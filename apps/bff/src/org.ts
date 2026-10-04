/**
 * Организация (R013, сценарий 6, FR-013, FR-004): потоки «добавить человека», «отключить» и
 * «включить» (TASK-000974).
 *
 * Оркеструет BFF, а не SPA: шаги идут в IAM (токен audience `iam`, scope `iam:people`) и в
 * ядро (audience `control-plane`) от имени вошедшего человека, токены не выходят из
 * процесса, а поток проверяется тестом без браузера. Шаги добавления:
 *   1. IAM principal (`kind=human`), 2. external identity (issuer IdP + subject),
 *   3. principal ядра, 4. iam-binding, 5. member workspace, 6. роли.
 * Поток идемпотентен и возобновляем без своего хранилища — состояние берётся у серверов:
 * - identity `(issuer IdP, subject)` — ключ человека: до шага 1 IAM спрашивается, чья она
 *   (`GET /external-identities?issuer=&subject=`). Есть — берётся этот IAM principal, так что
 *   повтор другим администратором (ключ идемпотентности IAM у каждого свой) дубля не заводит;
 * - `Idempotency-Key` шагов выводится из `flowId` (tenant IAM + e-mail);
 * - principal ядра несёт ввод в `metadata.onboarding`. Её может записать любой с
 *   `principals.write`, поэтому ей не верим: найденный по e-mail principal годится, только
 *   если identity из ввода принадлежит его `iamPrincipalId`, а связка этого IAM principal не
 *   стоит на другом principal ядра (иначе upsert связки перенаправил бы чужую — confused deputy);
 * - member и роли ядро делает идемпотентно.
 * Права связки называет администратор списком (консоль предлагает наборы, TAI-ADR-0068). До
 * шага 1 — права вызывающего ⊇ выдаваемым (или `admin`), иначе `403 permission_escalation`
 * с `missing`: IAM не должен завести человека, которому ядро потом откажет в связке.
 *
 * Перенесено из прежней консоли (`web/console/bff/src/org.ts`, R013, TASK-000974); профили
 * «участник/администратор» заменены списком прав.
 * Сбой источника посреди потока возвращает отчёт по пройденным шагам, а не 5xx.
 */
import { createHash, randomUUID } from 'node:crypto'
import { IdpAdminError, type IdpAdmin } from './idp-admin.ts'

export type Service = 'iam' | 'cp'
export interface Reply { status: number, body: Record<string, unknown> }
/**
 * Вызов наверх: IAM — путь от `/api/v1/tenants/{t}`, ядро — от `/api/v1`. Отказ и сбой
 * источника (5xx, сеть — `503 upstream_unavailable`) приходят ответом, а не исключением.
 */
export type Call = (service: Service, method: 'GET' | 'POST', path: string, init?: { body?: unknown, key?: string }) => Promise<Reply>

export interface OrgContext {
  call: Call
  iamTenantId: string
  /** Issuer IAM — половина пары связки ядра (из `iss` токена ядра вошедшего). */
  iamIssuer: string
  /** Issuer внешнего IdP — у него и заведена учётка человека (external identity). */
  idpIssuer: string
  loginUrl: (email: string) => string
  /** Заводить пользователя у провайдера входа (`idp-admin.ts`); нет — `sub` вводит администратор. */
  idpAdmin?: IdpAdmin | null
}

export const STEPS = ['iam_principal', 'identity', 'cp_principal', 'binding', 'member', 'roles'] as const
/** `idp_user` — первый шаг, только когда пользователя у провайдера заводит консоль. */
export type StepName = 'idp_user' | typeof STEPS[number]
export interface Step { name: StepName, status: 'pending' | 'done' | 'reused' | 'failed', error?: { status: number, code: string, missing?: string[] } }

/** Право ядра: `tasks.read`, `admin`. */
const PERMISSION = /^[a-z][a-z_]*(\.[a-z_]+)*$/
const MAX_PERMISSIONS = 80

/** Список прав из тела: строки-права без повторов; пусто или не то — `null`. */
export function parsePermissions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PERMISSIONS) return null
  if (!value.every(p => typeof p === 'string' && p.length <= 64 && PERMISSION.test(p))) return null
  return [...new Set(value as string[])].sort()
}

