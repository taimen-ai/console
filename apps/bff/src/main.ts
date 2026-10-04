#!/usr/bin/env node
/**
 * Точка входа BFF консоли: `node src/main.ts` (Node 24 исполняет TypeScript сам, сборки нет,
 * зависимостей времени выполнения нет).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AllowList, CONTROL_PLANE_MUTATIONS, CONTROL_PLANE_PENDING } from './allowlist.ts'
import { loadConfig } from './config.ts'
import { deriveKeys } from './crypto.ts'
import { federation, Oidc } from './identity.ts'
import { ConsoleBff, type Log } from './server.ts'
import { FileSessionStore } from './session-store.ts'
import { revokeRefresh, Sessions } from './sessions.ts'

const config = loadConfig()
const log: Log = entry => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
const snapshot = JSON.parse(readFileSync(join(config.openapiDir, 'control-plane.json'), 'utf8')) as object

const allow = AllowList.fromOpenApi(snapshot, { prefix: '/api/v1', mutations: CONTROL_PLANE_MUTATIONS, pending: CONTROL_PLANE_PENDING })
if (allow.missing.length > 0) log({ event: 'allowlist.missing', service: 'control-plane', operations: allow.missing })
if (allow.pendingKnown.length > 0) log({ event: 'allowlist.pending_known', service: 'control-plane', operations: allow.pendingKnown })

const oidc = new Oidc(config.oidc)
const exchange = federation(config.iam)
// Любое удаление сессии (выход, перевход, вытеснение, истечение) отзывает её refresh у IdP.
// Сессии переживают перезапуск (выкатку), если задан каталог: файл зашифрован ключом из секрета cookie.
const store = config.sessionStoreDir !== null ? new FileSessionStore(config.sessionStoreDir, deriveKeys(config.cookieKey).store) : undefined
const sessions = new Sessions({ ttlMs: config.sessionTtlMs, oidc, exchange, scopes: config.scopes, onDelete: revokeRefresh(oidc), ...(store !== undefined ? { store } : {}) })
if (store !== undefined) log({ event: 'sessions.restored', count: sessions.size })
const server = new ConsoleBff({ config, sessions, oidc, exchange, allow, log }).server()

setInterval(() => sessions.sweep(), 60_000).unref()
server.listen(config.port, config.host, () => {
  log({ event: 'listening', port: config.port, basePath: config.basePath || '/', routes: allow.routes.length, locales: config.locales })
})
/**
 * Остановка: новые соединения не принимаются, простаивающие закрываются сразу, идущие
 * запросы получают до 10 с на завершение; долгие потоки (SSE, туннели) обрываются по сроку —
 * клиенты переподключаются к соседней реплике или к новому процессу.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log({ event: 'stopping', signal })
    sessions.flush()
    server.close(() => process.exit(0))
    server.closeIdleConnections()
    setTimeout(() => { server.closeAllConnections(); process.exit(0) }, 10_000).unref()
  })
}
