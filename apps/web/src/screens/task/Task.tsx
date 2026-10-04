import {
  Button, Chronicle, DecisionCard, DecisionStatus, DegradedBanner, EmptyState, Icon, IdentityBlock, Seals, StatusMark, Zone,
  type ChronicleView, type SealsProps, type Status,
} from '@console/ui'
import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ApiError, BASE_PATH, cpGet, cpPost } from '../../api/client.ts'
import { executorKind, taskQuery, useMe, usePrincipals, useTasks } from '../../api/directory.ts'
import type { Approval, Artifact, Attention, EventPage, Page, Principal, Run, Task as TaskOut, TaskComment, TaskRelation, Verification } from '../../api/types.ts'
import { DeclineDialog } from '../../decisions/DeclineDialog.tsx'
import { useDecision } from '../../decisions/useDecision.ts'
import { since } from '../../lib/format.ts'
import { evidence, executor, initials, origin, processRef, readinessOf, signature, statusLabelOf, statusOf, workHref } from '../work/rows.ts'
import { viewHref } from '../view/ViewScreen.tsx'
import { useViews } from '../../api/views.ts'
import { buildHistory, when } from './history.ts'
import { StepForm, useStepForm } from '../../forms/StepForm.tsx'
import { Protocol } from './Protocol.tsx'
import { IMPORT_TYPE } from '../knowledge/importFlow.ts'
import { ImportPlan } from './ImportPlan.tsx'
import { DocumentFields } from './DocumentFields.tsx'
import { DOCUMENT_TYPE } from '../knowledge/documentFlow.ts'
import { changedAfter, Problem } from './Problem.tsx'
import { TaskActions, type Action } from './TaskActions.tsx'
import { useTaskRoles, vacantRoles } from '../../api/roles.ts'
import './task.css'

/**
 * Экран одной работы (docs/screens/task.md): путь, шапка со статусом и фразой готовности,
 * четыре печати, решение и материалы слева, сведения и связанная работа справа, история
 * и комментарий внизу. Только реализованный API ядра; историю консоль склеивает сама.
 *
 * Управляющих кнопок шапки («Передать», «Снять», «Изменить») пока нет: у каждой —
 * последствия до нажатия (сценарий 421), это отдельный шаг.
 */

type Directory = Map<string, Principal> | undefined

const list = <T,>(path: string) => ({ signal }: { signal: AbortSignal }) => cpGet<Page<T>>(path, signal).then(p => p.items)

export function Task({ taskRef, act }: { taskRef: string, act?: Action }) {
  useLingui()
  const task = useQuery(taskQuery(taskRef))
  if (task.isPending) return <div className="tk" aria-busy="true"><p className="tc-muted">{t`Loading the work…`}</p></div>
  if (task.isError) {
    const missing = task.error instanceof ApiError && task.error.status === 404
    return (
      <div className="tk">
        <Crumbs number={taskRef} />
        {missing
          ? <EmptyState title={t`Work not found`} body={t`It may have been removed, or you have no access to its workspace.`} />
          : <DegradedBanner.Section text={t`Could not load the work: no connection to the core.`} />}
      </div>
    )
  }
  return <TaskPage task={task.data} {...(act !== undefined ? { act } : {})} />
}

function Crumbs({ number }: { number: string }) {
  return (
    <nav className="tk-crumbs" aria-label={t`Path`}>
      <a href={`${BASE_PATH}/work`}>{t`← Work`}</a>
      <span aria-hidden="true">·</span>
      <span className="tc-mono">{number}</span>
    </nav>
  )
}