/** `subject` — `sub` у провайдера; пусто, если `createIdpUser`: его даст созданный пользователь. */
export interface PersonInput { displayName: string, email: string, subject: string, workspaceId: string, roleIds: string[], permissions: string[], createIdpUser?: boolean }
export interface FlowReport {
  flowId: string, complete: boolean, steps: Step[], iamPrincipalId: string | null, cpPrincipalId: string | null, loginUrl: string | null
  /** Пользователь у провайдера, если его заводила консоль; временный пароль — только у нового, один раз. */
  idpUser?: { created: boolean, temporaryPassword?: string }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/
/** Страниц одного списка, после которых поиск честно говорит «проверил не всё». */
export const MAX_PAGES = 20
const PARALLEL = 4

/**
 * Разбор тела «добавить человека»; `null` — тело не годится (`422 invalid_person`).
 * `subject` обязателен и без умолчания: IAM сверяет вход по claim `subjectClaim` провайдера
 * (у Dex и Keycloak это `sub`), а e-mail как subject без проверки `email_verified` открывал
 * бы захват учётки. Исключение — `createIdpUser`: пользователя заводит консоль, `sub` — его id.
 */
export function parsePerson(value: unknown): PersonInput | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const text = (x: unknown, max: number): string | null => typeof x === 'string' && x.trim() !== '' && x.trim().length <= max ? x.trim() : null
  const displayName = text(v.displayName, 200)
  const email = text(v.email, 254)?.toLowerCase() ?? null
  const subject = text(v.subject, 500)
  const workspaceId = typeof v.workspaceId === 'string' && UUID.test(v.workspaceId) ? v.workspaceId : null
  const roleIds = Array.isArray(v.roleIds) && v.roleIds.length <= 20 && v.roleIds.every(r => typeof r === 'string' && UUID.test(r)) ? [...new Set(v.roleIds as string[])] : null
  const permissions = parsePermissions(v.permissions)
  const createIdpUser = v.createIdpUser === true
  if (displayName === null || email === null || !EMAIL.test(email) || (subject === null && !createIdpUser) || workspaceId === null || roleIds === null || permissions === null) return null
  return { displayName, email, subject: subject ?? '', workspaceId, roleIds, permissions, ...(createIdpUser ? { createIdpUser } : {}) }
}

export const flowIdOf = (iamTenantId: string, email: string): string =>
  createHash('sha256').update(`${iamTenantId}|${email.toLowerCase()}`).digest('hex').slice(0, 32)

export class StepFailed extends Error {
  readonly error: NonNullable<Step['error']>
  constructor(reply: Reply) {
    super('step failed')
    const err = reply.body.error as { code?: unknown, details?: { missing?: unknown } } | undefined
    const code = typeof reply.body.detail === 'string' ? reply.body.detail : typeof err?.code === 'string' ? err.code : `http_${reply.status}`
    const missing = Array.isArray(err?.details?.missing) ? err.details.missing.filter((m): m is string => typeof m === 'string') : undefined
    this.error = { status: reply.status, code, ...(missing !== undefined ? { missing } : {}) }
  }
}

const refuse = (status: number, code: string, missing?: string[]): StepFailed =>
  new StepFailed({ status, body: { error: { code, ...(missing !== undefined ? { details: { missing } } : {}) } } })
const ok = (reply: Reply): Reply => {
  if (reply.status < 200 || reply.status > 299) throw new StepFailed(reply)
  return reply
}
type Row = Record<string, unknown>
const items = (reply: Reply): Row[] => Array.isArray(reply.body.items) ? reply.body.items as Row[] : []
const onboarding = (p: Row): Row | null => {
  const o = (p.metadata as Row | undefined)?.onboarding
  return typeof o === 'object' && o !== null ? o as Row : null
}

/** `fn` над элементами не больше чем по `PARALLEL` сразу. */
async function each<T>(list: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...list]
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next)
  }))
}

