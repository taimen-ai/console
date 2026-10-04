import {
  DecisionCard, DecisionStatus, IdentityBlock, JournalEntry, ProblemCard, StatusMark, Summary, WorkPath, Zone,
  type ExecutorKind, type JournalEntryProps, type SummaryChange, type WorkPathGate, type WorkPathStage,
} from '@console/ui'
import { plural, t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BASE_PATH, cpGet } from '../../api/client.ts'
import { useScope, useScopedAttention } from '../../api/scope.tsx'
import { executorKind, usePrincipals, useTasks } from '../../api/directory.ts'
import type { Approval, Attention, AttentionItem, JournalEvent, Page, Principal, Run, Claim, Task } from '../../api/types.ts'
import { clock, quote, since } from '../../lib/format.ts'
import { DeclineDialog } from '../../decisions/DeclineDialog.tsx'
import { useDecision } from '../../decisions/useDecision.ts'
import { distinct, useDay } from './day.ts'
import './today.css'

/**
 * Экран «Сегодня» (docs/screens/today.md): организация работает? где нужен я? что
 * изменилось и чем это доказано? Только реализованный API ядра: чего ядро не отдаёт
 * (меры результата, канал доставки решения, вакансии ролей), того на экране нет.
 */

const workHref = (ref: string | null | undefined): string | undefined => ref ? `${BASE_PATH}/work/${encodeURIComponent(ref)}` : undefined

type Directory = Map<string, Principal>
interface Actor { kind: ExecutorKind, name: string }

function actorOf(id: string | null, people: Directory | undefined): Actor {
  if (id === null) return { kind: 'process', name: t`Verification` }
  const p = people?.get(id)
  return p !== undefined ? { kind: executorKind(p), name: p.displayName } : { kind: 'process', name: t`Participant` }
}

/** Заголовок работы для события: из `task.created` дня, из загруженной работы или номер. */
function titleOf(e: JournalEvent, created: Map<string, string>, tasks: Map<string, Task>): string {
  const title = created.get(e.entityId) ?? tasks.get(e.entityId)?.title ?? (typeof e.payload.taskId === 'string' ? tasks.get(e.payload.taskId)?.title : undefined)
  const ref = typeof e.payload.publicId === 'string' ? e.payload.publicId : typeof e.payload.taskPublicId === 'string' ? e.payload.taskPublicId : undefined
  return title ?? ref ?? t`work`
}

/** Глагол записи журнала по типу события; человек и процесс заводят работу по-разному. */
function verbOf(type: string, human: boolean): string {
  switch (type) {
    case 'task.created': return human ? t({ id: 'journal.created.human', message: 'raised' }) : t({ id: 'journal.created.process', message: 'raised' })
    case 'task.claimed': return t`took`
    case 'task.completed': return t`submitted`
    case 'task.verified': return t`verified:`
    case 'task.verification_failed': return t`failed verification:`
    case 'work.reconciled': return t`withdrew`
    case 'approval.requested': return t`requested a sign-off on`
    case 'approval.approved': return t`approved`
    case 'approval.rejected': return t`declined`
    case 'approval.cancelled': return t`cancelled the sign-off request on`
    case 'run.failed': return t`attempt failed:`
    case 'run.started': return t`started an attempt on`
    case 'task.updated': return t`changed`
    case 'task.migrated': return t`moved to a new type`
    default: return type
  }
}

const METHOD: Record<string, SummaryChange['method']> = { external_state: 'external', external: 'external', deterministic: 'auto', auto: 'auto', human: 'human', model: 'model' }
function methodText(method: string): string {
  switch (method) {
    case 'external': return t`by external state`
    case 'human': return t`by a person`
    case 'model': return t`by a model's assessment`
    default: return t`by an automatic check`
  }
}

