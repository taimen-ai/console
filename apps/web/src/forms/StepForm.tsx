import { Button, Consequences, DecisionStatus, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, cpGet, cpPatch, cpPost } from '../api/client.ts'
import type { Task } from '../api/types.ts'
import { clock } from '../lib/format.ts'
import { processRef } from '../screens/work/rows.ts'
import { defaultUi, initialValues, payload, validate, type Errors, type FormSchema, type UiElement, type Values } from './schema.ts'
import { SchemaForm } from './SchemaForm.tsx'

/**
 * Форма шага процесса для работы, которую завёл шаг с участием человека
 * (`origin.ref = process/<экземпляр>/<шаг>`, шаг `human.form = {schema, uischema?}` в
 * описании процесса той версии, по которой идёт дело). Ответ — поля работы: ядро берёт
 * `step.result` из них при завершении. Отправка — два шага с `If-Match`: записать поля
 * (`PATCH /tasks/{ref}`), затем завершить (`POST /tasks/{ref}:complete`).
 */

interface Instance { id: string, definitionKey: string, definitionVersion: number }
interface Step { id?: string, human?: { form?: { schema?: FormSchema, uischema?: UiElement } } }
export interface StepFormSpec { schema: FormSchema, ui: UiElement, step: string, process: string }

/** Шаг по id в описании процесса: шаги лежат в стадиях и вложенных ветках — обход всего описания. */
export function findStep(spec: unknown, id: string): Step | undefined {
  if (spec === null || typeof spec !== 'object') return undefined
  if ((spec as Step).id === id && (spec as Step).human !== undefined) return spec as Step
  for (const v of Object.values(spec as Record<string, unknown>)) {
    const found = findStep(v, id)
    if (found !== undefined) return found
  }
  return undefined
}

export function useStepForm(task: Pick<Task, 'origin'> | undefined) {
  const ref = processRef((task?.origin as { ref?: string } | undefined)?.ref)
  const instance = useQuery({
    queryKey: ['process-instance', ref?.instanceId], enabled: ref !== undefined, staleTime: 30_000,
    queryFn: ({ signal }) => cpGet<Instance>(`/process-instances/${ref!.instanceId}`, signal),
  })
  const defRef = instance.data !== undefined ? `${instance.data.definitionKey}@${instance.data.definitionVersion}` : undefined
  const definition = useQuery({
    queryKey: ['process-definition', defRef], enabled: defRef !== undefined, staleTime: Infinity,
    queryFn: ({ signal }) => cpGet<{ spec: unknown }>(`/process-definitions/${encodeURIComponent(defRef!)}`, signal),
  })
  if (ref === undefined || definition.data === undefined || instance.data === undefined) return { form: undefined, loading: ref !== undefined && (instance.isPending || definition.isPending) }
  const step = findStep(definition.data.spec, ref.step)
  const schema = step?.human?.form?.schema
  if (schema === undefined || typeof schema !== 'object' || Object.keys(schema.properties ?? {}).length === 0) return { form: undefined, loading: false }
  const form: StepFormSpec = { schema, ui: step?.human?.form?.uischema ?? defaultUi(schema), step: ref.step, process: instance.data.definitionKey }
  return { form, loading: false }
}

function reasonOf(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  switch (error.code) {
    case 'version_conflict': return t`someone changed the work meanwhile — reopen it and try again`
    case 'task_claimed': return t`the executor holds the work — hand it over first`
    case 'invalid_custom_fields': case 'validation_error': return error.detail ?? t`the core did not accept the answers`
    default: return error.detail ?? error.code
  }
}

export function StepForm({ task, form }: { task: Task, form: StepFormSpec }) {
  const client = useQueryClient()
  const [values, setValues] = useState<Values>(() => initialValues(form.schema, (task.customFields ?? {}) as Values))
  const [errors, setErrors] = useState<Errors>({})
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const done = rows.some(r => r.state === 'done') && rows.at(-1)?.state === 'done'
  const closed = task.systemStatusCategory.startsWith('terminal')

  const step = (text: string, state: DecisionStatusRow['state'] = 'wait'): void =>
    setRows(r => [...r.filter(x => x.state !== 'wait'), { state, text, at: clock(new Date()) }])

  const submit = async (): Promise<void> => {
    const found = validate(form.schema, form.ui, values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    setRows([])
    try {
      step(t`Recording the answers…`)
      const current = await cpGet<Task>(`/tasks/${task.id}`)
      const saved = await cpPatch<Task>(`/tasks/${task.id}`, { customFields: { ...(current.customFields ?? {}), ...payload(form.ui, values) } }, current.version)
      step(t`Answers recorded in the core`, 'done')
      step(t`Completing the step…`)
      await consolePostComplete(task.id, saved.version)
      step(t`Step completed — the process moves on`, 'done')
    } catch (error) {
      const reason = reasonOf(error)
      step(t`Not recorded: ${reason}`, 'fail')
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: ['task'] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['views', 'data'] })
      void client.invalidateQueries({ queryKey: ['attention'] })
    }
  }

  return (
    <div className="sf">
      <SchemaForm schema={form.schema} ui={form.ui} values={values} errors={errors} disabled={busy || done || closed}
        onChange={(k, v) => { setValues(s => ({ ...s, [k]: v })); setErrors(e => { const { [k]: _, ...rest } = e; return rest }) }} />
      {!closed && !done
        ? (
          <>
            <Consequences items={[
              { tone: 'info', k: t`Step`, v: t`“${form.step}” of the process “${form.process}” is completed with these answers` },
              { tone: 'info', k: t`Process`, v: t`moves to the next step by its rules` },
              { tone: 'warn', k: t`Reversible`, v: t`no — the process does not return to a completed step` },
            ]} />
            <div className="sf-actions"><Button variant="brand" disabled={busy} onClick={() => void submit()}>{t`Complete the step`}</Button></div>
          </>
        )
        : null}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : closed ? <p className="tc-muted">{t`The step is completed: these answers were recorded.`}</p> : null}
    </div>
  )
}

/** Завершение работы ядром: `If-Match` — версия после записи полей. */
async function consolePostComplete(taskId: string, version: number): Promise<void> {
  await cpPost(`/tasks/${taskId}:complete`, {}, undefined, { 'if-match': `"task-${version}"` })
}