/** Все страницы списка ядра (курсор `nextCursor`); `complete=false` — упёрлись в MAX_PAGES. */
async function cpPages(call: Call, path: string): Promise<{ items: Row[], complete: boolean }> {
  const all: Row[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const reply = ok(await call('cp', 'GET', `${path}${path.includes('?') ? '&' : '?'}limit=200${cursor !== null ? `&cursor=${encodeURIComponent(cursor)}` : ''}`))
    all.push(...items(reply))
    cursor = typeof reply.body.nextCursor === 'string' ? reply.body.nextCursor : null
    if (cursor === null) return { items: all, complete: true }
  }
  return { items: all, complete: false }
}

/**
 * Чья identity `(issuer, subject)` в IAM: id principal или null. Маршрута нет (IAM без
 * чтения identity) — отказ `identity_unverifiable`: без проверки поток не идёт (fail closed).
 */
async function identityOwner(ctx: OrgContext, subject: string): Promise<string | null> {
  const issuer = idpIssuer(ctx)
  const reply = await ctx.call('iam', 'GET', `/external-identities?issuer=${encodeURIComponent(issuer)}&subject=${encodeURIComponent(subject)}`)
  if (reply.status === 405 || (reply.status === 404 && reply.body.detail === 'Not Found')) throw refuse(501, 'identity_unverifiable')
  const found = items(ok(reply)).find(i => i.issuer === issuer && i.subject === subject)
  if (found === undefined) return null
  // Ответ не той формы — не гадаем, чья identity (fail closed).
  if (typeof found.principal_id !== 'string' || found.principal_id === '') throw refuse(502, 'identity_unverifiable')
  if (found.status !== 'active') throw refuse(409, 'identity_disabled')
  return found.principal_id
}

/** Issuer IdP так, как его хранит IAM: без `/` на конце, сравнение точное. */
const idpIssuer = (ctx: OrgContext): string => ctx.idpIssuer.replace(/\/+$/, '')

/** IAM principal годится в человека потока: человек и активен. */
async function requireIamHuman(ctx: OrgContext, id: string): Promise<void> {
  const p = ok(await ctx.call('iam', 'GET', `/principals/${id}`)).body
  if (p.kind !== 'human') throw refuse(409, 'identity_mismatch')
  if (p.status !== 'active') throw refuse(409, 'person_disabled')
}

/**
 * Строка связки ядра уникальна по паре `(issuer IAM, iamPrincipalId)`, а upsert
 * перенаправляет её на свой principal и активирует. Поэтому пара, стоящая на другом principal
 * (любой строкой, любого статуса), — отказ: на отключённом — `person_disabled` (иначе
 * отключённый вошёл бы снова), на активном — `identity_bound_elsewhere`. Поиск — до первой находки.
 */
async function requireFreePair(ctx: OrgContext, everyone: Row[], iamId: string, own: string | null): Promise<void> {
  let holder: Row | null = null
  await each(everyone.filter(p => p.id !== own), async (p) => {
    if (holder !== null) return
    const rows = items(ok(await ctx.call('cp', 'GET', `/principals/${String(p.id)}/iam-bindings`)))
    if (rows.some(b => b.issuer === ctx.iamIssuer && b.iamPrincipalId === iamId)) holder ??= p
  })
  const found = holder as Row | null
  if (found !== null) throw refuse(409, found.status === 'active' ? 'identity_bound_elsewhere' : 'person_disabled')
}

/** Каких из выдаваемых прав нет у вызывающего (пусто — выдать может). `admin` включает всё — так решает ядро. */
export function missingFor(held: readonly unknown[], wanted: readonly string[]): string[] {
  if (held.includes('admin')) return []
  return wanted.filter(p => !held.includes(p))
}

/** Права связки вошедшего в ядре (`GET /harness/context`). */
async function callerPermissions(ctx: OrgContext): Promise<unknown[]> {
  const caller = ok(await ctx.call('cp', 'GET', '/harness/context')).body
  return Array.isArray(caller.permissions) ? caller.permissions as unknown[] : []
}

