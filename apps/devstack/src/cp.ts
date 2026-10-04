/**
 * Заглушка ядра для стенда разработки: те маршруты `/api/v1`, которые читает консоль, с
 * семантикой ядра — постраничные списки `{items, nextCursor}` без счётчиков, журнал с
 * чтением назад (`tail`, `before` → `prevCursor`), фильтр `types` по префиксу, решения
 * подтверждений с событиями и WebSocket `/events/ws`, который шлёт новые события.
 * Всё, чего здесь нет, — 404, как у ядра на неизвестном пути.
 */
import { createHash, randomUUID } from 'node:crypto'
import * as conn from './connections.ts'
import * as people from './people.ts'
import * as roles from './roles.ts'
import * as imports from './imports.ts'
import * as documents from './documents.ts'
import * as kb from './knowledge.ts'
import * as settings from './settings.ts'
import * as views from './views.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  WORKSPACE, agents, effectiveTaskTypes, participants, subtree, approvals, artifacts, attention, byRef, comments, relations, taskTypes, verifications, claims, emit, events, harnessContext, ME, principals, runs, tasks, workspaceTree,
  type JournalEvent, type Task,
} from './data.ts'

const send = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}
const notFound = (res: ServerResponse): void => send(res, 404, { error: { code: 'not_found', message: 'Not found' } })

/** Работа, заведённая с ключом идемпотентности: ключ → id. */
const createdBy = new Map<string, string>()

/** Страница по смещению: курсор — непрозрачная строка, как у ядра. */
/** Ответ с ETag версии (настройки пакета: `"package-settings-<version>"`). */
function sendTagged(res: ServerResponse, r: { status: number, body: unknown, etag?: string }): void {
  res.writeHead(r.status, { 'content-type': 'application/json', ...(r.etag !== undefined ? { etag: r.etag } : {}) }).end(JSON.stringify(r.body))
}

function page<T>(items: T[], query: URLSearchParams): { items: T[], nextCursor: string | null } {
  const limit = Math.min(Number(query.get('limit') ?? 50) || 50, 200)
  const offset = query.get('cursor') !== null ? Number(Buffer.from(query.get('cursor')!, 'base64url').toString()) || 0 : 0
  const slice = items.slice(offset, offset + limit)
  return { items: slice, nextCursor: offset + limit < items.length ? Buffer.from(String(offset + limit)).toString('base64url') : null }
}

const seqOf = (cursor: string): number => Number(Buffer.from(cursor, 'base64url').toString().replace(/^e:/, '')) || 0

function listEvents(query: URLSearchParams): Record<string, unknown> {
  const types = query.getAll('types').flatMap(t => t.split(',')).filter(Boolean)
  const matches = (e: JournalEvent): boolean => (types.length === 0 || types.some(t => e.type === t || e.type.startsWith(t.endsWith('.') ? t : `${t}.`)))
    && (query.get('entityId') === null || e.entityId === query.get('entityId'))
    && (query.get('entityType') === null || e.entityType === query.get('entityType'))
  const all = events.filter(matches)
  const limit = Math.min(Number(query.get('limit') ?? 50) || 50, 200)
  let items: JournalEvent[]
  let prev: string | null
  let hasMore: boolean
  let next: string
  if (query.get('before') !== null || query.get('tail') !== null) {
    const before = query.get('before') !== null ? seqOf(query.get('before')!) : Infinity
    const older = all.filter(e => e.sequence < before)
    const n = query.get('tail') !== null ? Math.min(Number(query.get('tail')), limit) : limit
    items = older.slice(-n)
    prev = older.length > items.length ? items[0]!.cursor : null
    hasMore = prev !== null
    next = items.at(-1)?.cursor ?? (events.at(-1)?.cursor ?? '')
  } else {
    const after = query.get('cursor') !== null ? seqOf(query.get('cursor')!) : 0
    const newer = all.filter(e => e.sequence > after)
    items = newer.slice(0, limit)
    hasMore = newer.length > limit
    next = items.at(-1)?.cursor ?? query.get('cursor') ?? (events.at(-1)?.cursor ?? '')
    prev = items[0]?.cursor ?? null
  }
  if (query.get('order') === 'desc') items = [...items].reverse()
  return { items, nextCursor: next, prevCursor: prev, hasMore }
}

