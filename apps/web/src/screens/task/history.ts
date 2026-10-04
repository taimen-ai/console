import type { ReactNode } from 'react'
import type { ChronicleEvent, ChronicleGroup, ChronicleSpan, ExecutorKind, Status } from '@console/ui'
import { t } from '@lingui/core/macro'
import { executorKind } from '../../api/directory.ts'
import type { Approval, JournalEvent, Principal, Run, Task, TaskComment, Verification } from '../../api/types.ts'
import { dayMonth, quote, startOfToday } from '../../lib/format.ts'
import { i18n } from '../../i18n.ts'
import { initials, processRef } from '../work/rows.ts'

/**
 * История одной работы (`Chronicle`): у ядра нет `/tasks/{ref}/timeline`, поэтому консоль
 * склеивает её сама из журнала работы, попыток, проверок, согласований и обсуждения
 * (docs/screens/task.md, «Данные»). Три вида: «Кратко» — группы по порядку времени, «По
 * времени» — где сколько стояла работа, «Полный журнал» — события с машинными типами.
 */

type Directory = Map<string, Principal> | undefined

export interface HistoryInput {
  task: Task
  events: JournalEvent[]
  runs: Run[]
  verifications: Verification[]
  approvals: Approval[]
  comments: TaskComment[]
  people: Directory
  me: string | undefined
  /** Раскрываемый ящик попытки (протокол) по id попытки. */
  boxes?: Map<string, ReactNode>
}

export interface History { groups: ChronicleGroup[], spans: ChronicleSpan[], events: ChronicleEvent[] }

const locale = (): string => i18n.locale || 'en'

/** «12:36» сегодня, «2 октября, 12:36» раньше. */
export function when(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  return d >= startOfToday(now) ? time : `${dayMonth(d)}, ${time}`
}