export async function addPerson(ctx: OrgContext, request: PersonInput): Promise<FlowReport> {
  const { call } = ctx
  let input = request
  const flowId = flowIdOf(ctx.iamTenantId, input.email)
  const key = (step: string): string => `console-person-${flowId}-${step}`
  const names: StepName[] = input.createIdpUser === true ? ['idp_user', ...STEPS] : [...STEPS]
  const steps: Step[] = names.map(name => ({ name, status: 'pending' }))
  const report: FlowReport = { flowId, complete: false, steps, iamPrincipalId: null, cpPrincipalId: null, loginUrl: null }
  let current: StepName = 'iam_principal'
  const done = (name: StepName, status: Step['status'] = 'done'): void => { steps[names.indexOf(name)]!.status = status }
  try {
    // Права вызывающего ⊇ выдаваемым (или `admin`) — до IAM: иначе IAM завёл бы человека
    // (principal и identity), а ядро отказало бы на связке `403 permission_escalation`.
    const missing = missingFor(await callerPermissions(ctx), input.permissions)
    if (missing.length > 0) throw refuse(403, 'permission_escalation', missing)
    // все principal ядра любого вида и статуса: по ним же ищется, на ком стоит пара связки
    const everyone = await cpPages(call, '/principals')
    if (!everyone.complete) throw refuse(409, 'lookup_incomplete')
    const sameEmail = everyone.items.filter(p => p.kind === 'human' && onboarding(p)?.email === input.email)
    const found = sameEmail.find(p => p.status === 'active')
    if (found === undefined && sameEmail.length > 0) throw refuse(409, 'person_disabled')
    if (input.createIdpUser === true) {
      // Пользователь у провайдера — после проверок прав и отключённых, до IAM: его id и есть `sub`.
      current = 'idp_user'
      if (ctx.idpAdmin == null) throw refuse(501, 'idp_admin_disabled')
      let user
      try {
        user = await ctx.idpAdmin.ensureUser({ email: input.email, displayName: input.displayName })
      } catch (error) {
        if (error instanceof IdpAdminError) throw refuse(error.status, error.code)
        throw error
      }
      input = { ...input, subject: user.id }
      report.idpUser = { created: user.created, ...(user.temporaryPassword !== undefined ? { temporaryPassword: user.temporaryPassword } : {}) }
      done(current, user.created ? 'done' : 'reused')
      current = 'iam_principal'
    }
    const owner = await identityOwner(ctx, input.subject)
    if (found !== undefined) {
      // Повтор: metadata не доказательство — identity из ввода должна быть у её iam principal.
      const iamId = String(onboarding(found)!.iamPrincipalId)
      current = 'identity'
      if (owner !== iamId) throw refuse(409, 'identity_mismatch')
      await requireIamHuman(ctx, iamId)
      await requireFreePair(ctx, everyone.items, iamId, String(found.id))
      report.iamPrincipalId = iamId
      report.cpPrincipalId = String(found.id)
      for (const name of ['iam_principal', 'identity', 'cp_principal'] as const) done(name, 'reused')
    } else {
      if (owner !== null) {
        // Человека уже завели (в том числе другой администратор) — берём его, а не второго.
        await requireIamHuman(ctx, owner)
        report.iamPrincipalId = owner
        done(current, 'reused')
      } else {
        const iam = ok(await call('iam', 'POST', '/principals', { body: { kind: 'human', displayName: input.displayName }, key: key('iam') }))
        report.iamPrincipalId = String(iam.body.id)
        done(current)
      }
      current = 'identity'
      if (owner !== null) done(current, 'reused')
      else {
        const linked = await call('iam', 'POST', `/principals/${report.iamPrincipalId}/external-identities`, { body: { issuer: idpIssuer(ctx), subject: input.subject } })
        // У principal уже есть другая identity — не та, что в вводе (иначе нашли бы её выше).
        if (linked.status === 409 && linked.body.detail === 'principal_has_identity') throw refuse(409, 'identity_mismatch')
        // Пара уже есть, но поиск в tenant её не видел — она у principal вне tenant или без membership.
        if (linked.status === 409 && linked.body.detail === 'external_identity_exists') throw refuse(409, 'identity_bound_elsewhere')
        ok(linked)
        done(current)
      }
      current = 'cp_principal'
      // До создания principal ядра: пара этого IAM principal уже может стоять на другом
      // (в том числе отключённом) — тогда новый principal не заводится вовсе.
      if (owner !== null) await requireFreePair(ctx, everyone.items, report.iamPrincipalId, null)
      const metadata = { onboarding: { source: 'console', flowId, email: input.email, subject: input.subject, iamPrincipalId: report.iamPrincipalId, workspaceId: input.workspaceId, roleIds: input.roleIds, permissions: input.permissions } }
      const cp = ok(await call('cp', 'POST', '/principals', { body: { kind: 'human', displayName: input.displayName, metadata }, key: key('cp') }))
      report.cpPrincipalId = String(cp.body.id)
      done(current)
    }
    const cpId = report.cpPrincipalId
    current = 'binding'
    const pair = (b: Row): boolean => b.status === 'active' && b.issuer === ctx.iamIssuer && b.iamPrincipalId === report.iamPrincipalId
    if (items(ok(await call('cp', 'GET', `/principals/${cpId}/iam-bindings`))).some(pair)) done(current, 'reused')
    else {
      ok(await call('cp', 'POST', `/principals/${cpId}/iam-bindings`, {
        body: { issuer: ctx.iamIssuer, iamTenantId: ctx.iamTenantId, iamPrincipalId: report.iamPrincipalId, permissions: input.permissions },
        key: key('binding'),
      }))
      done(current)
    }
    current = 'member'
    ok(await call('cp', 'POST', `/workspaces/${input.workspaceId}/members`, { body: { principalId: cpId }, key: key(`member-${input.workspaceId}`) }))
    done(current)
    current = 'roles'
    for (const roleId of input.roleIds) {
      ok(await call('cp', 'POST', `/principals/${cpId}/roles`, { body: { roleId, workspaceId: input.workspaceId }, key: key(`role-${roleId}-${input.workspaceId}`) }))
    }
    done(current)
    report.complete = true
    report.loginUrl = ctx.loginUrl(input.email)
  } catch (error) {
    if (!(error instanceof StepFailed)) throw error
    steps[names.indexOf(current)] = { name: current, status: 'failed', error: error.error }
  }
  return report
}

