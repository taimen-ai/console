/**
 * Подключения стенда — по CP-ADR-0079 (контракт консоли `docs/connections.md`): типы
 * подключений, подключения организации, приложения OAuth типов, OAuth-поток с фейковым
 * провайдером и ключ доступа, отзыв, секреты агентов по имени. Значения секретов стенд не
 * хранит и не пишет в журнал — как ядро: остаются только имена, кто и когда.
 *
 * Фейковый провайдер живёт на порту ядра без авторизации: `GET /oauth/authorize` — страница
 * согласия («Разрешить» / «Отказать»), `GET /api/v1/connections:callback` — возврат в консоль
 * `303` на `CONSOLE_RETURN` с `connection`, `result`, `reason`.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ME, P, TENANT, WORKSPACE, daysAgo } from './data.ts'

type Reply = { status: number, body: unknown, etag?: string }
const err = (status: number, code: string, message: string, details?: Record<string, unknown>): Reply => ({ status, body: { error: { code, message, ...(details !== undefined ? { details } : {}) } } })

const PROVIDER = 'http://127.0.0.1:8093'
let consoleReturn = 'http://localhost:5173/console/settings?section=connections'
/** Адрес возврата консоли (`CP_CONNECTIONS_RETURN_URL`): стенд знает публичный адрес только при запуске. */
export function configure(publicUrl: string): void { consoleReturn = `${publicUrl}/console/settings?section=connections` }

const externalId = { type: 'string', pattern: '^[A-Za-z0-9._-]{1,128}$' }

/** Настройки класса CRM (схема настроек коннектора CRM) — то, что понимает класс. */
const crmSettingsSchema = {
  type: 'object',
  properties: {
    stageRoles: {
      type: 'array', maxItems: 500, title: 'Роли этапов воронки',
      description: 'Какой этап какой воронки что означает. Этапа без роли в списке нет',
      items: { type: 'object', additionalProperties: false, required: ['pipelineId', 'stageId', 'role'], properties: { pipelineId: externalId, stageId: externalId, role: { type: 'string', enum: ['draft'] } } },
    },
    fields: {
      type: 'object', title: 'Поля CRM',
      properties: { inn: { anyOf: [{ type: 'null' }, externalId], title: 'Поле компании с ИНН', description: 'Идентификатор поля компании в CRM, где лежит ИНН' } },
    },
    observerAgent: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', title: 'Агент-наблюдатель', description: 'Ключ агента, который пишет наблюдения и снимки знаний этого подключения' },
    rateBudget: {
      type: 'object', additionalProperties: false, title: 'Доли лимита частоты CRM',
      properties: { observer: { type: 'number', exclusiveMinimum: 0, maximum: 1, default: 0.5, title: 'Наблюдатель' }, skillsHost: { type: 'number', exclusiveMinimum: 0, maximum: 1, default: 0.25, title: 'Хост скиллов' } },
    },
  },
}

interface ConnectionType { id: string, key: string, version: number, status: 'active' | 'deprecated' | 'disabled', spec: Record<string, unknown>, specHash: string, package: { key: string, version: string } | null, createdBy: string, createdAt: string, rowVersion: number }

const type = (key: string, pkg: string, spec: Record<string, unknown>): ConnectionType => ({
  id: randomUUID(), key, version: 1, status: 'active', spec, specHash: `sha256:${key}`, package: { key: pkg, version: '0.1.0' }, createdBy: ME, createdAt: daysAgo(30), rowVersion: 1,
})

export const types: ConnectionType[] = [
  type('crm-demo', 'crm-demo', {
    displayName: 'CRM (демо)', description: 'Сделки, воронки и задачи CRM организации; задачи проверки уходят ответственному в CRM.',
    auth: ['oauth2', 'token'],
    oauth2: { authorizeUrl: `${PROVIDER}/oauth/authorize`, tokenUrlTemplate: 'https://{account}/oauth2/access_token', accountParam: 'referer', authStyle: 'in_params', scopes: [] },
    accountField: { title: 'Адрес портала', description: 'Например, polaris.crm.example', pattern: '^[a-z0-9-]{1,63}\\.crm\\.example$' },
    settingsSchema: crmSettingsSchema, defaultKey: 'crm',
  }),
  type('mail', 'mail', {
    displayName: 'Почта', description: 'Входящие письма ящика организации — наблюдениями.', auth: ['token'], oauth2: null,
    accountField: { title: 'Адрес ящика', description: null, pattern: '^[^@\\s]+@[^@\\s]+$' },
    settingsSchema: { type: 'object', properties: { folder: { type: 'string', default: 'INBOX', title: 'Папка', description: 'Откуда читать письма' } } },
    defaultKey: 'mail',
  }),
]