function methodOf(e: JournalEvent): SummaryChange['method'] {
  const results = Array.isArray(e.payload.results) ? e.payload.results as { kind?: string }[] : []
  const kinds = results.map(r => METHOD[r.kind ?? '']).filter((k): k is NonNullable<typeof k> => k !== undefined)
  // Сильнейшее доказательство: внешнее состояние > человек > автопроверка > модель.
  return (['external', 'human', 'auto', 'model'] as const).find(k => kinds.includes(k)) ?? 'auto'
}

// ------------------------------------------------------------------ решения

function Decision({ item, approval, task, people, compact, onDecided }: { item: AttentionItem, approval: Approval | undefined, task: Task | undefined, people: Directory | undefined, compact: boolean, onDecided: () => void }) {
  const navigate = useNavigate()
  const review = item.kind === 'approval.review'
  const { rows, decide } = useDecision(item.entity.id, review, onDecided)
  const [declining, setDeclining] = useState(false)
  const requester = approval !== undefined ? people?.get(approval.requestedByPrincipalId) : undefined
  const ref = item.taskPublicId ?? task?.publicId
  const common = {
    kind: review ? t`Acceptance` : t`Approval`,
    title: item.title,
    since: since(item.since),
    ...(requester !== undefined ? { requester: { kind: executorKind(requester), name: requester.displayName } } : {}),
  }
  // Свёрнутая карточка сама — кнопка: ссылка в заголовке была бы интерактивным внутри интерактивного.
  if (!compact) return <DecisionCard {...common} collapsed title={item.title} {...(ref !== undefined ? { onOpen: () => void navigate({ to: '/work/$ref', params: { ref } }) } : {})} />
  return (
    <>
      <DecisionCard
        {...common}
        compact
        holds={approval?.gate === true}
        why={approval?.assignedPrincipalId !== undefined && approval.assignedPrincipalId !== null ? t`the decision is assigned to you.` : t`you hold the role that decides.`}
        evidence={ref !== undefined ? [{ label: t`Work ${ref}`, href: workHref(ref)! }] : []}
        primary={review ? t`Accept` : t`Approve`}
        secondary={review ? t`Return` : t`Decline`}
        kbd="E"
        onPrimary={() => decide('approve')}
        onSecondary={() => setDeclining(true)}
        {...(rows !== null ? { footer: <DecisionStatus rows={rows} /> } : {})}
      />
      {declining ? <DeclineDialog title={item.title} review={review} onConfirm={reason => decide('reject', reason)} onClose={() => setDeclining(false)} /> : null}
    </>
  )
}

/**
 * Решённое не исчезает сразу: карточка остаётся с подтверждением ядра («записано в ядре»),
 * пока человек на экране, — нажатие кнопки ещё не подтверждённое действие
 * (design-system/README.md, «Каркас и поведение»).
 */
function Decisions({ items: live, people, onDecided }: { items: AttentionItem[], people: Directory | undefined, onDecided: () => void }) {
  const [kept, setKept] = useState<AttentionItem[]>([])
  const keep = (item: AttentionItem): void => {
    onDecided()
    setKept(k => k.some(x => x.itemKey === item.itemKey) ? k : [...k, item])
  }
  const items = [...live, ...kept.filter(k => !live.some(i => i.itemKey === k.itemKey))]
  const approvals = useQueries({ queries: items.map(i => ({ queryKey: ['approvals', i.entity.id], queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<Approval>(`/approvals/${i.entity.id}`, signal) })) })
  const tasks = useTasks(items.map(i => i.taskId).filter((x): x is string => x !== null))
  return (
    <Zone title={t`Awaiting your sign-off`} count={live.length} tone="human" className="fixed today-z-decisions">
      <div className="today-stack">
        {items.map((item, i) => (
          <Decision key={item.itemKey} item={item} approval={approvals[i]?.data} task={item.taskId !== null ? tasks.get(item.taskId) : undefined} people={people} compact={i === 0 || kept.some(k => k.itemKey === item.itemKey)} onDecided={() => keep(item)} />
        ))}
      </div>
    </Zone>
  )
}

