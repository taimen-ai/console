#!/usr/bin/env node
/**
 * Стенд разработки консоли: заглушки IdP, IAM, ядра и launcher'а харнесса, настоящий BFF
 * поверх них и Vite с SPA. Вход идёт полным путём OIDC — IdP стенда пускает сразу, без
 * пароля, как владельца организации «Полярис».
 *
 *   pnpm dev            — Vite на http://localhost:5173/console/ (горячая перезагрузка)
 *   pnpm dev --static   — собранная SPA из apps/web/dist через BFF на http://localhost:8090/console/
 *                         (как в образе: CSP, `<base>` под префикс, кэширование)
 *
 * Порты: BFF 8090, IdP 8091, IAM 8092, ядро 8093, launcher 8094.
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AllowList, CONTROL_PLANE_MUTATIONS, CONTROL_PLANE_PENDING } from '../../bff/src/allowlist.ts'
import { loadConfig } from '../../bff/src/config.ts'
import { federation, Oidc } from '../../bff/src/identity.ts'
import { ConsoleBff } from '../../bff/src/server.ts'
import { revokeRefresh, Sessions } from '../../bff/src/sessions.ts'
import * as connections from './connections.ts'
import * as cp from './cp.ts'
import { ME, TENANT } from './data.ts'
import { iamService } from './iam.ts'
import * as launcher from './launcher.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const STATIC = process.argv.includes('--static')
const PORTS = { bff: 8090, idp: 8091, iam: 8092, cp: 8093, launcher: 8094, vite: 5173 }
const PUBLIC = STATIC ? `http://localhost:${PORTS.bff}` : `http://localhost:${PORTS.vite}`

function listen(port: number, handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')))
  })
  server.listen(port, '127.0.0.1')
  return server
}
const json = (res: ServerResponse, status: number, value: unknown): void => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)) }
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (claims: Record<string, unknown>): string => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.c3RhbmQ`

// ------------------------------------------------------------------ IdP: вход без пароля
const IDP = `http://127.0.0.1:${PORTS.idp}`
const codes = new Map<string, { nonce: string, challenge: string }>()
const kcUsers: { id: string, username: string, email: string }[] = []
listen(PORTS.idp, (req, res, body) => {
  const url = new URL(req.url ?? '/', IDP)
  if (url.pathname === '/.well-known/openid-configuration') {
    return json(res, 200, { issuer: IDP, authorization_endpoint: `${IDP}/authorize`, token_endpoint: `${IDP}/token`, end_session_endpoint: `${IDP}/logout`, revocation_endpoint: `${IDP}/revoke` })
  }
  if (url.pathname === '/authorize') {
    const code = randomBytes(12).toString('hex')
    codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', challenge: url.searchParams.get('code_challenge') ?? '' })
    const back = new URL(url.searchParams.get('redirect_uri')!)
    back.searchParams.set('code', code)
    back.searchParams.set('state', url.searchParams.get('state') ?? '')
    res.writeHead(302, { location: back.toString() }).end()
    return
  }
  if (url.pathname === '/token') {
    const form = new URLSearchParams(body)
    const idToken = (nonce?: string): string => jwt({ iss: IDP, sub: 'owner', sid: 'stand', aud: ['runtime-console'], exp: Math.floor(Date.now() / 1000) + 300, ...(nonce !== undefined ? { nonce } : {}) })
    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')
      if (code === undefined || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== code.challenge) return json(res, 400, { error: 'invalid_grant' })
      return json(res, 200, { id_token: idToken(code.nonce), refresh_token: `refresh-${randomBytes(8).toString('hex')}`, access_token: 'opaque' })
    }
    if (form.get('grant_type') === 'refresh_token') return json(res, 200, { id_token: idToken(), refresh_token: `refresh-${randomBytes(8).toString('hex')}` })
  }
  if (url.pathname === '/revoke') return json(res, 200, {})
  // Admin API Keycloak (realm platform): консоль заводит пользователя при «Добавить человека».
  if (url.pathname === '/realms/platform/protocol/openid-connect/token') {
    const form = new URLSearchParams(body)
    if (form.get('grant_type') !== 'client_credentials' || form.get('client_secret') !== 'stand-people-secret') return json(res, 401, { error: 'unauthorized_client' })
    return json(res, 200, { access_token: `kc-admin-${randomBytes(4).toString('hex')}`, expires_in: 300 })
  }
  if (url.pathname === '/admin/realms/platform/users') {
    if (!String(req.headers.authorization ?? '').startsWith('Bearer kc-admin-')) return json(res, 401, {})
    if (req.method === 'GET') return json(res, 200, kcUsers.filter(u => u.email === url.searchParams.get('email')))
    const input = JSON.parse(body) as { username: string, email: string }
    if (kcUsers.some(u => u.username === input.username)) return json(res, 409, { errorMessage: 'User exists with same username' })
    const id = randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
    kcUsers.push({ id, username: input.username, email: input.email })
    res.writeHead(201, { location: `${IDP}/admin/realms/platform/users/${id}` }).end()
    return
  }
  if (url.pathname === '/logout') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><p>Вы вышли (стенд разработки).</p><p><a href="${PUBLIC}/console/">Войти снова</a></p>`)
    return
  }
  json(res, 404, {})
})

// ------------------------------------------------------------------ IAM: обмен на токен audience и люди
listen(PORTS.iam, iamService({ port: PORTS.iam, idpIssuer: IDP, jwt, me: ME }))

// ------------------------------------------------------------------ ядро и launcher
// Фейковый провайдер OAuth и callback подключений — без Bearer, как публичный маршрут ядра.
connections.configure(PUBLIC)
const core = listen(PORTS.cp, (req, res, body) => { if (!connections.publicRoute(req, res)) cp.handle(req, res, body) })
core.on('upgrade', (req, socket) => cp.upgrade(req, socket))
listen(PORTS.launcher, launcher.handle)
cp.simulate(45_000)
launcher.proactive(20_000)

// ------------------------------------------------------------------ BFF
const secrets = mkdtempSync(join(tmpdir(), 'console-stand-'))
writeFileSync(join(secrets, 'cookie'), randomBytes(48).toString('hex'))
writeFileSync(join(secrets, 'oidc'), 'stand-client-secret')
writeFileSync(join(secrets, 'people'), 'stand-people-secret')
const config = loadConfig({
  CONSOLE_PUBLIC_URL: PUBLIC,
  CONSOLE_BASE_PATH: '/console',
  CONSOLE_HOST: '127.0.0.1',
  CONSOLE_PORT: String(PORTS.bff),
  CONSOLE_COOKIE_SECRET_FILE: join(secrets, 'cookie'),
  CONSOLE_OIDC_ISSUER: IDP,
  CONSOLE_OIDC_SECRET_FILE: join(secrets, 'oidc'),
  CONSOLE_IAM_URL: `http://127.0.0.1:${PORTS.iam}`,
  // Пользователь у провайдера заводится консолью: IdP стенда отвечает как Keycloak Admin API.
  CONSOLE_IDP_ADMIN: 'keycloak',
  CONSOLE_KEYCLOAK_URL: IDP,
  CONSOLE_KEYCLOAK_REALM: 'platform',
  CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE: join(secrets, 'people'),
  CONSOLE_IAM_TENANT: TENANT,
  CONSOLE_CONTROL_PLANE_URL: `http://127.0.0.1:${PORTS.cp}`,
  CONSOLE_LAUNCHER_URL: `http://127.0.0.1:${PORTS.launcher}/harness`,
  CONSOLE_OPENAPI_DIR: join(ROOT, 'openapi'),
  CONSOLE_PRODUCT_NAME: 'Console',
  ...(STATIC ? { CONSOLE_STATIC_DIR: join(ROOT, 'apps', 'web', 'dist') } : {}),
})
const allow = AllowList.fromOpenApi(JSON.parse(readFileSync(join(config.openapiDir, 'control-plane.json'), 'utf8')) as object, { prefix: '/api/v1', mutations: CONTROL_PLANE_MUTATIONS, pending: CONTROL_PLANE_PENDING })
const oidc = new Oidc(config.oidc)
const exchange = federation(config.iam)
const sessions = new Sessions({ ttlMs: config.sessionTtlMs, oidc, exchange, scopes: config.scopes, onDelete: revokeRefresh(oidc) })
const quiet = process.argv.includes('--quiet')
const bff = new ConsoleBff({
  config, sessions, oidc, exchange, allow,
  // Журнал стенда: всё, кроме чтений; изменения видны со временем — по ним разбираются сбои сценариев.
  log: entry => { if (!quiet && (entry.event !== 'access' || (entry.method !== 'GET' && entry.method !== 'HEAD'))) process.stdout.write(`bff ${new Date().toISOString()} ${JSON.stringify(entry)}\n`) },
}).server()
bff.listen(PORTS.bff, '127.0.0.1', () => process.stdout.write(`стенд: BFF ${PORTS.bff}, консоль ${PUBLIC}/console/\n`))

if (!STATIC) {
  const vite = spawn(join(ROOT, 'apps', 'web', 'node_modules', '.bin', 'vite'), ['--port', String(PORTS.vite), '--strictPort'], { cwd: join(ROOT, 'apps', 'web'), stdio: 'inherit' })
  vite.on('exit', code => process.exit(code ?? 0))
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { vite.kill(signal); process.exit(0) })
}
