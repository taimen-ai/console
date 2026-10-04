/**
 * Вход и выход: OIDC Authorization Code + PKCE S256 (confidential client) и обмен id token
 * IdP на токен платформы в IAM (`federation:exchange`). Незавершённый вход — целиком в
 * зашифрованной cookie, на сервере его нет; сессия создаётся последней, когда всё проверено.
 */
import type { Hono } from 'hono'
import { cookie, parseCookies, randomToken, seal, sign, unseal, unsign } from '../crypto.ts'
import { FederationError } from '../identity.ts'
import { LOGIN_COOKIE, page, safeNext, SESSION_COOKIE, sessionCookie, type AppDeps, type Env, type Keys } from '../context.ts'

const LOGIN_TTL_MS = 10 * 60_000

interface PendingLogin { state: string, verifier: string, nonce: string, next: string, exp: number }

export function authRoutes(app: Hono<Env>, deps: AppDeps, keys: Keys): void {
  const { config } = deps
  const b = config.basePath
  const now = deps.now ?? Date.now
  const loginCookie = (value: string, maxAgeSeconds: number): string =>
    cookie(LOGIN_COOKIE, value, { path: `${b}/_auth`, secure: config.secureCookies, maxAgeSeconds })

  app.get(`${b}/_auth/login`, async (c) => {
    const query = new URL(c.req.url).searchParams
    const pending: PendingLogin = {
      state: randomToken(16),
      verifier: randomToken(48),
      nonce: randomToken(16),
      next: safeNext(config, query.get('next')),
      exp: now() + LOGIN_TTL_MS,
    }
    let location: string
    try {
      const hint = query.get('login_hint')
      location = await deps.oidc.authorizeUrl(pending.state, pending.nonce, pending.verifier, hint !== null && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(hint) ? hint : undefined)
    } catch {
      return page(config, 503, { en: 'The sign-in provider is unavailable.', ru: 'Провайдер входа недоступен.' }, c.req.header('accept-language') ?? null)
    }
    // Новый вход в том же браузере заменяет прежний незавершённый: cookie одна.
    return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', 'set-cookie': loginCookie(seal(keys.seal, pending), LOGIN_TTL_MS / 1000) } })
  })

  app.get(`${b}/_auth/callback`, async (c) => {
    const query = new URL(c.req.url).searchParams
    const lang = c.req.header('accept-language') ?? null
    const clear = loginCookie('', 0)
    const fail = (status: number, en: string, ru: string): Response => page(config, status, { en, ru }, lang, { 'set-cookie': clear })
    const state = query.get('state')
    const code = query.get('code')
    const cookies = parseCookies(c.req.header('cookie'))
    const pending = unseal<PendingLogin>(keys.seal, cookies[LOGIN_COOKIE])
    if (query.has('error')) return fail(400, 'The sign-in provider declined the sign-in.', 'Вход отклонён провайдером.')
    // state связан с этим браузером зашифрованной cookie; verifier и nonce браузер не видит.
    if (state === null || code === null || pending === null || typeof pending.state !== 'string' || pending.state !== state || !(pending.exp > now())) {
      return fail(400, 'The sign-in attempt has expired.', 'Попытка входа устарела.')
    }
    let tokens
    try {
      tokens = await deps.oidc.exchangeCode(code, pending.verifier)
    } catch {
      return fail(502, 'The sign-in provider did not issue a token.', 'Провайдер входа не выдал токен.')
    }
    if (tokens.nonce !== pending.nonce) return fail(400, 'The sign-in response did not pass verification.', 'Ответ провайдера не прошёл проверку.')
    let issued
    try {
      issued = await deps.exchange(tokens.idToken, 'control-plane', config.scopes['control-plane'])
    } catch (error) {
      const denied = error instanceof FederationError && error.status < 500
      return denied
        ? fail(403, 'You have no access to the console.', 'Нет доступа к консоли.')
        : fail(503, 'The identity service is unavailable.', 'Сервис учётных записей недоступен.')
    }
    // Прежняя сессия этого браузера закрывается после создания новой: перевход поверх
    // живого SSO даёт тот же `sid` IdP, и удалённая при живой новой сессия refresh не отзывает.
    const location = safeNext(config, typeof pending.next === 'string' ? pending.next : null)
    const previous = unsign(keys.sign, cookies[SESSION_COOKIE])
    const session = deps.sessions.create(issued.principalId, tokens, { audience: 'control-plane', issued })
    if (previous !== null && previous !== session.sid) queueMicrotask(() => deps.sessions.delete(previous))
    const headers = new Headers({ location, 'cache-control': 'no-store' })
    headers.append('set-cookie', clear)
    headers.append('set-cookie', sessionCookie(config, sign(keys.sign, session.sid), config.sessionTtlMs / 1000))
    return new Response(null, { status: 302, headers })
  })

  /**
   * Выход. POST (свой Origin) закрывает сессию и либо ведёт (навигация) на выход из IdP
   * `303`, либо для fetch отвечает `204`. GET только перенаправляет на выход из IdP и сессию
   * не трогает (иначе чужая ссылка разлогинивала бы). Токенов в ответах нет.
   */
  const endSession = async (): Promise<string> => await deps.oidc.endSessionUrl() ?? `${b}/`
  app.get(`${b}/_auth/logout`, async () => new Response(null, { status: 303, headers: { location: await endSession(), 'cache-control': 'no-store' } }))
  app.post(`${b}/_auth/logout`, async (c) => {
    const sid = unsign(keys.sign, parseCookies(c.req.header('cookie'))[SESSION_COOKIE])
    if (sid !== null) deps.sessions.delete(sid)
    const clear = sessionCookie(config, '', 0)
    if (c.req.header('sec-fetch-mode') !== 'navigate' && !(c.req.header('accept') ?? '').includes('text/html')) {
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'set-cookie': clear } })
    }
    return new Response(null, { status: 303, headers: { location: await endSession(), 'cache-control': 'no-store', 'set-cookie': clear } })
  })
}