export interface Pending {
  kind: 'core' | 'iam_only'
  displayName: string
  iamPrincipalId: string | null
  cpPrincipalId: string | null
  /** Что ввёл администратор (из metadata ядра) — «Довести» повторяет поток с ним. */
  input: PersonInput | null
  missing: StepName[]
}

/**
 * Недоведённые добавления по данным серверов. `iam=false` — у вошедшего нет `iam:people`:
 * видны только недоведённые в ядре. `truncated` — какой-то список упёрся в MAX_PAGES,
 * и проверено не всё.
 */
export async function pendingPeople(ctx: OrgContext, iam: boolean): Promise<{ items: Pending[], truncated: boolean }> {
  const { call } = ctx
  const people = await cpPages(call, '/principals?kind=human')
  let truncated = !people.complete
  const pending: Pending[] = []
  const known = new Set<string>()
  const members = new Map<string, Promise<{ items: Row[], complete: boolean }>>()
  await each(people.items.filter(p => p.status === 'active'), async (p) => {
    const bindings = items(ok(await call('cp', 'GET', `/principals/${String(p.id)}/iam-bindings`)))
    for (const b of bindings) known.add(String(b.iamPrincipalId))
    const o = onboarding(p)
    if (o === null) return
    const input = parsePerson({ ...o, displayName: p.displayName })
    if (input === null) return
    known.add(String(o.iamPrincipalId))
    const missing: StepName[] = []
    if (!bindings.some(b => b.status === 'active' && b.iamPrincipalId === o.iamPrincipalId)) missing.push('binding')
    if (!members.has(input.workspaceId)) members.set(input.workspaceId, cpPages(call, `/workspaces/${input.workspaceId}/members`))
    const ws = await members.get(input.workspaceId)!
    if (!ws.complete) truncated = true
    if (!ws.items.some(m => m.principalId === p.id)) missing.push('member')
    const roles = items(ok(await call('cp', 'GET', `/principals/${String(p.id)}/roles`)))
    const held = new Set(roles.filter(r => r.workspaceId === input.workspaceId).map(r => String((r.role as { id?: unknown } | undefined)?.id)))
    if (input.roleIds.some(r => !held.has(r))) missing.push('roles')
    if (missing.length > 0) pending.push({ kind: 'core', displayName: String(p.displayName), iamPrincipalId: String(o.iamPrincipalId), cpPrincipalId: String(p.id), input, missing })
  })
  if (iam) {
    let after: string | null = null
    for (let page = 0; ; page++) {
      if (page === MAX_PAGES) { truncated = true; break }
      const reply = ok(await call('iam', 'GET', `/principals?kind=human&limit=500${after !== null ? `&after=${encodeURIComponent(after)}` : ''}`))
      for (const p of items(reply)) {
        if (p.status !== 'active' || known.has(String(p.id))) continue
        pending.push({ kind: 'iam_only', displayName: String(p.display_name), iamPrincipalId: String(p.id), cpPrincipalId: null, input: null, missing: ['identity', 'cp_principal', 'binding', 'member', 'roles'] })
      }
      after = typeof reply.body.next_after === 'string' ? reply.body.next_after : null
      if (after === null) break
    }
  }
  return { items: pending, truncated }
}

