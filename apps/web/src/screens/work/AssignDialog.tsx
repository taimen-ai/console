import { Button, Combobox, Criteria, Dialog, Field, WorkPreview, type CriterionItem, type SealsProps } from '@console/ui'
import { plural, t } from '@lingui/core/macro'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError, cpPost } from '../../api/client.ts'
import { executorKind, useMe, usePrincipals } from '../../api/directory.ts'
import { executorMeta, useExecutors, useTaskTypes } from '../../api/executors.ts'
import { subtreeOf, useScope, workspaceOptions } from '../../api/scope.tsx'
import type { Task } from '../../api/types.ts'
import { initials } from './rows.ts'
import type { WorkProposal } from './proposal.ts'

/**
 * «Поручить работу» (docs/screens/work.md): форма с предпросмотром «Будет заведено».
 * Тип работы задаёт критерии приёмки; «Завести работу» активна, только когда есть что
 * сделать, ожидаемый результат и срок. Запись — `POST /tasks` с ключом идемпотентности на
 * открытие диалога: повтор после обрыва не заведёт работу дважды. Результат и основание
 * уходят в описание работы — у ядра для них нет отдельных полей.
 */


function kindText(kind: string): string {
  switch (kind) {
    case 'deterministic': return t`auto-check`
    case 'external_state': return t`external state`
    case 'human': return t`a person`
    case 'llm_judge': return t`model assessment`
    default: return kind
  }
}

