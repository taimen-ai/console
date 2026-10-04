import type { ExecutorKind, SealsProps, Status, WorkRowProps } from '@console/ui'
import { t } from '@lingui/core/macro'
import { BASE_PATH } from '../../api/client.ts'
import { executorKind } from '../../api/directory.ts'
import type { Approval, Principal, Task } from '../../api/types.ts'
import { clock, dayMonth, due, since, startOfToday } from '../../lib/format.ts'

/**
 * Строка работы (`WorkRow`) из `TaskOut` ядра: статус словом, фраза готовности и четыре
 * печати — откуда · кто делает · чем доказано · кто подписывает (docs/screens/work.md).
 * Только то, что ядро отдаёт: метода проверки в сводке `verification` нет, поэтому пройденная
 * проверка — «проверено», без «чем именно».
 */

type Directory = Map<string, Principal> | undefined

export const workHref = (ref: string): string => `${BASE_PATH}/work/${encodeURIComponent(ref)}`

const OPEN_VERIFICATION = new Set(['running', 'waiting_human', 'waiting_external'])

/** Две буквы для знака агента и процесса: «Сверщик» → «Св», «Оплата счетов» → «ОС». */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return name.slice(0, 2)
}

/** `assignee` — вид исполнителя: взятая без захвата работа человека ждёт его, агента — ещё не начата. */
export function statusOf(task: Task, assignee?: ExecutorKind): Status {
  const v = task.verification?.status
  switch (task.systemStatusCategory) {
    case 'backlog': return 'queued'
    case 'blocked': return 'blocked'
    case 'terminal_success': return v === 'passed' ? 'verified' : 'completed'
    case 'terminal_cancelled': return 'stale'
    default:
      if (v === 'failed') return 'failed'
      if (v !== undefined && OPEN_VERIFICATION.has(v)) return v === 'waiting_human' ? 'waiting_human' : v === 'waiting_external' ? 'waiting_external' : 'completed'
      if (task.activeClaimId !== null) return 'running'
      if (task.claimEpoch === 0) return 'queued'
      return assignee === 'human' ? 'waiting_human' : 'queued'
  }
}

/**
 * Категории задач ядра: `backlog`, `active`, `blocked`, `terminal_success`,
 * `terminal_cancelled` (у проектов — другой словарь: planned/paused). «Не начата» — в очереди
 * (`backlog`) или активная, которую ни разу не брали (`claimEpoch == 0`, захвата нет).
 */
export const notStarted = (task: Pick<Task, 'systemStatusCategory' | 'claimEpoch' | 'activeClaimId'>): boolean =>
  task.systemStatusCategory === 'backlog' || (task.systemStatusCategory === 'active' && task.claimEpoch === 0 && task.activeClaimId === null)

/** Подпись статуса, когда знак дизайн-системы сам её не передаёт: снятая работа — «снята». */
export function statusLabelOf(task: Task): string | undefined {
  return task.systemStatusCategory === 'terminal_cancelled' ? t`withdrawn` : undefined
}

/** Фраза готовности: что с работой сейчас, одной строкой. */
export function readinessOf(task: Task, now = new Date()): string | undefined {
  const v = task.verification
  if (task.systemStatusCategory === 'terminal_success') {
    const at = task.completedAt !== null ? (new Date(task.completedAt) >= startOfToday(now) ? clock(task.completedAt) : dayMonth(task.completedAt)) : undefined
    return at !== undefined ? t`Done at ${at}` : t`Done`
  }
  if (task.systemStatusCategory === 'terminal_cancelled') return t`Withdrawn`
  // Статус, поставленный работе (блокировка, пауза), важнее итога прошлой проверки.
  if (task.systemStatusCategory === 'blocked') return t`Blocked`
  if (v?.status === 'failed') {
    const attempt = v.attempt
    return t`Did not pass verification (attempt ${attempt})`
  }
  if (v !== undefined && v !== null && OPEN_VERIFICATION.has(v.status)) return t`Submitted, under verification`
  if (task.assigneeId === null) return t`Nobody is assigned`
  return due(task.dueDate, now) ?? (notStarted(task) ? t`Not started yet` : undefined)
}

/**
 * Ссылка на шаг процесса в `origin.ref` работы: `process/<id экземпляра>/<шаг>` (так её
 * пишет движок процессов ядра). Старые и прочие ссылки — `undefined`.
 */
export function processRef(ref: string | undefined): { instanceId: string, step: string } | undefined {
  const m = /^process\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^/]+)$/i.exec(ref ?? '')
  return m !== null ? { instanceId: m[1]!, step: m[2]! } : undefined
}

