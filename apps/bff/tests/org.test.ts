import { afterEach, describe, expect, it } from 'vitest'
import { addPerson, disablePerson, enablePerson, flowIdOf, flowKey, MAX_PAGES, missingFor, parsePermissions, parsePerson, pendingPeople, type Call, type OrgContext, type PersonInput, type Reply } from '../src/org.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AllowList, CONTROL_PLANE_MUTATIONS } from '../src/allowlist.ts'
import { world } from './world.ts'

const TENANT = 'a1000000-0000-4000-8000-0000000000a1'
const WS = '11111111-1111-4111-8111-111111111111'
const ROLE = '22222222-2222-4222-8222-222222222222'
const IAM_ISS = 'https://cp.example.test/iam'
const IDP = 'https://idp.example.test'
/** Права «участника» прежней консоли (набор «Работа» консоли — та же роль) и администратора. */
const MEMBER = [
  'principals.read', 'sessions.open', 'tasks.read', 'tasks.write', 'tasks.claim', 'claims.manage', 'events.read',
  'workspaces.read', 'org.read', 'artifacts.read', 'artifacts.write', 'approvals.read', 'approvals.decide',
  'observations.write', 'projects.read', 'task_types.read', 'skills.invoke', 'goals.read', 'rules.read',
  'artifact_types.read', 'agents.read', 'processes.read',
].sort()
const ADMIN = ['admin']
const INPUT: PersonInput = { displayName: 'Мария', email: 'maria@example.test', subject: 'sub-maria', workspaceId: WS, roleIds: [ROLE], permissions: MEMBER }

type Row = Record<string, unknown>
/**
 * Перенесено из прежней консоли (`web/console/bff/tests/org.test.ts`); профили — списками прав.
 *
 * Поддельные IAM и ядро в памяти с их семантикой: IAM помнит ключ создания principal
 * бессрочно и за вызывающим (`caller`), ядро — пока не «истёк» (`forget()`), связка — upsert
 * по паре, member и роли идемпотентны. `fail`: ответ-отказ до действия или `'lost'` —
 * действие сделано, а ответ потерян (503).
 */
function fake(options: { identityRead?: boolean, callerPermissions?: string[], callerId?: string, endlessPages?: boolean, check?: Row, checkAction?: 'enable' | 'disable' } = {}) {
  let n = 0
  const id = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const iam = { principals: [] as Row[], identities: [] as Row[], keys: new Map<string, Row>(), caller: 'admin-1' }
  // права вызывающего в ядре — меняются посреди теста (завели админом, действует не-админ)
  const caller = { permissions: options.callerPermissions ?? ['admin'] }
  const cp = { principals: [] as Row[], bindings: [] as Row[], members: [] as Row[], roles: [] as Row[], keys: new Map<string, Row>() }
  const log: string[] = []
  const keys: string[] = []
  const fail = new Map<string, Reply | 'lost'>()
  const r = (status: number, body: Row = {}): Reply => ({ status, body })
  const deny = (code: string, details: Row = {}): Row => ({ allowed: false, reason: { code, message: code, details } })
  /**
   * Ворота ядра `principal disable` (principal_disable.disable_gate): право, повтор на
   * отключённом, себя нельзя, admin цели — в связках или в живом API-ключе (`adminKey`,
   * консоли не виден). `enable` пропускается. `check` — заданный ответ на `checkAction`.
   */
  const gate = (c: Row): Row => {
    if (c.action !== 'disable') return { allowed: true, reason: null }
    const held = caller.permissions
    if (!held.includes('admin') && !held.includes('principals.write')) return deny('permission_denied', { required: ['principals.write'] })
    const target = cp.principals.find(p => p.id === c.resourceId)
    if (target === undefined) return deny('not_found')
    if (target.status === 'disabled') return { allowed: true, reason: null }
    if (target.id === (options.callerId ?? 'caller-cp')) return deny('cannot_disable_self')
    const admin = target.adminKey === true || cp.bindings.some(b => b.principalId === target.id && b.status !== 'revoked' && (b.permissions as string[]).includes('admin'))
    if (admin && !held.includes('admin')) return deny('permission_escalation', { missing: ['admin'] })
    return { allowed: true, reason: null }
  }
  const act = (service: string, method: string, path: string, body: Row, key: string | undefined): Reply => {
    const [bare = '', query = ''] = path.split('?')
    const seg = bare.split('/')
    if (service === 'iam') {
      if (method === 'GET' && bare === '/external-identities') {
        if (options.identityRead === false) return r(404, { detail: 'Not Found' })
        const q = new URLSearchParams(query)
        // identity чужого tenant (hidden) поиск не показывает, но пара занята
        return r(200, { items: iam.identities.filter(i => i.hidden !== true && i.issuer === q.get('issuer') && i.subject === q.get('subject')).map(({ hidden: _, ...i }) => i) })
      }
      if (method === 'GET' && bare === '/principals') return r(200, { items: iam.principals, next_after: null })
      if (method === 'GET') return iam.principals.find(p => p.id === seg[2]) !== undefined ? r(200, iam.principals.find(p => p.id === seg[2])!) : r(404, { detail: 'principal_not_found' })
      if (bare === '/principals') {
        const known = iam.keys.get(`${iam.caller}|${key!}`)
        if (known !== undefined) return r(201, known)
        const p = { id: id(), kind: 'human', display_name: body.displayName, status: 'active' }
        iam.principals.push(p)
        iam.keys.set(`${iam.caller}|${key!}`, p)
        return r(201, p)
      }
      if (bare.endsWith('/external-identities')) {
        // как в IAM: сначала проверка онбординга (identity у цели уже есть), потом уникальность пары
        if (iam.identities.some(i => i.principal_id === seg[2])) return r(409, { detail: 'principal_has_identity' })
        if (iam.identities.some(i => i.issuer === body.issuer && i.subject === body.subject)) return r(409, { detail: 'external_identity_exists' })
        iam.identities.push({ principal_id: seg[2], issuer: body.issuer, subject: body.subject, status: 'active' })
        return r(201, {})
      }
      const target = iam.principals.find(p => p.id === seg[2]!.split(':')[0])!
      if (bare.endsWith(':enable')) {
        // как в IAM: из disabled — в active, active — no-op; paused — свой отказ
        if (target.status === 'paused') return r(409, { detail: 'principal_paused' })
        const previousStatus = target.status
        target.status = 'active'
        return r(200, { principalId: target.id, status: 'active', previousStatus })
      }
      target.status = 'disabled'
      return r(200, {})
    }
    if (method === 'GET' && bare === '/principals') return r(200, { items: cp.principals, nextCursor: options.endlessPages === true ? 'more' : null })
    if (method === 'GET' && bare === '/harness/context') return r(200, { principal: { id: options.callerId ?? 'caller-cp' }, permissions: caller.permissions })
    if (method === 'GET' && bare.endsWith('/iam-bindings')) return r(200, { items: cp.bindings.filter(b => b.principalId === seg[2]) })
    if (method === 'GET' && bare.endsWith('/roles')) return r(200, { items: cp.roles.filter(x => x.principalId === seg[2]) })
    if (method === 'GET' && bare.endsWith('/members')) return r(200, { items: cp.members.filter(m => m.workspaceId === seg[2]), nextCursor: null })
    if (method === 'GET') return r(200, cp.principals.find(p => p.id === seg[2]) ?? {})
    if (bare === '/principals') {
      const known = cp.keys.get(key!)
      if (known !== undefined) return r(201, known)
      const p = { id: id(), kind: 'human', status: 'active', ...body }
      cp.principals.push(p)
      cp.keys.set(key!, p)
      return r(201, p)
    }
    if (bare.endsWith('/iam-bindings')) {
      cp.bindings = cp.bindings.filter(b => !(b.iamPrincipalId === body.iamPrincipalId && b.issuer === body.issuer))
      cp.bindings.push({ principalId: seg[2], status: 'active', ...body })
      return r(201, {})
    }
    if (bare.endsWith('/members')) {
      if (!cp.members.some(m => m.workspaceId === seg[2] && m.principalId === body.principalId)) cp.members.push({ workspaceId: seg[2], ...body })
      return r(201, {})
    }
    if (bare === '/authz:check') {
      const checks = body.checks as Row[]
      return r(200, { results: checks.map(c => ({ ...c, ...(options.check !== undefined && c.action === (options.checkAction ?? 'enable') ? options.check : gate(c)) })) })
    }
    if (bare.endsWith(':enable')) {
      const target = cp.principals.find(p => p.id === seg[2]!.split(':')[0])!
      target.status = 'active'
      return r(200, { ...target, liveApiKeys: 0 })
    }
    if (bare.endsWith('/roles')) {
      if (!cp.roles.some(x => x.principalId === seg[2] && (x.role as Row).id === body.roleId)) cp.roles.push({ principalId: seg[2], workspaceId: body.workspaceId, role: { id: body.roleId } })
      return r(201, {})
    }
    cp.principals.find(p => p.id === seg[2]!.split(':')[0])!.status = 'disabled'
    for (const b of cp.bindings) if (b.principalId === seg[2]!.split(':')[0]) b.status = 'revoked'
    return r(200, { status: 'disabled' })
  }
  const call: Call = async (service, method, path, init = {}) => {
    const route = `${service} ${method} ${path.split('?')[0]!.replace(/[0-9a-f-]{36}/g, '{id}')}`
    log.push(route)
    if (init.key !== undefined) keys.push(`${route} ${init.key}`)
    const planned = fail.get(route)
    if (planned !== undefined) fail.delete(route)
    if (planned !== undefined && planned !== 'lost') return planned
    const reply = act(service, method, path, (init.body ?? {}) as Row, init.key)
    return planned === 'lost' ? r(503, { detail: 'upstream_unavailable' }) : reply
  }
  const ctx: OrgContext = { call, iamTenantId: TENANT, iamIssuer: IAM_ISS, idpIssuer: IDP, loginUrl: e => `https://console.test/console/_auth/login?login_hint=${e}` }
  const counts = (): number[] => [iam.principals.length, iam.identities.length, cp.principals.length, cp.bindings.length, cp.members.length, cp.roles.length]
  return { ctx, iam, cp, caller, log, keys, fail, counts, forget: () => cp.keys.clear() }
}