interface Connection {
  id: string, key: string, type: string, typeVersion: number, displayName: string, account: string | null, auth: 'oauth2' | 'token' | null
  status: 'pending' | 'active' | 'expired' | 'revoked', statusReason: string | null, statusMessage: string | null, settings: Record<string, unknown>
  secretRef: string | null, expiresAt: string | null, connectedBy: string | null, connectedAt: string | null, lastCheckedAt: string | null
  agents: string[], createdBy: string, createdAt: string, updatedAt: string, version: number
}

const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString()

export const connections: Connection[] = [
  {
    id: randomUUID(), key: 'crm', type: 'crm-demo', typeVersion: 1, displayName: 'CRM отдела продаж', account: 'polaris.crm.example', auth: 'oauth2',
    status: 'active', statusReason: null, statusMessage: null,
    settings: { observerAgent: 'crm-observer', stageRoles: [{ pipelineId: '100', stageId: '142', role: 'draft' }], fields: { inn: '5521' } },
    secretRef: `oauth2/creds/tenants/${TENANT}/connections/crm`, expiresAt: null, connectedBy: P.irina.id, connectedAt: daysAgo(12, 11), lastCheckedAt: minutesAgo(4),
    agents: ['crm-observer'], createdBy: P.irina.id, createdAt: daysAgo(12, 10), updatedAt: daysAgo(2, 15), version: 3,
  },
  {
    id: randomUUID(), key: 'mail-finance', type: 'mail', typeVersion: 1, displayName: 'Почта бухгалтерии', account: 'buh@polaris.example', auth: 'token',
    status: 'expired', statusReason: 'token_expired', statusMessage: null, settings: { folder: 'INBOX' },
    secretRef: `kv/data/tenants/${TENANT}/connections/mail-finance`, expiresAt: daysAgo(1, 9), connectedBy: P.ivan.id, connectedAt: daysAgo(90), lastCheckedAt: daysAgo(1, 8),
    agents: [], createdBy: P.ivan.id, createdAt: daysAgo(90), updatedAt: daysAgo(1, 9), version: 2,
  },
]

const oauthApps = new Map<string, { clientId: string, updatedAt: string }>([['crm-demo', { clientId: 'polaris-console', updatedAt: daysAgo(14) }]])
const states = new Map<string, { key: string, expires: number }>()
const secretNames = new Map<string, { name: string, updatedAt: string, updatedBy: string }[]>([
  ['crm-observer', [{ name: 'crm-webhook-signing', updatedAt: daysAgo(12, 12), updatedBy: P.irina.id }]],
])

const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/
const etag = (c: Connection): string => `"connection-${c.version}"`
const typeOf = (c: Connection): ConnectionType | undefined => types.find(t => t.key === c.type && t.version === c.typeVersion)
const authOf = (t: ConnectionType | undefined): string[] => (t?.spec.auth as string[] | undefined) ?? []
const out = (c: Connection, card = false): Record<string, unknown> => {
  const { agents, ...rest } = c
  return card ? { ...rest, agents } : rest
}

