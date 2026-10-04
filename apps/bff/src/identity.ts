/**
 * Вход человека: OIDC IdP (Authorization Code + PKCE S256, confidential client) →
 * id token → IAM `federation:exchange` на нужный audience (TAI-ADR-0058 п.4).
 *
 * Обменивается именно id token: он JWT у любого OIDC IdP, а access token Dex таким быть
 * не обязан (R004). Консоль не знает, какой IdP за ней: только issuer, client id и secret.
 */
import type { Audience, Config } from './config.ts'
import { jwtPayload, pkceChallenge } from './crypto.ts'

interface Endpoints {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint?: string
  revocation_endpoint?: string
}

export interface IdpTokens {
  idToken: string
  /** Срок id token, мс эпохи. */
  idTokenExp: number
  refreshToken: string | null
  nonce: string | null
  /**
   * Сессия IdP (claim `sid` id token, OIDC Front-Channel Logout §3; у Keycloak — его user
   * session). Перевход поверх живого SSO даёт тот же `sid`, а отзыв любого refresh token
   * этой сессии у Keycloak гасит её целиком — поэтому BFF не отзывает refresh, пока жива
   * другая сессия консоли с тем же `sid`. `null` — IdP claim не выдаёт (Dex).
   */
  sid: string | null
}

/** Сколько ждать IdP на любом вызове: зависший IdP не держит вход и выход. */
export const IDP_TIMEOUT_MS = 10_000
/** Сколько помнить отказ discovery: лежащий IdP не получает по запросу на каждый вход и отзыв. */
export const DISCOVERY_RETRY_MS = 5_000

export class OidcError extends Error {
  readonly status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}

export class Oidc {
  private endpoints: Promise<Endpoints> | null = null
  /** Последний отказ discovery и до какого момента отвечать им, не спрашивая IdP. */
  private failure: { error: unknown, until: number } | null = null
  private readonly config: Config['oidc']
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly now: () => number

  /**
   * `timeoutMs` — на каждый вызов IdP (discovery, token, revocation), по умолчанию 10 с;
   * `now` — часы отрицательного кэша discovery.
   */
  constructor(config: Config['oidc'], fetchImpl: typeof fetch = fetch, options: { timeoutMs?: number, now?: () => number } = {}) {
    this.config = config
    this.fetchImpl = fetchImpl
    this.timeoutMs = options.timeoutMs ?? IDP_TIMEOUT_MS
    this.now = options.now ?? Date.now
  }