function TaskPage({ task, act }: { task: TaskOut, act?: Action }) {
  const me = useMe().data?.principal.id
  const people = usePrincipals().data
  const id = task.id
  const types = useQuery({ queryKey: ['task-types'], staleTime: 5 * 60_000, queryFn: ({ signal }) => cpGet<Page<{ key: string, displayName: string }>>('/task-types?limit=200', signal) })
  const approvals = useQuery({ queryKey: ['approvals', 'task', id], queryFn: list<Approval>(`/approvals?taskId=${id}&limit=50`) })
  const verifications = useQuery({ queryKey: ['task', id, 'verifications'], queryFn: list<Verification>(`/tasks/${id}/verifications?limit=20`) })
  const runs = useQuery({ queryKey: ['runs', 'task', id], queryFn: list<Run>(`/runs?taskId=${id}&limit=50`) })
  const comments = useQuery({ queryKey: ['task', id, 'comments'], queryFn: list<TaskComment>(`/tasks/${id}/comments?limit=100`) })
  const relations = useQuery({ queryKey: ['task', id, 'relations'], queryFn: list<TaskRelation>(`/tasks/${id}/relations`) })
  const artifacts = useQuery({ queryKey: ['artifacts', 'task', id], queryFn: list<Artifact>(`/artifacts?taskId=${id}&limit=50`) })
  const events = useQuery({ queryKey: ['task', id, 'events'], queryFn: ({ signal }) => cpGet<EventPage>(`/events?entityType=task&entityId=${id}&limit=200`, signal).then(p => p.items) })
  const attention = useQuery({ queryKey: ['attention'], queryFn: ({ signal }) => cpGet<Attention>('/me/attention', signal) })

  const myDecision = attention.data?.items.find(i => i.taskId === id && i.entity.type === 'approval' && i.kind !== 'approval.undecidable')
  const pendingMine = approvals.data?.find(a => a.id === myDecision?.entity.id)
  const lastVerification = verifications.data?.[0]
  const assigneeKind = task.assigneeId !== null ? executorKind(people?.get(task.assigneeId)) : undefined
  const readiness = readinessOf(task)
  const stepForm = useStepForm(task)

  const seals: SealsProps = {
    labelled: true,
    origin: origin(task, people),
    executor: executor(task, people),
    evidence: evidenceOf(task, lastVerification),
    signature: signature(task, approvals.data ?? [], people, me),
  }
  // Протоколы попыток — в ящики истории; в «Материалах» их нет.
  const transcripts = (artifacts.data ?? []).filter(a => a.type === 'transcript' && a.runId !== null)
  const materials = artifacts.data?.filter(a => a.type !== 'transcript')
  const boxes = new Map(transcripts.map(a => [a.runId!, <Protocol key={a.id} artifact={a} />]))
  const history = buildHistory({
    task, people, me, boxes,
    events: events.data ?? [], runs: runs.data ?? [], verifications: [...(verifications.data ?? [])].reverse(),
    approvals: approvals.data ?? [], comments: comments.data ?? [],
  })
  const [view, setView] = useState<ChronicleView>('brief')
  // `?act=handoff` — «Назначить» со строки «Работы» открывает «Передать» сразу.
  const [action, setAction] = useState<Action | null>(act !== undefined && !task.systemStatusCategory.startsWith('terminal') ? act : null)
  const roles = useTaskRoles(task)
  const failedAt = lastVerification?.status === 'failed' ? lastVerification.finishedAt : null
  const changedAfterFailure = changedAfter(failedAt, comments.data ?? [], artifacts.data ?? [])
  const open = !task.systemStatusCategory.startsWith('terminal')
  const typeName = types.data?.items.find(ty => ty.key === task.typeKey)?.displayName ?? task.typeKey
  const tree = useQuery({ queryKey: ['workspaces', 'tree', 'all'], staleTime: 5 * 60_000, queryFn: ({ signal }) => cpGet<{ roots: WorkspaceNode[] }>('/workspaces/tree?includeProjects=false', signal) })
  const space = task.workspaceId !== null ? findWorkspace(tree.data?.roots ?? [], task.workspaceId) : undefined

  return (
    <div className="tk">
      <Crumbs number={task.publicId} />
      <div className="tk-head">
        <TaskActions task={task} open={action} onOpen={setAction} changedAfterFailure={changedAfterFailure} />
        <StatusMark status={myDecision !== undefined ? 'waiting_human' : statusOf(task, assigneeKind)} {...(myDecision !== undefined ? { label: t`waiting for you`, mine: true } : statusLabelOf(task) !== undefined ? { label: statusLabelOf(task)! } : {})} />
        <h1 className="tk-title">{task.title}</h1>
        {readiness !== undefined ? <p className="tk-ready">{readiness}</p> : null}
      </div>
      <div className="tk-seals"><Seals {...seals} /></div>

      <div className="tk-grid">
        <div className="tk-col">
          {open && verifications.data !== undefined && (task.systemStatusCategory === 'blocked' || lastVerification?.status === 'failed')
            ? (
              <Zone title={t`Problem`} tone="problem" className="tk-z-problem">
                <Problem task={task} verifications={verifications.data} onAction={setAction} />
              </Zone>
            )
            : null}
          {task.typeKey === IMPORT_TYPE && artifacts.data !== undefined
            ? (
              <Zone title={t`Load plan`} className="tk-z-plan">
                <ImportPlan task={task} artifacts={artifacts.data} approvals={approvals.data ?? []} />
              </Zone>
            )
            : null}
          {task.typeKey === DOCUMENT_TYPE
            ? (
              <Zone title={t`Document fields`} className="tk-z-doc">
                <DocumentFields task={task} decisionPending={myDecision !== undefined} />
              </Zone>
            )
            : null}
          {myDecision !== undefined
            ? (
              <Zone title={t`Waiting for your sign-off`} tone="human" className="tk-z-decision">
                <Decision approvalId={myDecision.entity.id} review={myDecision.kind === 'approval.review'} title={myDecision.title} approval={pendingMine} people={people} verification={lastVerification} />
              </Zone>
            )
            : null}
          {stepForm.form !== undefined
            ? (
              <Zone title={t`Process step`} {...(task.systemStatusCategory.startsWith('terminal') ? {} : { tone: 'human' as const })} className="tk-z-step">
                <StepForm task={task} form={stepForm.form} />
              </Zone>
            )
            : null}
          <Zone title={t`Materials`} {...(materials !== undefined ? { count: materials.length } : {})} className="tk-z-materials">
            {artifacts.isError ? <DegradedBanner.Section /> : <Materials items={materials} people={people} />}
          </Zone>
        </div>
        <div className="tk-col">
          <Zone title={t`Details`} className="tk-z-details">
            <dl className="tc-props">
              <dt>{t`Type of work`}</dt><dd>{typeName}</dd>
              <dt>{t`Owner`}</dt><dd>{person(task.ownerId, people, me) ?? <span className="tc-muted">{t`not set`}</span>}</dd>
              <dt>{t`Executes`}</dt><dd>{person(task.assigneeId, people, me) ?? <span className="tc-muted">{t`not assigned`}</span>}</dd>
              {roles.required.length > 0
                ? <><dt>{t`Role`}</dt><dd>{roles.required.map(r => r.name).join(', ')}{vacantRoles(roles.required, roles.holders).length > 0 ? <span className="tk-overdue"> · {t`nobody holds it`}</span> : null}</dd></>
                : null}
              {space !== undefined ? <><dt>{t`Workspace`}</dt><dd>{space}</dd></> : null}
              <dt>{t`Due`}</dt><dd>{task.dueDate ? <>{when(task.dueDate)}{new Date(task.dueDate) < new Date() && task.completedAt === null ? <span className="tk-overdue"> · {t`overdue`}</span> : null}</> : <span className="tc-muted">{t`no due date`}</span>}</dd>
              {task.startDate ? <><dt>{t`Start`}</dt><dd>{when(task.startDate)}</dd></> : null}
              <dt>{t({ id: 'task.details.raised', message: 'Raised' })}</dt><dd>{when(task.createdAt)}</dd>
              {task.completedAt ? <><dt>{t({ id: 'task.details.done', message: 'Done' })}</dt><dd>{when(task.completedAt)}</dd></> : null}
            </dl>
          </Zone>
          <Zone title={t`Related work`} className="tk-z-related">
            <Related relations={relations.data} self={id} people={people} processCase={processRef((task.origin as { ref?: string }).ref)} />
          </Zone>
        </div>
      </div>

      <Zone title={t`History`} className="tk-z-history" action={<a className="st-link-btn" href={`${BASE_PATH}/journal?entityType=task&entityId=${id}`}>{t`In the journal`}</a>}>
        <Chronicle view={view} onView={setView} groups={history.groups} spans={history.spans} events={history.events} />
        <Compose taskId={id} />
      </Zone>
    </div>
  )
}