const statuses = (report: { steps: { name: string, status: string }[] }): string[] => report.steps.map(s => `${s.name}:${s.status}`)
const failed = (report: { steps: { status: string, name: string, error?: { code: string } }[] }) => report.steps.find(s => s.status === 'failed')

describe('добавить человека', () => {
  it('все шаги по порядку, ключ идемпотентности у каждого создания, ссылка первого входа', async () => {
    const f = fake()
    const report = await addPerson(f.ctx, INPUT)
    expect(report.complete).toBe(true)
    expect(statuses(report)).toEqual(['iam_principal:done', 'identity:done', 'cp_principal:done', 'binding:done', 'member:done', 'roles:done'])
    expect(report.loginUrl).toBe('https://console.test/console/_auth/login?login_hint=maria@example.test')
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual([
      'iam POST /principals', 'iam POST /principals/{id}/external-identities', 'cp POST /principals',
      'cp POST /principals/{id}/iam-bindings', 'cp POST /workspaces/{id}/members', 'cp POST /principals/{id}/roles',
    ])
    expect(f.iam.identities).toEqual([{ principal_id: report.iamPrincipalId, issuer: IDP, subject: 'sub-maria', status: 'active' }])
    expect(f.cp.bindings[0]).toMatchObject({ issuer: IAM_ISS, iamTenantId: TENANT, iamPrincipalId: report.iamPrincipalId, permissions: MEMBER })
    expect(f.cp.principals[0]!.metadata).toMatchObject({ onboarding: { email: 'maria@example.test', iamPrincipalId: report.iamPrincipalId, flowId: flowIdOf(TENANT, INPUT.email) } })
  })

  it('ответ потерян после шага N — отчёт по пройденным шагам, повтор доводит без дублей', async () => {
    for (const [route, at] of [
      ['iam POST /principals', 'iam_principal'],
      ['iam POST /principals/{id}/external-identities', 'identity'],
      ['cp POST /principals', 'cp_principal'],
      ['cp POST /principals/{id}/iam-bindings', 'binding'],
      ['cp POST /workspaces/{id}/members', 'member'],
      ['cp POST /principals/{id}/roles', 'roles'],
    ] as const) {
      const f = fake()
      f.fail.set(route, 'lost')
      const first = await addPerson(f.ctx, INPUT)
      expect(first.complete, at).toBe(false)
      expect(failed(first), at).toMatchObject({ name: at, error: { status: 503, code: 'upstream_unavailable' } })
      const again = await addPerson(f.ctx, INPUT)
      expect(again.complete, at).toBe(true)
      expect(f.counts(), at).toEqual([1, 1, 1, 1, 1, 1])
    }
  })

  it('повтор другим администратором (свой ключ IAM) находит человека по identity, второго не заводит', async () => {
    const f = fake()
    f.fail.set('cp POST /principals', { status: 503, body: { detail: 'upstream_unavailable' } })
    await addPerson(f.ctx, INPUT)
    f.iam.caller = 'admin-2'
    const again = await addPerson(f.ctx, INPUT)
    expect(statuses(again).slice(0, 3)).toEqual(['iam_principal:reused', 'identity:reused', 'cp_principal:done'])
    expect(f.counts()).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('повтор готового потока ничего не создаёт, даже когда ключи ядра истекли', async () => {
    const f = fake()
    await addPerson(f.ctx, INPUT)
    f.forget()
    const again = await addPerson(f.ctx, INPUT)
    expect(statuses(again)).toEqual(['iam_principal:reused', 'identity:reused', 'cp_principal:reused', 'binding:reused', 'member:done', 'roles:done'])
    expect(f.counts()).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('B1: повтор с другим subject — identity_mismatch, ничего не меняется', async () => {
    // готовый поток: найден principal ядра, но identity из ввода не его
    const f = fake()
    await addPerson(f.ctx, INPUT)
    const other = await addPerson(f.ctx, { ...INPUT, subject: 'sub-other' })
    expect(failed(other)).toMatchObject({ name: 'identity', error: { code: 'identity_mismatch' } })
    // оборвался до ядра: IAM principal с identity A, повтор с B — principal_has_identity
    const g = fake()
    g.fail.set('cp POST /principals', { status: 503, body: {} })
    await addPerson(g.ctx, INPUT)
    const mismatch = await addPerson(g.ctx, { ...INPUT, subject: 'sub-other' })
    expect(failed(mismatch)).toMatchObject({ name: 'identity', error: { status: 409, code: 'identity_mismatch' } })
    expect(g.counts()).toEqual([1, 1, 0, 0, 0, 0])
  })

  it('чужая metadata.onboarding не даёт перенаправить связку (confused deputy)', async () => {
    const f = fake()
    // жертва: человек с identity и связкой на своём principal ядра
    const victim = await addPerson(f.ctx, { ...INPUT, email: 'victim@example.test', subject: 'sub-victim', displayName: 'Жертва' })
    // подложенный principal ядра с e-mail новичка и iam principal жертвы
    f.cp.principals.push({ id: 'forged', kind: 'human', status: 'active', displayName: 'X', metadata: { onboarding: { email: INPUT.email, iamPrincipalId: victim.iamPrincipalId } } })
    expect(failed(await addPerson(f.ctx, INPUT))).toMatchObject({ error: { code: 'identity_mismatch' } })
    // и даже с subject жертвы — связка жертвы стоит на другом principal
    expect(failed(await addPerson(f.ctx, { ...INPUT, subject: 'sub-victim' }))).toMatchObject({ name: 'identity', error: { code: 'identity_bound_elsewhere' } })
    expect(f.cp.bindings.filter(b => b.iamPrincipalId === victim.iamPrincipalId).map(b => b.principalId)).toEqual([victim.cpPrincipalId])
  })

  it('B3: новый e-mail + subject человека, отключённого в ядре, — person_disabled, сироты нет', async () => {
    const f = fake()
    const gone = await addPerson(f.ctx, INPUT)
    // отключён только в ядре: IAM principal и identity активны, связка ядра revoked
    await f.ctx.call('cp', 'POST', `/principals/${gone.cpPrincipalId}:disable`)
    const before = f.cp.principals.length
    const logged = f.log.length
    const again = await addPerson(f.ctx, { ...INPUT, email: 'maria.new@example.test' })
    expect(failed(again)).toMatchObject({ name: 'cp_principal', error: { code: 'person_disabled' } })
    expect(f.cp.principals).toHaveLength(before)
    expect(f.cp.bindings.map(b => [b.principalId, b.status])).toEqual([[gone.cpPrincipalId, 'revoked']])
    expect(f.log.slice(logged).filter(l => l.startsWith('cp POST'))).toEqual([])
  })

  it('пара на активном чужом principal — identity_bound_elsewhere до создания principal ядра', async () => {
    const f = fake()
    const first = await addPerson(f.ctx, INPUT)
    const again = await addPerson(f.ctx, { ...INPUT, email: 'twin@example.test' })
    expect(failed(again)).toMatchObject({ name: 'cp_principal', error: { code: 'identity_bound_elsewhere' } })
    expect(f.cp.principals.map(p => p.id)).toEqual([first.cpPrincipalId])
  })

  it('отключённого повторно не добавить; неполный поиск и нечитаемые identity — явный отказ', async () => {
    const f = fake()
    const added = await addPerson(f.ctx, INPUT)
    await disablePerson(f.ctx, added.cpPrincipalId!, null)
    expect(failed(await addPerson(f.ctx, INPUT))).toMatchObject({ name: 'iam_principal', error: { code: 'person_disabled' } })

    expect(failed(await addPerson(fake({ endlessPages: true }).ctx, INPUT))).toMatchObject({ error: { code: 'lookup_incomplete' } })
    const blind = fake({ identityRead: false })
    expect(failed(await addPerson(blind.ctx, INPUT))).toMatchObject({ error: { code: 'identity_unverifiable' } })
    expect(blind.counts()).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('ответ IAM о identity: без principal_id — fail closed, disabled — отказ, чужой tenant — bound_elsewhere', async () => {
    const f = fake()
    f.iam.identities.push({ issuer: IDP, subject: INPUT.subject, status: 'active' })
    const odd = await addPerson(f.ctx, INPUT)
    expect(failed(odd)).toMatchObject({ name: 'iam_principal', error: { code: 'identity_unverifiable' } })
    expect(f.log).not.toContain('iam GET /principals/undefined')
    expect(f.counts()).toEqual([0, 1, 0, 0, 0, 0])

    const g = fake()
    g.iam.principals.push({ id: 'gone', kind: 'human', status: 'active' })
    g.iam.identities.push({ principal_id: 'gone', issuer: IDP, subject: INPUT.subject, status: 'disabled' })
    expect(failed(await addPerson(g.ctx, INPUT))).toMatchObject({ name: 'iam_principal', error: { code: 'identity_disabled' } })

    const h = fake()
    h.iam.identities.push({ principal_id: 'foreign', issuer: IDP, subject: INPUT.subject, status: 'active', hidden: true })
    const foreign = await addPerson(h.ctx, INPUT)
    expect(failed(foreign)).toMatchObject({ name: 'identity', error: { status: 409, code: 'identity_bound_elsewhere' } })
    expect(h.cp.principals).toHaveLength(0)
  })

  it('issuer провайдера — без `/` на конце: так он хранится в IAM и так ищется', async () => {
    const f = fake()
    const ctx = { ...f.ctx, idpIssuer: `${IDP}/` }
    expect((await addPerson(ctx, INPUT)).complete).toBe(true)
    expect(f.iam.identities[0]).toMatchObject({ issuer: IDP })
    const again = await addPerson(ctx, INPUT)
    expect(statuses(again).slice(0, 3)).toEqual(['iam_principal:reused', 'identity:reused', 'cp_principal:reused'])
    expect(f.counts()).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('права вызывающего ⊉ профилю — permission_escalation с missing до IAM, ничего не заводится', async () => {
    const f = fake({ callerPermissions: [...MEMBER, 'principals.write'] })
    const admin = await addPerson(f.ctx, { ...INPUT, permissions: ADMIN })
    expect(admin.complete).toBe(false)
    expect(admin.steps[0]).toEqual({ name: 'iam_principal', status: 'failed', error: { status: 403, code: 'permission_escalation', missing: ['admin'] } })
    expect(statuses(admin).slice(1)).toEqual(['identity:pending', 'cp_principal:pending', 'binding:pending', 'member:pending', 'roles:pending'])
    // до отказа — только права вызывающего: ни IAM, ни поиска, ни записей в ядро
    expect(f.log).toEqual(['cp GET /harness/context'])
    expect(f.counts()).toEqual([0, 0, 0, 0, 0, 0])
    // участника без части прав участника — тоже отказ, с перечнем недостающих
    const g = fake({ callerPermissions: ['principals.read', 'principals.write', 'tasks.read'] })
    expect(failed(await addPerson(g.ctx, INPUT))).toMatchObject({ name: 'iam_principal', error: { status: 403, code: 'permission_escalation', missing: MEMBER.filter(p => !['principals.read', 'tasks.read'].includes(p)) } })
    expect(g.log.some(l => l.startsWith('iam '))).toBe(false)
    // участника тот же не-администратор заводит: права участника у него есть
    expect((await addPerson(f.ctx, INPUT)).complete).toBe(true)
    expect(f.cp.bindings).toEqual([expect.objectContaining({ permissions: MEMBER })])
  })

  it('частичный отказ: шаг с кодом и missing, дальше не идёт; чужая identity — отказ', async () => {
    const f = fake()
    f.fail.set('cp POST /principals/{id}/iam-bindings', { status: 403, body: { error: { code: 'permission_escalation', details: { missing: ['admin'] } } } })
    const report = await addPerson(f.ctx, { ...INPUT, permissions: ADMIN })
    expect(report.complete).toBe(false)
    expect(report.loginUrl).toBeNull()
    expect(report.steps[3]).toEqual({ name: 'binding', status: 'failed', error: { status: 403, code: 'permission_escalation', missing: ['admin'] } })
    expect(statuses(report).slice(4)).toEqual(['member:pending', 'roles:pending'])
  })
})

describe('недоведённые добавления', () => {
  it('ядро без связки или ролей и человек только в IAM видны; готовый и владелец — нет', async () => {
    const f = fake()
    await addPerson(f.ctx, INPUT)
    f.fail.set('cp POST /principals/{id}/iam-bindings', { status: 403, body: { error: { code: 'forbidden' } } })
    await addPerson(f.ctx, { ...INPUT, email: 'ivan@example.test', subject: 'ivan', displayName: 'Иван' })
    f.fail.set('iam POST /principals/{id}/external-identities', { status: 422, body: { detail: 'identity_provider_unknown' } })
    await addPerson(f.ctx, { ...INPUT, email: 'olga@example.test', subject: 'olga', displayName: 'Ольга' })
    f.iam.principals.push({ id: 'owner-iam', display_name: 'Владелец', status: 'active' })
    f.cp.principals.push({ id: 'owner-cp', kind: 'human', status: 'active', displayName: 'Владелец', metadata: {} })
    f.cp.bindings.push({ principalId: 'owner-cp', iamPrincipalId: 'owner-iam', status: 'active' })
    const pending = await pendingPeople(f.ctx, true)
    expect(pending.truncated).toBe(false)
    expect(pending.items.map(p => [p.kind, p.displayName, p.missing])).toEqual([
      ['core', 'Иван', ['binding', 'member', 'roles']],
      ['iam_only', 'Ольга', ['identity', 'cp_principal', 'binding', 'member', 'roles']],
    ])
    expect(pending.items[0]!.input).toMatchObject({ email: 'ivan@example.test', subject: 'ivan', roleIds: [ROLE] })
    expect((await pendingPeople(f.ctx, false)).items.map(p => p.kind)).toEqual(['core'])
    // список ядра упёрся в предел страниц — ответ говорит, что проверено не всё
    const g = fake({ endlessPages: true })
    expect((await pendingPeople(g.ctx, false)).truncated).toBe(true)
    expect(g.log.filter(l => l === 'cp GET /principals')).toHaveLength(MAX_PAGES)
  })
})

describe('отключить человека', () => {
  it('сначала IAM, потом ядро; повтор идемпотентен', async () => {
    const f = fake()
    const added = await addPerson(f.ctx, INPUT)
    const report = await disablePerson(f.ctx, added.cpPrincipalId!, 'ушла')
    expect(report).toMatchObject({ complete: true, iam: 'done', cp: 'done' })
    expect(f.log.filter(l => l.includes(':disable'))).toEqual(['iam POST /principals/{id}:disable', 'cp POST /principals/{id}:disable'])
    expect(await disablePerson(f.ctx, added.cpPrincipalId!, null)).toMatchObject({ complete: true })
  })

  it('B2: администратора отключает только администратор — отказ до IAM', async () => {
    const f = fake()
    const admin = await addPerson(f.ctx, { ...INPUT, permissions: ADMIN })
    const member = await addPerson(f.ctx, { ...INPUT, email: 'p@example.test', subject: 'sub-p' })
    f.caller.permissions = ['principals.write', 'workspaces.manage', 'org.manage']
    const report = await disablePerson(f.ctx, admin.cpPrincipalId!, null)
    expect(report).toMatchObject({ complete: false, iam: 'pending', cp: 'failed', error: { service: 'cp', status: 403, code: 'permission_escalation', missing: ['admin'] } })
    expect(f.log.some(l => l.includes(':disable'))).toBe(false)
    expect(f.log).toContain('cp POST /authz:check')
    expect(f.iam.principals[0]!.status).toBe('active')
    // не-администратора он отключает; администратор — администратора
    expect(await disablePerson(f.ctx, member.cpPrincipalId!, null)).toMatchObject({ complete: true })
    const g = fake()
    const other = await addPerson(g.ctx, { ...INPUT, permissions: ADMIN })
    expect(await disablePerson(g.ctx, other.cpPrincipalId!, null)).toMatchObject({ complete: true })
  })

  it('себя и без principals.write — отказ до IAM', async () => {
    const f = fake()
    const added = await addPerson(f.ctx, INPUT)
    const self = fake({ callerId: added.cpPrincipalId! })
    Object.assign(self.cp, { principals: f.cp.principals, bindings: f.cp.bindings })
    expect(await disablePerson(self.ctx, added.cpPrincipalId!, null)).toMatchObject({ iam: 'pending', cp: 'failed', error: { code: 'cannot_disable_self' } })
    const weak = fake({ callerPermissions: ['principals.read'] })
    Object.assign(weak.cp, { principals: f.cp.principals, bindings: f.cp.bindings })
    expect(await disablePerson(weak.ctx, added.cpPrincipalId!, null)).toMatchObject({ iam: 'pending', error: { status: 403, code: 'permission_denied', missing: ['principals.write'] } })
    expect([...self.log, ...weak.log].some(l => l.includes(':disable'))).toBe(false)
  })

  it('admin цели в API-ключе (консоли не виден) — отказ ворот ядра до IAM, вход не закрывается', async () => {
    const f = fake()
    const added = await addPerson(f.ctx, INPUT)
    // связка участника, но у principal живой админский API-ключ — это видит только ядро
    f.cp.principals.find(p => p.id === added.cpPrincipalId)!.adminKey = true
    f.caller.permissions = [...MEMBER, 'principals.write']
    f.log.length = 0
    expect(await disablePerson(f.ctx, added.cpPrincipalId!, null))
      .toMatchObject({ complete: false, iam: 'pending', cp: 'failed', error: { service: 'cp', status: 403, code: 'permission_escalation', missing: ['admin'] } })
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual(['cp POST /authz:check'])
    expect(f.log.some(l => l.startsWith('iam '))).toBe(false)
    expect(f.iam.principals[0]!.status).toBe('active')
    expect(f.cp.bindings[0]!.status).toBe('active')
    // вопрос ядру — о той цели и том действии, что выполнит эндпоинт
    const g = fake({ checkAction: 'disable', check: { allowed: false, reason: { code: 'principal_kind_not_disableable', message: 'no', details: {} } } })
    Object.assign(g.cp, { principals: f.cp.principals, bindings: f.cp.bindings })
    expect(await disablePerson(g.ctx, added.cpPrincipalId!, null)).toMatchObject({ cp: 'failed', error: { status: 422, code: 'principal_kind_not_disableable' } })
    // администратор такого отключает
    f.caller.permissions = ['admin']
    expect(await disablePerson(f.ctx, added.cpPrincipalId!, null)).toMatchObject({ complete: true, iam: 'done', cp: 'done' })
  })

  it('агент — use_agent_retire без вызовов; отказ ядра после IAM — частично, с причиной', async () => {
    const f = fake()
    f.cp.principals.push({ id: 'agent-cp', kind: 'agent', status: 'active' })
    expect(await disablePerson(f.ctx, 'agent-cp', null)).toMatchObject({ complete: false, cp: 'failed', error: { code: 'use_agent_retire' } })
    expect(f.log.some(l => l.includes(':disable'))).toBe(false)

    const added = await addPerson(f.ctx, INPUT)
    f.fail.set('cp POST /principals/{id}:disable', { status: 409, body: { error: { code: 'use_agent_retire' } } })
    expect(await disablePerson(f.ctx, added.cpPrincipalId!, null)).toMatchObject({ complete: false, iam: 'done', cp: 'failed', error: { service: 'cp', code: 'use_agent_retire' } })
    f.fail.set('iam POST /principals/{id}:disable', { status: 403, body: { detail: 'people_admin_protected' } })
    expect(await disablePerson(f.ctx, added.cpPrincipalId!, null)).toMatchObject({ iam: 'failed', cp: 'pending', error: { service: 'iam', code: 'people_admin_protected' } })
  })
})

describe('включить человека', () => {
  const KEY = '5b2f3c4d-0000-4000-8000-000000000001'
  const disabled = async (f: ReturnType<typeof fake>, input: PersonInput = INPUT) => {
    const added = await addPerson(f.ctx, input)
    expect(await disablePerson(f.ctx, added.cpPrincipalId!, null)).toMatchObject({ complete: true })
    f.log.length = 0
    f.keys.length = 0
    return added
  }

  it('IAM :enable, затем ядро :enable, затем новая связка с правами профиля — ключи от ключа подтверждения', async () => {
    const f = fake()
    const added = await disabled(f)
    expect(f.cp.bindings[0]!.status).toBe('revoked')
    const report = await enablePerson(f.ctx, added.cpPrincipalId!, { reason: 'вернулась', key: KEY, permissions: MEMBER })
    expect(report).toMatchObject({ complete: true, iam: 'done', cp: 'done', binding: 'done', permissions: MEMBER, principal: { status: 'active', liveApiKeys: 0 } })
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual([
      'cp POST /authz:check', 'iam POST /principals/{id}:enable', 'cp POST /principals/{id}:enable', 'cp POST /principals/{id}/iam-bindings',
    ])
    expect(f.keys).toEqual([
      `iam POST /principals/{id}:enable console-enable-${KEY}-iam-${added.iamPrincipalId}`,
      `cp POST /principals/{id}:enable console-enable-${KEY}-cp`,
      `cp POST /principals/{id}/iam-bindings console-enable-${KEY}-binding-${added.iamPrincipalId}`,
    ])
    expect(f.iam.principals[0]!.status).toBe('active')
    expect(f.cp.bindings).toEqual([expect.objectContaining({ status: 'active', issuer: IAM_ISS, iamTenantId: TENANT, iamPrincipalId: added.iamPrincipalId, permissions: MEMBER })])
    // повтор с тем же ключом: IAM и ядро — no-op, связка уже активна
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ complete: true, binding: 'reused' })
    expect(f.cp.bindings).toHaveLength(1)
  })

  it('профиль называет оператор: прежний admin сам не возвращается, admin — явным выбором и только admin', async () => {
    const f = fake()
    const added = await disabled(f, { ...INPUT, permissions: ADMIN })
    // по умолчанию — участник, хотя прежняя связка держала admin (амендмент «Включение» п.2)
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ complete: true, permissions: MEMBER })
    expect(f.cp.bindings).toEqual([expect.objectContaining({ status: 'active', permissions: MEMBER })])
    // явный admin от не-admin — отказ до IAM с missing
    const g = fake()
    const again = await disabled(g)
    const weak = fake({ callerPermissions: [...MEMBER, 'principals.write'] })
    Object.assign(weak.cp, { principals: g.cp.principals, bindings: g.cp.bindings })
    Object.assign(weak.iam, { principals: g.iam.principals })
    expect(await enablePerson(weak.ctx, again.cpPrincipalId!, { reason: null, key: KEY, permissions: ADMIN }))
      .toMatchObject({ complete: false, iam: 'pending', cp: 'failed', permissions: ADMIN, error: { service: 'cp', status: 403, code: 'permission_escalation', missing: ['admin'] } })
    expect(weak.log.some(l => l.includes(':enable') || l.includes('POST /principals/{id}/iam-bindings'))).toBe(false)
    expect(g.iam.principals[0]!.status).toBe('disabled')
    // тот же не-admin участником — может: права участника у него есть
    expect(await enablePerson(weak.ctx, again.cpPrincipalId!, { reason: null, key: 'k-member-0001', permissions: MEMBER })).toMatchObject({ complete: true, permissions: MEMBER })
    // явный admin от admin — admin
    const h = fake()
    const third = await disabled(h)
    expect(await enablePerson(h.ctx, third.cpPrincipalId!, { reason: null, key: KEY, permissions: ADMIN })).toMatchObject({ complete: true, permissions: ADMIN })
    expect(h.cp.bindings[0]).toMatchObject({ status: 'active', permissions: ADMIN })
  })

  it('права вызывающего ⊉ профилю — permission_escalation с missing до любого шага', async () => {
    const f = fake()
    const added = await disabled(f)
    f.caller.permissions = ['principals.read', 'principals.write', 'tasks.read']
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER }))
      .toMatchObject({ complete: false, iam: 'pending', cp: 'failed', binding: 'pending', error: { service: 'cp', status: 403, code: 'permission_escalation', missing: MEMBER.filter(p => !['principals.read', 'tasks.read'].includes(p)) } })
    // только чтения и вопрос ядру — ни IAM, ни записей в ядро
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual(['cp POST /authz:check'])
    expect(f.iam.principals[0]!.status).toBe('disabled')
    expect(f.cp.bindings[0]!.status).toBe('revoked')
    expect(missingFor(['admin'], ADMIN)).toEqual([])
    expect(missingFor(MEMBER, MEMBER)).toEqual([])
    expect(missingFor(MEMBER, ADMIN)).toEqual(['admin'])
  })

  it('metadata.onboarding не решает, чей вход открыть и с какими правами (подставной principal)', async () => {
    // Жертва A — живой человек со своей связкой на principal V.
    const f = fake()
    const victim = await addPerson(f.ctx, { ...INPUT, permissions: ADMIN })
    // Не-admin с principals.write заводит X с onboarding {iamPrincipalId: A, profile: admin} и
    // отключает его; связок у X нет.
    f.cp.principals.push({ id: 'x-cp', kind: 'human', status: 'disabled', displayName: 'X', metadata: { onboarding: { email: 'x@example.test', iamPrincipalId: victim.iamPrincipalId, permissions: ADMIN, subject: 'sub-maria' } } })
    f.log.length = 0
    for (const permissions of [MEMBER, ADMIN]) {
      expect(await enablePerson(f.ctx, 'x-cp', { reason: null, key: KEY, permissions }))
        .toMatchObject({ complete: false, iam: 'pending', cp: 'failed', error: { service: 'cp', status: 409, code: 'iam_principal_unknown' } })
    }
    expect(f.log.some(l => l.includes(':enable') || l.includes('POST /principals/{id}/iam-bindings'))).toBe(false)
    // связка A осталась на V, с прежними правами; X не активен
    expect(f.cp.bindings).toEqual([expect.objectContaining({ principalId: victim.cpPrincipalId, iamPrincipalId: victim.iamPrincipalId, status: 'active', permissions: ADMIN })])
    expect(f.cp.principals.find(p => p.id === 'x-cp')!.status).toBe('disabled')
    // Свои связки у X есть (на B), metadata зовёт в admin — профиль всё равно выбранный, пара — своя.
    const g = fake()
    const b = await disabled(g)
    const own = g.cp.principals.find(p => p.id === b.cpPrincipalId)!
    own.metadata = { onboarding: { iamPrincipalId: victim.iamPrincipalId, permissions: ADMIN } }
    expect(await enablePerson(g.ctx, b.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ complete: true, permissions: MEMBER })
    expect(g.cp.bindings).toEqual([expect.objectContaining({ principalId: b.cpPrincipalId, iamPrincipalId: b.iamPrincipalId, permissions: MEMBER })])
    expect(g.keys.filter(k => k.startsWith('iam '))).toEqual([`iam POST /principals/{id}:enable console-enable-${KEY}-iam-${b.iamPrincipalId}`])
  })

  it('отказ ворот ядра (authz:check) — код и missing, до IAM ничего не меняется', async () => {
    const f = fake({ check: { allowed: false, reason: { code: 'permission_escalation', message: 'live key', details: { missing: ['admin'] } } } })
    const added = await disabled(f)
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER }))
      .toMatchObject({ complete: false, iam: 'pending', cp: 'failed', error: { service: 'cp', status: 403, code: 'permission_escalation', missing: ['admin'] } })
    expect(f.log.some(l => l.includes(':enable'))).toBe(false)
    const g = fake({ check: { allowed: false, reason: { code: 'permission_denied', message: 'no', details: { required: ['principals.write'] } } } })
    Object.assign(g.cp, { principals: f.cp.principals, bindings: f.cp.bindings })
    expect(await enablePerson(g.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ error: { status: 403, code: 'permission_denied', missing: ['principals.write'] } })
    f.cp.principals.push({ id: 'agent-cp', kind: 'agent', status: 'disabled' })
    expect(await enablePerson(f.ctx, 'agent-cp', { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ cp: 'failed', error: { code: 'use_agent_publish' } })
  })

  it('отказы IAM — iam failed, ядро не трогается; отказ ядра после IAM — частично, повтор доводит', async () => {
    for (const code of ['principal_paused', 'principal_provisioned', 'self_enable_forbidden', 'principal_status_not_enableable', 'principal_conflict']) {
      const f = fake()
      const added = await disabled(f)
      f.fail.set('iam POST /principals/{id}:enable', { status: 409, body: { detail: code } })
      expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER }), code)
        .toMatchObject({ complete: false, iam: 'failed', cp: 'pending', error: { service: 'iam', status: 409, code } })
      expect(f.log.includes('cp POST /principals/{id}:enable'), code).toBe(false)
    }
    const f = fake()
    const added = await disabled(f)
    f.fail.set('iam POST /principals/{id}:enable', { status: 403, body: { detail: 'people_admin_protected' } })
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ iam: 'failed', error: { service: 'iam', status: 403, code: 'people_admin_protected' } })
    f.fail.set('cp POST /principals/{id}:enable', { status: 409, body: { error: { code: 'use_agent_publish' } } })
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ iam: 'done', cp: 'failed', binding: 'pending', error: { service: 'cp', code: 'use_agent_publish' } })
    f.fail.set('cp POST /principals/{id}/iam-bindings', 'lost')
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ cp: 'done', binding: 'failed', error: { status: 503, code: 'upstream_unavailable' } })
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ complete: true, binding: 'reused' })
  })

  it('активный в ядре, IAM закрыт: не-администратору — честный отказ, администратор открывает вход', async () => {
    // Администратор отключён частично: IAM закрыт, в ядре активен и связка admin жива.
    const f = fake()
    const admin = await addPerson(f.ctx, { ...INPUT, permissions: ADMIN })
    expect((await f.ctx.call('iam', 'POST', `/principals/${admin.iamPrincipalId}:disable`)).status).toBe(200)
    // Не-администратор с principals.write и iam:people жмёт «Включить» участником.
    f.caller.permissions = [...MEMBER, 'principals.write']
    f.log.length = 0
    const report = await enablePerson(f.ctx, admin.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })
    expect(report).toMatchObject({ complete: false, iam: 'failed', cp: 'reused', binding: 'pending', error: { service: 'iam', status: 403, code: 'iam_login_closed' } })
    // статус IAM прочитан, но вход остался закрытым; в ядро — только вопрос воротам
    expect(f.log).toContain('iam GET /principals/{id}')
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual(['cp POST /authz:check'])
    expect(f.iam.principals[0]!.status).toBe('disabled')
    expect(f.cp.bindings).toEqual([expect.objectContaining({ status: 'active', permissions: ADMIN })])

    // Администратор открывает вход (`:enable` эскалации не создаёт); связка — прежняя живая.
    f.caller.permissions = ['admin']
    f.log.length = 0
    f.keys.length = 0
    expect(await enablePerson(f.ctx, admin.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER }))
      .toMatchObject({ complete: true, iam: 'done', cp: 'reused', binding: 'reused', permissions: ADMIN, principal: { status: 'active' } })
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual(['cp POST /authz:check', 'iam POST /principals/{id}:enable'])
    expect(f.keys).toEqual([`iam POST /principals/{id}:enable console-enable-${KEY}-iam-${admin.iamPrincipalId}`])
    expect(f.iam.principals[0]!.status).toBe('active')
    expect(f.cp.bindings).toHaveLength(1)
  })

  it('активный в ядре, IAM открыт: IAM не пишется, права в отчёте — фактические живой связки', async () => {
    const f = fake()
    const admin = await addPerson(f.ctx, { ...INPUT, permissions: ADMIN })
    f.caller.permissions = [...MEMBER, 'principals.write']
    f.log.length = 0
    // Живая связка есть и ставить нечего — выбранный профиль (даже admin) не проверяется.
    for (const permissions of [MEMBER, ADMIN]) {
      expect(await enablePerson(f.ctx, admin.cpPrincipalId!, { reason: null, key: KEY, permissions }), permissions.join())
        .toMatchObject({ complete: true, iam: 'reused', cp: 'reused', binding: 'reused', permissions: ADMIN })
    }
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual(['cp POST /authz:check', 'cp POST /authz:check'])
    expect(f.cp.bindings).toEqual([expect.objectContaining({ status: 'active', permissions: ADMIN })])

    // Связки нет — её ставить, и выбранный профиль сверх прав вызывающего — отказ до IAM.
    const h = fake()
    const bare = await addPerson(h.ctx, INPUT)
    h.cp.bindings[0]!.status = 'revoked'
    h.caller.permissions = [...MEMBER, 'principals.write']
    h.log.length = 0
    expect(await enablePerson(h.ctx, bare.cpPrincipalId!, { reason: null, key: KEY, permissions: ADMIN }))
      .toMatchObject({ complete: false, iam: 'pending', cp: 'failed', binding: 'pending', error: { service: 'cp', status: 403, code: 'permission_escalation', missing: ['admin'] } })
    expect(h.log.some(l => l.startsWith('iam '))).toBe(false)
    expect(await enablePerson(h.ctx, bare.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ complete: true, iam: 'reused', binding: 'done', permissions: MEMBER })

    // Живая связка с другими правами — в отчёте её фактические права, вторая связка не ставится.
    const g = fake()
    const odd = await addPerson(g.ctx, INPUT)
    g.cp.bindings[0]!.permissions = ['tasks.read']
    expect(await enablePerson(g.ctx, odd.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ complete: true, binding: 'reused', permissions: ['tasks.read'] })
    expect(g.cp.bindings).toHaveLength(1)
  })

  it('повтор «ядро включено, связка не выдана» доводит связку без IAM', async () => {
    const f = fake()
    const added = await disabled(f)
    f.fail.set('cp POST /principals/{id}/iam-bindings', { status: 503, body: { detail: 'upstream_unavailable' } })
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER }))
      .toMatchObject({ complete: false, iam: 'done', cp: 'done', binding: 'failed', error: { service: 'cp', status: 503 } })
    expect(f.iam.principals[0]!.status).toBe('active')
    f.log.length = 0
    expect(await enablePerson(f.ctx, added.cpPrincipalId!, { reason: null, key: KEY, permissions: MEMBER }))
      .toMatchObject({ complete: true, iam: 'reused', cp: 'reused', binding: 'done', permissions: MEMBER })
    expect(f.log.filter(l => !l.includes(' GET '))).toEqual(['cp POST /authz:check', 'cp POST /principals/{id}/iam-bindings'])
    expect(f.cp.bindings.filter(b => b.status === 'active')).toEqual([expect.objectContaining({ iamPrincipalId: added.iamPrincipalId, permissions: MEMBER })])
  })

  it('IAM principal неизвестен — связку не на что ставить; ключ SPA проверяется', async () => {
    const f = fake()
    f.cp.principals.push({ id: 'orphan', kind: 'human', status: 'disabled', metadata: {} })
    expect(await enablePerson(f.ctx, 'orphan', { reason: null, key: KEY, permissions: MEMBER })).toMatchObject({ iam: 'pending', cp: 'failed', error: { status: 409, code: 'iam_principal_unknown' } })
    expect(f.log.some(l => l.includes(':enable'))).toBe(false)
    expect(flowKey(KEY)).toBe(KEY)
    expect(parsePermissions(['tasks.read', 'admin', 'tasks.read'])).toEqual(['admin', 'tasks.read'])
    for (const bad of [undefined, null, [], 'admin', ['Root!'], ['a b'], [1], ['__proto__.x'], Array.from({ length: 81 }, (_, i) => `p${i}`)]) expect(parsePermissions(bad), String(bad)).toBeNull()
    for (const bad of [undefined, '', 'x', 'a/b/c/d/e/f', 'ключ-ключ-ключ']) expect(flowKey(bad)).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('разбор ввода', () => {
  it('e-mail в нижний регистр; subject обязателен и без умолчания; мусор отклоняется', () => {
    expect(parsePerson({ displayName: ' Мария ', email: 'Maria@Example.test', subject: ' s-1 ', workspaceId: WS, roleIds: [], permissions: ['tasks.read', 'tasks.read'] }))
      .toEqual({ displayName: 'Мария', email: 'maria@example.test', subject: 's-1', workspaceId: WS, roleIds: [], permissions: ['tasks.read'] })
    for (const bad of [null, {}, { ...INPUT, subject: '' }, { ...INPUT, subject: undefined }, { ...INPUT, email: 'нет' }, { ...INPUT, workspaceId: 'x' }, { ...INPUT, roleIds: ['x'] }, { ...INPUT, permissions: [] }, { ...INPUT, permissions: undefined }, { ...INPUT, permissions: ['Root!'] }]) {
      expect(parsePerson(bad)).toBeNull()
    }
  })
})

describe('маршруты BFF', () => {
  let t: Awaited<ReturnType<typeof world>> | undefined
  afterEach(async () => { await t?.close(); t = undefined })

  it('без сессии — 401, чужой origin — 403, плохое тело — 422; login_hint уходит к IdP', async () => {
    t = await world()
    expect((await t.call('GET', '/console/api/org/people/pending')).status).toBe(401)
    const { cookie } = await t.login()
    expect((await t.call('POST', '/console/api/org/people', { headers: { cookie, origin: 'https://evil.test' }, body: '{}' })).status).toBe(403)
    const bad = await t.call('POST', '/console/api/org/people', { headers: { cookie, ...t.origin }, body: '{"email":"x"}' })
    expect([bad.status, JSON.parse(bad.body)]).toEqual([422, { error: { code: 'invalid_person' } }])
    expect((await t.call('POST', '/console/api/org/nope', { headers: { cookie, ...t.origin }, body: '{}' })).status).toBe(404)
    // токен ядра без iss — связку ставить не на что: явный отказ, а не пустой issuer
    const body = JSON.stringify({ ...INPUT })
    const noIss = await t.call('POST', '/console/api/org/people', { headers: { cookie, ...t.origin }, body })
    expect([noIss.status, JSON.parse(noIss.body)]).toEqual([502, { error: { code: 'iam_issuer_unknown' } }])
    // «Включить» — тот же маршрут организации: до шагов нужен issuer связки
    const enable = await t.call('POST', '/console/api/org/people/9f1c2b3a-1111-4222-8333-444455556666:enable', { headers: { cookie, ...t.origin, 'idempotency-key': 'k-12345678' }, body: JSON.stringify({ permissions: MEMBER }) })
    expect([enable.status, JSON.parse(enable.body)]).toEqual([502, { error: { code: 'iam_issuer_unknown' } }])
    expect((await t.call('POST', '/console/api/org/people/not-a-uuid:enable', { headers: { cookie, ...t.origin }, body: '{}' })).status).toBe(404)
    // права не списком прав — 422 до любого шага
    const root = await t.call('POST', '/console/api/org/people/9f1c2b3a-1111-4222-8333-444455556666:enable', { headers: { cookie, ...t.origin, 'idempotency-key': 'k-12345678' }, body: '{"permissions":["Root!"]}' })
    expect([root.status, JSON.parse(root.body)]).toEqual([422, { error: { code: 'invalid_permissions' } }])
    // голое `:enable` ядра через прокси закрыто: включение — только поток с проверками
    const sent = t.cp.requests.length
    const bare = await t.call('POST', '/console/api/cp/principals/9f1c2b3a-1111-4222-8333-444455556666:enable', { headers: { cookie, ...t.origin, 'idempotency-key': 'k-12345678' }, body: '{}' })
    expect([bare.status, JSON.parse(bare.body)]).toEqual([404, { error: { code: 'not_found' } }])
    expect(t.cp.requests.length).toBe(sent)
    const login = await t.call('GET', '/console/_auth/login?login_hint=maria%40example.test')
    expect(new URL(String(login.headers.location)).searchParams.get('login_hint')).toBe('maria@example.test')
    const junk = await t.call('GET', '/console/_auth/login?login_hint=not-an-email')
    expect(new URL(String(junk.headers.location)).searchParams.has('login_hint')).toBe(false)
  })
})

describe('allow-list: включение и проверка прав (TASK-000974)', () => {
  it('снимок ядра знает authz:check — открыта; голое principal :enable закрыто — только поток', () => {
    const snapshot = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'openapi', 'control-plane.json'), 'utf8')) as object
    const allow = AllowList.fromOpenApi(snapshot, { prefix: '/api/v1', mutations: CONTROL_PLANE_MUTATIONS })
    expect(allow.missing).toEqual([])
    expect(allow.match('POST', '/api/v1/authz:check')?.template).toBe('/api/v1/authz:check')
    expect(CONTROL_PLANE_MUTATIONS).not.toContain('POST /api/v1/principals/{principal_id}:enable')
    expect(allow.match('POST', '/api/v1/principals/9f1c2b3a-1111-4222-8333-444455556666:enable')).toBeNull()
    expect(allow.match('POST', '/api/v1/principals/9f1c2b3a-1111-4222-8333-444455556666%3Aenable')).toBeNull()
  })
})