const seconds = (iso: string): string => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Длительность словами: «< 1 мин», «12 мин», «1 ч 25 мин», «3 дн». */
export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return t`< 1 min`
  if (minutes < 60) return t`${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? t`${hours} h ${rest} min` : t`${hours} h`
  const days = Math.floor(hours / 24)
  return t`${days} d`
}

interface Actor { kind: ExecutorKind, name: string, label: string }
function actor(id: string | null | undefined, people: Directory, me: string | undefined): Actor | undefined {
  if (id === null || id === undefined) return undefined
  const p = people?.get(id)
  const name = id === me ? t`You` : p?.displayName ?? t`Participant`
  return { kind: executorKind(p), name, label: initials(p?.displayName ?? name) }
}

function runStatus(status: string): Status {
  switch (status) {
    case 'running': return 'running'
    case 'failed': case 'timed_out': return 'failed'
    case 'cancelled': return 'stale'
    case 'suspended': return 'paused'
    default: return 'completed'
  }
}

function verificationStatus(status: string): Status {
  if (status === 'passed') return 'verified'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'stale'
  if (status === 'waiting_human') return 'waiting_human'
  if (status === 'waiting_external') return 'waiting_external'
  return 'running'
}

function originTitle(task: Task, people: Directory, me: string | undefined): string {
  const o = task.origin as { kind?: string, ref?: string }
  const ref = typeof o.ref === 'string' ? quote(o.ref) : ''
  switch (o.kind) {
    case 'rule': return ref !== '' ? t`Rule ${ref} raised the work` : t`A rule raised the work`
    case 'process': {
      const step = processRef(o.ref)?.step
      if (step !== undefined) {
        const quoted = quote(step)
        return t`Process step ${quoted} raised the work`
      }
      return ref !== '' ? t`Process ${ref} raised the work` : t`A process raised the work`
    }
    case 'parent': return ref !== '' ? t`Raised as part of ${ref}` : t`Raised as part of other work`
    case 'external': return ref !== '' ? t`Imported from ${ref}` : t`Imported from an external system`
    case 'harness': return t`An agent raised the work during its own work`
    default: {
      const who = actor(task.createdBy, people, me)?.name ?? t`A person`
      return t`Raised by: ${who}`
    }
  }
}

interface Dated { at: string, group: ChronicleGroup, phase?: string, human?: boolean }

export function buildHistory(input: HistoryInput, now = new Date()): History {
  const { task, people, me } = input
  const dated: Dated[] = []

  dated.push({ at: task.createdAt, phase: t`Raised, not yet taken`, group: { kind: 'origin', at: when(task.createdAt, now), status: 'running', title: originTitle(task, people, me), ...(task.description ? { text: task.description } : {}) } })

  for (const e of input.events) {
    if (e.type !== 'task.claimed') continue
    const who = actor((e.payload.holderId as string | undefined) ?? e.actorId, people, me)
    dated.push({ at: e.occurredAt, phase: t`Taken`, group: { kind: 'claim', at: when(e.occurredAt, now), ...(who !== undefined ? { actor: who, title: t`${who.name} took the work` } : { title: t`The work was taken` }) } })
  }

  for (const r of input.runs) {
    const at = r.startedAt ?? r.createdAt
    const who = actor(r.principalId, people, me)
    const attempt = r.attempt
    const reason = (r.failureReason as { message?: unknown } | null)?.message
    const length = r.finishedAt !== null && r.finishedAt !== undefined ? duration(new Date(r.finishedAt).getTime() - new Date(at).getTime()) : undefined
    dated.push({
      at, phase: who !== undefined ? t`Attempt by ${who.name}` : t`Attempt`,
      group: {
        kind: 'attempt', at: when(at, now), status: runStatus(r.status),
        title: length !== undefined ? t`Attempt #${attempt} · ${length}` : t`Attempt #${attempt} — in progress`,
        ...(who !== undefined ? { actor: who } : {}),
        ...(typeof reason === 'string' ? { text: reason } : {}),
        ...(input.boxes?.has(r.id) === true ? { box: input.boxes.get(r.id) } : {}),
      },
    })
  }

  for (const v of input.verifications) {
    const done = new Map(v.results.map(r => [r.key, r]))
    const passed = v.results.filter(r => r.status === 'passed').length
    const total = v.checks.length
    const attempt = v.attempt
    const title = v.status === 'passed' ? t`Verified: ${passed} of ${total}`
      : v.status === 'failed' ? t`Did not pass verification (attempt ${attempt})`
        : v.status === 'cancelled' ? t`Verification cancelled`
          : t`Under verification: ${passed} of ${total} passed`
    dated.push({
      at: v.startedAt, phase: t`Verification`,
      group: {
        kind: 'verify', at: when(v.startedAt, now), status: verificationStatus(v.status), title,
        criteria: v.checks.map((c) => {
          const r = done.get(c.key)
          const text = c.description ?? c.key
          // Без результата критерий не провален: до него проверка не дошла или он впереди.
          const note = r === undefined ? (v.status === 'failed' || v.status === 'cancelled' ? t`not checked` : t`ahead`) : r.message
          return { ok: r?.status === 'passed', text: note !== undefined ? `${text} — ${note}` : text }
        }),
      },
    })
  }

  for (const a of input.approvals) {
    const decided = a.status !== 'pending'
    const whoId = decided ? a.decisionByPrincipalId : a.assignedPrincipalId
    const who = actor(whoId, people, me)
    // Внутри фразы — «вы» строчной: «Ждёт подписи: вы».
    const name = whoId === me && me !== undefined ? t`you` : who?.name ?? t`someone with the role`
    const title = a.status === 'pending' ? t`Waiting for sign-off: ${name}`
      : a.status === 'approved' ? t`Signed: ${name}`
        : a.status === 'rejected' ? t`Declined: ${name}` : t`Sign-off request cancelled`
    dated.push({
      at: a.createdAt, phase: t`Waiting for sign-off`, human: true,
      group: { kind: 'signature', at: when(decided && a.decisionAt !== null ? a.decisionAt : a.createdAt, now), human: true, done: decided, title, ...(who !== undefined ? { actor: who } : {}), ...(a.comment ? { text: a.comment } : {}) },
    })
  }

  for (const c of input.comments) {
    const who = actor(c.authorPrincipalId, people, me)
    dated.push({ at: c.createdAt, group: { kind: 'discussion', at: when(c.createdAt, now), human: true, done: true, title: who?.name ?? t`Participant`, text: c.body, ...(who !== undefined ? { actor: who } : {}) } })
  }

  dated.sort((a, b) => a.at.localeCompare(b.at))
  return { groups: dated.map(d => d.group), spans: spans(task, dated, now), events: journal(input) }
}

