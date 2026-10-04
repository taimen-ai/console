/**
 * API консоли под `{base}/api`:
 * - `config` — бренд и языки для SPA при запуске (без сессии);
 * - `session` — кто вошёл;
 * - `cp/*` → ядро `/api/v1/*` по allow-list из снимка openapi;
 * - `assistant/{message,stream,history,approval}` → launcher харнесса, поверхность `surface/1`;
 * - `org/people…` — люди организации: потоки BFF через IAM и ядро (`./org.ts`).
 * Каждый запрос наверх несёт Bearer вошедшего человека, поэтому действие попадает в журнал
 * ядра от его имени. BFF ответы не агрегирует и не переписывает.
 */
import { createHash } from 'node:crypto'
import type { Hono } from 'hono'
import type { Audience } from '../config.ts'
import { fail, json, sessionOf, type AppDeps, type Ctx, type Env, type Keys } from '../context.ts'
import { BodyTooLarge, pickRequestHeaders, readLimited, relayResponse } from '../proxy.ts'
import { buildScreenContext, parseScreen, ScreenUrlError } from '../screen-context.ts'
import { Unavailable, type Session } from '../sessions.ts'
import { upstreamReader } from '../upstream.ts'
import { orgRoutes } from './org.ts'

/** Лимит тела на участке launcher'а (контракт `surface/1`). */
const SURFACE_BODY_LIMIT = 64 * 1024
const SURFACE_OPS = { message: 'POST', stream: 'GET', history: 'GET', approval: 'POST' } as const
type SurfaceOp = keyof typeof SURFACE_OPS
/** Параметры query операций поверхности, которые уходят в launcher; прочие отбрасываются. */
const SURFACE_QUERY: Record<SurfaceOp, readonly string[]> = { message: [], stream: ['after'], history: ['before', 'limit'], approval: [] }
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Сколько помнить собранное тело сообщения ассистента для повтора с тем же requestId. */
export const MESSAGE_REPLAY_TTL_MS = 10 * 60_000
/** Сколько собранных тел помнить на сессию: сверх — вытесняется самое старое. */
export const MESSAGE_REPLAY_MAX = 100

/** Ошибка тела запроса: `400 {error:{code}}`, наверх запрос не идёт. */
export class BadRequest extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

/**
 * Собранное тело `surface/message` (или его сборка в полёте). Повтор с тем же requestId,
 * текстом и экраном получает это тело байт в байт: харнесс сверяет отпечаток
 * `[surface, text, screenContext]`, а контекст, собранный заново, отличался бы хотя бы
 * `capturedAt`. Сборку отменяет уход последнего ждущего клиента, пока она не готова.
 */
interface AssembledMessage { fingerprint: string, expiresAt: number, body: Promise<Buffer>, done: boolean, waiters: number, abort: AbortController }