/** Материал секрета в строке — как `reject_secret_text` ядра: префиксы провайдеров, Bearer, JWT. */
const SECRET = /\b(ghp_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{10,}|Bearer\s+\S{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|api_key=\S+)/
function secretPath(value: unknown, path = ''): string | null {
  if (typeof value === 'string') return SECRET.test(value) ? path || '/' : null
  if (Array.isArray(value)) { for (const [i, v] of value.entries()) { const p = secretPath(v, `${path}/${i}`); if (p !== null) return p } return null }
  if (value !== null && typeof value === 'object') { for (const [k, v] of Object.entries(value)) { const p = secretPath(v, `${path}/${k}`); if (p !== null) return p } }
  return null
}

/** Проверка настроек CRM: пары воронки и этапа — без повторов, доли лимита — в (0, 1]. */
function checkSettings(t: ConnectionType, settings: Record<string, unknown>): { path: string, message: string }[] {
  const errors: { path: string, message: string }[] = []
  if (t.key === 'crm-demo') {
    const seen = new Set<string>()
    for (const [i, r] of ((settings.stageRoles as { pipelineId?: string, stageId?: string, role?: string }[] | undefined) ?? []).entries()) {
      const pair = `${r.pipelineId}:${r.stageId}`
      if (seen.has(pair)) errors.push({ path: `/stageRoles/${i}`, message: 'этап уже назначен' })
      seen.add(pair)
      if (r.role !== 'draft') errors.push({ path: `/stageRoles/${i}/role`, message: 'неизвестная роль' })
    }
    const budget = settings.rateBudget as { observer?: number, skillsHost?: number } | undefined
    for (const k of ['observer', 'skillsHost'] as const) {
      const v = budget?.[k]
      if (v !== undefined && (typeof v !== 'number' || v <= 0 || v > 1)) errors.push({ path: `/rateBudget/${k}`, message: 'от 0 (не включая) до 1' })
    }
  }
  return errors
}

export function listTypes(q: URLSearchParams): Reply {
  const status = q.get('status')
  return { status: 200, body: { items: types.filter(t => status === null || t.status === status), nextCursor: null } }
}

export function getType(ref: string): Reply {
  const [key, version] = ref.split('@')
  const t = types.find(x => x.key === key && (version === undefined ? x.status === 'active' : String(x.version) === version))
  return t === undefined ? err(404, 'not_found', 'connection type not found') : { status: 200, body: t }
}

export function getOAuthApp(key: string): Reply {
  if (!types.some(t => t.key === key)) return err(404, 'not_found', 'connection type not found')
  const app = oauthApps.get(key)
  return { status: 200, body: { type: key, configured: app !== undefined, clientId: app?.clientId ?? null, updatedAt: app?.updatedAt ?? null } }
}

export function setOAuthApp(key: string, body: string): Reply {
  const t = types.find(x => x.key === key)
  if (t === undefined) return err(404, 'not_found', 'connection type not found')
  if (!authOf(t).includes('oauth2')) return err(422, 'auth_not_supported', 'the type does not connect over OAuth')
  const input = JSON.parse(body || '{}') as { clientId?: unknown, clientSecret?: unknown }
  if (typeof input.clientId !== 'string' || input.clientId.length < 1 || input.clientId.length > 500 || typeof input.clientSecret !== 'string' || input.clientSecret.length < 1 || input.clientSecret.length > 4096) {
    return err(400, 'invalid_request', 'clientId and clientSecret are required')
  }
  // Секрет приложения уходит «в хранилище» — у стенда никуда: значение не хранится.
  const updatedAt = new Date().toISOString()
  oauthApps.set(key, { clientId: input.clientId, updatedAt })
  return { status: 200, body: { type: key, configured: true, clientId: input.clientId, updatedAt } }
}

export function list(q: URLSearchParams): Reply {
  const items = connections.filter(c => (q.get('type') === null || c.type === q.get('type')) && (q.get('status') === null || c.status === q.get('status')))
  return { status: 200, body: { items: items.map(c => out(c)), nextCursor: null } }
}

export function get(key: string): Reply {
  const c = connections.find(x => x.key === key)
  return c === undefined ? err(404, 'not_found', 'connection not found') : { status: 200, body: out(c, true), etag: etag(c) }
}

export function create(body: string): Reply {
  const input = JSON.parse(body || '{}') as { key?: string, type?: string, displayName?: string, settings?: Record<string, unknown> }
  const t = types.find(x => x.key === input.type && x.status === 'active')
  if (t === undefined) return err(422, 'unknown_connection_type', 'no active version of the connection type')
  const key = input.key ?? String(t.spec.defaultKey)
  if (!KEY.test(key)) return err(400, 'invalid_request', 'key: lower-case letters, digits and dashes')
  if (connections.some(c => c.key === key)) return err(409, 'connection_key_taken', 'a connection with this key exists', { key })
  const settings = input.settings ?? {}
  const secret = secretPath(settings)
  if (secret !== null) return err(422, 'secret_material_rejected', 'a value looks like a secret', { field: 'settings', path: secret })
  const at = new Date().toISOString()
  const c: Connection = {
    id: randomUUID(), key, type: t.key, typeVersion: t.version, displayName: input.displayName?.trim() || String(t.spec.displayName), account: null, auth: null,
    status: 'pending', statusReason: null, statusMessage: null, settings, secretRef: null, expiresAt: null, connectedBy: null, connectedAt: null, lastCheckedAt: null,
    agents: [], createdBy: ME, createdAt: at, updatedAt: at, version: 1,
  }
  connections.push(c)
  return { status: 201, body: out(c, true), etag: etag(c) }
}

export function patch(key: string, ifMatch: string | undefined, body: string): Reply {
  const c = connections.find(x => x.key === key)
  if (c === undefined) return err(404, 'not_found', 'connection not found')
  if (ifMatch === undefined) return err(428, 'precondition_required', 'If-Match is required')
  if (ifMatch !== etag(c)) return err(409, 'version_conflict', 'the connection changed', { currentVersion: c.version })
  const input = JSON.parse(body || '{}') as { displayName?: string, settings?: Record<string, unknown> }
  if (input.settings !== undefined) {
    const secret = secretPath(input.settings)
    if (secret !== null) return err(422, 'secret_material_rejected', 'a value looks like a secret', { field: 'settings', path: secret })
    const errors = checkSettings(typeOf(c)!, input.settings)
    if (errors.length > 0) return err(422, 'invalid_connection_settings', 'settings does not match the template schema', { field: 'settings', errors })
    c.settings = input.settings
  }
  if (typeof input.displayName === 'string' && input.displayName.trim() !== '') c.displayName = input.displayName.trim()
  c.version += 1
  c.updatedAt = new Date().toISOString()
  return { status: 200, body: out(c, true), etag: etag(c) }
}

export function authorize(key: string): Reply {
  const c = connections.find(x => x.key === key)
  if (c === undefined) return err(404, 'not_found', 'connection not found')
  const t = typeOf(c)
  if (!authOf(t).includes('oauth2')) return err(422, 'auth_not_supported', 'the type does not connect over OAuth')
  if (!oauthApps.has(c.type)) return err(409, 'oauth_app_not_configured', 'the OAuth application of the type is not set', { type: c.type })
  for (const [s, v] of states) if (v.key === key) states.delete(s)
  const state = randomBytes(32).toString('base64url')
  const expires = Date.now() + 600_000
  states.set(state, { key, expires })
  const url = new URL(String((t!.spec.oauth2 as { authorizeUrl: string }).authorizeUrl))
  url.searchParams.set('client_id', oauthApps.get(c.type)!.clientId)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', `${PROVIDER}/api/v1/connections:callback`)
  return { status: 200, body: { authorizeUrl: url.toString(), expiresAt: new Date(expires).toISOString() } }
}

export function setToken(key: string, body: string): Reply {
  const c = connections.find(x => x.key === key)
  if (c === undefined) return err(404, 'not_found', 'connection not found')
  const t = typeOf(c)!
  if (!authOf(t).includes('token')) return err(422, 'auth_not_supported', 'the type does not take a key')
  const input = JSON.parse(body || '{}') as { account?: unknown, token?: unknown, expiresAt?: unknown }
  if (typeof input.token !== 'string' || input.token.length < 1 || input.token.length > 8192) return err(400, 'invalid_request', 'token is required')
  const pattern = (t.spec.accountField as { pattern: string }).pattern
  if (typeof input.account !== 'string' || input.account.length < 1 || input.account.length > 253) return err(400, 'invalid_request', 'account: 1…253 characters')
  if (!new RegExp(`^(?:${pattern})$`).test(input.account)) return err(422, 'invalid_account', 'the account does not match the type')
  if (input.expiresAt !== undefined && input.expiresAt !== null && (typeof input.expiresAt !== 'string' || Date.parse(input.expiresAt) <= Date.now())) return err(422, 'invalid_expiry', 'expiresAt must be in the future')
  const at = new Date().toISOString()
  Object.assign(c, {
    status: 'active', auth: 'token', account: input.account, statusReason: null, statusMessage: null, secretRef: `kv/data/tenants/${TENANT}/connections/${key}`,
    expiresAt: typeof input.expiresAt === 'string' ? input.expiresAt : null, connectedBy: ME, connectedAt: at, updatedAt: at, version: c.version + 1,
  })
  return { status: 200, body: out(c, true), etag: etag(c) }
}

export function revoke(key: string, body: string): Reply {
  const c = connections.find(x => x.key === key)
  if (c === undefined) return err(404, 'not_found', 'connection not found')
  if (c.status === 'revoked') return { status: 200, body: out(c, true), etag: etag(c) }
  const reason = (JSON.parse(body || '{}') as { reason?: unknown }).reason
  for (const [s, v] of states) if (v.key === key) states.delete(s)
  Object.assign(c, { status: 'revoked', auth: null, secretRef: null, expiresAt: null, statusReason: null, statusMessage: typeof reason === 'string' && reason.trim() !== '' ? reason.slice(0, 500) : null, updatedAt: new Date().toISOString(), version: c.version + 1 })
  return { status: 200, body: out(c, true), etag: etag(c) }
}

// ------------------------------------------------------------------ секреты агентов по имени

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

export function listSecrets(agentKey: string, known: boolean): Reply {
  if (!known) return err(404, 'not_found', 'agent not found')
  return { status: 200, body: { items: secretNames.get(agentKey) ?? [] } }
}

export function setSecret(agentKey: string, name: string, body: string, known: boolean): Reply {
  if (!known) return err(404, 'not_found', 'agent not found')
  if (!NAME.test(name)) return err(422, 'invalid_secret_name', 'name: lower-case letters, digits and dashes')
  const value = (JSON.parse(body || '{}') as { value?: unknown }).value
  if (typeof value !== 'string' || value.length < 1 || value.length > 65536) return err(400, 'invalid_request', 'value is required')
  const names = secretNames.get(agentKey) ?? []
  const existing = names.find(n => n.name === name)
  const item = { name, updatedAt: new Date().toISOString(), updatedBy: ME }
  if (existing !== undefined) Object.assign(existing, item)
  else names.push(item)
  secretNames.set(agentKey, names)
  return { status: existing !== undefined ? 200 : 201, body: item }
}

export function deleteSecret(agentKey: string, name: string, known: boolean): Reply {
  if (!known) return err(404, 'not_found', 'agent not found')
  const names = secretNames.get(agentKey) ?? []
  const i = names.findIndex(n => n.name === name)
  if (i < 0) return err(404, 'not_found', 'secret not found')
  names.splice(i, 1)
  return { status: 204, body: null }
}

// ------------------------------------------------------------------ фейковый провайдер OAuth и callback

const page = (res: ServerResponse, html: string): void => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(`<!doctype html><meta charset="utf-8"><title>CRM (демо) — доступ</title><body style="font:16px system-ui;max-width:560px;margin:48px auto;padding:0 16px">${html}</body>`) }
const esc = (s: string): string => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

