import { Button, Callout, Combobox, Consequences, DecisionStatus, Dialog, Field, type ConsequenceItem, type DecisionStatusRow } from '@console/ui'
import { i18n } from '@lingui/core'
import { t } from '@lingui/core/macro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ApiError, cpGet, cpPatch, cpPost } from '../../api/client.ts'
import { useMe, usePrincipals } from '../../api/directory.ts'
import { executorMeta, useExecutors } from '../../api/executors.ts'
import { assignRole, missingRoles, useTaskRoles, vacantRoles, withoutRoles } from '../../api/roles.ts'
import { initials } from '../work/rows.ts'
import type { Page, Run, Task } from '../../api/types.ts'
import { clock } from '../../lib/format.ts'

/**
 * Управляющие действия работы (docs/screens/scenario-421.md, шаги 1–3): «Передать»,
 * «Снять», «Изменить» и «Повторить как было» (из блока «Проблема»: остановленная работа
 * возвращается в статус возврата своего типа — `lifecycleSchema.releaseStatus` — и
 * исполнитель берёт её снова). У каждого — последствия до кнопки, а нажатие — ещё не действие:
 * шаги идут строками состояния, «записано в ядре» — только после ответа ядра.
 *
 * Ядро не даёт менять работу под живым захватом исполнителя (`409 task_claimed`), поэтому
 * «Передать» и «Снять» идут шагами: остановить попытку (`:request-cancel`, кооперативно) →
 * отпустить захват (`:release`, право `claims.manage`) → перечитать версию → `PATCH` с
 * `If-Match`. «Изменить» под захватом меняет только то, что исполнителю не мешает, — и
 * тоже через ядро, которое само откажет, если нельзя.
 */

export type Action = 'handoff' | 'cancel' | 'edit' | 'retry'
interface Target { status: string, displayName: string, systemStatusCategory: string, route: string }
interface Transitions { targets: Target[] }

function reasonOf(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  switch (error.code) {
    case 'version_conflict': return t`someone changed the work meanwhile — reopen it and try again`
    case 'task_claimed': return t`the executor still holds the work`
    case 'claim_holder_mismatch': case 'forbidden': return t`you have no right to take the work from the executor`
    case 'invalid_transition': return t`the type of work does not allow this status now`
    case 'org_manage_required': return t`you have no right to give roles — ask the administrator, or assign without the role`
    case 'unknown_requirement': return t`the role is no longer known in the space of the work`
    default: return error.detail ?? error.code
  }
}

interface Lifecycle { releaseStatus?: string, initialStatus?: string }
/** Тип работы: статус возврата и исполнение скиллом (кому можно передать). Один кэш на экран. */
const useTaskType = (typeId: string) => useQuery({
  queryKey: ['task-type', typeId], staleTime: 5 * 60_000,
  queryFn: ({ signal }) => cpGet<{ lifecycleSchema?: Lifecycle, execution?: { skill?: string } | null }>(`/task-types/${typeId}`, signal),
})