export function apiRoutes(app: Hono<Env>, deps: AppDeps, keys: Keys): void {
  const { config } = deps
  const b = config.basePath
  const now = deps.now ?? Date.now
  const messages = new WeakMap<Session, Map<string, AssembledMessage>>()

  app.get(`${b}/api/config`, () => json(200, { basePath: b, brand: config.brand, locales: config.locales, defaultLocale: config.defaultLocale }))

  // Всё остальное под /api — только с сессией.
  app.use(`${b}/api/*`, async (c, next) => {
    const session = sessionOf(deps, keys, c.req.header('cookie'))
    if (session === null) {
      c.set('route', `${b}/api/*`)
      return fail(401, 'unauthenticated')
    }
    c.set('session', session)
    await next()
  })

  app.get(`${b}/api/session`, (c) => {
    const session = c.get('session')
    // Кто вошёл; права — из ядра. Токенов здесь нет и быть не должно.
    return json(200, { principalId: session.principalId, expiresAt: new Date(session.expiresAt).toISOString() })
  })

  app.all(`${b}/api/cp/*`, async (c) => {
    const raw = new URL(c.req.url)
    const path = `/api/v1${raw.pathname.slice(`${b}/api/cp`.length)}`
    const route = deps.allow.match(c.req.method, path)
    if (route === null) return fail(404, 'not_found')
    c.set('route', `${b}/api/cp${route.template.slice('/api/v1'.length)}`)
    const upload = route.template === '/api/v1/artifact-contents'
    return await forward(c, c.get('session'), 'control-plane', `${config.upstreams.controlPlane}${path}${raw.search}`, upload ? { bodyLimit: config.uploadLimitBytes } : {})
  })

  app.on(['GET', 'POST'], `${b}/api/assistant/:op{message|stream|history|approval}`, async (c) => {
    const op = c.req.param('op') as SurfaceOp
    if (SURFACE_OPS[op] !== c.req.method) return fail(404, 'not_found')
    c.set('route', `${b}/api/assistant/${op}`)
    const session = c.get('session')
    const params = new URL(c.req.url).searchParams
    const kept = new URLSearchParams()
    for (const name of SURFACE_QUERY[op]) {
      const value = params.get(name)
      if (value !== null) kept.set(name, value)
    }
    const query = kept.toString()
    // Principal — только из сессии: человек говорит лишь со своим контейнером.
    const target = `${config.upstreams.launcher}/_launcher/internal/principals/${session.principalId}/surface/${op}${query !== '' ? `?${query}` : ''}`
    return await forward(c, session, 'human-harness', target, {
      bodyLimit: SURFACE_BODY_LIMIT,
      headers: { 'x-harness-surface': 'console' },
      stream: op === 'stream',
      ...(op === 'message' ? { body: (body: Buffer, signal: AbortSignal) => surfaceMessage(c, session, body, signal) } : {}),
    })
  })

  orgRoutes(app, deps)

  app.all(`${b}/api/*`, () => fail(404, 'not_found'))

  /**
   * Запрос наверх с Bearer audience. Тело буферизуется с лимитом; ответ идёт потоком. 401
   * ресурса — токен сбрасывается и запрос повторяется один раз (отзыв или гонка срока; 401
   * приходит до первого байта потока, поэтому и поток повторяется безопасно). Повторный 401 —
   * `502 upstream_unauthorized`, а не 401, чтобы SPA не уходила на вход по кругу.
   */
  async function forward(c: Ctx, session: Session, audience: Audience, url: string, options: {
    bodyLimit?: number, headers?: Record<string, string>, stream?: boolean, body?: (body: Buffer, signal: AbortSignal) => Promise<Buffer>
  } = {}): Promise<Response> {
    const method = c.req.method
    // Уход клиента слушается с самого начала: сборка тела (контекст экрана) его тоже видит.
    const signal = c.req.raw.signal
    let body = SAFE_METHODS.has(method) ? undefined : await readLimited(c.req.raw, options.bodyLimit ?? config.bodyLimitBytes)
    const headers: Record<string, string> = { ...pickRequestHeaders(c.req.raw.headers), ...options.headers, 'x-request-id': c.get('requestId') }
    if (body !== undefined && options.body !== undefined) {
      body = await options.body(body, signal)
      // Тело пересобрано: тип — JSON, какой бы ни прислал браузер.
      headers['content-type'] = 'application/json'
    }
    for (let attempt = 0; ; attempt++) {
      const token = await deps.sessions.token(session, audience)
      let upstream: Response
      try {
        upstream = await fetch(url, { method, headers: { ...headers, authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: new Uint8Array(body) } : {}), signal, redirect: 'manual' })
      } catch (error) {
        if (signal.aborted) throw error
        throw new Unavailable(`upstream ${audience}: ${(error as { cause?: { code?: string } }).cause?.code ?? 'error'}`)
      }
      if (upstream.status === 401) {
        await upstream.body?.cancel()
        deps.sessions.invalidate(session, audience)
        if (attempt === 0) continue
        return fail(502, 'upstream_unauthorized', { audience })
      }
      return relayResponse(upstream, options.stream === true ? { 'x-accel-buffering': 'no' } : {})
    }
  }

  /**
   * Тело `surface/message` для launcher'а. SPA присылает `{requestId, text, screenUrl?}`;
   * наверх уходит `{requestId, text, screenContext?}`, где `screenContext` BFF собрал сам по
   * адресу экрана из данных ядра. Присланный браузером `screenContext` отбрасывается, как и
   * прочие поля. Текст сообщения дальше этого места не читается и в журнал не пишется.
   */
  async function surfaceMessage(c: Ctx, session: Session, raw: Buffer, signal: AbortSignal): Promise<Buffer> {
    let body: Record<string, unknown>
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
      body = parsed as Record<string, unknown>
    } catch {
      throw new BadRequest('invalid_body')
    }
    const { requestId, text, screenUrl } = body
    if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new BadRequest('invalid_request_id')
    c.set('messageRequestId', requestId)
    if (typeof text !== 'string' || text.length === 0 || text.length > 20_000) throw new BadRequest('invalid_text')
    if (screenUrl !== undefined && screenUrl !== null && typeof screenUrl !== 'string') throw new BadRequest('invalid_screen_url')
    const screen = typeof screenUrl === 'string' ? screenUrl : null
    if (screen !== null) {
      try {
        parseScreen(screen, config.publicOrigin, b)
      } catch (error) {
        if (error instanceof ScreenUrlError) throw new BadRequest('invalid_screen_url')
        throw error
      }
    }
    const requestIdForLog = c.get('requestId')
    const assemble = async (abort: AbortSignal): Promise<Buffer> => {
      let screenContext
      if (screen !== null) {
        const get = upstreamReader({ config, sessions: deps.sessions, allow: deps.allow }, session, requestIdForLog)
        screenContext = await buildScreenContext(get, screen, { origin: config.publicOrigin, basePath: b, now: now(), signal: abort })
      }
      return Buffer.from(JSON.stringify({ requestId, text, ...(screenContext !== undefined ? { screenContext } : {}) }), 'utf8')
    }
    const fingerprint = createHash('sha256').update(JSON.stringify([text, screen])).digest('base64url')
    const cache = messageCache(session)
    const known = cache.get(requestId)
    if (known !== undefined && known.fingerprint !== fingerprint) return await assemble(signal)
    return await join(known ?? remember(cache, requestId, fingerprint, assemble), signal)
  }

  /** Собранные тела сообщений сессии без истёкших (порядок вставки — порядок сроков). */
  function messageCache(session: Session): Map<string, AssembledMessage> {
    let cache = messages.get(session)
    if (cache === undefined) {
      cache = new Map()
      messages.set(session, cache)
    }
    for (const [id, entry] of cache) {
      if (entry.expiresAt > now()) break
      cache.delete(id)
    }
    return cache
  }

  function remember(cache: Map<string, AssembledMessage>, requestId: string, fingerprint: string, assemble: (signal: AbortSignal) => Promise<Buffer>): AssembledMessage {
    const abort = new AbortController()
    const entry: AssembledMessage = { fingerprint, expiresAt: now() + MESSAGE_REPLAY_TTL_MS, body: Promise.resolve(Buffer.alloc(0)), done: false, waiters: 0, abort }
    // Сборка не удалась или отменена — не помнить: повтор соберёт заново, наверх она не ходила.
    entry.body = assemble(abort.signal).then((body) => {
      entry.done = true
      return body
    }, (error: unknown) => {
      if (cache.get(requestId) === entry) cache.delete(requestId)
      throw error
    })
    entry.body.catch(() => {})
    cache.set(requestId, entry)
    for (const oldest of cache.keys()) {
      if (cache.size <= MESSAGE_REPLAY_MAX) break
      cache.delete(oldest)
    }
    return entry
  }

  /** Дождаться сборки; ушёл последний ждущий до её конца — сборка отменяется. */
  async function join(entry: AssembledMessage, signal: AbortSignal): Promise<Buffer> {
    entry.waiters++
    let left = false
    const leave = (): void => {
      if (left) return
      left = true
      if (--entry.waiters === 0 && !entry.done) entry.abort.abort()
    }
    signal.addEventListener('abort', leave, { once: true })
    if (signal.aborted) leave()
    try {
      return await entry.body
    } finally {
      signal.removeEventListener('abort', leave)
      if (!left) {
        left = true
        entry.waiters--
      }
    }
  }
}

export { BodyTooLarge }