function listTasks(query: URLSearchParams): Task[] {
  let out = [...tasks]
  const eq = (name: string, field: keyof Task): void => {
    const value = query.get(name)
    if (value !== null) out = out.filter(t => t[field] === value)
  }
  const ws = query.get('workspaceId')
  if (ws !== null) { const within = query.get('includeDescendants') === 'true' ? subtree(ws) : new Set([ws]); out = out.filter(t => within.has(t.workspaceId)) }
  eq('systemStatusCategory', 'systemStatusCategory')
  eq('status', 'status')
  eq('typeKey', 'typeKey')
  eq('assigneeId', 'assigneeId')
  eq('ownerId', 'ownerId')
  const q = query.get('q')?.toLowerCase()
  // Как ядро: каждое слово — подстрока названия, описания или номера, без учёта регистра.
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean)
    out = out.filter(t => { const hay = `${t.title}\n${t.description ?? ''}\n${t.publicId}`.toLowerCase(); return terms.every(term => hay.includes(term)) })
  }
  const dueFrom = query.get('dueFrom')
  const dueTo = query.get('dueTo')
  if (dueFrom !== null) out = out.filter(t => t.dueDate !== null && t.dueDate >= new Date(dueFrom).toISOString())
  if (dueTo !== null) out = out.filter(t => t.dueDate !== null && t.dueDate < new Date(dueTo).toISOString())
  const sort = query.get('sort') ?? '-createdAt'
  const key = sort.replace(/^-/, '') as 'createdAt' | 'dueDate' | 'startDate'
  out.sort((a, b) => String(a[key] ?? '9999').localeCompare(String(b[key] ?? '9999')) * (sort.startsWith('-') ? -1 : 1))
  return out
}

/** Подписчики WebSocket журнала: им уходит каждое новое событие. */
const sockets = new Set<Duplex>()

function frame(text: string): Buffer {
  const data = Buffer.from(text, 'utf8')
  const head = data.length < 126 ? Buffer.from([0x81, data.length])
    : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255])
      : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(data.length), 2); return b })()
  return Buffer.concat([head, data])
}

export function publish(event: JournalEvent): void {
  for (const socket of sockets) socket.write(frame(JSON.stringify(event)))
}