/** Куда вернуть остановленную работу: статус возврата типа, иначе начальный — если тип пускает. */
export function retryTargetOf(targets: Target[], lifecycle: Lifecycle | undefined): Target | undefined {
  for (const key of [lifecycle?.releaseStatus, lifecycle?.initialStatus]) {
    const found = targets.find(x => x.status === key && x.route === 'update' && !x.systemStatusCategory.startsWith('terminal') && x.systemStatusCategory !== 'blocked')
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * `open` и `onOpen` — снаружи: те же диалоги открывает блок «Проблема». `changedAfterFailure` —
 * менялось ли что-то у работы после провала (иначе повтор, скорее всего, даст тот же итог).
 */
export function TaskActions({ task, open, onOpen, changedAfterFailure = false }: { task: Task, open: Action | null, onOpen: (a: Action | null) => void, changedAfterFailure?: boolean }) {
  const setOpen = onOpen
  const transitions = useQuery({ queryKey: ['task', task.id, 'transitions'], queryFn: ({ signal }) => cpGet<Transitions>(`/tasks/${task.id}/transitions`, signal) })
  const type = useTaskType(task.typeId)
  if (task.systemStatusCategory.startsWith('terminal')) return null
  const cancelTarget = transitions.data?.targets.find(x => x.systemStatusCategory === 'terminal_cancelled' && x.route === 'update')
  const retryTarget = retryTargetOf(transitions.data?.targets ?? [], type.data?.lifecycleSchema)
  return (
    <>
      <div className="tk-tools">
        <Button variant="ghost" size="sm" onClick={() => setOpen('handoff')}>{t`Hand over`}</Button>
        <Button variant="ghost" size="sm" disabled={cancelTarget === undefined} title={cancelTarget === undefined && transitions.isSuccess ? t`The type of work has no “withdrawn” status` : undefined} onClick={() => setOpen('cancel')}>{t`Withdraw`}</Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen('edit')}>{t`Edit`}</Button>
      </div>
      {open !== null ? <ActionDialog action={open} task={task} cancelTarget={cancelTarget} retryTarget={retryTarget} changedAfterFailure={changedAfterFailure} statusTargets={(transitions.data?.targets ?? []).filter(x => x.route === 'update' && x.systemStatusCategory !== 'terminal_cancelled')} onClose={() => setOpen(null)} /> : null}
    </>
  )
}

const toLocal = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/**
 * `statusTargets` — переходы типа, которые делаются правкой (`route: update`), кроме снятия:
 * сдача на проверку (`route: complete`) — дело исполнителя, снятие — отдельной кнопкой.
 */
function ActionDialog({ action, task, cancelTarget, retryTarget, changedAfterFailure, statusTargets, onClose }: { action: Action, task: Task, cancelTarget: Target | undefined, retryTarget: Target | undefined, changedAfterFailure: boolean, statusTargets: Target[], onClose: () => void }) {
  const client = useQueryClient()
  const me = useMe().data?.principal.id
  const people = usePrincipals().data
  const running = useQuery({ queryKey: ['runs', 'task', task.id, 'running'], queryFn: ({ signal }) => cpGet<Page<Run>>(`/runs?taskId=${task.id}&status=running&limit=5`, signal).then(p => p.items) })
  const run = running.data?.[0]
  const claimed = task.activeClaimId !== null
  const holder = task.assigneeId !== null ? people?.get(task.assigneeId)?.displayName : undefined

  const humans = [...(people?.values() ?? [])].filter(p => p.kind === 'human' && p.status === 'active').sort((a, b) => a.displayName.localeCompare(b.displayName))
  // Кому передать — тем, кто может брать этот тип работы в её пространстве.
  const typeInfo = useTaskType(task.typeId).data
  const { executors } = useExecutors({ id: task.typeId, key: task.typeKey, execution: typeInfo?.execution ?? null }, task.workspaceId)
  const [to, setTo] = useState('')
  // Роль у работы — правило подбора: у кого нет роли, тому её дают или снимают требование с работы.
  const roles = useTaskRoles(task)
  const [roleMode, setRoleMode] = useState<'grant' | 'bypass'>('grant')
  const lacking = to !== '' ? missingRoles(to, roles.required, roles.holders) : []
  const vacant = vacantRoles(roles.required, roles.holders)
  const roleNames = (list: { name: string }[]): string => list.map(r => i18n.locale === 'ru' ? `«${r.name}»` : `“${r.name}”`).join(', ')
  const [note, setNote] = useState('')
  const [title, setTitle] = useState(task.title)
  const [due, setDue] = useState(toLocal(task.dueDate))
  const [owner, setOwner] = useState(task.ownerId ?? '')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const step = (text: string): void => setRows(r => [...r.filter(x => x.state !== 'wait'), { state: 'wait', text, at: clock(new Date()) }])
  const ok = (text: string): void => setRows(r => [...r.filter(x => x.state !== 'wait'), { state: 'done', text, at: clock(new Date()) }])

  /** Освободить работу от исполнителя: остановить попытку и отпустить захват. */
  const free = async (): Promise<void> => {
    if (run !== undefined) {
      step(t`Asking the executor to stop the attempt…`)
      await cpPost(`/runs/${run.id}:request-cancel`, { reason: note.trim() || t`stopped from the console` })
      ok(t`Stop requested — the protocol of the attempt is kept`)
    }
    if (claimed) {
      step(t`Releasing the work from the executor…`)
      await cpPost(`/claims/${task.activeClaimId}:release`, { reason: action === 'cancel' ? 'withdrawn' : action === 'retry' ? 'retried' : 'handed-over' })
      ok(t`Released — recorded in the core`)
    }
  }
  const fresh = async (): Promise<Task> => cpGet<Task>(`/tasks/${task.id}`)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setRows([])
    try {
      if (action === 'handoff') {
        await free()
        if (lacking.length > 0 && roleMode === 'grant') {
          for (const r of lacking) {
            const name = r.name
            step(t`Giving the role “${name}”…`)
            try {
              await assignRole(to, r.id, task.workspaceId)
            } catch (error) {
              throw error instanceof ApiError && error.kind === 'forbidden' ? new ApiError(403, 'org_manage_required') : error
            }
            ok(t`Role “${name}” given — recorded in the core`)
          }
        }
        step(t`Assigning…`)
        const current = await fresh()
        const bypass = lacking.length > 0 && roleMode === 'bypass' && roles.requirements !== undefined
        await cpPatch(`/tasks/${task.id}`, { assigneeId: to, ...(bypass ? { requirements: withoutRoles(roles.requirements!, lacking.map(r => r.slug)) } : {}) }, current.version)
        ok(bypass ? t`Handed over without the role — the requirement is removed from this work` : t`Handed over — recorded in the core`)
        if (bypass) {
          step(t`Recording why…`)
          const names = roleNames(lacking)
          await cpPost(`/tasks/${task.id}/comments`, { body: t`Assigned without the role ${names}.` + (note.trim() !== '' ? `\n\n${note.trim()}` : '') }, crypto.randomUUID())
          ok(t`Recorded in the history of the work`)
        }
      } else if (action === 'cancel' && cancelTarget !== undefined) {
        await free()
        step(t`Withdrawing…`)
        const current = await fresh()
        await cpPatch(`/tasks/${task.id}`, { status: cancelTarget.status }, current.version)
        ok(t`Withdrawn — recorded in the core`)
      } else if (action === 'retry' && retryTarget !== undefined) {
        await free()
        step(t`Returning the work to the executor…`)
        const current = await fresh()
        await cpPatch(`/tasks/${task.id}`, { status: retryTarget.status }, current.version)
        ok(t`Returned — the executor takes it again`)
      } else if (action === 'edit') {
        step(t`Saving…`)
        const body: Record<string, unknown> = {}
        if (title.trim() !== task.title) body.title = title.trim()
        const dueIso = due === '' ? null : new Date(due).toISOString()
        if (dueIso !== (task.dueDate ?? null) && toLocal(dueIso) !== toLocal(task.dueDate)) body.dueDate = dueIso
        if (owner !== (task.ownerId ?? '')) body.ownerId = owner || null
        if (status !== '') body.status = status
        if (Object.keys(body).length > 0) await cpPatch(`/tasks/${task.id}`, body, task.version)
        ok(Object.keys(body).length > 0 ? t`Saved — recorded in the core` : t`Nothing changed`)
      }
      const noteInBypass = action === 'handoff' && lacking.length > 0 && roleMode === 'bypass'
      if (note.trim() !== '' && action !== 'edit' && !noteInBypass) {
        step(t`Adding the comment…`)
        await cpPost(`/tasks/${task.id}/comments`, { body: note.trim() }, crypto.randomUUID())
        ok(t`Comment added`)
      }
      setDone(true)
    } catch (error) {
      const reason = reasonOf(error)
      setRows(r => [...r.filter(x => x.state !== 'wait'), { state: 'fail', text: t`Not recorded: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: ['task'] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['runs'] })
    }
  }

  const attempt: ConsequenceItem = run !== undefined
    ? { tone: 'warn', k: t`Current attempt`, v: t`will be asked to stop; what is already done stays, the protocol is kept` }
    : { tone: 'ok', k: t`Current attempt`, v: t`none is running` }
  const external: ConsequenceItem = { tone: 'warn', k: t`What is already done outside`, v: t`is not rolled back: the core does not undo actions in other systems` }

  let dialogTitle: string
  let items: ConsequenceItem[]
  let primary: string
  let ready: boolean
  let body: ReactNode
  if (action === 'handoff') {
    const target = people?.get(to)
    dialogTitle = t`Hand over the work`
    items = [
      attempt,
      ...(claimed ? [{ tone: 'info' as const, k: t`Executor`, v: holder !== undefined ? t`${holder} stops holding the work` : t`the current executor stops holding the work` }] : []),
      { tone: 'info', k: t`New executor`, v: target !== undefined ? t`${target.displayName} gets the work with its history and materials` : t`choose who gets the work` },
      ...(lacking.length > 0 && target !== undefined
        ? [roleMode === 'grant'
            ? { tone: 'info' as const, k: t`Role`, v: t`${target.displayName} gets ${roleNames(lacking)} in this space — for other work there too` }
            : { tone: 'warn' as const, k: t`Role`, v: t`the requirement ${roleNames(lacking)} is removed from this work; the history shows who did it and why` }]
        : []),
      { tone: 'ok', k: t`Reversible`, v: t`yes — the work can be handed over again` },
    ]
    primary = t`Hand over`
    ready = to !== '' && to !== task.assigneeId
    body = (
      <div className="tc-form">
        <Field label={t`To whom`} wide>
          <Combobox label={t`To whom`} value={to === '' ? null : to} onChange={v => setTo(v ?? '')} placeholder={t`choose a person or an agent`}
            emptyText={t`Nobody here can take this type of work`}
            options={executors.filter(e => e.id !== task.assigneeId).map((e) => {
              const missing = missingRoles(e.id, roles.required, roles.holders)
              const meta = [executorMeta(e), missing.length > 0 ? t`no role ${roleNames(missing)}` : ''].filter(Boolean).join(' · ')
              return { value: e.id, label: e.id === me ? t`${e.displayName} (you)` : e.displayName, search: e.displayName, kind: e.kind === 'human' ? 'human' as const : e.kind === 'agent' ? 'agent' as const : 'process' as const, glyph: initials(e.displayName), meta }
            })} />
        </Field>
        {roles.required.length > 0
          ? <p className="tc-field-help tk-roles-note">{t`The work requires the role ${roleNames(roles.required)}: whoever lacks it cannot take the work. Authority is separate — the core checks it at the action, assigning does not give it.`}</p>
          : null}
        {vacant.length > 0 && lacking.length === 0
          ? <div className="tk-wide"><Callout><b>{t`Nobody in the organization holds the role ${roleNames(vacant)}.`}</b> {t`Choose who gets the work: you can give them the role, or assign without the role.`}</Callout></div>
          : null}
        {lacking.length > 0 && target !== undefined
          ? (
            <fieldset className="tk-role-choice">
              <legend>{vacant.length > 0 ? t`Nobody holds the role ${roleNames(vacant)}; ${target.displayName} does not have it either` : t`${target.displayName} does not have the role ${roleNames(lacking)}`}</legend>
              <label><input type="radio" name="role-mode" checked={roleMode === 'grant'} onChange={() => setRoleMode('grant')} /> {t`Give ${target.displayName} the role ${roleNames(lacking)}`}</label>
              <label><input type="radio" name="role-mode" checked={roleMode === 'bypass'} onChange={() => setRoleMode('bypass')} /> {t`Assign without the role — the requirement is removed from this work and the history shows it`}</label>
            </fieldset>
          )
          : null}
        <Field label={t`What to tell them`} wide help={t`Becomes a comment on the work.`}><textarea className="tc-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </div>
    )
  } else if (action === 'retry') {
    const executorName = holder ?? t`the executor`
    dialogTitle = t`Retry as it was`
    items = [
      { tone: 'info', k: t`Status`, v: retryTarget !== undefined ? t`becomes “${retryTarget.displayName}”; ${executorName} takes the work again` : t`the type of work has no status to return the work to` },
      changedAfterFailure
        ? { tone: 'ok', k: t`Since the failure`, v: t`there are new comments or materials — the executor sees them` }
        : { tone: 'warn', k: t`Since the failure`, v: t`nothing changed — the result will most likely be the same; say what to do differently` },
      { tone: 'info', k: t`Check`, v: t`acceptance runs again on the next hand-in` },
      { tone: 'ok', k: t`Reversible`, v: t`yes — the work can be handed over or withdrawn` },
    ]
    primary = t`Retry`
    ready = retryTarget !== undefined
    body = <div className="tc-form"><Field label={t`What to do differently`} wide help={t`Optional. Becomes a comment on the work; the executor reads it.`}><textarea className="tc-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field></div>
  } else if (action === 'cancel') {
    dialogTitle = t`Withdraw the work`
    items = [
      attempt,
      external,
      { tone: 'info', k: t`Status`, v: cancelTarget !== undefined ? t`becomes “${cancelTarget.displayName}”; the work leaves the lists` : '—' },
      { tone: 'warn', k: t`Reversible`, v: t`no — to continue, raise the work again` },
    ]
    primary = t`Withdraw`
    ready = note.trim() !== ''
    body = <div className="tc-form"><Field label={t`Why it is withdrawn`} wide help={t`Required: it stays in the history of the work.`}><textarea className="tc-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field></div>
  } else {
    dialogTitle = t`Edit the work`
    items = [
      { tone: 'info', k: t`History`, v: t`the change is recorded with your name` },
      ...(claimed ? [{ tone: 'info' as const, k: t`Executor`, v: t`keeps working; to change the executor, hand the work over` }] : []),
      { tone: 'ok', k: t`Reversible`, v: t`yes — edit again` },
    ]
    primary = t`Save`
    ready = title.trim() !== ''
    body = (
      <div className="tc-form">
        <Field label={t`What to do`} wide><input className="tc-input" value={title} maxLength={500} onChange={e => setTitle(e.target.value)} /></Field>
        <Field label={t`Due`}><input className="tc-input" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></Field>
        <Field label={t`Owner`}>
          <Combobox label={t`Owner`} value={owner === '' ? null : owner} onChange={v => setOwner(v ?? '')} clearLabel={t`not set`} placeholder={t`not set`}
            options={humans.map(p => ({ value: p.id, label: p.id === me ? t`${p.displayName} (you)` : p.displayName, search: p.displayName, kind: 'human' as const, glyph: initials(p.displayName) }))} />
        </Field>
        {statusTargets.length > 0
          ? (
            <Field label={t`Status`} help={claimed ? t`The executor holds the work: its status changes through them or after “Hand over”.` : t`Only transitions the type of work allows.`}>
              <select className="tc-select" value={status} disabled={claimed} onChange={e => setStatus(e.target.value)}>
                <option value="">{t`keep as is`}</option>
                {statusTargets.map(x => <option key={x.status} value={x.status}>{x.displayName}</option>)}
              </select>
            </Field>
          )
          : null}
      </div>
    )
  }

  return (
    <Dialog title={dialogTitle} sub={task.title} alert={action === 'cancel'} onClose={onClose}
      hint={action === 'cancel' ? t`Irreversible` : undefined}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button>
            <Button variant={action === 'cancel' ? 'danger' : 'brand'} disabled={!ready || busy} onClick={() => void submit()}>{primary}</Button>
          </>
        )}>
      {/* После записи поля и последствия уже не нужны: что случилось — в строках состояния. */}
      {done ? null : body}
      {/* После записи последствия уже не «до кнопки»: что случилось — в строках состояния. */}
      {done ? null : <Consequences items={items} />}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