/** «По времени»: отрезки между вехами работы в процентах всего срока (до завершения или сейчас). */
function spans(task: Task, dated: Dated[], now: Date): ChronicleSpan[] {
  const marks = dated.filter(d => d.phase !== undefined)
  const start = new Date(task.createdAt).getTime()
  const end = task.completedAt !== null && task.completedAt !== undefined ? new Date(task.completedAt).getTime() : now.getTime()
  const total = Math.max(end - start, 1)
  const pct = (ms: number): number => Math.min(100, Math.max(0, Math.round(((ms - start) / total) * 100)))
  return marks.map((m, i) => {
    const from = new Date(m.at).getTime()
    const to = i + 1 < marks.length ? new Date(marks[i + 1]!.at).getTime() : end
    return { label: m.phase!, from: pct(from), to: Math.max(pct(to), pct(from) + 1), dur: duration(to - from), ...(m.human === true ? { human: true } : {}) }
  })
}

/** «Полный журнал»: события работы ядра и связанные с ней записи, машинный тип — вторым слоем. */
function journal(input: HistoryInput): ChronicleEvent[] {
  const { people, me } = input
  const name = (id: string | null | undefined): string => actor(id, people, me)?.name ?? t`core`
  const rows: { at: string, text: string, type: string }[] = []
  for (const e of input.events) rows.push({ at: e.occurredAt, type: e.type, text: eventText(e, name(e.actorId)) })
  for (const r of input.runs) {
    const attempt = r.attempt
    const who = name(r.principalId)
    rows.push({ at: r.startedAt ?? r.createdAt, type: 'run.started', text: t`Attempt #${attempt} started: ${who}` })
    if (r.finishedAt !== null && r.finishedAt !== undefined) rows.push({ at: r.finishedAt, type: `run.${r.status}`, text: t`Attempt #${attempt} finished` })
  }
  for (const a of input.approvals) {
    const who = name(a.assignedPrincipalId)
    rows.push({ at: a.createdAt, type: 'approval.requested', text: t`Sign-off requested: ${who}` })
    if (a.decisionAt !== null) rows.push({ at: a.decisionAt, type: `approval.${a.status}`, text: name(a.decisionByPrincipalId) })
  }
  // Журнал ядра уже несёт комментарии событием; без него — запись из обсуждения.
  if (!input.events.some(e => e.type === 'task.comment_added')) {
    for (const c of input.comments) {
      const who = name(c.authorPrincipalId)
      rows.push({ at: c.createdAt, type: 'task.comment_added', text: t`Comment: ${who}` })
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at))
  return rows.map(r => ({ at: seconds(r.at), text: r.text, type: r.type }))
}

function eventText(e: JournalEvent, who: string): string {
  switch (e.type) {
    case 'task.created': return t`Raised: ${who}`
    case 'task.claimed': return t`Taken: ${who}`
    case 'task.completed': return t`Submitted for verification: ${who}`
    case 'task.verification_started': return t`Verification started`
    case 'task.verified': return t`Verified`
    case 'task.verification_failed': {
      const reason = e.payload.reason
      return typeof reason === 'string' ? t`Did not pass verification: ${reason}` : t`Did not pass verification`
    }
    case 'task.updated': return t`Changed: ${who}`
    case 'task.comment_added': return t`Comment: ${who}`
    case 'task.released': return t`Released: ${who}`
    default: return who
  }
}
