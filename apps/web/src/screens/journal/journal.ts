import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type { JournalEvent } from '../../api/types.ts'

/**
 * «Журнал» для аудиторов (docs/screens/journal.md): все записи журнала ядра (`GET /events`) —
 * кто, что, когда и над чем, — от новых к старым, с фильтрами и выгрузкой. Журнал ядра только
 * дописывается; консоль его не меняет и ничего в нём не скрывает, кроме чужих пространств
 * (их отсекает ядро правами чтения).
 *
 * Что фильтрует ядро: группа событий (`types` — префиксы), объект (`entityType`, `entityId`).
 * Что — консоль по прочитанному: автор (`actorId`), период и область из шапки (поддерево;
 * у `/events` нет `includeDescendants`). Поэтому период дочитывается назад постранично до
 * своего начала, не дальше `MAX_SCAN_PAGES` страниц, — и экран говорит, докуда прочитано.
 */

export const FAMILIES = {
  work: { title: msg`Work`, prefixes: ['task.', 'work.', 'claim.', 'run.', 'artifact.'] },
  decisions: { title: msg`Decisions`, prefixes: ['approval.'] },
  access: { title: msg`People and access`, prefixes: ['principal.', 'iam_binding.', 'role.', 'session.', 'api_key.', 'delegation.', 'capability.'] },
  rules: { title: msg`Rules and processes`, prefixes: ['rule.', 'process.'] },
  agents: { title: msg`Agents and skills`, prefixes: ['agent.', 'skill.'] },
  knowledge: { title: msg`Knowledge`, prefixes: ['knowledge.'] },
  setup: { title: msg`Setup`, prefixes: ['workspace.', 'workspace_type.', 'task_type.', 'view.', 'project.', 'project_template.', 'calendar.', 'tenant.', 'event_journal.', 'context_adapter.', 'goal.'] },
} as const satisfies Record<string, { title: MessageDescriptor, prefixes: readonly string[] }>
export type Family = keyof typeof FAMILIES

/**
 * События, которые аудитор смотрит первыми: доступ, ключи, аварийный вход, удаление и чтение
 * содержимого, сам журнал. В ленте они выделены.
 */
export const AUDIT_TYPES = new Set([
  'api_key.break_glass_issued', 'api_key.created', 'api_key.revoked',
  'iam_binding.created', 'iam_binding.updated', 'iam_binding.revoked',
  'principal.created', 'principal.disabled', 'principal.enabled',
  'role.assigned', 'role.revoked', 'delegation.created', 'delegation.revoked',
  'artifact.content_purged', 'artifact.content_read',
  'event_journal.archived', 'event_journal.pruned', 'tenant.bootstrapped',
])

export interface JournalSearch {
  family?: Family
  /** Автор — principal id. */
  who?: string
  /** Период — даты `ГГГГ-ММ-ДД` по часам браузера, включительно. */
  from?: string
  to?: string
  entityType?: string
  entityId?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Разбор адреса: неизвестное и неверное отбрасывается, а не уходит в ядро. */
export function parseJournalSearch(raw: Record<string, unknown>): JournalSearch {
  const out: JournalSearch = {}
  if (typeof raw.family === 'string' && Object.hasOwn(FAMILIES, raw.family)) out.family = raw.family as Family
  if (typeof raw.who === 'string' && UUID.test(raw.who)) out.who = raw.who
  for (const key of ['from', 'to'] as const) {
    const v = raw[key]
    if (typeof v === 'string' && DATE.test(v) && !Number.isNaN(new Date(`${v}T00:00`).getTime())) out[key] = v
  }
  if (typeof raw.entityType === 'string' && /^[a-z][a-z_]{0,40}$/.test(raw.entityType)) out.entityType = raw.entityType
  if (typeof raw.entityId === 'string' && UUID.test(raw.entityId)) out.entityId = raw.entityId
  return out
}

/** Начало и конец периода (`[from, to)`), по часам браузера; `to` — включительно по дням. */
export function periodOf(search: JournalSearch): { from: Date | null, to: Date | null } {
  const from = search.from !== undefined ? new Date(`${search.from}T00:00`) : null
  const to = search.to !== undefined ? new Date(new Date(`${search.to}T00:00`).getTime() + 86_400_000) : null
  return { from, to }
}

/** Параметры `GET /events` под фильтры ядра (без курсора и размера страницы). */
export function eventParams(search: JournalSearch): URLSearchParams {
  const params = new URLSearchParams()
  if (search.family !== undefined) for (const p of FAMILIES[search.family].prefixes) params.append('types', p)
  if (search.entityType !== undefined) params.set('entityType', search.entityType)
  if (search.entityId !== undefined) params.set('entityId', search.entityId)
  return params
}

/** Отбор на стороне консоли: автор, период, область. Группу и объект уже отобрало ядро. */
export function matches(e: JournalEvent, search: JournalSearch, inScope: (ws: string | null) => boolean): boolean {
  if (search.who !== undefined && e.actorId !== search.who) return false
  const { from, to } = periodOf(search)
  const at = new Date(e.occurredAt)
  if (from !== null && at < from) return false
  if (to !== null && at >= to) return false
  if (search.family !== undefined && !FAMILIES[search.family].prefixes.some(p => e.type.startsWith(p))) return false
  return inScope(e.workspaceId)
}

/** Ячейка CSV: кавычки удвоены; начало формулой (`= + - @`) обезврежено апострофом. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_COLUMNS = ['sequence', 'occurredAt', 'type', 'actorId', 'actor', 'entityType', 'entityId', 'workspaceId', 'payload', 'id'] as const

/** CSV выгрузки: одна строка — одна запись журнала, полезная нагрузка — JSON. */
export function toCsv(events: JournalEvent[], nameOf: (id: string | null) => string): string {
  const rows = events.map(e => [e.sequence, e.occurredAt, e.type, e.actorId, nameOf(e.actorId), e.entityType, e.entityId, e.workspaceId, e.payload, e.id].map(csvCell).join(','))
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n'
}

/** JSON Lines выгрузки: записи журнала как есть, по одной на строку. */
export const toJsonl = (events: JournalEvent[]): string => events.map(e => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '')