export function origin(task: Task, people: Directory): SealsProps['origin'] {
  const o = task.origin as { kind?: string, ref?: string }
  const ref = typeof o.ref === 'string' ? o.ref : ''
  switch (o.kind) {
    case 'human': {
      const who = people?.get(task.createdBy)
      return who !== undefined ? { kind: 'human', text: t`raised by ${who.displayName}`, name: who.displayName } : { kind: 'human', text: t`raised by a person` }
    }
    case 'rule': return { kind: 'rule', text: ref !== '' ? t`rule ${ref}` : t`by a rule` }
    case 'process': {
      const step = processRef(ref)?.step
      return { kind: 'process', text: step !== undefined ? t`process step ${step}` : ref !== '' ? t`process ${ref}` : t`by a process` }
    }
    case 'parent': return { kind: 'parent', text: ref !== '' ? t`part of ${ref}` : t`part of other work` }
    case 'external': return { kind: 'external', text: ref !== '' ? t`from ${ref}` : t`from an external system` }
    case 'harness': return { kind: 'harness', text: t`raised during an agent's work` }
    default: return null
  }
}

export function executor(task: Task, people: Directory): SealsProps['executor'] {
  if (task.assigneeId === null) return null
  const p = people?.get(task.assigneeId)
  const kind: ExecutorKind = executorKind(p)
  const name = p?.displayName ?? t`Participant`
  return { kind, name, label: initials(name) }
}

export function evidence(task: Task): SealsProps['evidence'] {
  const v = task.verification
  if (v === null || v === undefined) return task.systemStatusCategory === 'terminal_success' ? { method: 'none', text: t`closed without verification` } : { method: 'none', text: t`verification ahead` }
  if (v.status === 'passed') return { method: 'auto', text: t`verified` }
  if (v.status === 'failed') {
    const attempt = v.attempt
    return { method: 'failed', text: t`failed, attempt ${attempt}` }
  }
  if (v.status === 'cancelled') return { method: 'none', text: t`verification cancelled` }
  return { method: 'pending' }
}

/** Приёмка работы ждёт решения человека: среди критериев есть проверка человеком. */
const needsPerson = (task: Task): boolean => (task.acceptance ?? []).some(c => (c as { kind?: unknown }).kind === 'human')

/**
 * Подпись: ждущее согласование — «ждёт подписи» с тем, кто решает; решённое — кто подписал;
 * критерий приёмки «человеком» без согласования — подпись впереди; иначе — не требуется.
 */
export function signature(task: Task, approvals: readonly Approval[], people: Directory, me: string | undefined): SealsProps['signature'] {
  const name = (id: string | null): string | undefined => id === null ? undefined : id === me ? t`you` : people?.get(id)?.displayName
  const pending = approvals.find(a => a.status === 'pending')
  if (pending !== undefined) {
    const who = name(pending.assignedPrincipalId)
    return { pending: true, ...(who !== undefined ? { who } : {}) }
  }
  const approved = approvals.filter(a => a.status === 'approved').at(-1)
  if (approved !== undefined) {
    const who = name(approved.decisionByPrincipalId)
    const at = approved.decisionAt !== null ? clock(approved.decisionAt) : undefined
    return { ...(who !== undefined ? { who } : {}), ...(at !== undefined ? { at } : {}) }
  }
  return needsPerson(task) && task.systemStatusCategory !== 'terminal_success' ? { pending: true } : null
}

/** Согласования работы, известные экрану (ждущие — одним запросом на экран, решённые — у сделанных). */
export interface RowContext { people: Directory, me: string | undefined, approvals: readonly Approval[] }

export function rowOf(task: Task, ctx: RowContext): WorkRowProps {
  const status = statusOf(task, task.assigneeId !== null ? executorKind(ctx.people?.get(task.assigneeId)) : undefined)
  const readiness = readinessOf(task)
  const age = since(task.updatedAt)
  const statusLabel = statusLabelOf(task)
  return {
    status,
    ...(statusLabel !== undefined ? { statusLabel } : {}),
    title: task.title,
    number: task.publicId,
    href: workHref(task.publicId),
    ...(readiness !== undefined ? { readiness } : {}),
    ...(age !== undefined ? { age } : {}),
    seals: {
      origin: origin(task, ctx.people),
      executor: executor(task, ctx.people),
      evidence: evidence(task),
      signature: signature(task, ctx.approvals, ctx.people, ctx.me),
    },
  }
}