interface WorkspaceNode { id: string, name: string, children?: WorkspaceNode[] }
/** Путь пространства от корня: «Полярис / Финансы». */
function findWorkspace(nodes: WorkspaceNode[], id: string, path: string[] = []): string | undefined {
  for (const n of nodes) {
    const here = [...path, n.name]
    if (n.id === id) return here.join(' / ')
    const deeper = findWorkspace(n.children ?? [], id, here)
    if (deeper !== undefined) return deeper
  }
  return undefined
}

/** Печать «чем доказано» с подробностью проверки: «автопроверкой 3/4». */
function evidenceOf(task: TaskOut, v: Verification | undefined): SealsProps['evidence'] {
  const base = evidence(task)
  if (v === undefined || base === null || base === undefined) return base
  const passed = v.results.filter(r => r.status === 'passed').length
  const total = v.checks.length
  if (v.status === 'passed') return { method: 'auto', text: t`verified ${passed}/${total}` }
  if (v.status === 'failed') {
    const attempt = v.attempt
    return { method: 'failed', text: t`failed, attempt ${attempt}` }
  }
  if (v.status === 'waiting_human' || v.status === 'waiting_external' || v.status === 'running') return { method: 'pending', text: t`checks passed ${passed}/${total}` }
  return base
}

function person(id: string | null, people: Directory, me: string | undefined): ReactNode {
  if (id === null) return null
  const p = people?.get(id)
  const name = p?.displayName ?? t`Participant`
  return <IdentityBlock kind={executorKind(p)} name={id === me ? t`${name} (you)` : name} label={initials(name)} inline size="sm" />
}

