/**
 * BFF консоли (CON-ADR-0001, п. 4) на Hono. Всё живёт под префиксом `basePath` (по
 * умолчанию `/console`, задаётся при запуске):
 * - `{base}/_auth/{login,callback,logout}` — вход и выход (`routes/auth.ts`);
 * - `{base}/api/*` — конфигурация, сессия, ядро, ассистент (`routes/api.ts`);
 * - `{base}/api/ws` — туннель журнала событий ядра (WebSocket, ниже);
 * - `{base}/healthz`, `{base}/readyz`; остальное под `{base}/` — SPA (`routes/spa.ts`).
 *
 * Сквозное — middleware: id запроса, журнал доступа (метод, шаблон маршрута, статус, время;
 * ни тел, ни query, ни текстов беседы, ни токенов), проверка origin у изменений (CSRF),
 * единый перевод ошибок в ответ.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import { deriveKeys } from './crypto.ts'
import { fail, json, safeNext, sameOrigin, sessionCookie, sessionOf, type AppDeps, type Env, type Keys } from './context.ts'
import { BodyTooLarge, refuseUpgrade, tunnel } from './proxy.ts'
import { apiRoutes, BadRequest } from './routes/api.ts'
import { authRoutes } from './routes/auth.ts'
import { spaRoutes } from './routes/spa.ts'
import { MAX_TUNNELS_PER_SESSION, NoPermission, ReauthRequired, Unavailable } from './sessions.ts'

export type { AppDeps, Log } from './context.ts'
export { SESSION_COOKIE } from './context.ts'
export { MESSAGE_REPLAY_MAX, MESSAGE_REPLAY_TTL_MS } from './routes/api.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export class ConsoleBff {
  readonly app: Hono<Env>
  private readonly deps: AppDeps
  private readonly keys: Keys
  private readonly now: () => number
  /** Маршруты без сессии — единственный список. Всё, чего здесь нет, требует входа. */
  readonly publicRoutes: readonly string[]

  constructor(deps: AppDeps) {
    this.deps = deps
    this.keys = deriveKeys(deps.config.cookieKey)
    this.now = deps.now ?? Date.now
    const b = deps.config.basePath
    this.publicRoutes = [
      `GET ${b}/healthz`, `GET ${b}/readyz`, `GET ${b}/_auth/login`, `GET ${b}/_auth/callback`, `POST ${b}/_auth/logout`, `GET ${b}/_auth/logout`,
      `GET ${b}/api/config`, `GET ${b}/assets/*`,
    ]
    this.app = this.build()
  }

  isPublic(method: string, rawPath: string): boolean {
    return this.publicRoutes.some((entry) => {
      const [m, path] = entry.split(' ') as [string, string]
      if (m !== method) return false
      return path.endsWith('*') ? rawPath.startsWith(path.slice(0, -1)) : rawPath === path
    })
  }

  safeNext(next: string | null): string {
    return safeNext(this.deps.config, next)
  }

  private build(): Hono<Env> {
    const { config, log } = this.deps
    const b = config.basePath
    const app = new Hono<Env>()

    app.use('*', async (c, next) => {
      const started = this.now()
      const requestId = randomUUID()
      c.set('requestId', requestId)
      c.set('route', '(unmatched)')
      await next()
      c.res.headers.set('x-request-id', requestId)
      const messageRequestId = c.get('messageRequestId')
      log({
        event: 'access', requestId, method: c.req.method, route: c.get('route'), status: c.res.status, ms: this.now() - started,
        ...(messageRequestId !== undefined ? { messageRequestId } : {}),
      })
    })

    if (b !== '') {
      // Корень сайта и префикс без слэша ведут в консоль: другого приложения на этом адресе нет.
      app.get('/', (c) => { c.set('route', '/'); return c.redirect(`${b}/`, 302) })
      app.get(b, (c) => { c.set('route', b); return c.redirect(`${b}/`, 301) })
    }

    // Изменения — только со своего origin (CSRF): Origin/Sec-Fetch-Site обязаны совпасть.
    app.use(`${b}/*`, async (c, next) => {
      if (!SAFE_METHODS.has(c.req.method) && !sameOrigin(config, c.req.raw.headers)) {
        c.set('route', new URL(c.req.url).pathname.startsWith(`${b}/api/`) ? `${b}/api/(mutation)` : `${b}/(mutation)`)
        return fail(403, 'forbidden_origin')
      }
      await next()
    })

    app.get(`${b}/healthz`, (c) => { c.set('route', `${b}/healthz`); return json(200, { status: 'ok' }) })
    // Готовность: IdP отвечает на discovery — без него вход невозможен.
    app.get(`${b}/readyz`, async (c) => {
      c.set('route', `${b}/readyz`)
      try {
        await this.deps.oidc.discover()
        return json(200, { status: 'ready' })
      } catch {
        return json(503, { status: 'not_ready', reason: 'idp_unavailable' })
      }
    })

    authRoutes(app, this.deps, this.keys)
    apiRoutes(app, this.deps, this.keys)
    spaRoutes(app, this.deps, this.keys)

    app.notFound(() => fail(404, 'not_found'))
    app.onError((error, c) => {
      const url = new URL(c.req.url)
      const api = url.pathname.startsWith(`${b}/api/`)
      if (error instanceof ReauthRequired) {
        const clear = { 'set-cookie': sessionCookie(config, '', 0) }
        if (api) return fail(401, 'reauth_required', {}, clear)
        return new Response(null, { status: 302, headers: { location: `${b}/_auth/login?next=${encodeURIComponent(this.safeNext(url.pathname + url.search))}`, ...clear } })
      }
      // Отказ IAM выдать audience или scope — «нет прав», а не падение: консоль объясняет его.
      if (error instanceof NoPermission) return fail(403, 'no_permission', { audience: error.audience, reason: error.code })
      if (error instanceof BodyTooLarge) return fail(413, 'body_too_large')
      if (error instanceof BadRequest) return fail(400, error.code)
      if (error instanceof Unavailable) return fail(503, 'upstream_unavailable')
      // Клиент ушёл — отвечать некому.
      if (c.req.raw.signal.aborted) return new Response(null, { status: 499 })
      log({ event: 'error', requestId: c.get('requestId'), error: error instanceof Error ? error.name : 'unknown' })
      return fail(500, 'internal')
    })
    return app
  }

  /** HTTP-сервер: запросы — Hono, рукопожатия WebSocket — туннель к журналу ядра. */
  server(): Server {
    const server = createServer(getRequestListener(this.app.fetch))
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.upgrade(req, socket, head).catch(() => {
        if (!socket.destroyed) refuseUpgrade(socket, 500)
      })
    })
    return server
  }

  /**
   * Туннель журнала событий ядра (`{base}/api/ws` → `/api/v1/events/ws`). Рукопожатие WS не
   * защищено CORS: чужой origin отклоняется явно (CSWSH). Туннель принадлежит сессии: выход,
   * перевход, истечение и sweep его закрывают; туннелей на сессию — не больше
   * `MAX_TUNNELS_PER_SESSION`.
   */
  async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const { config } = this.deps
    const started = this.now()
    const requestId = randomUUID()
    let route = `${config.basePath}/api/ws`
    const done = (status: number): void => this.deps.log({ event: 'access', requestId, method: 'GET', route, status, ms: this.now() - started })
    const [rawPath = '/', search = ''] = (req.url ?? '/').split(/\?(.*)/s)
    socket.on('error', () => socket.destroy())
    if (rawPath !== `${config.basePath}/api/ws`) {
      route = '(unmatched)'
      refuseUpgrade(socket, 404)
      return done(404)
    }
    if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      refuseUpgrade(socket, 400)
      return done(400)
    }
    if (req.headers.origin !== config.publicOrigin) {
      refuseUpgrade(socket, 403)
      return done(403)
    }
    const session = sessionOf(this.deps, this.keys, req.headers.cookie)
    if (session === null) {
      refuseUpgrade(socket, 401)
      return done(401)
    }
    // Место туннеля занимается до рукопожатия: одновременные рукопожатия не обходят лимит.
    if (session.tunnels.size >= MAX_TUNNELS_PER_SESSION) {
      refuseUpgrade(socket, 429)
      return done(429)
    }
    const slot = { destroy: (): void => {} }
    session.tunnels.add(slot)
    let status = 500
    try {
      const token = await this.deps.sessions.token(session, 'control-plane')
      const url = new URL(`${config.upstreams.controlPlane}/api/v1/events/ws${search !== '' ? `?${search}` : ''}`)
      status = await tunnel(socket, head, req, url, { authorization: `Bearer ${token}`, 'x-request-id': requestId }, (close) => {
        if (this.deps.sessions.get(session.sid) !== session) return close()
        slot.destroy = close
        socket.once('close', () => session.tunnels.delete(slot))
      }, this.deps.wsHandshakeTimeoutMs)
    } catch (error) {
      status = error instanceof NoPermission ? 403 : error instanceof ReauthRequired ? 401 : 503
      refuseUpgrade(socket, status)
    } finally {
      if (status !== 101) session.tunnels.delete(slot)
    }
    done(status)
  }
}