/** Маршруты без Bearer: страница согласия провайдера и callback ядра. `true` — ответ отдан. */
export function publicRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', PROVIDER)
  if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
    const back = url.searchParams.get('redirect_uri') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const allow = `${back}?${new URLSearchParams({ state, code: randomBytes(8).toString('hex'), referer: 'polaris.crm.example' })}`
    const deny = `${back}?${new URLSearchParams({ state, error: 'access_denied', error_description: 'The user declined' })}`
    page(res, `<h1>CRM (демо)</h1><p>Приложение <b>${esc(url.searchParams.get('client_id') ?? '')}</b> просит доступ к порталу <b>polaris.crm.example</b>: сделки, воронки, задачи.</p><p><a id="allow" href="${esc(allow)}">Разрешить</a> · <a id="deny" href="${esc(deny)}">Отказать</a></p>`)
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/connections:callback') {
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
    const state = url.searchParams.get('state') ?? ''
    const known = states.get(state)
    states.delete(state)
    const to = (q: Record<string, string>): void => { res.writeHead(303, { ...headers, location: `${consoleReturn}&${new URLSearchParams(q)}` }).end() }
    if (known === undefined || known.expires < Date.now()) { to({ result: 'invalid_state' }); return true }
    const c = connections.find(x => x.key === known.key)!
    const error = url.searchParams.get('error')
    if (error !== null || url.searchParams.get('code') === null) {
      c.statusReason = error === 'access_denied' ? 'consent_denied' : 'provider_error'
      c.statusMessage = (url.searchParams.get('error_description') ?? '').slice(0, 500) || null
      c.updatedAt = new Date().toISOString()
      to({ connection: c.key, result: 'failed', reason: c.statusReason })
      return true
    }
    const at = new Date().toISOString()
    Object.assign(c, {
      status: 'active', auth: 'oauth2', account: url.searchParams.get('referer'), statusReason: null, statusMessage: null,
      secretRef: `oauth2/creds/tenants/${TENANT}/connections/${c.key}`, expiresAt: null, connectedBy: ME, connectedAt: at, lastCheckedAt: at, updatedAt: at, version: c.version + 1,
    })
    to({ connection: c.key, result: 'active' })
    return true
  }
  return false
}

