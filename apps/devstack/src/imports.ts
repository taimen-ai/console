/**
 * Загрузка таблицы в базу знаний на стенде: хранилище содержимого (`PUT /artifact-contents`),
 * артефакты работы, вызовы скиллов `knowledge.import_plan@1` и `knowledge.template@1` и
 * запрос решения. План считается по CSV: первая строка — заголовки (как в шаблоне), строка
 * без значения первой колонки — ошибка. Вызов идёт `pending → running → succeeded` за
 * пару секунд — как у живого исполнителя скиллов.
 */
import { createHash, randomUUID } from 'node:crypto'
import { ME, TENANT, WORKSPACE, approvals, artifacts, byRef, emit, type Approval } from './data.ts'
import * as kb from './knowledge.ts'

interface Upload { body: string, mediaType: string }
const uploads = new Map<string, Upload>()
const invocations = new Map<string, Record<string, unknown>>()

type Reply = { status: number, body: unknown }
const fail = (status: number, code: string, message: string): Reply => ({ status, body: { error: { code, message } } })

export function upload(body: string, mediaType: string | undefined): Reply {
  if (mediaType === undefined || mediaType === '') return fail(400, 'invalid_request', 'Content-Type with the media type of the file is required')
  const ref = `upload:${randomUUID()}`
  uploads.set(ref, { body, mediaType })
  return { status: 201, body: { contentRef: ref, sizeBytes: Buffer.byteLength(body), mediaType, sha256: createHash('sha256').update(body).digest('hex'), expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }
}

export function createArtifact(input: Record<string, unknown>): Reply {
  const task = typeof input.task === 'string' ? byRef(input.task) : undefined
  const content = typeof input.contentRef === 'string' ? uploads.get(input.contentRef) : undefined
  if (input.contentRef !== undefined && content === undefined) return fail(422, 'content_ref_unknown', 'contentRef is unknown or expired')
  const at = new Date().toISOString()
  const a = {
    id: randomUUID(), tenantId: TENANT, workspaceId: task?.workspaceId ?? (typeof input.workspaceId === 'string' ? input.workspaceId : WORKSPACE), taskId: task?.id ?? null, runId: null, createdByPrincipalId: ME,
    type: String(input.type), name: String(input.name), uri: null, content: null, supersedesArtifactId: null, metadata: input.metadata ?? {},
    contentState: content !== undefined ? 'stored' : 'none', sizeBytes: content !== undefined ? Buffer.byteLength(content.body) : null, mediaType: content?.mediaType ?? null,
    sha256: null, typeVersion: 1, createdAt: at, ...(content !== undefined ? { body: content.body } : {}),
  }
  artifacts.push(a)
  return { status: 201, body: a }
}

const csvRows = (text: string): string[][] => text.split(/\r?\n/).filter(l => l.trim() !== '').map(l => l.split(/[;,]/).map(c => c.trim()))

function plan(inputs: Record<string, unknown>): Record<string, unknown> {
  const file = artifacts.find(a => a.id === inputs.fileArtifactId) as { body?: string } | undefined
  const [header = [], ...rows] = csvRows(file?.body ?? '')
  const rowErrors = rows.flatMap((r, i) => (r[0] ?? '') === '' ? [{ row: i + 2, code: 'required', message: `пустое обязательное поле «${header[0] ?? 'ключ'}»`, column: header[0] ?? null }] : [])
  const good = rows.length - rowErrors.length
  const status = rows.length === 0 ? 'empty' : rowErrors.length > 0 ? 'invalid' : 'ok'
  const counts = { opened: status === 'ok' ? good : 0, changed: 0, closed: 0, unchanged: 0 }
  return {
    status, templateVersion: `${String(inputs.kind)}@1`, source: `template:${String(inputs.kind)}`, rows: rows.length, counts,
    stateToken: status === 'ok' ? randomUUID() : null, opened: [], changed: [], closed: [], truncated: false, conflicts: [], rowErrors,
    summary: status === 'ok' ? `**План загрузки:** откроется ${good}, изменится 0, закроется 0.` : status === 'empty' ? 'В таблице нет строк.' : `**Таблица с ошибками:** ${rowErrors.length} — исправьте файл и загрузите снова.`,
  }
}

function template(inputs: Record<string, unknown>): Record<string, unknown> {
  const pack = kb.packs[String(inputs.pack)] as { kinds?: { kind: string, attributes?: { properties?: Record<string, { title?: string }>, required?: string[] } }[] } | undefined
  const kind = pack?.kinds?.find(k => k.kind === inputs.kind)
  const props = Object.entries(kind?.attributes?.properties ?? {})
  const csv = props.map(([key, p]) => p.title ?? key).join(';') + '\n'
  return {
    templateVersion: `${String(inputs.kind)}@1`, filename: `${String(inputs.kind)}.csv`, mediaType: 'text/csv', contentBase64: Buffer.from(csv, 'utf8').toString('base64'),
    columns: props.map(([key, p]) => ({ field: key, header: p.title ?? key, required: (kind?.attributes?.required ?? []).includes(key), type: 'string' })),
  }
}

const SKILLS: Record<string, (inputs: Record<string, unknown>) => Record<string, unknown>> = {
  'knowledge.import_plan@1': plan,
  'knowledge.template@1': template,
}

export function invoke(ref: string, input: Record<string, unknown>): Reply {
  const run = SKILLS[ref]
  if (run === undefined) return fail(404, 'skill_not_found', `skill ${ref} is not registered`)
  const at = new Date().toISOString()
  const inv: Record<string, unknown> = {
    id: randomUUID(), tenantId: TENANT, skillId: ref, inputs: input.inputs ?? {}, authorityPrincipalId: ME, authorizationBasis: null, idempotencyKey: input.idempotencyKey ?? null,
    status: 'pending', attempt: 1, maxAttempts: 1, availableAt: at, output: null, error: null, cost: null, fencingToken: null, executorPrincipalId: null,
    executorSessionId: null, leaseExpiresAt: null, heartbeatAt: null, taskId: input.taskId ?? null, runId: null, artifactId: null, createdAt: at, updatedAt: at, startedAt: null, finishedAt: null,
  }
  invocations.set(String(inv.id), inv)
  setTimeout(() => { inv.status = 'running'; inv.startedAt = new Date().toISOString() }, 400)
  setTimeout(() => { inv.status = 'succeeded'; inv.output = run(inv.inputs as Record<string, unknown>); inv.finishedAt = new Date().toISOString() }, 1200)
  return { status: 201, body: inv }
}

export const invocation = (id: string): Record<string, unknown> | undefined => invocations.get(id)

export function requestApproval(input: Record<string, unknown>): Reply {
  const task = typeof input.task === 'string' ? byRef(input.task) : undefined
  if (task === undefined) return fail(404, 'task_not_found', 'Task not found')
  if (approvals.some(a => a.taskId === task.id && a.status === 'pending')) return fail(409, 'approval_pending', 'The task already has a pending approval')
  const at = new Date().toISOString()
  const a: Approval = {
    id: randomUUID(), tenantId: TENANT, workspaceId: task.workspaceId, taskId: task.id, artifactId: null, requestedByPrincipalId: ME, status: 'pending',
    gate: input.gate === true, requiredRoleId: null, assignedPrincipalId: typeof input.assignedPrincipalId === 'string' ? input.assignedPrincipalId : ME,
    decisionByPrincipalId: null, decisionAt: null, comment: typeof input.comment === 'string' ? input.comment : null, version: 1, outcomeStatus: null, excludedPrincipals: [], createdAt: at, updatedAt: at,
  }
  approvals.push(a)
  emit('approval.requested', { type: 'approval', id: a.id }, ME, { taskId: task.id, gate: a.gate })
  return { status: 201, body: a }
}