function Decision({ approvalId, review, title, approval, people, verification }: { approvalId: string, review: boolean, title: string, approval: Approval | undefined, people: Directory, verification: Verification | undefined }) {
  const { rows, decide } = useDecision(approvalId, review)
  const [declining, setDeclining] = useState(false)
  const requester = approval !== undefined ? people?.get(approval.requestedByPrincipalId) : undefined
  const done = new Map((verification?.results ?? []).map(r => [r.key, r.status]))
  const preconditions = (verification?.checks ?? []).filter(c => c.kind !== 'human').map(c => ({ ok: done.get(c.key) === 'passed', text: c.description ?? c.key }))
  const at = since(approval?.createdAt)
  return (
    <>
      <DecisionCard
        compact
        kind={review ? t`Acceptance` : t`Approval`}
        title={title}
        holds={approval?.gate === true}
        {...(at !== undefined ? { since: at } : {})}
        {...(requester !== undefined ? { requester: { kind: executorKind(requester), name: requester.displayName } } : {})}
        why={approval?.assignedPrincipalId !== null && approval?.assignedPrincipalId !== undefined ? t`the decision is assigned to you.` : t`you hold the role that decides.`}
        {...(preconditions.length > 0 ? { preconditions } : {})}
        primary={review ? t`Accept` : t`Approve`}
        secondary={review ? t`Return` : t`Decline`}
        kbd="E"
        onPrimary={() => decide('approve')}
        onSecondary={() => setDeclining(true)}
        {...(rows !== null ? { footer: <DecisionStatus rows={rows} /> } : {})}
      />
      {declining ? <DeclineDialog title={title} review={review} onConfirm={reason => decide('reject', reason)} onClose={() => setDeclining(false)} /> : null}
    </>
  )
}

