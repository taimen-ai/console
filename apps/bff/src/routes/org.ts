/**
 * Люди организации под `{base}/api/org` (поток — `../org.ts`):
 * - `GET  people/pending` — недоведённые добавления по данным серверов; `iam: false` — у
 *   вошедшего нет `iam:people`, видны только недоведённые в ядре; `idpAdmin` — консоль заводит
 *   пользователя у провайдера входа (`createIdpUser` в теле «добавить»);
 * - `POST people` — добавить человека или довести поток (идемпотентно);
 * - `POST people/{cpPrincipalId}:disable` `{reason?}` — закрыть вход в IAM и отключить в ядре;
 * - `POST people/{cpPrincipalId}:enable` `{reason?, permissions}` — открыть вход в IAM, включить в
 *   ядре и поставить связку с названными правами; `Idempotency-Key` запроса — основа ключей шагов.
 * Вызовы наверх — токенами вошедшего человека: IAM audience `iam` (scope `iam:people`, только
 * членам группы администраторов людей), ядро — `control-plane`. Отказ IAM выдать audience —
 * `403 no_permission` (обработчик ошибок сервера). Токены из процесса не выходят.
 */
import type { Hono } from 'hono'
import { fail, json, type AppDeps, type Ctx, type Env } from '../context.ts'
import { jwtPayload } from '../crypto.ts'
import { keycloakAdmin } from '../idp-admin.ts'
import { addPerson, disablePerson, enablePerson, flowKey, parsePermissions, parsePerson, pendingPeople, StepFailed, type Call, type OrgContext } from '../org.ts'
import { readLimited } from '../proxy.ts'
import { NoPermission, type Session } from '../sessions.ts'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ACTION = new RegExp(`^(${UUID}):(disable|enable)$`, 'i')
/** Тело запросов людей — небольшой JSON. */
const BODY_LIMIT = 16 * 1024
const STEP_TIMEOUT_MS = 15_000

export function orgRoutes(app: Hono<Env>, deps: AppDeps): void {
  const { config } = deps
  const b = config.basePath
  // Пользователь у провайдера входа — только когда развёртывание это включило (`CONSOLE_IDP_ADMIN`).
  const idpAdmin = config.idpAdmin !== null ? keycloakAdmin(config.idpAdmin) : null

  /** Вызов наверх от имени вошедшего: повтор на 401 один раз; сбой источника — ответом. */
  const callOf = (session: Session, requestId: string): Call => async (service, method, path, init = {}) => {
    const audience = service === 'iam' ? 'iam' : 'control-plane'
    const base = service === 'iam' ? `${config.iam.url}/api/v1/tenants/${config.iam.tenantId}` : `${config.upstreams.controlPlane}/api/v1`
    const body = init.body !== undefined ? JSON.stringify(init.body) : undefined
    for (let attempt = 0; ; attempt++) {
      const token = await deps.sessions.token(session, audience)
      let response: Response
      let text: string
      try {
        response = await fetch(`${base}${path}`, {
          method,
          headers: {
            accept: 'application/json', authorization: `Bearer ${token}`, 'x-request-id': requestId,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(init.key !== undefined ? { 'idempotency-key': init.key } : {}),
          },
          ...(body !== undefined ? { body } : {}),
          signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        })
        text = await response.text()
      } catch {
        // сбой сети — ответом: поток вернёт отчёт по пройденным шагам
        return { status: 503, body: { detail: 'upstream_unavailable' } }
      }
      if (response.status === 401 && attempt === 0) {
        deps.sessions.invalidate(session, audience)
        continue
      }
      if (response.status >= 500) return { status: response.status, body: { detail: 'upstream_unavailable' } }
      let parsed: unknown = {}
      try { parsed = text !== '' ? JSON.parse(text) : {} } catch { /* не JSON — пустое тело */ }
      return { status: response.status, body: typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {} }
    }
  }

  /** Контекст потока; issuer IAM — из `iss` своего токена ядра (первая половина пары связки). */
  const context = async (c: Ctx): Promise<OrgContext | Response> => {
    const session = c.get('session')
    const iss = jwtPayload(await deps.sessions.token(session, 'control-plane'))?.iss
    if (typeof iss !== 'string' || iss === '') return fail(502, 'iam_issuer_unknown')
    return {
      call: callOf(session, c.get('requestId')),
      iamTenantId: config.iam.tenantId,
      iamIssuer: iss,
      idpIssuer: config.oidc.issuer,
      loginUrl: email => `${config.publicOrigin}${b}/_auth/login?login_hint=${encodeURIComponent(email)}`,
      idpAdmin,
    }
  }

  const body = async (c: Ctx): Promise<Record<string, unknown> | null> => {
    try {
      const parsed = JSON.parse((await readLimited(c.req.raw, BODY_LIMIT)).toString('utf8') || '{}') as unknown
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
    } catch (error) {
      if (error instanceof SyntaxError) return null
      throw error
    }
  }

  app.get(`${b}/api/org/people/pending`, async (c) => {
    c.set('route', `${b}/api/org/people/pending`)
    let iam = true
    try { await deps.sessions.token(c.get('session'), 'iam') } catch (error) {
      if (!(error instanceof NoPermission)) throw error
      iam = false
    }
    const ctx = await context(c)
    if (ctx instanceof Response) return ctx
    try {
      // `idpAdmin` — форма «Добавить человека» предлагает завести пользователя у провайдера.
      return json(200, { ...await pendingPeople(ctx, iam), iam, idpAdmin: idpAdmin !== null })
    } catch (error) {
      // отказ чтения (нет principals.read и т. п.) — код источника, а не 500
      if (!(error instanceof StepFailed)) throw error
      return fail(error.error.status < 500 ? error.error.status : 502, error.error.code)
    }
  })

  app.post(`${b}/api/org/people`, async (c) => {
    c.set('route', `${b}/api/org/people`)
    const input = parsePerson(await body(c))
    if (input === null) return fail(422, 'invalid_person')
    // Без `iam:people` поток не начинается: отказ — до первого шага, а не посреди.
    await deps.sessions.token(c.get('session'), 'iam')
    const ctx = await context(c)
    if (ctx instanceof Response) return ctx
    return json(200, await addPerson(ctx, input))
  })

  app.post(`${b}/api/org/people/:action`, async (c) => {
    const action = ACTION.exec(c.req.param('action'))
    if (action === null) return fail(404, 'not_found')
    const [, id, verb] = action as unknown as [string, string, string]
    c.set('route', `${b}/api/org/people/{principal_id}:${verb.toLowerCase()}`)
    const input = await body(c)
    if (input === null) return fail(400, 'invalid_body')
    const reason = typeof input.reason === 'string' && input.reason.trim() !== '' ? input.reason.trim().slice(0, 500) : null
    const enable = verb.toLowerCase() === 'enable'
    // Права новой связки называет оператор (CP-ADR-0077, амендмент «Включение» п.2) — до шагов.
    const permissions = enable ? parsePermissions(input.permissions) : null
    if (enable && permissions === null) return fail(422, 'invalid_permissions')
    await deps.sessions.token(c.get('session'), 'iam')
    const ctx = await context(c)
    if (ctx instanceof Response) return ctx
    if (enable) return json(200, await enablePerson(ctx, id, { reason, key: flowKey(c.req.header('idempotency-key')), permissions: permissions! }))
    return json(200, await disablePerson(ctx, id, reason))
  })
}

