/**
 * Стенд для тестов BFF: IdP, IAM, ядро, fleet и launcher — локальные http-серверы на
 * случайных портах, часы BFF — управляемые.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AllowList, CONTROL_PLANE_MUTATIONS, CONTROL_PLANE_PENDING } from '../src/allowlist.ts'
import type { Audience, Config } from '../src/config.ts'
import { federation, Oidc } from '../src/identity.ts'
import { ConsoleBff } from '../src/server.ts'
import { revokeRefresh, Sessions } from '../src/sessions.ts'

export const PRINCIPAL = 'a3000000-0000-4000-8000-0000000000a3'
export const TENANT = 'a1000000-0000-4000-8000-0000000000a1'
export const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/

export const fakeJwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`

export interface Recorded { method: string, url: string, headers: IncomingHttpHeaders, body: string }

async function listen(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ server: Server, url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

const send = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

/**
 * `wsHandshakeTimeoutMs` — сколько BFF ждёт ответа ядра на рукопожатие WS. По умолчанию 2 с:
 * под нагрузкой (параллельные пакеты и сборка) несколько одновременных рукопожатий не
 * укладывались в прежние 200 мс, и тест лимита туннелей изредка падал. Короткий таймаут —
 * только тесту, который проверяет сам таймаут.
 */
export interface WorldOptions { publicOrigin?: string, wrongNonce?: boolean, denyHarness?: boolean, idTokenTtl?: number, wrongIssuer?: boolean, wsHandshakeTimeoutMs?: number }

