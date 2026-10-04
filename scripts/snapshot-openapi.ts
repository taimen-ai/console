/**
 * Обновить снимок openapi ядра: только чтение `GET /openapi.json` стенда.
 *
 *   node scripts/snapshot-openapi.ts --base https://cp.example.com
 *
 * Снимок пишется с отступом, чтобы diff читался. Из него BFF строит allow-list при старте,
 * а `@console/api` — типы клиента (`pnpm --filter @console/api build`).
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const at = process.argv.indexOf('--base')
const base = (at > 0 ? process.argv[at + 1] : process.env.CONSOLE_SNAPSHOT_BASE ?? '')?.replace(/\/+$/, '') ?? ''
if (base === '') throw new Error('укажите --base <публичный адрес стенда> или CONSOLE_SNAPSHOT_BASE')
const response = await fetch(`${base}/openapi.json`, { headers: { accept: 'application/json' } })
if (!response.ok) throw new Error(`${base}/openapi.json → HTTP ${response.status}`)
const doc = await response.json() as { info?: { version?: string }, paths?: Record<string, unknown> }
if (doc.paths === undefined) throw new Error('в ответе нет paths — это не openapi')
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi', 'control-plane.json'), `${JSON.stringify(doc, null, 2)}\n`)
console.log(`control-plane: ${Object.keys(doc.paths).length} путей, версия ${doc.info?.version ?? '?'} ← ${base}`)