export interface DisableReport { complete: boolean, iam: Step['status'] | 'skipped', cp: Step['status'], error?: Step['error'] & { service: Service }, principal?: Record<string, unknown> }

/**
 * Отключить человека: сначала IAM (вход и PAT закрываются сразу), потом ядро (связки,
 * сессии, claims, прогоны — CP-ADR-0077). До IAM — ворота ядра (`POST /authz:check`, действие
 * `principal disable`): право, «себя нельзя», агент реестра и «администратора отключает только
 * администратор» — по связкам и по живым API-ключам цели, которых консоль не видит. Своими
 * проверками консоль этого не решает: иначе не-администратор закрыл бы в IAM вход тому, у кого
 * admin в ключе, а ядро потом отказало бы, оставив IAM закрытым.
 * Отказ ядра после IAM — частичное состояние закрыто (вход уже закрыт); повтор доводит.
 */
export async function disablePerson(ctx: OrgContext, cpPrincipalId: string, reason: string | null): Promise<DisableReport> {
  const { call } = ctx
  const report: DisableReport = { complete: false, iam: 'pending', cp: 'pending' }
  let service: Service = 'cp'
  try {
    const principal = ok(await call('cp', 'GET', `/principals/${cpPrincipalId}`)).body
    if (principal.kind !== 'human') throw refuse(409, principal.kind === 'agent' ? 'use_agent_retire' : 'principal_kind_not_disableable')
    // Предусловия ядра — до IAM: иначе IAM закрыл бы вход в обход ядра.
    await coreGate(ctx, 'disable', cpPrincipalId)
    const bindings = items(ok(await call('cp', 'GET', `/principals/${cpPrincipalId}/iam-bindings`)))
    const iamIds = [...new Set(bindings.filter(b => b.issuer === ctx.iamIssuer && b.iamTenantId === ctx.iamTenantId).map(b => String(b.iamPrincipalId)))]
    service = 'iam'
    for (const id of iamIds) ok(await call('iam', 'POST', `/principals/${id}:disable?reason=principal_disabled`))
    report.iam = iamIds.length > 0 ? 'done' : 'skipped'
    service = 'cp'
    report.principal = ok(await call('cp', 'POST', `/principals/${cpPrincipalId}:disable`, { body: reason !== null ? { reason } : {}, key: randomUUID() })).body
    report.cp = 'done'
    report.complete = true
  } catch (error) {
    if (!(error instanceof StepFailed)) throw error
    report[service] = 'failed'
    report.error = { service, ...error.error }
  }
  return report
}

export interface EnableReport {
  complete: boolean
  iam: Step['status']
  cp: Step['status']
  binding: Step['status']
  /** Права связки по итогу: новой — названные оператором, уже живой — её фактические. */
  permissions: string[] | null
  error?: Step['error'] & { service: Service }
  principal?: Record<string, unknown>
}

/** Код отказа ворот ядра → HTTP-статус эндпоинта (`POST /authz:check` отдаёт только код). */
const DENIAL_STATUS: Record<string, number> = {
  permission_denied: 403, permission_escalation: 403, outside_purpose: 403, not_found: 404,
  principal_kind_not_enableable: 422, principal_kind_not_disableable: 422,
}

/**
 * Ворота ядра для `principal enable|disable` (`POST /authz:check`, CP-ADR-0055): те же проверки,
 * что у эндпоинта, без записи. Отказ — `StepFailed` с кодом эндпоинта и `missing`
 * (`details.missing` или `details.required`).
 */