// ------------------------------------------------------------------ проблемы

function failedRunsText(title: string | undefined, count: number, message: string | undefined): string {
  const work = quote(title ?? t`Work`)
  const attempts = plural(count, { one: 'the attempt failed', other: '# attempts failed' })
  return message !== undefined ? t`${work}: ${attempts} — ${message}` : t`${work}: ${attempts}`
}

interface Problem { key: string, severity: 'failed' | 'blocked' | 'stale' | 'approaching', diagnosis: string, where?: string, since?: string, href?: string }

/**
 * Упавшие попытки работы — проблема дня, только пока работа стоит: работы ещё нет в кэше —
 * подождать; снята или сделана — решение принято; идёт новая попытка — её повторяют
 * («Сейчас в работе»); сдана и проверяется — тоже не поломка; статус «заблокирована» —
 * так и сказать, а не «попытка не удалась».
 */
export function failedRunState(task: Pick<Task, 'systemStatusCategory' | 'status' | 'verification'> | undefined, retrying: boolean): 'skip' | 'blocked' | 'failed' {
  if (task === undefined || task.systemStatusCategory.startsWith('terminal') || retrying) return 'skip'
  if (task.systemStatusCategory === 'blocked' || task.status === 'blocked') return 'blocked'
  // После упавших попыток работу сдали: идёт или пройдена проверка — это не поломка.
  const v = task.verification?.status
  if (v === 'running' || v === 'waiting_human' || v === 'waiting_external' || v === 'passed') return 'skip'
  return 'failed'
}

function problemsOf(attention: AttentionItem[], failedRuns: Run[], tasks: Map<string, Task>, people: Directory | undefined, verifyFailures: Map<string, JournalEvent>, retrying: Set<string>): Problem[] {
  const out: Problem[] = []
  const covered = new Set<string>()
  for (const item of attention) {
    // Работа, решение по которой ждёт человека, — в «Ждёт вас», а не в «Сломано».
    if (item.entity.type === 'approval' && item.kind !== 'approval.undecidable') {
      if (item.taskId !== null) covered.add(item.taskId)
      continue
    }
    const ref = item.taskPublicId ?? undefined
    if (item.taskId !== null) covered.add(item.taskId)
    const failure = item.taskId !== null ? verifyFailures.get(item.taskId) : undefined
    const reason = typeof failure?.payload.reason === 'string' ? failure.payload.reason : undefined
    const base = { key: item.itemKey, since: since(item.since), ...(ref !== undefined ? { href: workHref(ref)! } : {}) }
    const title = quote(item.title)
    if (item.kind === 'task.delegated_failing') out.push({ ...base, severity: 'failed', diagnosis: reason !== undefined ? t`${title} keeps failing: ${reason}` : t`${title} keeps failing: attempts fail in a row` })
    else if (item.kind === 'task.blocked') out.push({ ...base, severity: 'blocked', diagnosis: t`${title} is stuck` })
    else if (item.kind === 'task.due_not_started') out.push({ ...base, severity: 'approaching', diagnosis: t`${title} is near its due date and nobody has started it` })
    else if (item.kind === 'approval.undecidable') out.push({ ...base, severity: 'blocked', diagnosis: t`Nobody can decide on ${title}` })
  }
  // Упавшие сегодня попытки, которых нет в «Ждёт вас»: по одной строке на работу — если работа
  // всё ещё стоит. Снятая или сделанная, повторяемая сейчас — не проблема дня.
  const byTask = new Map<string, Run[]>()
  for (const r of failedRuns) if (!covered.has(r.taskId)) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r])
  for (const [taskId, list] of byTask) {
    const task = tasks.get(taskId)
    const state = failedRunState(task, retrying.has(taskId))
    if (state === 'skip') continue
    const who = people?.get(list[0]!.principalId)
    const reason = list[0]!.failureReason as { message?: string } | null
    const title = quote(task!.title)
    out.push({
      key: `run:${taskId}`, severity: state,
      diagnosis: state === 'blocked' ? t`${title} is blocked` : failedRunsText(task!.title, list.length, typeof reason?.message === 'string' ? reason.message : undefined),
      ...(who !== undefined ? { where: executorKind(who) === 'agent' ? t`agent ${quote(who.displayName)}` : t`executor ${quote(who.displayName)}` } : {}),
      since: since(list.at(-1)!.startedAt),
      href: workHref(task!.publicId)!,
    })
  }
  return out
}