export async function world(options: WorldOptions = {}) {
  let clock = Date.parse('2026-09-29T10:00:00Z')
  const now = (): number => clock
  const logs: Record<string, unknown>[] = []
  const issuedTokens: string[] = []
  const codes = new Map<string, { challenge: string, nonce: string, sid?: string }>()
  /**
   * Заглушка IdP моделирует сессии IdP так, как их ведёт Keycloak 26: у каждого входа есть
   * `sid` (claim id token), refresh token привязан к нему; отзыв любого refresh token гасит
   * всю сессию IdP — все её refresh tokens (`killed`), а следующий вход с этим `sid` просит
   * пароль заново и получает новый `sid` (`passwordPrompts`).
   */
  const idp = {
    tokenCalls: [] as URLSearchParams[], refreshFails: false, basic: [] as string[], revoked: [] as string[], refreshIssued: [] as string[], revokeHangs: false,
    sidOf: new Map<string, string>(), killed: new Set<string>(), passwordPrompts: 0,
  }
  const replies: { path: string, status: number, headers: IncomingHttpHeaders, body: string }[] = []
  const iam = { calls: [] as { audience: Audience, scopes: string[] }[] }
  const cp = { requests: [] as Recorded[], wsAuth: [] as (string | undefined)[], reject401: 0, fixtures: {} as Record<string, unknown>, hang: new Set<string>(), aborted: [] as string[] }
  /**
   * Launcher ведёт себя как харнесс по `surface/1`: сообщение с уже виденным requestId и тем
   * же телом получает исходный ответ, с другим телом — `409 request_id_reused`.
   */
  const launcher = { requests: [] as Recorded[], release: (): void => {}, messages: new Map<string, { body: string, messageId: string }>() }
  let counter = 0

  /** Refresh token IdP: непрозрачный и уникальный, чтобы поиск утечек не давал ложных совпадений. */
  const newRefresh = (sid: string): string => {
    const refresh = `refresh-${++counter}-${randomBytes(12).toString('hex')}`
    issuedTokens.push(refresh)
    idp.refreshIssued.push(refresh)
    idp.sidOf.set(refresh, sid)
    return refresh
  }

  const idToken = (nonce: string | null, sid: string): string => {
    const token = fakeJwt({ iss: 'idp', sub: 'user-1', sid, aud: ['runtime-console', 'iam-service'], exp: Math.floor(clock / 1000) + (options.idTokenTtl ?? 300), ...(nonce !== null ? { nonce } : {}) })
    issuedTokens.push(token)
    return token
  }

  const idpServer = await listen((req, res, body) => {
    const url = new URL(req.url ?? '/', 'http://idp')
    if (url.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, {
        issuer: options.wrongIssuer === true ? 'https://other.example' : `${idpUrl}/`,
        authorization_endpoint: `${idpUrl}/authorize`, token_endpoint: `${idpUrl}/token`,
        end_session_endpoint: `${idpUrl}/logout`, revocation_endpoint: `${idpUrl}/revoke`,
      })
    }
    if (url.pathname === '/revoke') {
      const token = new URLSearchParams(body).get('token') ?? ''
      idp.revoked.push(token)
      // Keycloak: отзыв refresh снимает клиент с user session по `sid`, а единственный
      // клиент — удаляет user session целиком, со всеми её refresh tokens.
      const sid = idp.sidOf.get(token)
      if (sid !== undefined) idp.killed.add(sid)
      if (idp.revokeHangs) return // IdP завис: ответа нет, соединение закроет close()
      return send(res, 200, {})
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(body)
      idp.tokenCalls.push(form)
      idp.basic.push(req.headers.authorization ?? '')
      if (form.get('grant_type') === 'authorization_code') {
        const code = codes.get(form.get('code') ?? '')
        codes.delete(form.get('code') ?? '')
        const verifier = form.get('code_verifier') ?? ''
        if (code === undefined || createHash('sha256').update(verifier).digest('base64url') !== code.challenge) return send(res, 400, { error: 'invalid_grant' })
        // Живой SSO отдаёт тот же `sid`; погашенный — форма пароля и новая сессия IdP.
        let sid = code.sid ?? `sso-${++counter}`
        if (idp.killed.has(sid)) {
          idp.passwordPrompts++
          sid = `sso-${++counter}`
        }
        const refresh = newRefresh(sid)
        return send(res, 200, { id_token: idToken(options.wrongNonce === true ? 'other' : code.nonce, sid), refresh_token: refresh, access_token: 'opaque-access' })
      }
      if (form.get('grant_type') === 'refresh_token') {
        const sid = idp.sidOf.get(form.get('refresh_token') ?? '')
        if (idp.refreshFails || sid === undefined || idp.killed.has(sid)) return send(res, 400, { error: 'invalid_grant' })
        const refresh = newRefresh(sid)
        return send(res, 200, { id_token: idToken(null, sid), refresh_token: refresh })
      }
    }
    send(res, 404, {})
  })
  const idpUrl = idpServer.url

  const iamServer = await listen((req, res, body) => {
    if (req.url === `/api/v1/tenants/${TENANT}/federation:exchange`) {
      const parsed = JSON.parse(body) as { audience: Audience, scopes: string[], token: string, identityProvider: string }
      iam.calls.push({ audience: parsed.audience, scopes: parsed.scopes })
      if (!issuedTokens.includes(parsed.token)) return send(res, 401, { detail: 'invalid_token' })
      if (parsed.audience === 'human-harness' && options.denyHarness === true) return send(res, 403, { detail: 'scope_not_allowed' })
      const accessToken = fakeJwt({ sub: PRINCIPAL, aud: parsed.audience, n: ++counter })
      issuedTokens.push(accessToken)
      return send(res, 200, { accessToken, expiresIn: 300, audience: parsed.audience, scope: parsed.scopes, principalId: PRINCIPAL })
    }
    cp.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
    send(res, 200, { items: [] })
  })

  const cpServer = await listen((req, res, body) => {
    cp.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
    if (cp.reject401 > 0) {
      cp.reject401--
      return send(res, 401, { error: { code: 'invalid_token' } })
    }
    // Ответ ядра по полному пути с query или по пути без него (/api/v1 срезан).
    const path = (req.url ?? '').replace(/^\/api\/v1/, '')
    // Зависший источник: ответа нет; обрыв BFF'ом записывается.
    if (cp.hang.has(path.split('?')[0]!)) {
      res.once('close', () => { if (!res.writableEnded) cp.aborted.push(path) })
      return
    }
    const fixture = cp.fixtures[path] ?? cp.fixtures[path.split('?')[0]!]
    if (fixture !== undefined) return send(res, 200, fixture)
    send(res, 200, { ok: true })
  })
  cpServer.server.on('upgrade', (req: IncomingMessage, socket, head: Buffer) => {
    cp.wsAuth.push(req.headers.authorization)
    if (req.url?.includes('hang') === true) { socket.on('end', () => socket.destroy()); return }
    const accept = createHash('sha1').update(`${String(req.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.write('from-core')
    if (head.length > 0) socket.write(head)
    socket.on('data', (chunk: Buffer) => socket.write(Buffer.concat([Buffer.from('echo:'), chunk])))
    socket.on('end', () => socket.destroy())
  })

  const launcherServer = await listen((req, res, body) => {
    launcher.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
    const path = (req.url ?? '').split('?')[0]!
    if (path.endsWith('/surface/stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      res.write('event: ready\nid: c1\ndata: {"resumed":false}\n\n')
      launcher.release = () => res.end('event: message\nid: c2\ndata: {"text":"second"}\n\n')
      return
    }
    if (path.endsWith('/surface/message')) {
      const requestId = (JSON.parse(body) as { requestId: string }).requestId
      const seen = launcher.messages.get(requestId)
      if (seen !== undefined && seen.body !== body) return send(res, 409, { error: { code: 'request_id_reused' } })
      const messageId = seen?.messageId ?? `m_${launcher.messages.size + 1}`
      launcher.messages.set(requestId, { body, messageId })
      return send(res, 202, { requestId, messageId, queued: false })
    }
    send(res, 200, { items: [], nextBefore: null })
  })

  const publicOrigin = options.publicOrigin ?? 'http://console.test'
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    publicOrigin,
    basePath: '/console',
    secureCookies: publicOrigin.startsWith('https://'),
    cookieKey: Buffer.from('test-cookie-key-0123456789abcdef'),
    sessionTtlMs: 12 * 3_600_000,
    sessionStoreDir: null,
    oidc: { issuer: idpUrl, clientId: 'runtime-console', clientSecret: 'client-secret-value', scopes: 'openid offline_access', redirectUri: `${publicOrigin}/console/_auth/callback`, postLogoutRedirectUri: `${publicOrigin}/console/` },
    iam: { url: iamServer.url, tenantId: TENANT, identityProvider: 'dex' },
    idpAdmin: null,
    upstreams: { controlPlane: cpServer.url, launcher: `${launcherServer.url}/harness` },
    scopes: { 'control-plane': ['control-plane:read', 'control-plane:write'], 'human-harness': ['harness:use'], iam: ['iam:people'] },
    openapiDir: join(import.meta.dirname, '..', '..', '..', 'openapi'),
    staticDir: null,
    bodyLimitBytes: 1024 * 1024,
    uploadLimitBytes: 2 * 1024 * 1024,
    brand: { productName: 'Console', orgName: null },
    locales: ['en', 'ru'],
    defaultLocale: 'en',
  }
  const snapshot = (name: string): object => JSON.parse(readFileSync(join(config.openapiDir, `${name}.json`), 'utf8')) as object
  const oidc = new Oidc(config.oidc)
  const exchange = federation(config.iam, now)
  const sessions = new Sessions({ ttlMs: config.sessionTtlMs, oidc, exchange, scopes: config.scopes, now, onDelete: revokeRefresh(oidc) })
  const app = new ConsoleBff({
    config, sessions, oidc, exchange, now, log: entry => logs.push(entry), wsHandshakeTimeoutMs: options.wsHandshakeTimeoutMs ?? 2000,
    allow: AllowList.fromOpenApi(snapshot('control-plane'), { prefix: '/api/v1', mutations: CONTROL_PLANE_MUTATIONS, pending: CONTROL_PLANE_PENDING }),
  })
  const bff = app.server()
  await new Promise<void>(resolve => bff.listen(0, '127.0.0.1', resolve))
  const port = (bff.address() as AddressInfo).port

  interface Reply { status: number, headers: IncomingHttpHeaders, body: string }
  function call(method: string, path: string, init: { headers?: Record<string, string>, body?: string } = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers: init.headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => {
          const reply = { status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }
          replies.push({ path, ...reply })
          resolve(reply)
        })
      })
      req.on('error', reject)
      req.end(init.body)
    })
  }

  /**
   * Полный вход: login → «браузер у IdP» → callback. Возвращает cookie сессии. `sso` —
   * сессия IdP браузера: тот же `sso` моделирует перевход поверх живого SSO (тот же `sid`),
   * без него каждый вход — отдельный браузер со своей сессией IdP.
   */
  async function login(next = '/console/work/TASK-1', previous?: string, sso?: string): Promise<{ cookie: string, setCookie: string, challenge: string, reply: Reply }> {
    const start = await call('GET', `/console/_auth/login?next=${encodeURIComponent(next)}`)
    const authorize = new URL(String(start.headers.location))
    const state = authorize.searchParams.get('state')!
    const challenge = authorize.searchParams.get('code_challenge')!
    const code = `code-${++counter}`
    codes.set(code, { challenge, nonce: authorize.searchParams.get('nonce')!, ...(sso !== undefined ? { sid: sso } : {}) })
    const loginCookie = String(start.headers['set-cookie']?.[0]).split(';')[0]!
    const reply = await call('GET', `/console/_auth/callback?code=${code}&state=${state}`, { headers: { cookie: previous !== undefined ? `${loginCookie}; ${previous}` : loginCookie } })
    const setCookie = (reply.headers['set-cookie'] ?? []).find(c => c.startsWith('console_session=')) ?? ''
    return { cookie: setCookie.split(';')[0]!, setCookie, challenge, reply }
  }

  return {
    config, sessions, app, bff, port, call, login, logs, issuedTokens, idp, iam, cp, launcher, codes, replies,
    advance: (ms: number): void => { clock += ms },
    origin: { origin: publicOrigin },
    /**
     * Глобальная проверка FR-007 (ревью R005), её зовёт `close()` каждого теста: ни один ответ
     * BFF — тело и заголовки, включая Location, — не несёт JWT, refresh token IdP или иной
     * выданный токен; журнал BFF — тоже, и ещё без секрета клиента.
     */
    assertNoLeaks(): void {
      const replyText = JSON.stringify(replies)
      const logText = JSON.stringify(logs)
      for (const [where, text] of [['ответ', replyText], ['журнал', logText]] as const) {
        if (JWT.test(text)) throw new Error(`утечка: JWT в ${where}`)
        for (const token of issuedTokens) if (text.includes(token)) throw new Error(`утечка: выданный токен в ${where}`)
        if (text.includes(config.oidc.clientSecret)) throw new Error(`утечка: секрет клиента в ${where}`)
      }
      for (const refresh of idp.refreshIssued) if (replyText.includes(refresh)) throw new Error('утечка: refresh token в ответе')
    },
    async close(): Promise<void> {
      try {
        this.assertNoLeaks()
      } finally {
        bff.closeAllConnections()
        for (const s of [bff, idpServer.server, iamServer.server, cpServer.server, launcherServer.server]) {
          s.closeAllConnections()
          await new Promise(resolve => s.close(resolve))
        }
      }
    },
  }
}
