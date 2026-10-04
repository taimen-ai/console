import type { ControlPlanePaths } from '@console/api'
import createClient from 'openapi-fetch'

/**
 * Клиент консоли: всё под префиксом запуска (`<base href>` вписывает BFF), cookie сессии,
 * единый разбор ошибок BFF. Токенов в браузере нет — их держит BFF.
 */

/** Префикс консоли без завершающего `/`: `/console` или `''`. */
export const BASE_PATH = (() => {
  if (typeof document === 'undefined') return '/console'
  return new URL(document.baseURI).pathname.replace(/\/+$/, '')
})()

export const API = `${BASE_PATH}/api`
export const LOGIN_PATH = `${BASE_PATH}/_auth/login`

/**
 * Ошибка API в терминах экрана. `kind` решает, какое состояние показать:
 * - `auth` — сессии нет или нужен перевход: страница уже уходит на вход;
 * - `forbidden` — 403: «нет доступа» с причиной;
 * - `upstream` — 502 `upstream_unauthorized`: сервис не принял токен, перевход не лечит;
 * - `unavailable` — 5xx и сеть: «нет связи» со временем последних данных;
 * - `client` — прочие 4xx (409 и 422 управляющих действий показываются как есть).
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly kind: 'auth' | 'forbidden' | 'upstream' | 'unavailable' | 'client'
  readonly detail: string | undefined
  /** `error.details` ответа ядра: пути ошибок полей, текущая версия при конфликте и т. п. */
  readonly details: Record<string, unknown> | undefined

  constructor(status: number, code: string, detail?: string, details?: Record<string, unknown>) {
    super(`${status} ${code}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.details = details
    this.kind = status === 401 ? 'auth'
      : status === 403 ? 'forbidden'
        : status === 502 && code === 'upstream_unauthorized' ? 'upstream'
          : status === 0 || status >= 500 ? 'unavailable' : 'client'
  }
}

const REAUTH = new Set(['unauthenticated', 'reauth_required'])
/** 401 BFF, после которого `consoleFetch` уже ушёл на вход. */
export const leftForLogin = (error: ApiError): boolean => error.status === 401 && REAUTH.has(error.code)

/** Полная навигация браузера. Отдельный объект — тесты подменяют её без навигации jsdom. */
export const browser = { assign: (url: string): void => window.location.assign(url) }

/** Вход с возвратом на текущий адрес: глубокая ссылка переживает вход. */
export function redirectToLogin(): void {
  browser.assign(`${LOGIN_PATH}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
}

async function errorBody(response: Response): Promise<{ code?: string, message?: string, details?: Record<string, unknown> }> {
  try {
    const body = await response.clone().json() as { error?: { code?: unknown, message?: unknown, details?: unknown } }
    const e = body.error ?? {}
    return {
      ...(typeof e.code === 'string' ? { code: e.code } : {}), ...(typeof e.message === 'string' ? { message: e.message } : {}),
      ...(e.details !== null && typeof e.details === 'object' && !Array.isArray(e.details) ? { details: e.details as Record<string, unknown> } : {}),
    }
  } catch {
    return {}
  }
}

/**
 * fetch консоли. Неуспешный ответ бросает ApiError — экраны получают либо данные, либо
 * ошибку для состояния. 401 `unauthenticated`/`reauth_required` сразу уводит на вход.
 */
export async function consoleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(input, { ...init, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'network')
  }
  if (response.ok) return response
  const body = await errorBody(response)
  const code = body.code ?? `http_${response.status}`
  if (response.status === 401 && REAUTH.has(code)) redirectToLogin()
  throw new ApiError(response.status, code, body.message, body.details)
}

const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
/** Ядро: пути снимка openapi без префикса `/api/v1`. */
export const cp = createClient<ControlPlanePaths>({ baseUrl: `${origin}${API}/cp`, fetch: consoleFetch })

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  return await (await consoleFetch(path, { ...init, headers: { accept: 'application/json', ...init?.headers } })).json() as T
}

/** GET ядра по пути без `/api/v1`, для ответов, которые снимок openapi не описывает (`{}`). */
export const cpGet = <T>(path: string, signal?: AbortSignal): Promise<T> => getJson<T>(`${API}/cp${path}`, signal !== undefined ? { signal } : {})

/** POST ядра с JSON-телом; мутация идёт со своего origin — BFF это проверяет. */
export async function cpPost<T>(path: string, body: unknown = {}, idempotencyKey?: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await consoleFetch(`${API}/cp${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(idempotencyKey !== undefined ? { 'idempotency-key': idempotencyKey } : {}), ...headers },
    body: JSON.stringify(body),
  })
  return response.status === 204 ? undefined as T : await response.json() as T
}

/**
 * PATCH ядра с оптимистичной блокировкой: `If-Match: "task-<версия>"` (409 `version_conflict`,
 * если работу успели изменить). `entity` — вид версии в ETag ядра.
 */
export async function cpPatch<T>(path: string, body: unknown, version: number, entity = 'task'): Promise<T> {
  const response = await consoleFetch(`${API}/cp${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'if-match': `"${entity}-${version}"` },
    body: JSON.stringify(body),
  })
  return await response.json() as T
}

export interface SessionInfo { principalId: string, expiresAt: string }
export const getSession = (): Promise<SessionInfo> => getJson<SessionInfo>(`${API}/session`)

export interface LaunchConfig { basePath: string, brand: { productName: string, orgName: string | null }, locales: string[], defaultLocale: string }
export const getConfig = (): Promise<LaunchConfig> => getJson<LaunchConfig>(`${API}/config`)

/** Выход: POST закрывает сессию в BFF (204), затем навигация на выход из IdP. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE_PATH}/_auth/logout`, { method: 'POST', credentials: 'same-origin' })
  } catch { /* сессию BFF закроет срок; навигация всё равно уводит к IdP */ }
  browser.assign(`${BASE_PATH}/_auth/logout`)
}