/** Материалы работы: каждый открывает страницу документа (сам документ, источник, кто добавил). */
function Materials({ items, people }: { items: Artifact[] | undefined, people: Directory }) {
  if (items === undefined) return <p className="tc-muted">{t`Loading…`}</p>
  if (items.length === 0) return <p className="tc-muted">{t`No materials yet.`}</p>
  return (
    <ul className="tc-linklist">
      {items.map((a) => {
        const name = a.name || a.type
        const who = people?.get(a.createdByPrincipalId)?.displayName
        const meta = typeof a.sizeBytes === 'number' ? size(a.sizeBytes) : who
        return (
          <li key={a.id}>
            <Icon name="file" />
            <a href={`${BASE_PATH}/documents/${a.id}`}>{name}</a>
            {meta !== undefined ? <span className="tc-age">{meta}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

function size(bytes: number): string {
  if (bytes < 1024) return t`${bytes} B`
  const kb = Math.round(bytes / 1024)
  if (kb < 1024) return t`${kb} KB`
  const mb = (bytes / 1024 / 1024).toFixed(1)
  return t`${mb} MB`
}

function relationText(type: string, outgoing: boolean): string {
  switch (type) {
    case 'depends_on': return outgoing ? t`depends on it` : t`depends on this`
    case 'blocks': return outgoing ? t`blocked by this` : t`blocks this`
    case 'parent_of': case 'parent': return outgoing ? t`part of this work` : t`includes this`
    case 'duplicates': return t`duplicate`
    default: return type.replace(/_/g, ' ')
  }
}

interface ProcessInstance { id: string, definitionKey: string, instanceKey: string, status: 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled' | (string & {}), stages?: { key?: string, title?: string, displayName?: string, state?: string, status?: string }[] }

function processStatus(status: string): { mark: Status, label: string } {
  switch (status) {
    case 'completed': return { mark: 'verified', label: t`case closed` }
    case 'failed': return { mark: 'failed', label: t`case failed` }
    case 'cancelled': return { mark: 'stale', label: t`case cancelled` }
    case 'suspended': return { mark: 'paused', label: t`case suspended` }
    default: return { mark: 'running', label: t`case in progress` }
  }
}

/** Дело процесса, шаг которого завёл работу: экземпляр из ядра, ссылка — на экран пакета, если он объявлен. */
function ProcessCase({ instanceId, step }: { instanceId: string, step: string }) {
  const instance = useQuery({ queryKey: ['process-instance', instanceId], staleTime: 30_000, queryFn: ({ signal }) => cpGet<ProcessInstance>(`/process-instances/${instanceId}`, signal) })
  const views = useViews()
  if (instance.isError) return <li><span className="tc-muted">{t`The process case is not available`}</span></li>
  if (instance.data === undefined) return <li><span className="tc-muted">{t`Loading…`}</span></li>
  const p = instance.data
  const view = views.data?.find(v => v.source.process === p.definitionKey && v.source.instance === true)
  const { mark, label } = processStatus(p.status)
  const name = t`Case ${p.instanceKey}`
  return (
    <li>
      <StatusMark status={mark} label={label} pill={false} />
      {view !== undefined ? <a href={viewHref(view.key, p.id)}>{name}</a> : <span>{name}</span>}
      <span className="tc-age">{t`process ${p.definitionKey}, step ${step}`}</span>
    </li>
  )
}

function Related({ relations, self, people, processCase }: { relations: TaskRelation[] | undefined, self: string, people: Directory, processCase: { instanceId: string, step: string } | undefined }) {
  const others = (relations ?? []).map(r => ({ r, other: r.fromTaskId === self ? r.toTaskId : r.fromTaskId, outgoing: r.fromTaskId === self }))
  const tasks = useTasks(others.map(o => o.other))
  if (relations === undefined && processCase === undefined) return <p className="tc-muted">{t`Loading…`}</p>
  if (others.length === 0 && processCase === undefined) return <p className="tc-muted">{t`No related work.`}</p>
  return (
    <ul className="tc-linklist">
      {processCase !== undefined ? <ProcessCase {...processCase} /> : null}
      {others.map(({ r, other, outgoing }) => {
        const task = tasks.get(other)
        const kind = task?.assigneeId ? executorKind(people?.get(task.assigneeId)) : undefined
        return (
          <li key={r.id}>
            {task !== undefined ? <StatusMark status={statusOf(task, kind)} pill={false} /> : null}
            {task !== undefined ? <a href={workHref(task.publicId)}>{task.title}</a> : <span className="tc-muted">{t`Work is not available`}</span>}
            <span className="tc-age">{relationText(r.type, outgoing)}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Комментарий: виден всем, кто связан с работой; запись — в ядре, история перечитывается. */
function Compose({ taskId }: { taskId: string }) {
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: (body: string) => cpPost<TaskComment>(`/tasks/${taskId}/comments`, { body }, crypto.randomUUID()),
    onSuccess: () => {
      setText('')
      setError(null)
      void client.invalidateQueries({ queryKey: ['task', taskId] })
    },
    onError: (e) => {
      const reason = e instanceof ApiError ? e.detail ?? e.code : ''
      setError(e instanceof ApiError && e.kind === 'client' ? t`The core did not accept the comment: ${reason}` : t`Not sent: no connection to the core`)
    },
  })
  const submit = (): void => { if (text.trim() !== '' && !send.isPending) send.mutate(text.trim()) }
  return (
    <form className="tk-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={t`Write a comment…`} aria-label={t`Comment on the work`} rows={1}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
      <div className="tk-compose-bar">
        <span role={error !== null ? 'alert' : undefined}>{error ?? t`Everyone involved in the work will see the comment`}</span>
        <Button type="submit" variant="secondary" size="sm" disabled={text.trim() === '' || send.isPending}>{send.isPending ? t`Sending…` : t`Send`}</Button>
      </div>
    </form>
  )
}
