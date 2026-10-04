/**
 * Документ в базу знаний на стенде (`knowledge-document`, TAI-ADR-0070 §8). Работа в `todo` с
 * файлом (`fileArtifactId`) проходит как у живого хоста скиллов: claim → артефакт `skill_result`
 * извлечения `knowledge.document_extract@1` → сдача (проверка `waiting_human`) → решение
 * владельцу. Одобрение записывает сущность в базу знаний стенда, отказ отменяет работу.
 */
import { randomUUID } from 'node:crypto'
import { TENANT, approvals, artifacts, emit, principals, verifications, type Approval, type Task } from './data.ts'
import * as kb from './knowledge.ts'

export const DOCUMENT_TYPE = 'knowledge-document'
const EXTRACT = 'knowledge.document_extract@1'

type Publish = (event: ReturnType<typeof emit>) => void

/** Поля, которые «прочитало» извлечение: по виду, из имени файла. */
function extraction(task: Task): Record<string, unknown> {
  const fields = task.customFields as Record<string, unknown>
  const kind = String(fields.kind ?? 'agreement')
  const filename = String(fields.filename ?? 'document.pdf')
  const base = filename.replace(/\.[^.]+$/, '')
  const until = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)
  const attributes: Record<string, unknown> = kind === 'agreement'
    ? { number: base, subject: 'Поставка оборудования', direction: 'purchase', status: 'active', validUntil: until }
    : kind === 'credential'
      ? { type: 'license', issuer: 'ГУ МЧС России', number: base, validUntil: until }
      : { name: base }
  return {
    documentKey: `document:${randomUUID().slice(0, 8)}`,
    textStatus: filename.toLowerCase().endsWith('.jpg') ? 'ocr' : 'text',
    attributes,
    proposal: { key: `${kind}:manual:${base}`, title: base },
    summary: `**Извлечено из «${filename}»**\n\n> ${base} — действует до ${until}.`,
  }
}

const executor = () => principals.find(p => p.kind === 'service') ?? principals[0]!

/** Работа ушла в `todo` с файлом — исполнитель «читает» документ. */
export function onQueued(t: Task, publish: Publish): void {
  if (t.typeKey !== DOCUMENT_TYPE || t.status !== 'todo' || t.verification !== null) return
  const fields = t.customFields as Record<string, unknown>
  if (typeof fields.fileArtifactId !== 'string') return
  const by = executor().id
  setTimeout(() => {
    t.activeClaimId = randomUUID(); t.claimEpoch++; t.status = 'in_progress'; t.version++
    publish(emit('task.claimed', { type: 'task', id: t.id }, by, { publicId: t.publicId, claimId: t.activeClaimId }))
  }, 600)
  setTimeout(() => {
    const at = new Date().toISOString()
    artifacts.push({
      id: randomUUID(), tenantId: TENANT, workspaceId: t.workspaceId, taskId: t.id, runId: null, createdByPrincipalId: by,
      type: 'skill_result', name: EXTRACT, uri: null, content: { skill: EXTRACT, output: extraction(t) }, supersedesArtifactId: null, metadata: {},
      contentState: 'none', sizeBytes: null, mediaType: null, sha256: null, typeVersion: 1, createdAt: at,
    })
    const v = {
      id: randomUUID(), tenantId: TENANT, taskId: t.id, attempt: 1, status: 'waiting_human', trigger: 'complete', triggerRef: null, authorityPrincipalId: by,
      checks: [{ key: 'apply', kind: 'human', description: 'Владелец проверил поля и одобрил запись', spec: {} }], results: [],
      cursor: 0, skillInvocationId: null, approvalId: null, nextCheckAt: null, startedAt: at, finishedAt: null, updatedAt: at,
    }
    verifications.unshift(v)
    t.verification = { id: v.id, status: 'waiting_human', attempt: 1, updatedAt: at }
    t.activeClaimId = null; t.status = 'review'; t.version++; t.updatedAt = at
    const a: Approval = {
      id: randomUUID(), tenantId: TENANT, workspaceId: t.workspaceId, taskId: t.id, artifactId: null, requestedByPrincipalId: by, status: 'pending',
      gate: true, requiredRoleId: null, assignedPrincipalId: t.ownerId, decisionByPrincipalId: null, decisionAt: null, comment: null, version: 1,
      outcomeStatus: null, excludedPrincipals: [], createdAt: at, updatedAt: at,
    }
    approvals.push(a)
    publish(emit('task.verification_started', { type: 'task', id: t.id }, by, { publicId: t.publicId, attempt: 1 }))
    publish(emit('approval.requested', { type: 'approval', id: a.id }, by, { taskId: t.id, gate: true }))
  }, 2500)
}

/** Исход решения по документу: одобрено — сущность с сохранёнными полями; отказ — работа снята. */
export function onDecided(t: Task, verb: 'approve' | 'reject' | 'cancel'): void {
  if (t.typeKey !== DOCUMENT_TYPE) return
  const fields = t.customFields as Record<string, unknown>
  if (verb === 'approve') {
    const key = typeof fields.key === 'string' && fields.key !== '' ? fields.key : String(fields.documentKey)
    kb.entities.unshift({ kind: String(fields.kind), key, title: String(fields.title ?? key), attributes: (fields.attributes ?? {}) as Record<string, unknown> })
  } else {
    t.status = 'cancelled'; t.systemStatusCategory = 'terminal_cancelled'; t.version++
  }
}