  /**
   * Документ discovery, один на процесс. Зависший IdP обрывается таймаутом. Отказ (сеть,
   * HTTP, чужой issuer, таймаут) кэшируется ненадолго — `DISCOVERY_RETRY_MS`: вызовы в это
   * окно получают тот же отказ сразу, а первый после окна спросит IdP заново. Так sweep с
   * сотней отзывов или поток входов не долбят лежащий IdP, а вернувшийся подхватывается за
   * секунды.
   */
  discover(): Promise<Endpoints> {
    if (this.endpoints === null && this.failure !== null && this.failure.until > this.now()) {
      return Promise.reject(this.failure.error)
    }
    this.endpoints ??= this.fetchImpl(`${this.config.issuer}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).then(async (r) => {
      if (!r.ok) throw new OidcError(`OIDC discovery: HTTP ${r.status}`, r.status)
      const endpoints = await r.json() as Endpoints
      // OIDC Discovery §4.3: issuer документа обязан совпасть с настроенным.
      if (typeof endpoints.issuer !== 'string' || endpoints.issuer.replace(/\/+$/, '') !== this.config.issuer) {
        throw new OidcError('OIDC discovery: issuer не совпадает с настроенным')
      }
      this.failure = null
      return endpoints
    }).catch((error: unknown) => {
      this.endpoints = null
      this.failure = { error, until: this.now() + DISCOVERY_RETRY_MS }
      throw error
    })
    return this.endpoints
  }

  /** `loginHint` — e-mail из ссылки первого входа (R013): IdP подставит его в форму. */
  async authorizeUrl(state: string, nonce: string, verifier: string, loginHint?: string): Promise<string> {
    const url = new URL((await this.discover()).authorization_endpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      ...(loginHint !== undefined ? { login_hint: loginHint } : {}),
    }).toString()
    return url.toString()
  }

  exchangeCode(code: string, verifier: string): Promise<IdpTokens> {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.config.redirectUri }, null)
  }

  /** Тихий перевход: refresh token IdP → новый id token. Ротированный refresh token заменяет прежний. */
  refresh(refreshToken: string): Promise<IdpTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken)
  }

  /**
   * Адрес выхода из IdP. Без `id_token_hint`: адрес уходит в браузер, а id token — годный
   * вход в публичный `federation:exchange` до своего `exp`. Хватает client_id и
   * post_logout_redirect_uri (Keycloak при этом спросит подтверждение).
   */
  async endSessionUrl(): Promise<string | null> {
    const endpoint = (await this.discover().catch(() => null))?.end_session_endpoint
    if (endpoint === undefined || endpoint === null) return null
    const url = new URL(endpoint)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('post_logout_redirect_uri', this.config.postLogoutRedirectUri)
    return url.toString()
  }

  /** Отозвать refresh token у IdP (RFC 7009), если IdP это умеет. Лучшее усилие: ошибка не мешает выходу. */
  async revoke(refreshToken: string): Promise<boolean> {
    const endpoint = (await this.discover().catch(() => null))?.revocation_endpoint
    if (endpoint === undefined || endpoint === null) return false
    const response = await this.post(endpoint, { token: refreshToken, token_type_hint: 'refresh_token' }).catch(() => null)
    return response?.ok ?? false
  }

  private post(url: string, form: Record<string, string>): Promise<Response> {
    // client_secret_basic (RFC 6749 §2.3.1: части кодируются form-urlencoded).
    const basic = Buffer.from(`${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`).toString('base64')
    return this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}`, accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
  }

  private async token(form: Record<string, string>, previousRefresh: string | null): Promise<IdpTokens> {
    const { token_endpoint } = await this.discover()
    const response = await this.post(token_endpoint, form)
    if (!response.ok) throw new OidcError(`OIDC token (${form.grant_type}): HTTP ${response.status}`, response.status)
    const body = await response.json() as { id_token?: unknown, refresh_token?: unknown }
    if (typeof body.id_token !== 'string') throw new OidcError(`OIDC token (${form.grant_type}): нет id_token`, 400)
    const claims = jwtPayload(body.id_token)
    if (claims === null || typeof claims.exp !== 'number') throw new OidcError('OIDC: id_token без exp', 400)
    return {
      idToken: body.id_token,
      idTokenExp: claims.exp * 1000,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : previousRefresh,
      nonce: typeof claims.nonce === 'string' ? claims.nonce : null,
      sid: typeof claims.sid === 'string' && claims.sid !== '' ? claims.sid : null,
    }
  }
}

export interface Issued {
  token: string
  /** Срок токена, мс эпохи. */
  exp: number
  scopes: string[]
  principalId: string
}

/** Отказ IAM: `status` и `code` из ответа (`scope_not_allowed`, `audience_not_allowed`, …). */
export class FederationError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(`IAM federation: ${status} ${code}`)
    this.status = status
    this.code = code
  }
}

export type Exchange = (idToken: string, audience: Audience, scopes: string[]) => Promise<Issued>

export function federation(config: Config['iam'], now: () => number = Date.now, fetchImpl: typeof fetch = fetch): Exchange {
  return async (idToken, audience, scopes) => {
    const response = await fetchImpl(`${config.url}/api/v1/tenants/${config.tenantId}/federation:exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ identityProvider: config.identityProvider, token: idToken, audience, scopes }),
    })
    const body = await response.json().catch(() => ({})) as {
      accessToken?: unknown, expiresIn?: unknown, scope?: unknown, principalId?: unknown,
      detail?: unknown, error?: { code?: unknown }
    }
    if (!response.ok || typeof body.accessToken !== 'string' || typeof body.principalId !== 'string') {
      const code = typeof body.detail === 'string' ? body.detail : typeof body.error?.code === 'string' ? body.error.code : 'federation_failed'
      throw new FederationError(response.ok ? 502 : response.status, code)
    }
    const ttl = typeof body.expiresIn === 'number' ? body.expiresIn : 300
    return {
      token: body.accessToken,
      exp: now() + ttl * 1000,
      scopes: Array.isArray(body.scope) ? body.scope.filter((s): s is string => typeof s === 'string') : scopes,
      principalId: body.principalId,
    }
  }
}
