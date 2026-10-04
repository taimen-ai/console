import type { ControlPlaneComponents } from '@console/api'

/**
 * Типы ответов ядра. Где снимок openapi описывает схему — берём её; где ответ в снимке
 * `{}` (ядро отдаёт JSONResponse без модели) — форма записана здесь по коду ядра, с
 * ссылкой на источник. Только поля, которые консоль читает.
 */
type Schemas = ControlPlaneComponents['schemas']
export type Task = Schemas['TaskOut']
export type Approval = Schemas['ApprovalOut']
export type Run = Schemas['RunOut']
export type Claim = Schemas['ClaimOut']
export type Principal = Schemas['PrincipalOut']

export interface Page<T> { items: T[], nextCursor: string | null }

/** Событие журнала (`EventOut` + `cursor`; control_plane/api/v1/events.py). */
export interface JournalEvent {
  id: string
  sequence: number
  type: string
  entityType: string
  entityId: string
  actorId: string | null
  workspaceId: string | null
  payload: Record<string, unknown>
  occurredAt: string
  cursor: string
}
export interface EventPage { items: JournalEvent[], nextCursor: string, prevCursor: string | null, hasMore: boolean }

/** `GET /me/attention` (CP-ADR-0071; application/queries/attention.py, `attention_body`). */
export interface AttentionItem {
  itemKey: string
  kind: 'approval.decide' | 'approval.review' | 'approval.undecidable' | 'task.due_not_started' | 'task.blocked' | 'task.delegated_failing' | (string & {})
  reasonCode: string
  rule: string
  score: number
  entity: { type: 'approval' | 'task' | (string & {}), id: string }
  title: string
  workspaceId: string | null
  taskId: string | null
  taskPublicId: string | null
  dueDate: string | null
  since: string | null
  details: Record<string, unknown>
  actions: { action: string, method: string, href: string }[]
  feedback: { verdict: string } | null
}
export interface Attention { items: AttentionItem[], degraded: { rule: string, reasonCode: string, message: string }[], generatedAt: string }

/** `GET /harness/context` (application/queries/harness.py): кто я и где я. */
export interface HarnessContext {
  tenant: { id: string, slug: string, name: string }
  principal: { id: string, kind: string, displayName: string }
  permissions?: string[]
}

export type Artifact = Schemas['ArtifactOut']
export type TaskComment = Schemas['TaskCommentOut']
export type TaskRelation = Schemas['TaskRelationOut']

/** Попытка стадии проверки (`TaskVerificationOut`, CP-ADR-0067; в снимке openapi — `PageOut` без формы элемента). */
export interface Verification {
  id: string
  taskId: string
  attempt: number
  status: 'running' | 'waiting_human' | 'waiting_external' | 'passed' | 'failed' | 'cancelled' | (string & {})
  trigger: string
  /** Критерии приёмки, как были при открытии попытки. */
  checks: { key: string, kind: string, description?: string }[]
  /** Результаты пройденных критериев. */
  results: { key: string, kind: string, status: string, reason?: string, message?: string }[]
  approvalId: string | null
  startedAt: string
  finishedAt: string | null
}