// ------------------------------------------------------------------ экран

export function Today() {
  // Подписка на язык: смена языка перерисовывает экран.
  useLingui()
  const people = usePrincipals()
  const day = useDay()
  const attention = useScopedAttention<Attention>()
  const running = useQuery({ queryKey: ['runs', 'running'], queryFn: ({ signal }) => cpGet<Page<Run>>('/runs?status=running&limit=50', signal) })
  const failed = useQuery({ queryKey: ['runs', 'failed'], queryFn: ({ signal }) => cpGet<Page<Run>>('/runs?status=failed&limit=50', signal) })
  const claims = useQuery({ queryKey: ['claims', 'active'], queryFn: ({ signal }) => cpGet<Page<Claim>>('/claims?status=active&limit=50', signal) })

  // Область: события — по пространству записи журнала, попытки и захваты — по пространству их работы.
  const scope = useScope()
  const events = (day.data?.events ?? []).filter(e => scope.contains(e.workspaceId))
  const startOfDay = day.data !== undefined ? new Date(day.data.since) : new Date()
  const allFailedToday = (failed.data?.items ?? []).filter(r => new Date(r.startedAt ?? r.createdAt) >= startOfDay)
  const items = attention.data?.items ?? []
  const decisions = items.filter(i => i.entity.type === 'approval' && i.kind !== 'approval.undecidable')
  const [decidedHere, setDecidedHere] = useState(false)

  // Заголовки работ: созданные сегодня — из событий, остальные — запросом.
  const created = new Map<string, string>()
  for (const e of events) if (e.type === 'task.created' && typeof e.payload.title === 'string') created.set(e.entityId, e.payload.title)
  const allRunning = running.data?.items ?? []
  const allClaims = claims.data?.items ?? []
  const verified = events.filter(e => e.type === 'task.verified')
  const recent = events.slice(-7).reverse()
  const tasks = useTasks([
    ...allRunning.map(r => r.taskId), ...allClaims.map(c => c.taskId), ...allFailedToday.map(r => r.taskId),
    ...verified.slice(-3).map(e => e.entityId).filter(id => !created.has(id)),
    ...recent.map(e => (e.entityType === 'task' ? e.entityId : typeof e.payload.taskId === 'string' ? e.payload.taskId : null)).filter((id): id is string => id !== null && !created.has(id)),
  ])

  const inScope = (taskId: string): boolean => scope.ws === null || scope.contains(tasks.get(taskId)?.workspaceId)
  const runningItems = allRunning.filter(r => inScope(r.taskId))
  const claimItems = allClaims.filter(c => inScope(c.taskId))
  const failedToday = allFailedToday.filter(r => inScope(r.taskId))

  const verifyFailures = new Map<string, JournalEvent>()
  for (const e of events) if (e.type === 'task.verification_failed') verifyFailures.set(e.entityId, e)
  const problems = attention.data !== undefined ? problemsOf(items, failedToday, tasks, people.data, verifyFailures, new Set([...runningItems.map(r => r.taskId), ...claimItems.map(c => c.taskId)])) : []

  // «Итог»: доведено до проверенного результата из сданных сегодня.
  const verifiedIds = distinct(events, 'task.verified')
  const submittedIds = distinct(events, 'task.completed')
  const changes: SummaryChange[] = verified.slice(-3).reverse().map((e) => {
    const method = methodOf(e)
    return {
      title: <a href={workHref(typeof e.payload.publicId === 'string' ? e.payload.publicId : e.entityId)}>{created.get(e.entityId) ?? tasks.get(e.entityId)?.title ?? (typeof e.payload.publicId === 'string' ? e.payload.publicId : t`Work`)}</a>,
      ...(method !== undefined ? { method, methodText: methodText(method) } : {}),
    }
  })

  // «Поток работы»: стадии по событиям дня, разбивка по видам исполнителей.
  const kindOfActor = (e: JournalEvent): ExecutorKind => actorOf(e.actorId, people.data).kind
  const count = (type: string, kind: (e: JournalEvent) => ExecutorKind): { count: number, byKind: Partial<Record<ExecutorKind, number>> } => {
    const seen = new Map<string, ExecutorKind>()
    for (const e of events) if (e.type === type && !seen.has(e.entityId)) seen.set(e.entityId, kind(e))
    const byKind: Partial<Record<ExecutorKind, number>> = {}
    for (const k of seen.values()) byKind[k] = (byKind[k] ?? 0) + 1
    return { count: seen.size, byKind }
  }
  const originKind = (e: JournalEvent): ExecutorKind => {
    const origin = (e.payload.origin as { kind?: string } | undefined)?.kind
    return origin === 'human' ? 'human' : origin === 'agent' ? 'agent' : 'process'
  }
  const claimedBy = new Map<string, ExecutorKind>()
  for (const e of events) if (e.type === 'task.claimed') claimedBy.set(e.entityId, kindOfActor(e))
  const executing = new Map<string, ExecutorKind>()
  for (const r of runningItems) executing.set(r.taskId, executorKind(people.data?.get(r.principalId)))
  for (const c of claimItems) if (!executing.has(c.taskId)) executing.set(c.taskId, executorKind(people.data?.get(c.holderId)))
  const executingByKind: Partial<Record<ExecutorKind, number>> = {}
  for (const k of executing.values()) executingByKind[k] = (executingByKind[k] ?? 0) + 1
  const reconciled = events.filter(e => e.type === 'work.reconciled' && e.payload.action === 'cancel')
  const stages: WorkPathStage[] = [
    { label: t`Raised`, ...count('task.created', originKind) },
    { label: t`Taken`, ...count('task.claimed', kindOfActor) },
    { label: t`In progress`, count: executing.size, byKind: executingByKind },
    { label: t`Submitted`, ...count('task.completed', kindOfActor) },
    { label: t`Verified`, ...count('task.verified', e => claimedBy.get(e.entityId) ?? 'process') },
    { label: t`Withdrawn`, count: new Set(reconciled.map(e => e.entityId)).size, tail: true },
  ]
  const notTaken = [...distinct(events, 'task.created')].filter(id => !claimedBy.has(id)).length
  const myReview = items.filter(i => i.kind === 'approval.review').length
  const gates: WorkPathGate[] = [
    notTaken > 0 ? { count: notTaken, reason: t`nobody took` } : { count: 0 },
    { count: 0 }, { count: 0 },
    myReview > 0 ? { count: myReview, reason: plural(myReview, { one: 'awaits your acceptance', other: 'await your acceptance' }), mine: true } : { count: 0 },
    { count: 0 },
  ]

  const journal: (JournalEntryProps & { key: string })[] = recent.map((e) => {
    const actor = actorOf(e.actorId, people.data)
    const verb = verbOf(e.type, actor.kind === 'human')
    const why = e.type === 'task.verification_failed' && typeof e.payload.reason === 'string' ? e.payload.reason
      : e.type === 'approval.approved' && e.payload.channel === 'telegram' ? t`in Telegram` : undefined
    return { key: e.id, at: clock(e.occurredAt), actor, verb, object: quote(titleOf(e, created, tasks)), ...(why !== undefined ? { why } : {}) }
  })

  const now = [
    ...runningItems.map(r => ({ key: r.id, who: people.data?.get(r.principalId), taskId: r.taskId, text: t`Attempt #${r.attempt}`, at: r.startedAt ?? r.createdAt })),
    ...claimItems.filter(c => !runningItems.some(r => r.taskId === c.taskId)).map(c => ({ key: c.id, who: people.data?.get(c.holderId), taskId: c.taskId, text: '', at: c.acquiredAt })),
  ]

  const loading = day.isPending || attention.isPending
  const summary = day.data !== undefined
    ? <Summary compact lead={t`Verified today: `} verified={verifiedIds.size} submitted={submittedIds.size} unit={plural(verifiedIds.size, { one: 'work item', other: 'work items' })} {...(decisions.length > 0 ? { waiting: decisions.length } : {})} {...(problems.length > 0 ? { broken: problems.length } : {})} changes={changes} {...(changes.length === 0 ? { empty: submittedIds.size > 0 ? plural(submittedIds.size, { one: 'No verified results today yet — # work item is being checked.', other: 'No verified results today yet — # work items are being checked.' }) : t`No verified results today yet.` } : {})} />
    : null

  return (
    <div className="today-grid" aria-busy={loading}>
      {/* Видимый заголовок «Сегодня» — в строке состояния; здесь — для экранного диктора и навигации по заголовкам. */}
      <h1 className="tc-sr">{t`Today`}</h1>
      <div className="today-col">
        <Zone label={t`Summary`} className="fixed today-z-summary">{summary}{day.data?.partial === true ? <p className="tc-muted today-note">{t`Today's journal is longer than the console reads at once: the numbers cover the last hours.`}</p> : null}</Zone>
        {problems.length > 0
          ? (
            <Zone title={t`Broken / stuck`} count={problems.length} tone="problem" className="fixed today-z-problems">
              <div className="today-problems">
                {problems.map(p => (
                  <ProblemCard key={p.key} row severity={p.severity} diagnosis={p.href !== undefined ? <a href={p.href}>{p.diagnosis}</a> : p.diagnosis}
                    {...(p.where !== undefined ? { where: p.where } : {})} {...(p.since !== undefined ? { since: p.since } : {})} />
                ))}
              </div>
            </Zone>
          )
          : null}
        <Zone title={t`Work flow`} count={t`today`} className="fixed today-path today-z-flow">
          <WorkPath look="flow" stages={stages} gates={gates} />
        </Zone>
        <Zone title={t`What happened`} className="fill today-z-journal" action={<a className="st-link-btn" href={`${BASE_PATH}/journal`}>{t`Whole journal`}</a>}>
          <div className="tc-journal">
            {journal.length > 0 ? journal.map(({ key, ...j }) => <JournalEntry key={key} {...j} />) : <p className="tc-muted">{t`The journal is quiet today so far.`}</p>}
          </div>
        </Zone>
      </div>
      <aside className="today-col" aria-label={t`Decisions and executors`}>
        {decisions.length > 0 || decidedHere ? <Decisions items={decisions} people={people.data} onDecided={() => setDecidedHere(true)} /> : null}
        <Zone title={t`In progress now`} count={now.length} className="fill today-z-now">
          {now.length > 0
            ? (
              <ul className="today-now">
                {now.map((n) => {
                  const task = tasks.get(n.taskId)
                  const phrase = [n.text, task !== undefined ? quote(task.title) : null, since(n.at)].filter(Boolean).join(' · ')
                  return (
                    <li key={n.key}>
                      <IdentityBlock kind={executorKind(n.who)} name={n.who?.displayName ?? t`Executor`} now={phrase} size="sm" />
                      <StatusMark status="running" label={executorKind(n.who) === 'human' ? t`working` : t`executing`} />
                    </li>
                  )
                })}
              </ul>
            )
            : <p className="tc-muted">{t`Nobody is executing anything right now.`}</p>}
        </Zone>
      </aside>
    </div>
  )
}