async function coreGate(ctx: OrgContext, action: 'enable' | 'disable', cpPrincipalId: string): Promise<void> {
  const checked = ok(await ctx.call('cp', 'POST', '/authz:check', { body: { checks: [{ action, resourceType: 'principal', resourceId: cpPrincipalId }] } }))
  const answer = (Array.isArray(checked.body.results) ? checked.body.results[0] : undefined) as Row | undefined
  if (answer?.allowed === true) return
  const reason = (answer?.reason ?? {}) as { code?: unknown, details?: Row }
  const code = typeof reason.code === 'string' ? reason.code : 'permission_denied'
  const listed = reason.details?.missing ?? reason.details?.required
  throw refuse(DENIAL_STATUS[code] ?? 409, code, Array.isArray(listed) ? listed.filter((m): m is string => typeof m === 'string') : undefined)
}

/** Ключ идемпотентности от SPA (общий `<Action>`): годный — берётся, иначе свой. */
export const flowKey = (key: string | undefined): string =>
  key !== undefined && /^[A-Za-z0-9._:-]{8,100}$/.test(key) ? key : randomUUID()

/**
 * Включить человека (CP-ADR-0077, амендмент «Включение»; IAM ADR-0002 п.12): сначала IAM
 * (`:enable`, вход снова возможен), потом ядро (`:enable`), потом новая связка — отозванные
 * при отключении связки не восстанавливаются, права называет оператор заново (`permissions`;
 * амендмент п.2).
 *
 * Чей вход открывается, берётся только из собственных строк связки principal ядра с нашим
 * issuer и tenant. Строка уникальна по паре `(issuer IAM, iamPrincipalId)`, так что эта пара
 * ни на ком другом не стоит, и upsert её никуда не перенаправит. `metadata.onboarding` здесь не
 * читается вовсе: её пишет любой с `principals.write`, и по ней «Включить» перевёл бы на
 * подставной principal чужую связку. Строк нет — человек ни разу не входил через связку,
 * включать нечего: `409 iam_principal_unknown`.
 *
 * До IAM — ворота ядра (`POST /authz:check`, действие `principal enable`: право, вид, агент
 * реестра, эскалация по живым ключам) и, если связку придётся ставить, права вызывающего ⊇
 * правам профиля (или `admin`): иначе IAM открыл бы вход, а ядро отказало бы на связке
 * (`403 permission_escalation` с `missing`). Ключи идемпотентности шагов — от ключа подтверждения `<Action>`: повтор после
 * сбоя доводит, не выполняя сделанное дважды (IAM и ядро отвечают сохранённым).
 *
 * Principal ядра уже `active` — ядро не вызывается (`cp: reused`). Вход в IAM читается (`GET`):
 * открыт — `iam: reused`; закрыт (частичное отключение) — открывает его только администратор
 * (`:enable`, `iam: done`), остальным честный отказ `403 iam_login_closed`: ворота ядра
 * активного пропускают без проверки эскалации, и иначе не-администратор открыл бы вход, например,
 * администратору. Связка: живая есть — берётся она, и в отчёте её фактический профиль (второй
 * связки нет, выбранный профиль не проверяется); нет — ставится с выбранным профилем.
 */