// ------------------------------------------------------------------ знание crm@1 подключения `crm`

/** Воронки, этапы и пользователи CRM — снимок знаний `crm@1` в workspace наблюдателя. */
export const crmEntities: { kind: string, key: string, title: string, attributes: Record<string, unknown> }[] = [
  { kind: 'crm_pipeline', key: 'crm:crm:100', title: 'Продажи', attributes: { connection: 'crm', externalId: '100', name: 'Продажи', main: true, sort: 1 } },
  { kind: 'crm_pipeline', key: 'crm:crm:200', title: 'Тендеры', attributes: { connection: 'crm', externalId: '200', name: 'Тендеры', sort: 2 } },
  { kind: 'crm_stage', key: 'crm:crm:100:141', title: 'Первичный контакт', attributes: { connection: 'crm', pipelineId: '100', externalId: '141', name: 'Первичный контакт', sort: 10, outcome: 'open' } },
  { kind: 'crm_stage', key: 'crm:crm:100:142', title: 'Готовим предложение', attributes: { connection: 'crm', pipelineId: '100', externalId: '142', name: 'Готовим предложение', sort: 20, outcome: 'open' } },
  { kind: 'crm_stage', key: 'crm:crm:100:143', title: 'Переговоры', attributes: { connection: 'crm', pipelineId: '100', externalId: '143', name: 'Переговоры', sort: 30, outcome: 'open' } },
  { kind: 'crm_stage', key: 'crm:crm:100:144', title: 'Успешно реализовано', attributes: { connection: 'crm', pipelineId: '100', externalId: '144', name: 'Успешно реализовано', sort: 40, outcome: 'won' } },
  { kind: 'crm_stage', key: 'crm:crm:200:241', title: 'Анализ закупки', attributes: { connection: 'crm', pipelineId: '200', externalId: '241', name: 'Анализ закупки', sort: 10, outcome: 'open' } },
  { kind: 'crm_stage', key: 'crm:crm:200:242', title: 'Подготовка заявки', attributes: { connection: 'crm', pipelineId: '200', externalId: '242', name: 'Подготовка заявки', sort: 20, outcome: 'open' } },
  { kind: 'crm_stage', key: 'crm:crm:200:243', title: 'Закрыто и не реализовано', attributes: { connection: 'crm', pipelineId: '200', externalId: '243', name: 'Закрыто и не реализовано', sort: 30, outcome: 'lost' } },
]

export const OBSERVER_WORKSPACE = WORKSPACE