/** `datetime-local` → ISO; пусто или неверно — null. */
const toIso = (value: string): string | null => {
  if (value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Что заводится: поля формы или предложения ассистента. */
export interface WorkDraft {
  title: string
  result: string
  basis?: string
  /** Срок ISO. */
  due: string
  typeKey?: string
  assigneeId?: string
  ownerId?: string
  workspaceId?: string
}

/**
 * `POST /tasks`: результат и основание — в описание (у ядра для них нет полей). Общая запись
 * формы и карточки «Будет заведено» в ленте ассистента.
 */
export function raiseWork(draft: WorkDraft, key: string): Promise<Task> {
  const basis = (draft.basis ?? '').trim()
  const result = draft.result.trim()
  const description = basis !== '' ? `${result}\n\n${t`Basis: ${basis}`}` : result
  return cpPost<Task>('/tasks', {
    title: draft.title.trim(), description, dueDate: draft.due,
    ...(draft.typeKey !== undefined ? { typeKey: draft.typeKey } : {}),
    ...(draft.assigneeId !== undefined ? { assigneeId: draft.assigneeId } : {}),
    ...(draft.ownerId !== undefined ? { ownerId: draft.ownerId } : {}),
    ...(draft.workspaceId !== undefined ? { workspaceId: draft.workspaceId } : {}),
    origin: { kind: 'human' },
  }, key)
}

/** Ошибка записи работы словами для человека. */
export function raiseError(failure: unknown): string {
  const reason = failure instanceof ApiError ? failure.detail ?? failure.code : ''
  return failure instanceof ApiError && failure.kind === 'client' ? t`The core did not accept the work: ${reason}`
    : failure instanceof ApiError && failure.kind === 'forbidden' ? t`You have no right to raise work here.`
      : t`Not sent: no connection to the core`
}

/** «Поручить работу»; `initial` — поля из предложения (`/work/new?…`, ссылка ассистента). */
export function AssignDialog({ onClose, initial }: { onClose: () => void, initial?: WorkProposal }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const me = useMe().data?.principal.id
  const people = usePrincipals().data
  const scope = useScope()
  // Пространства — только область из шапки; по умолчанию — она сама (при «Все» — первый корень).
  const within = scope.ws !== null ? subtreeOf(scope.nodes, scope.ws) : undefined
  const spaces = workspaceOptions(scope.nodes, within)
  const humans = [...(people?.values() ?? [])].filter(p => p.kind === 'human' && p.status === 'active').sort((a, b) => a.displayName.localeCompare(b.displayName))

  const [form, setForm] = useState({
    title: initial?.title ?? '', type: initial?.type ?? '', exec: initial?.exec ?? '', result: initial?.result ?? '',
    owner: initial?.owner ?? '', due: initial?.due ?? '', space: initial?.ws ?? '', basis: initial?.basis ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }): void => setForm(f => ({ ...f, [key]: e.target.value }))
  const pick = (key: keyof typeof form) => (value: string | null): void => setForm(f => ({ ...f, [key]: value ?? '' }))
  const [key] = useState(() => crypto.randomUUID())

  const space = form.space !== '' ? form.space : scope.ws ?? spaces[0]?.value ?? ''
  // Типы — разрешённые в выбранном пространстве; исполнители — те, кто может брать выбранный тип там.
  const { types: active } = useTaskTypes(space || null)
  const type = active.find(ty => ty.key === form.type)
  const { executors } = useExecutors(type, space || null)
  // Сменили тип или пространство — исполнитель, который не может брать работу, сбрасывается.
  const execOk = form.exec === '' || executors.some(e => e.id === form.exec)
  const owner = form.owner !== '' ? form.owner : me ?? ''
  const due = toIso(form.due)
  const ready = form.title.trim() !== '' && form.result.trim() !== '' && due !== null && execOk

  const create = useMutation({
    mutationFn: () => raiseWork({
      title: form.title, result: form.result, basis: form.basis, due: due!,
      ...(type !== undefined ? { typeKey: type.key } : {}),
      ...(form.exec !== '' && execOk ? { assigneeId: form.exec } : {}),
      ...(owner !== '' ? { ownerId: owner } : {}),
      ...(space !== '' ? { workspaceId: space } : {}),
    }, key),
    onSuccess: (task) => {
      void client.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
      void navigate({ to: '/work/$ref', params: { ref: task.publicId } })
    },
  })
  const error = create.error === null ? null : raiseError(create.error)

  const executor = form.exec !== '' && execOk ? people?.get(form.exec) : undefined
  const ownerName = owner === me ? t`you` : people?.get(owner)?.displayName ?? '—'
  const criteria: CriterionItem[] = (type?.acceptance ?? []).map(c => ({ text: c.description ?? c.key, kind: kindText(c.kind) }))
  const needsPerson = (type?.acceptance ?? []).some(c => c.kind === 'human')
  const seals: SealsProps = {
    origin: { kind: 'human', text: t`raised by you` },
    executor: executor !== undefined ? { kind: executorKind(executor), name: executor.displayName, label: initials(executor.displayName) } : null,
    evidence: { method: 'none', text: t`verification ahead` },
    signature: needsPerson ? { pending: true } : null,
  }
  const dueText = due !== null ? new Date(due).toLocaleString(undefined, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <Dialog wide title={t`Assign work`} sub={t`Before the work is raised you see exactly what will be created. You can also assign work in words — to the assistant.`} onClose={onClose}
      footer={
        <>
          <span className="tc-dialog-hint" role={error !== null ? 'alert' : undefined}>{error ?? (ready ? t`The work will appear in “Work” and with the executor` : t`Fill in what to do, the expected result and the due date`)}</span>
          <Button variant="ghost" onClick={onClose}>{t`Cancel`}</Button>
          <Button variant="brand" disabled={!ready || create.isPending} onClick={() => create.mutate()}>{create.isPending ? t`Raising…` : t`Raise the work`}</Button>
        </>
      }>
      <div className="work-assign">
        <div className="tc-form">
          <Field label={t`What to do`} wide><input className="tc-input" value={form.title} onChange={set('title')} maxLength={500} placeholder={t`Start with a verb: “Reconcile invoice No. 421”`} /></Field>
          <Field label={t`Type of work`} help={t`The type sets the acceptance criteria. Only types allowed in the workspace.`}>
            <Combobox label={t`Type of work`} value={form.type === '' ? null : form.type} onChange={pick('type')} clearLabel={t`Free-form work`} placeholder={t`Free-form work`}
              options={active.map(ty => ({ value: ty.key, label: ty.displayName || ty.key, search: ty.key }))} />
          </Field>
          <Field label={t`Executes`} help={type !== undefined ? t`Only those who can take this type of work here.` : undefined}>
            <Combobox label={t`Executes`} value={form.exec === '' || !execOk ? null : form.exec} onChange={pick('exec')} clearLabel={t`not assigned yet`} placeholder={t`not assigned yet`}
              emptyText={t`Nobody here can take this type of work`}
              options={executors.map(e => ({ value: e.id, label: e.displayName, kind: e.kind === 'human' ? 'human' as const : e.kind === 'agent' ? 'agent' as const : 'process' as const, glyph: initials(e.displayName), meta: executorMeta(e) }))} />
          </Field>
          <Field label={t`Expected result`} wide><textarea className="tc-textarea" value={form.result} onChange={set('result')} rows={3} placeholder={t`What should come out — so that it can be checked`} /></Field>
          <Field label={t`Owner`}>
            <Combobox label={t`Owner`} value={owner === '' ? null : owner} onChange={pick('owner')}
              options={humans.map(p => ({ value: p.id, label: p.id === me ? t`${p.displayName} (you)` : p.displayName, kind: 'human' as const, glyph: initials(p.displayName), search: p.displayName }))} />
          </Field>
          <Field label={t`Due`}><input className="tc-input" type="datetime-local" value={form.due} onChange={set('due')} /></Field>
          {spaces.length > 1
            ? (
              <Field label={t`Workspace`} help={scope.ws !== null ? t`Within the workspace chosen at the top.` : undefined}>
                <Combobox label={t`Workspace`} value={space === '' ? null : space} onChange={v => { if (v !== null) setForm(f => ({ ...f, space: v })) }} options={spaces} />
              </Field>
            )
            : null}
          <Field label={t`Basis and materials`} wide><input className="tc-input" value={form.basis} onChange={set('basis')} placeholder={t`Why this work is needed: a document, a request, an observation`} /></Field>
          {criteria.length > 0
            ? <Field label={t`Acceptance criteria`} wide help={t`Declared by the type of work. The work is done only when all of them pass.`}><Criteria items={criteria} /></Field>
            : null}
        </div>
        <WorkPreview label={t`Will be raised`} title={form.title.trim() || '—'} seals={seals}
          fields={[
            [t`Type`, type?.displayName ?? t`Free-form work`],
            [t`Result`, form.result.trim() || '—'],
            [t`Executes`, executor?.displayName ?? t`not assigned yet`],
            [t`Owner`, ownerName],
            [t`Due`, dueText],
            ...(spaces.length > 1 ? [[t`Where`, scope.nodes.find(n => n.id === space)?.path.join(' / ') ?? '—'] as [string, string]] : []),
            [t`Acceptance`, criteria.length > 0 ? plural(criteria.length, { one: '# criterion', other: '# criteria' }) : t`by the owner`],
          ]} />
      </div>
    </Dialog>
  )
}