export async function enablePerson(ctx: OrgContext, cpPrincipalId: string, options: { reason: string | null, key: string, permissions: string[] }): Promise<EnableReport> {
  const { call } = ctx
  const { permissions } = options
  const report: EnableReport = { complete: false, iam: 'pending', cp: 'pending', binding: 'pending', permissions }
  const key = (step: string): string => `console-enable-${options.key}-${step}`
  // Предусловия до IAM — отказ ядра (`cp`); дальше шаг, на котором остановились.
  let step: 'iam' | 'cp' | 'binding' = 'cp'
  try {
    const principal = ok(await call('cp', 'GET', `/principals/${cpPrincipalId}`)).body
    if (principal.kind !== 'human') throw refuse(409, principal.kind === 'agent' ? 'use_agent_publish' : 'principal_kind_not_enableable')
    await coreGate(ctx, 'enable', cpPrincipalId)
    const held = await callerPermissions(ctx)
    // Выдать больше, чем держит сам, вызывающий не может (ядро: 403 permission_escalation) —
    // проверяется до IAM, но только если связку придётся ставить (см. ниже).
    const missing = missingFor(held, permissions)
    const escalation = (): StepFailed => refuse(403, 'permission_escalation', missing)
    if (principal.status !== 'active' && missing.length > 0) throw escalation()
    const bindings = items(ok(await call('cp', 'GET', `/principals/${cpPrincipalId}/iam-bindings`)))
    const iamIds = [...new Set(bindings
      .filter(b => b.issuer === ctx.iamIssuer && b.iamTenantId === ctx.iamTenantId && typeof b.iamPrincipalId === 'string' && UUID.test(b.iamPrincipalId))
      .map(b => String(b.iamPrincipalId)))]
    // Своих строк нет — связку не на что ставить, а metadata не доказательство (см. выше).
    if (iamIds.length === 0) throw refuse(409, 'iam_principal_unknown')
    const live = (rows: Row[], id: string): Row[] => rows.filter(b => b.status === 'active' && b.issuer === ctx.iamIssuer && b.iamPrincipalId === id)
    if (principal.status === 'active') {
      // Уже включён в ядре: так доводится свой повтор «ядро включено, связка не выдана» (свой
      // поток открывает IAM раньше ядра) и частичное отключение «IAM закрыт, ядро нет». Живая
      // связка есть и ставить нечего — права не проверяются: оператор ничего не выдаёт.
      if (missing.length > 0 && iamIds.some(id => live(bindings, id).length === 0)) throw escalation()
      report.cp = 'reused'
      report.principal = principal
      // Вход в IAM — по его собственному статусу. Ворота ядра активного пропускают без проверки
      // эскалации, поэтому закрытый вход открывает только администратор: иначе не-администратор
      // открыл бы его, например, администратору, отключённому частично. Для администратора
      // `:enable` эскалации не создаёт.
      step = 'iam'
      let opened = false
      for (const id of iamIds) {
        const iam = ok(await call('iam', 'GET', `/principals/${id}`)).body
        if (iam.status === 'active') continue
        if (!held.includes('admin')) throw refuse(403, 'iam_login_closed')
        ok(await call('iam', 'POST', `/principals/${id}:enable`, { key: key(`iam-${id}`) }))
        opened = true
      }
      report.iam = opened ? 'done' : 'reused'
    } else {
      step = 'iam'
      for (const id of iamIds) ok(await call('iam', 'POST', `/principals/${id}:enable`, { key: key(`iam-${id}`) }))
      report.iam = 'done'
      step = 'cp'
      report.principal = ok(await call('cp', 'POST', `/principals/${cpPrincipalId}:enable`, { body: options.reason !== null ? { reason: options.reason } : {}, key: key('cp') })).body
      report.cp = 'done'
    }
    step = 'binding'
    const now = items(ok(await call('cp', 'GET', `/principals/${cpPrincipalId}/iam-bindings`)))
    // Права в отчёте — фактические: у живой связки её, у новой — названные оператором.
    const actual: string[][] = []
    let created = false
    for (const id of iamIds) {
      const rows = live(now, id)
      if (rows.length > 0) {
        actual.push(...rows.map(b => (Array.isArray(b.permissions) ? b.permissions.filter((p): p is string => typeof p === 'string') : [])))
        continue
      }
      // Связка пропала между чтениями — ставится она только в пределах прав вызывающего.
      if (missing.length > 0) throw escalation()
      ok(await call('cp', 'POST', `/principals/${cpPrincipalId}/iam-bindings`, {
        body: { issuer: ctx.iamIssuer, iamTenantId: ctx.iamTenantId, iamPrincipalId: id, permissions },
        key: key(`binding-${id}`),
      }))
      actual.push(permissions)
      created = true
    }
    report.binding = created ? 'done' : 'reused'
    report.permissions = actual.every(p => p.join() === actual[0]?.join()) ? actual[0] ?? null : null
    report.complete = true
  } catch (error) {
    if (!(error instanceof StepFailed)) throw error
    report[step] = 'failed'
    report.error = { service: step === 'iam' ? 'iam' : 'cp', ...error.error }
  }
  return report
}
