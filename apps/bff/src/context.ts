/**
 * Общее для маршрутов BFF: зависимости приложения, переменные запроса Hono, единый вид
 * ошибок и сессия из cookie. Токены живут только в процессе BFF: в браузер уходит cookie с
 * подписанным id сессии.
 */
import type { Context } from 'hono'
import type { AllowList } from './allowlist.ts'
import type { Config } from './config.ts'
import { cookie, parseCookies, unsign } from './crypto.ts'
import type { Exchange, Oidc } from './identity.ts'
import { RESPONSE_SECURITY_HEADERS } from './proxy.ts'
import type { Session, Sessions } from './sessions.ts'

export const SESSION_COOKIE = 'console_session'
export const LOGIN_COOKIE = 'console_login'

export type Log = (entry: Record<string, unknown>) => void

export interface AppDeps {
  config: Config
  sessions: Sessions
  oidc: Pick<Oidc, 'authorizeUrl' | 'exchangeCode' | 'endSessionUrl' | 'discover'>
  exchange: Exchange
  allow: AllowList
  log: Log
  now?: () => number
  /** Таймаут рукопожатия WS с ядром (по умолчанию 10 с). */
  wsHandshakeTimeoutMs?: number
}

/** Ключи подписи cookie сессии и шифрования cookie входа. */
export interface Keys { sign: Buffer, seal: Buffer }

/** Переменные запроса: id для журнала и шаблон маршрута — без query и параметров. */
export interface Vars {
  requestId: string
  route: string
  session: Session
  messageRequestId: string
}
export type Env = { Variables: Vars }
export type Ctx = Context<Env>

export const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } as const

/** Ответ API об ошибке: `{error: {code, ...}}`, без кэша, не исполняется как документ. */
export function fail(status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, ...extra } }, headers)
}

export function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...SECURITY_HEADERS, ...RESPONSE_SECURITY_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

/** Страница входа и её ошибок — без скриптов, на двух языках (браузер выбирает по Accept-Language). */
export function page(config: Config, status: number, text: { en: string, ru: string }, acceptLanguage: string | null, headers: Record<string, string> = {}): Response {
  const ru = /^\s*ru\b/i.test(acceptLanguage ?? '') || (config.defaultLocale === 'ru' && acceptLanguage === null)
  const lang = ru ? 'ru' : 'en'
  const body = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>${escapeHtml(config.brand.productName)}</title>`
    + `<p>${escapeHtml(ru ? text.ru : text.en)}</p><p><a href="${config.basePath}/_auth/login">${ru ? 'Войти снова' : 'Sign in again'}</a></p></html>`
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'", ...headers },
  })
}

export function sessionCookie(config: Config, value: string, maxAgeSeconds: number): string {
  return cookie(SESSION_COOKIE, value, { path: config.basePath === '' ? '/' : config.basePath, secure: config.secureCookies, maxAgeSeconds })
}

export function sessionOf(deps: AppDeps, keys: Keys, cookieHeader: string | undefined | null): Session | null {
  return deps.sessions.get(unsign(keys.sign, parseCookies(cookieHeader ?? undefined)[SESSION_COOKIE]))
}

/**
 * Куда вернуть после входа: разбор относительно своего origin, только свой origin и путь
 * консоли; наружу — нормализованные pathname + search.
 */
export function safeNext(config: Config, next: string | null): string {
  const home = `${config.basePath}/`
  if (next === null) return home
  try {
    const url = new URL(next, config.publicOrigin)
    if (url.origin !== config.publicOrigin || !url.pathname.startsWith(home)) return home
    return url.pathname + url.search
  } catch {
    return home
  }
}

/** Изменение принимается только со своего origin: Sec-Fetch-Site и Origin обязаны совпасть. */
export function sameOrigin(config: Config, headers: Headers): boolean {
  const site = headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false
  const origin = headers.get('origin')
  if (origin !== null) return origin === config.publicOrigin
  return site !== null
}
