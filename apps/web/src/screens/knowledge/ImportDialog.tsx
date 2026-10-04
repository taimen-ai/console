import { Button, Consequences, DecisionStatus, Dialog, Field, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '../../api/client.ts'
import { useMe } from '../../api/directory.ts'
import { clock } from '../../lib/format.ts'
import { downloadTemplate, startImport, type ImportTarget } from './importFlow.ts'
import type { Pack, PackKind } from './model.ts'

/**
 * «Загрузить таблицу» (docs/screens/knowledge.md): вид → шаблон → файл → план. База знаний
 * не меняется, пока человек не одобрит план на странице работы: одобрение по типу работы
 * применяет ровно показанный план.
 */

/** Ограничение консоли на файл, как у BFF (`CONSOLE_UPLOAD_LIMIT_BYTES`). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024

interface Props {
  workspaceId: string
  orgName: string | undefined
  packRefs: { ref: string, pack: Pack }[]
  kinds: PackKind[]
  initialKind: string | undefined
  onClose: () => void
}

/** Пакет вида — первый включённый, где вид объявлен; прочие включённые — `packs` для связей и профилей. */
export function targetOf(packRefs: { ref: string, pack: Pack }[], kind: PackKind, workspaceId: string): ImportTarget | undefined {
  const own = packRefs.find(p => p.pack.kinds.some(k => k.kind === kind.kind))
  if (own === undefined) return undefined
  const others = packRefs.filter(p => p.ref !== own.ref)
  const definitions = [own, ...others].slice(0, 5).map(p => p.pack as unknown as Record<string, unknown>)
  return { workspaceId, pack: own.ref, kind: kind.kind, packs: others.map(p => p.ref), definitions, kindTitle: kind.title ?? kind.kind }
}

function reasonOf(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  if (error.status === 413 || error.code === 'body_too_large') return t`the file is too large`
  if (error.kind === 'forbidden') return t`you have no right to load into the knowledge base`
  return error.detail ?? error.code
}

export function ImportDialog({ workspaceId, orgName, packRefs, kinds, initialKind, onClose }: Props) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const me = useMe().data?.principal.id
  const [kindKey, setKindKey] = useState(initialKind ?? kinds[0]?.kind ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [template, setTemplate] = useState<string | null>(null)
  const [taskRef, setTaskRef] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const kind = kinds.find(k => k.kind === kindKey)
  const target = kind !== undefined ? targetOf(packRefs, kind, workspaceId) : undefined
  const tooLarge = file !== null && file.size > MAX_FILE_BYTES
  const ready = target !== undefined && file !== null && !tooLarge && me !== undefined

  const step = (text: string, state: 'wait' | 'done' = 'wait'): void =>
    setRows(r => [...r.filter(x => x.state !== 'wait'), { state, text, at: clock(new Date()) }])

  const submit = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setRows([])
    try {
      await startImport(target, file, me, step, task => setTaskRef(task.publicId))
      setDone(true)
    } catch (error) {
      const reason = reasonOf(error)
      setRows(r => [...r.filter(x => x.state !== 'wait'), { state: 'fail', text: t`Not loaded: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['attention'] })
    }
  }

  const getTemplate = async (format: 'xlsx' | 'csv'): Promise<void> => {
    if (target === undefined) return
    setTemplate(t`Preparing the template…`)
    try {
      const name = await downloadTemplate(target, format, () => setTemplate(t`Waiting for the skill executor…`))
      setTemplate(t`Downloaded: ${name}`)
    } catch (error) {
      const reason = reasonOf(error)
      setTemplate(t`Template not prepared: ${reason}`)
    }
  }

  // Работа заведена — повтор отсюда не нужен: план строится заново на её странице.
  const started = taskRef !== null || rows.length > 0
  return (
    <Dialog title={t`Load a table`} sub={orgName} onClose={onClose} hint={t`Reversible: nothing is written until you approve the plan`}
      footer={taskRef !== null && (done || !busy)
        ? (
          <>
            <Button variant="ghost" onClick={onClose}>{t`Close`}</Button>
            <Button variant="brand" onClick={() => { onClose(); void navigate({ to: '/work/$ref', params: { ref: taskRef } }) }}>{t`Open the work`}</Button>
          </>
        )
        : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button>
            <Button variant="brand" disabled={!ready || busy || started} onClick={() => void submit()}>{t`Load and build the plan`}</Button>
          </>
        )}>
      <div className="tc-form">
        <Field label={t`What the table holds`} wide>
          <select className="tc-select" value={kindKey} disabled={busy || started} onChange={e => { setKindKey(e.target.value); setTemplate(null) }}>
            {kinds.map(k => <option key={k.kind} value={k.kind}>{k.title ?? k.kind}</option>)}
          </select>
        </Field>
        <div className="kb-template">
          <span className="tc-muted">{t`Template with the columns of this kind:`}</span>
          <Button variant="ghost" size="sm" disabled={target === undefined || busy} onClick={() => void getTemplate('xlsx')}>XLSX</Button>
          <Button variant="ghost" size="sm" disabled={target === undefined || busy} onClick={() => void getTemplate('csv')}>CSV</Button>
          {template !== null ? <span className="tc-muted" role="status">{template}</span> : null}
        </div>
        <Field label={t`File`} wide help={tooLarge ? t`The file is larger than 25 MB.` : t`XLSX or CSV filled by the template.`}>
          <input className="tc-input" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy || started}
            aria-invalid={tooLarge || undefined} onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      {started
        ? null
        : (
          <Consequences items={[
            { tone: 'info', k: t`Work`, v: t`a “knowledge import” work is raised with the file, the plan and its history` },
            { tone: 'ok', k: t`Knowledge base`, v: t`does not change until you approve the plan` },
            { tone: 'info', k: t`Plan`, v: t`what opens, changes and closes; rows with errors are shown before any decision` },
            { tone: 'ok', k: t`Reversible`, v: t`yes — before approval the work can be withdrawn` },
          ]} />
        )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
