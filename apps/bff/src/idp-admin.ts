/**
 * Пользователь у провайдера входа — шаг «Добавить человека» (решение владельца 2026-10-03:
 * консоль заводит пользователя Keycloak сама). Консоль остаётся совместимой с любым OIDC IdP:
 * шаг включается только `CONSOLE_IDP_ADMIN=keycloak`, без него администратор вводит `sub`
 * готового пользователя.
 *
 * Keycloak Admin API — служебным клиентом с service account (`client_credentials`) и ролями
 * realm-management `manage-users`, `view-users`, `query-users`, не больше: его заводит
 * оператор при развёртывании (скрипт bootstrap поставки). Секрет клиента — файл.
 *
 * Идемпотентно по e-mail: пользователь с таким адресом уже есть — берётся он (пароль не
 * меняется). Новый — с именем и фамилией (без них Keycloak не пускает: «Account is not fully
 * set up»), подтверждённым адресом и временным паролем, который при первом входе нужно
 * сменить. Временный пароль возвращается один раз — его отдают человеку вместе со ссылкой
 * первого входа; в журнал BFF он не пишется.
 */
import { randomBytes } from 'node:crypto'

export interface IdpUser { id: string, created: boolean, temporaryPassword?: string }
export interface IdpAdmin { ensureUser(input: { email: string, displayName: string }): Promise<IdpUser> }

/** Отказ провайдера: код для отчёта потока и HTTP-статус шага. */
export class IdpAdminError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code }
}

export interface KeycloakOptions { url: string, realm: string, clientId: string, secret: string, now?: () => number }

/** Имя для Keycloak: первое слово — имя, остальное — фамилия; одно слово — оно же фамилия. */
export function splitName(displayName: string): { firstName: string, lastName: string } {
  const [first = displayName, ...rest] = displayName.trim().split(/\s+/)
  return { firstName: first, lastName: rest.length > 0 ? rest.join(' ') : first }
}

/** Временный пароль: случайный, с буквами обоих регистров, цифрой и знаком — под обычные политики. */
export const temporaryPassword = (): string => `${randomBytes(12).toString('base64url')}-7Kq`

const TIMEOUT_MS = 10_000

export function keycloakAdmin(options: KeycloakOptions): IdpAdmin {
  const now = options.now ?? Date.now
  const base = options.url.replace(/\/+$/, '')
  const realm = encodeURIComponent(options.realm)
  let cached: { token: string, until: number } | null = null

  const send = async (method: string, path: string, init: { token?: string, json?: unknown, form?: Record<string, string> } = {}): Promise<Response> => {
    try {
      return await fetch(`${base}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(init.token !== undefined ? { authorization: `Bearer ${init.token}` } : {}),
          ...(init.json !== undefined ? { 'content-type': 'application/json' } : init.form !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : init.form !== undefined ? { body: new URLSearchParams(init.form).toString() } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'manual',
      })
    } catch {
      throw new IdpAdminError(503, 'idp_unavailable')
    }
  }

  const token = async (): Promise<string> => {
    if (cached !== null && cached.until > now()) return cached.token
    const reply = await send('POST', `/realms/${realm}/protocol/openid-connect/token`, { form: { grant_type: 'client_credentials', client_id: options.clientId, client_secret: options.secret } })
    if (reply.status >= 500) throw new IdpAdminError(503, 'idp_unavailable')
    if (!reply.ok) throw new IdpAdminError(502, 'idp_admin_unauthorized')
    const body = await reply.json() as { access_token?: string, expires_in?: number }
    if (typeof body.access_token !== 'string') throw new IdpAdminError(502, 'idp_admin_unauthorized')
    cached = { token: body.access_token, until: now() + Math.max(10, (body.expires_in ?? 60) - 10) * 1000 }
    return cached.token
  }

  const fail = (reply: Response): never => {
    if (reply.status >= 500) throw new IdpAdminError(503, 'idp_unavailable')
    if (reply.status === 401 || reply.status === 403) throw new IdpAdminError(502, 'idp_admin_forbidden')
    throw new IdpAdminError(502, `idp_http_${reply.status}`)
  }

  const findByEmail = async (tok: string, email: string): Promise<{ id: string, email?: string }[]> => {
    const reply = await send('GET', `/admin/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`, { token: tok })
    if (!reply.ok) fail(reply)
    const items = await reply.json() as unknown
    return Array.isArray(items) ? items.filter((u): u is { id: string, email?: string } => typeof u === 'object' && u !== null && typeof (u as { id?: unknown }).id === 'string') : []
  }

  return {
    async ensureUser({ email, displayName }) {
      const tok = await token()
      const same = (await findByEmail(tok, email)).filter(u => (u.email ?? '').toLowerCase() === email.toLowerCase())
      if (same.length > 1) throw new IdpAdminError(409, 'idp_user_ambiguous')
      if (same.length === 1) return { id: same[0]!.id, created: false }
      const password = temporaryPassword()
      const reply = await send('POST', `/admin/realms/${realm}/users`, {
        token: tok,
        json: { username: email, email, emailVerified: true, enabled: true, ...splitName(displayName), credentials: [{ type: 'password', value: password, temporary: true }] },
      })
      // Имя пользователя (= e-mail) занято учёткой с другим адресом — не наша, не берём.
      if (reply.status === 409) throw new IdpAdminError(409, 'idp_user_exists')
      if (reply.status !== 201) fail(reply)
      const id = /\/users\/([^/?#]+)$/.exec(reply.headers.get('location') ?? '')?.[1]
      const found = id !== undefined ? [{ id: decodeURIComponent(id) }] : await findByEmail(tok, email)
      if (found.length !== 1) throw new IdpAdminError(502, 'idp_user_unknown')
      return { id: found[0]!.id, created: true, temporaryPassword: password }
    },
  }
}