export function upgrade(req: IncomingMessage, socket: Duplex): void {
  if (!(req.url ?? '').startsWith('/api/v1/events/ws') || !String(req.headers.authorization ?? '').startsWith('Bearer ')) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return
  }
  const accept = createHash('sha1').update(`${String(req.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  // Догнать с курсора `after`, как ядро.
  const after = new URL(req.url ?? '/', 'http://cp').searchParams.get('after')
  if (after !== null) for (const e of events) if (e.sequence > seqOf(after)) socket.write(frame(JSON.stringify(e)))
  sockets.add(socket)
  socket.on('data', (chunk: Buffer) => {
    // Закрытие от клиента (opcode 8) — ответить закрытием и отпустить.
    if ((chunk[0]! & 0x0f) === 8) socket.end(Buffer.from([0x88, 0]))
  })
  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => sockets.delete(socket))
}

function decide(res: ServerResponse, id: string, verb: 'approve' | 'reject' | 'cancel', body: string): void {
  const a = approvals.find(x => x.id === id)
  if (a === undefined) return notFound(res)
  if (a.status !== 'pending') return send(res, 409, { error: { code: 'approval_not_pending', message: `Approval is ${a.status}` } })
  const comment = (() => { try { return (JSON.parse(body || '{}') as { comment?: string }).comment ?? null } catch { return null } })()
  a.status = verb === 'approve' ? 'approved' : verb === 'reject' ? 'rejected' : 'cancelled'
  a.decisionByPrincipalId = ME
  a.decisionAt = new Date().toISOString()
  a.comment = comment
  a.version++
  a.updatedAt = a.decisionAt
  publish(emit(`approval.${a.status}`, { type: 'approval', id: a.id }, ME, { taskId: a.taskId, decisionBy: ME, comment, channel: null }))
  const t = tasks.find(x => x.id === a.taskId)
  if (t !== undefined) documents.onDecided(t, verb)
  if (t !== undefined && verb === 'approve') {
    t.status = a.gate ? 'done' : 'paying'
    t.systemStatusCategory = a.gate ? 'terminal_success' : 'active'
    t.version++
    t.updatedAt = a.decisionAt
    if (a.gate) {
      t.completedAt = a.decisionAt
      publish(emit('task.verified', { type: 'task', id: t.id }, ME, { publicId: t.publicId, taskId: t.id, attempt: 1, checks: 1, results: [{ kind: 'human', passed: true }] }))
    } else publish(emit('task.updated', { type: 'task', id: t.id }, ME, { publicId: t.publicId, fromStatus: 'approval', status: t.status, systemStatusCategory: t.systemStatusCategory, version: t.version }))
  }
  send(res, 200, a)
}

/**
 * Исполнители типа в пространстве (`GET /task-types/{id}/executors`, TASK-001307 с отбором
 * TASK-001345): люди — участники пространства; агенты — берущие работу (`spec.work`, не
 * наблюдатели), исполнитель скиллов — только для типа со скиллом, тип в `spec.work.taskTypes`
 * (или список не задан), пространство агента покрывает выбранное.
 */
function executorsOf(typeId: string, workspaceId: string | null): { status: number, body: unknown } {
  const ty = taskTypes.find(x => x.id === typeId)
  if (ty === undefined) return { status: 404, body: { error: { code: 'not_found', message: 'Task type not found' } } }
  if (workspaceId === null) return { status: 400, body: { error: { code: 'invalid_request', message: 'workspaceId is required' } } }
  const humans = participants(workspaceId).filter(p => p.kind === 'human' && p.status === 'active')
    .map(p => ({ principalId: p.principalId, kind: 'human', displayName: p.displayName, roles: (p.roles as { displayName: string }[]).map(r => r.displayName), reason: 'any' }))
  const skill = typeof (ty as { execution?: { skill?: unknown } }).execution?.skill === 'string'
  const bots = agents().flatMap((a) => {
    const spec = (a.revision as { spec?: { executor?: { kind?: string }, work?: { taskTypes?: string[] } } }).spec
    const kind = spec?.executor?.kind
    if (a.state === 'stopped' || a.principalId === null || spec?.work === undefined || kind === undefined || kind === 'observer' || kind === 'git-connector') return []
    if ((kind === 'skills') !== skill) return []
    const list = spec.work.taskTypes
    if (Array.isArray(list) && !list.includes(ty.key)) return []
    if (typeof a.workspaceId === 'string' && !subtree(a.workspaceId).has(workspaceId)) return []
    return [{ principalId: a.principalId, kind: 'agent', displayName: a.displayName, roles: [], reason: Array.isArray(list) ? 'agent_task_types' : 'agent_any' }]
  })
  return { status: 200, body: { items: [...humans, ...bots] } }
}

export function handle(req: IncomingMessage, res: ServerResponse, body: string): void {
  if (!String(req.headers.authorization ?? '').startsWith('Bearer ')) return send(res, 401, { error: { code: 'unauthenticated' } })
  const url = new URL(req.url ?? '/', 'http://cp')
  const path = url.pathname.replace(/^\/api\/v1/, '')
  const q = url.searchParams
  const method = req.method ?? 'GET'
  let m: RegExpExecArray | null
  if (method === 'GET') {
    // Права — связки владельца стенда (как у ядра: из binding вошедшего).
    if (path === '/harness/context') return send(res, 200, { ...harnessContext(), permissions: people.permissionsOf(ME) })
    if (path === '/workspaces/tree') return send(res, 200, workspaceTree())
    if (path === '/me/attention') {
      const body = attention() as { items: { workspaceId: string }[] }
      const ws = q.get('workspaceId')
      if (ws !== null) { const within = q.get('includeDescendants') === 'true' ? subtree(ws) : new Set([ws]); body.items = body.items.filter(i => within.has(i.workspaceId)) }
      return send(res, 200, body)
    }
    if (path === '/agents') return send(res, 200, page(agents(), q))
    if (path === '/roles') { const r = roles.list(); return send(res, r.status, r.body) }
    if ((m = /^\/roles\/([^/]+)\/principals$/.exec(path)) !== null) { const r = roles.holders(m[1]!, principals); return send(res, r.status, r.body) }
    if ((m = /^\/roles\/([^/]+)$/.exec(path)) !== null) { const r = roles.get(m[1]!); return send(res, r.status, r.body) }
    if ((m = /^\/principals\/([^/]+)\/roles$/.exec(path)) !== null) { const r = roles.ofPrincipal(m[1]!); return send(res, r.status, r.body) }
    if ((m = /^\/tasks\/([^/]+)\/requirements$/.exec(path)) !== null) { const t = byRef(m[1]!); if (t === undefined) return notFound(res); const r = roles.requirementsOf(t.publicId); return send(res, r.status, r.body) }
    if (path === '/connection-types') { const r = conn.listTypes(q); return send(res, r.status, r.body) }
    if ((m = /^\/connection-types\/([^/]+)\/oauth-app$/.exec(path)) !== null) { const r = conn.getOAuthApp(decodeURIComponent(m[1]!)); return send(res, r.status, r.body) }
    if ((m = /^\/connection-types\/([^/]+)$/.exec(path)) !== null) { const r = conn.getType(decodeURIComponent(m[1]!)); return send(res, r.status, r.body) }
    if (path === '/connections') { const r = conn.list(q); return send(res, r.status, r.body) }
    if ((m = /^\/connections\/([^/:]+)$/.exec(path)) !== null) { const r = conn.get(m[1]!); return sendTagged(res, r) }
    if ((m = /^\/agents\/([^/]+)\/secrets$/.exec(path)) !== null) { const key = m[1]!; const r = conn.listSecrets(key, agents().some(a => a.key === key)); return send(res, r.status, r.body) }
    if (path === '/package-settings') { const r = settings.list(q.get('locale') ?? 'en'); return send(res, r.status, r.body) }
    if ((m = /^\/packages\/([^/]+)\/settings$/.exec(path)) !== null) { const r = settings.get(m[1]!, q.get('locale') ?? 'en'); return sendTagged(res, r) }
    if ((m = /^\/packages\/([^/]+)\/settings\/versions$/.exec(path)) !== null) { const r = settings.versions(m[1]!); return send(res, r.status, r.body) }
    if (path === '/rules') return send(res, 200, page(settings.rules.filter(r => q.get('status') === null || r.status === q.get('status')), q))
    if ((m = /^\/workspaces\/([^/]+)\/participants$/.exec(path)) !== null) return send(res, 200, page(participants(m[1]!), q))
    if ((m = /^\/workspaces\/([^/]+)$/.exec(path)) !== null && m[1] !== 'tree') return send(res, 200, { id: m[1], effectiveTaskTypes: effectiveTaskTypes(m[1]!) })
    if (path === '/events') return send(res, 200, listEvents(q))
    if (path === '/tasks') return send(res, 200, page(listTasks(q), q))
    if ((m = /^\/tasks\/([^/]+)\/transitions$/.exec(path)) !== null) {
      const t = byRef(m[1]!)
      if (t === undefined) return notFound(res)
      const targets = t.systemStatusCategory.startsWith('terminal') ? [] : [
        { status: 'todo', displayName: 'К исполнению', systemStatusCategory: 'active', route: 'update' },
        { status: 'in_progress', displayName: 'В работе', systemStatusCategory: 'active', route: 'update' },
        { status: 'blocked', displayName: 'Заблокирована', systemStatusCategory: 'blocked', route: 'update' },
        { status: 'backlog', displayName: 'В очереди', systemStatusCategory: 'backlog', route: 'update' },
        { status: 'cancelled', displayName: 'Снята', systemStatusCategory: 'terminal_cancelled', route: 'update' },
        { status: 'done', displayName: 'Сделана', systemStatusCategory: 'terminal_success', route: 'complete' },
      ].filter(x => x.status !== t.status)
      return send(res, 200, { taskId: t.id, publicId: t.publicId, typeId: t.typeId, typeKey: t.typeKey, typeVersion: t.typeVersion, status: t.status, systemStatusCategory: t.systemStatusCategory, targets })
    }
    if ((m = /^\/tasks\/([^/]+)\/(verifications|comments|relations)$/.exec(path)) !== null) {
      const t = byRef(m[1]!)
      if (t === undefined) return notFound(res)
      if (m[2] === 'verifications') return send(res, 200, page(verifications.filter(v => v.taskId === t.id), q))
      if (m[2] === 'comments') return send(res, 200, page(comments.filter(c => c.taskId === t.id), q))
      return send(res, 200, page(relations.filter(r => r.fromTaskId === t.id || r.toTaskId === t.id), q))
    }
    if ((m = /^\/artifacts\/([^/]+)\/content$/.exec(path)) !== null) {
      const a = artifacts.find(x => x.id === m![1])
      if (a === undefined) return notFound(res)
      if (a.contentState !== 'stored') return send(res, 404, { error: { code: 'content_not_stored', message: 'the artifact has no stored content' } })
      const name = encodeURIComponent(String(a.name))
      res.writeHead(200, { 'content-type': String(a.mediaType ?? 'application/octet-stream'), 'content-disposition': `inline; filename*=UTF-8''${name}`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' })
      const body = (a as { body?: unknown }).body
      res.end(Buffer.isBuffer(body) ? body : String(body ?? ''))
      return
    }
    if ((m = /^\/artifacts\/([^/]+)$/.exec(path)) !== null) { const a = artifacts.find(x => x.id === m![1]); return a !== undefined ? send(res, 200, a) : notFound(res) }
    if (path === '/artifacts') return send(res, 200, page(artifacts.filter(a => q.get('taskId') === null || a.taskId === q.get('taskId')), q))
    if ((m = /^\/tasks\/([^/]+)$/.exec(path)) !== null) { const t = byRef(m[1]!); return t !== undefined ? send(res, 200, t) : notFound(res) }
    if ((m = /^\/workspaces\/([^/]+)\/knowledge-packs$/.exec(path)) !== null) return send(res, 200, { workspaceId: m[1], rootWorkspaceId: m[1], configured: true, packs: kb.effective, strict: false, effective: kb.effective, updatedAt: new Date().toISOString() })
    if ((m = /^\/knowledge\/packs\/(.+)$/.exec(path)) !== null) { const pack = kb.packs[decodeURIComponent(m[1]!)]; return pack !== undefined ? send(res, 200, pack) : notFound(res) }
    if ((m = /^\/process-definitions\/([^/]+)$/.exec(path)) !== null) { const ref = decodeURIComponent(m[1]!); return ref === 'invoice-approval' || ref === `invoice-approval@${views.DEFINITION.version}` ? send(res, 200, { ...views.DEFINITION, latestVersion: views.DEFINITION.version, status: 'active' }) : notFound(res) }
    if ((m = /^\/process-instances\/([^/:]+)$/.exec(path)) !== null) { const pi = views.instance(m[1]!); return pi !== undefined ? send(res, 200, pi) : notFound(res) }
    if (path === '/views') return send(res, 200, views.list(q))
    if ((m = /^\/views\/([^/:]+)$/.exec(path)) !== null) { const v = views.one(m[1]!, q); return v !== undefined ? send(res, 200, v) : notFound(res) }
    if ((m = /^\/skill-invocations\/([^/:]+)$/.exec(path)) !== null) { const inv = imports.invocation(m[1]!); return inv !== undefined ? send(res, 200, inv) : notFound(res) }
    if (path === '/task-types') return send(res, 200, page(taskTypes, q))
    if ((m = /^\/task-types\/([^/]+)\/executors$/.exec(path)) !== null) { const r = executorsOf(m[1]!, q.get('workspaceId')); return send(res, r.status, r.body) }
    if ((m = /^\/task-types\/([^/]+)$/.exec(path)) !== null) {
      const ty = taskTypes.find(x => x.id === m![1] || x.key === m![1]) ?? taskTypes.find(x => x.key === tasks.find(t => t.typeId === m![1])?.typeKey)
      return ty !== undefined ? send(res, 200, { ...ty, lifecycleSchema: { initialStatus: 'todo', releaseStatus: 'todo', claimStatus: 'in_progress', completionStatus: 'done' } }) : notFound(res)
    }
    if (path === '/approvals') return send(res, 200, page(approvals.filter(a => (q.get('status') === null || a.status === q.get('status')) && (q.get('taskId') === null || a.taskId === q.get('taskId'))), q))
    if ((m = /^\/approvals\/([^/:]+)$/.exec(path)) !== null) { const a = approvals.find(x => x.id === m![1]); return a !== undefined ? send(res, 200, a) : notFound(res) }
    if (path === '/runs') return send(res, 200, page(runs.filter(r => (q.get('status') === null || r.status === q.get('status')) && (q.get('taskId') === null || r.taskId === q.get('taskId'))), q))
    if (path === '/claims') return send(res, 200, page(claims.filter(c => (q.get('status') === null || c.status === q.get('status')) && (q.get('taskId') === null || c.taskId === q.get('taskId'))), q))
    if (path === '/principals') return send(res, 200, page(principals.filter(p => q.get('kind') === null || p.kind === q.get('kind')).map(people.withProfile), q))
    if ((m = /^\/principals\/([^/]+)\/iam-bindings$/.exec(path)) !== null) { const r = people.listBindings(m[1]!); return send(res, r.status, r.body) }
    if ((m = /^\/principals\/([^/:]+)$/.exec(path)) !== null) { const r = people.get(m[1]!); return send(res, r.status, r.body) }
    if ((m = /^\/workspaces\/([^/]+)\/members$/.exec(path)) !== null) { const r = people.listMembers(m[1]!); return send(res, r.status, r.body) }
    if ((m = /^\/principals\/([^/]+)$/.exec(path)) !== null) { const p = principals.find(x => x.id === m![1]); return p !== undefined ? send(res, 200, p) : notFound(res) }
    return notFound(res)
  }
  if (method === 'POST' && (m = /^\/approvals\/([^/:]+):(approve|reject|cancel)$/.exec(path)) !== null) return decide(res, m[1]!, m[2] as 'approve' | 'reject' | 'cancel', body)
  if (method === 'POST' && (m = /^\/me\/attention\/(.+):feedback$/.exec(path)) !== null) return send(res, 200, { itemKey: m[1], verdict: 'useful', recordedAt: new Date().toISOString() })
  if (method === 'PATCH' && (m = /^\/tasks\/([^/]+)$/.exec(path)) !== null) {
    const t = byRef(m[1]!)
    if (t === undefined) return notFound(res)
    const match = /"?task-(\d+)"?/.exec(String(req.headers['if-match'] ?? ''))
    if (match === null) return send(res, 428, { error: { code: 'precondition_required', message: 'If-Match is required' } })
    if (Number(match[1]) !== t.version) return send(res, 409, { error: { code: 'version_conflict', message: 'the task changed', details: { currentVersion: t.version } } })
    if (t.activeClaimId !== null) return send(res, 409, { error: { code: 'task_claimed', message: 'Task has an active claim; present claimId and fencingToken' } })
    const input = JSON.parse(body || '{}') as Record<string, unknown>
    const changed: Record<string, unknown> = {}
    if (input.requirements !== undefined && input.requirements !== null) {
      const bad = roles.setRequirements(t.publicId, input.requirements as { roles?: unknown })
      if (bad !== null) return send(res, bad.status, bad.body)
      changed.requirements = input.requirements
    }
    for (const f of ['title', 'description', 'ownerId', 'assigneeId', 'dueDate', 'startDate', 'status', 'customFields'] as const) if (f in input) { (t as unknown as Record<string, unknown>)[f] = input[f]; changed[f] = input[f] }
    if (typeof input.status === 'string') t.systemStatusCategory = ({ cancelled: 'terminal_cancelled', blocked: 'blocked', backlog: 'backlog' } as Record<string, string>)[input.status] ?? 'active'
    t.version++
    t.updatedAt = new Date().toISOString()
    publish(emit('task.updated', { type: 'task', id: t.id }, ME, { publicId: t.publicId, changes: Object.keys(changed), status: t.status, systemStatusCategory: t.systemStatusCategory, version: t.version }))
    if (changed.status !== undefined) documents.onQueued(t, publish)
    return send(res, 200, t)
  }
  if (method === 'POST' && (m = /^\/tasks\/([^/:]+):complete$/.exec(path)) !== null) {
    const t = byRef(m[1]!)
    if (t === undefined) return notFound(res)
    const match = /"?task-(\d+)"?/.exec(String(req.headers['if-match'] ?? ''))
    if (match === null) return send(res, 428, { error: { code: 'precondition_required', message: 'If-Match is required' } })
    if (Number(match[1]) !== t.version) return send(res, 409, { error: { code: 'version_conflict', message: 'the task changed' } })
    if (t.activeClaimId !== null) return send(res, 409, { error: { code: 'task_claimed', message: 'Task has an active claim' } })
    const at = new Date().toISOString()
    t.status = 'done'; t.systemStatusCategory = 'terminal_success'; t.completedAt = at; t.updatedAt = at; t.version++
    views.stepCompleted(t.publicId)
    publish(emit('task.completed', { type: 'task', id: t.id }, ME, { publicId: t.publicId, status: 'done', systemStatusCategory: 'terminal_success' }))
    publish(emit('process.step_completed', { type: 'process_instance', id: (t.origin as { ref?: string }).ref?.split('/')[1] ?? '' }, ME, { step: (t.origin as { ref?: string }).ref?.split('/')[2] }))
    return send(res, 200, t)
  }
  if (method === 'POST' && (m = /^\/claims\/([^/:]+):release$/.exec(path)) !== null) {
    const c = claims.find(x => x.id === m![1])
    if (c === undefined) return notFound(res)
    const t = tasks.find(x => x.id === c.taskId)!
    c.status = 'released'; c.releasedAt = new Date().toISOString(); c.releaseReason = String((JSON.parse(body || '{}') as { reason?: unknown }).reason ?? 'released')
    t.activeClaimId = null; t.version++
    publish(emit('task.released', { type: 'task', id: t.id }, ME, { publicId: t.publicId, claimId: c.id, reason: c.releaseReason }))
    return send(res, 200, c)
  }
  if (method === 'POST' && (m = /^\/runs\/([^/:]+):request-cancel$/.exec(path)) !== null) {
    const r = runs.find(x => x.id === m![1])
    if (r === undefined) return notFound(res)
    return send(res, 202, { ...r, cancelRequestedAt: new Date().toISOString(), cancelRequestedBy: ME })
  }
  if (method === 'POST' && (m = /^\/tasks\/([^/]+)\/comments$/.exec(path)) !== null) {
    const t = byRef(m[1]!)
    if (t === undefined) return notFound(res)
    const text = String((JSON.parse(body || '{}') as { body?: unknown }).body ?? '').trim()
    if (text === '') return send(res, 422, { error: { code: 'invalid_comment', message: 'body is required' } })
    const at = new Date().toISOString()
    const c = { id: randomUUID(), tenantId: t.tenantId, taskId: t.id, authorPrincipalId: ME, body: text, runId: null, artifactId: null, version: 1, createdAt: at, updatedAt: at, editedAt: null }
    comments.push(c)
    publish(emit('task.comment_added', { type: 'task', id: t.id }, ME, { publicId: t.publicId, commentId: c.id }))
    return send(res, 201, c)
  }
  if (method === 'POST' && (m = /^\/views\/([^/:]+):query$/.exec(path)) !== null) { const r = views.query(m[1]!, JSON.parse(body || '{}'), q); return send(res, r.status, r.body) }
  if (method === 'PUT' && (m = /^\/packages\/([^/]+)\/settings$/.exec(path)) !== null) { const r = settings.put(m[1]!, req.headers['if-match'] as string | undefined, body, q.get('locale') ?? 'ru'); return sendTagged(res, r) }
  if (method === 'POST' && path === '/principals') { const r = people.create(body, req.headers['idempotency-key'] as string | undefined); return send(res, r.status, r.body) }
  if (method === 'POST' && path === '/authz:check') { const r = people.authzCheck(body); return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/principals\/([^/:]+):disable$/.exec(path)) !== null) { const r = people.disable(m[1]!); return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/principals\/([^/:]+):enable$/.exec(path)) !== null) { const r = people.enable(m[1]!); return send(res, r.status, r.body) }
  if (method === 'PATCH' && (m = /^\/principals\/([^/:]+)$/.exec(path)) !== null) { const r = people.patch(m[1]!, req.headers['if-match'] as string | undefined, body); return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/principals\/([^/]+)\/iam-bindings$/.exec(path)) !== null) { const r = people.upsertBinding(m[1]!, body); return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/workspaces\/([^/]+)\/members$/.exec(path)) !== null) { const r = people.addMember(m[1]!, body); return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/workspaces\/([^/]+)\/members\/([^/:]+):remove$/.exec(path)) !== null) { const r = people.removeMember(m[1]!, m[2]!); if (r.status === 204) { res.writeHead(204).end(); return } return send(res, r.status, r.body) }
  if (method === 'POST' && path === '/roles') { const r = roles.create(body); return send(res, r.status, r.body) }
  if (method === 'PATCH' && (m = /^\/roles\/([^/]+)$/.exec(path)) !== null) { const r = roles.patch(m[1]!, req.headers['if-match'] as string | undefined, body); return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/principals\/([^/]+)\/roles\/([^/:]+):revoke$/.exec(path)) !== null) { const r = roles.revoke(m[1]!, m[2]!, body); if (r.status === 204) { res.writeHead(204).end(); return } return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/principals\/([^/]+)\/roles$/.exec(path)) !== null) { const id = m[1]!; const r = roles.assign(id, body, principals.some(p => p.id === id)); return send(res, r.status, r.body) }
  if (method === 'PUT' && (m = /^\/connection-types\/([^/]+)\/oauth-app$/.exec(path)) !== null) { const r = conn.setOAuthApp(decodeURIComponent(m[1]!), body); return send(res, r.status, r.body) }
  if (method === 'POST' && path === '/connections') { const r = conn.create(body); return sendTagged(res, r) }
  if (method === 'PATCH' && (m = /^\/connections\/([^/:]+)$/.exec(path)) !== null) { const r = conn.patch(m[1]!, req.headers['if-match'] as string | undefined, body); return sendTagged(res, r) }
  if (method === 'POST' && (m = /^\/connections\/([^/:]+):authorize$/.exec(path)) !== null) { const r = conn.authorize(m[1]!); return send(res, r.status, r.body) }
  if (method === 'PUT' && (m = /^\/connections\/([^/:]+)\/token$/.exec(path)) !== null) { const r = conn.setToken(m[1]!, body); return sendTagged(res, r) }
  if (method === 'POST' && (m = /^\/connections\/([^/:]+):revoke$/.exec(path)) !== null) { const r = conn.revoke(m[1]!, body); return sendTagged(res, r) }
  if (method === 'PUT' && (m = /^\/agents\/([^/]+)\/secrets\/([^/]+)$/.exec(path)) !== null) { const key = m[1]!; const r = conn.setSecret(key, decodeURIComponent(m[2]!), body, agents().some(a => a.key === key)); return send(res, r.status, r.body) }
  if (method === 'DELETE' && (m = /^\/agents\/([^/]+)\/secrets\/([^/]+)$/.exec(path)) !== null) {
    const key = m[1]!
    const r = conn.deleteSecret(key, decodeURIComponent(m[2]!), agents().some(a => a.key === key))
    if (r.status === 204) { res.writeHead(204).end(); return }
    return send(res, r.status, r.body)
  }
  if (method === 'POST' && (m = /^\/rules\/([^/:]+):(enable|disable)$/.exec(path)) !== null) { const r = settings.toggle(m[1]!, m[2] as 'enable' | 'disable'); return send(res, r.status, r.body) }
  if (method === 'PUT' && path === '/artifact-contents') { const r = imports.upload(body, req.headers['content-type']); return send(res, r.status, r.body) }
  if (method === 'POST' && path === '/artifacts') { const r = imports.createArtifact(JSON.parse(body || '{}')); return send(res, r.status, r.body) }
  if (method === 'POST' && (m = /^\/skills\/([^/:]+):invoke$/.exec(path)) !== null) { const r = imports.invoke(decodeURIComponent(m[1]!), JSON.parse(body || '{}')); return send(res, r.status, r.body) }
  if (method === 'POST' && path === '/approvals') { const r = imports.requestApproval(JSON.parse(body || '{}')); return send(res, r.status, r.body) }
  if (method === 'POST' && path === '/knowledge/entities:query') { const r = kb.query(JSON.parse(body || '{}')); return send(res, r.status, r.body) }
  if (method === 'POST' && path === '/tasks') {
    // Повтор с тем же Idempotency-Key — та же работа, как у ядра.
    const idem = String(req.headers['idempotency-key'] ?? '')
    const replay = idem !== '' ? createdBy.get(idem) : undefined
    if (replay !== undefined) return send(res, 201, tasks.find(x => x.id === replay))
    const input = JSON.parse(body || '{}') as Partial<Task>
    if (typeof input.title !== 'string' || input.title.trim() === '') return send(res, 422, { error: { code: 'validation_error', message: 'title is required' } })
    const type = taskTypes.find(ty => ty.key === (input.typeKey ?? 'free'))
    if (type === undefined) return send(res, 422, { error: { code: 'task_type_not_found', message: `unknown type ${String(input.typeKey)}` } })
    // Как ядро (commands/tasks.py): только начальный статус типа или статус категории backlog.
    if (input.status !== undefined && input.status !== 'todo' && input.status !== 'backlog') return send(res, 422, { error: { code: 'invalid_status', message: "New tasks must start in the type's initial status or in a 'backlog' status" } })
    const at = new Date().toISOString()
    const t: Task = {
      ...tasks[0]!, id: randomUUID(), publicId: `TASK-000${860 + tasks.length}`, title: input.title.trim(), description: input.description ?? '', typeKey: type.key, typeId: type.id,
      assigneeId: input.assigneeId ?? null, ownerId: input.ownerId ?? ME, workspaceId: input.workspaceId ?? WORKSPACE, dueDate: input.dueDate ?? null, startDate: null,
      status: input.status === 'backlog' ? 'backlog' : 'todo', systemStatusCategory: input.status === 'backlog' ? 'backlog' : 'active', createdBy: ME, origin: { kind: 'human' }, acceptance: type.acceptance, evidence: [], customFields: (input.customFields ?? {}) as Task['customFields'],
      createdAt: at, updatedAt: at, completedAt: null, verification: null, activeClaimId: null, version: 1,
    }
    tasks.unshift(t)
    if (idem !== '') createdBy.set(idem, t.id)
    publish(emit('task.created', { type: 'task', id: t.id }, ME, { publicId: t.publicId, title: t.title, typeKey: t.typeKey, status: 'todo', systemStatusCategory: 'active', origin: { kind: 'human' } }))
    documents.onQueued(t, publish)
    return send(res, 201, t)
  }
  notFound(res)
}

/**
 * Жизнь организации: раз в `everyMs` одна работа проходит следующий шаг. Консоль видит это
 * живьём через журнал — для проверки «online» и обновления зон без перезагрузки.
 */
export function simulate(everyMs: number): NodeJS.Timeout {
  const pool = tasks.filter(t => t.systemStatusCategory === 'active' && t.claimEpoch === 0 && t.assigneeId === null)
  let n = 0
  return setInterval(() => {
    const id = randomUUID()
    const publicId = `TASK-000${950 + n++}`
    publish(emit('task.created', { type: 'task', id }, principals.find(p => p.kind === 'service')!.id, { publicId, title: `Сверить счёт №${430 + n}`, typeKey: 'invoice-reconcile', status: 'todo', systemStatusCategory: 'active', origin: { kind: 'process' } }))
    if (pool.length > 0 && n % 3 === 0) pool.shift()
  }, everyMs).unref()
}
