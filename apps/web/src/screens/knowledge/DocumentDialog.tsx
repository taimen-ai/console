import { Button, Consequences, DecisionStatus, Dialog, Field, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '../../api/client.ts'
import { useMe } from '../../api/directory.ts'
import { clock } from '../../lib/format.ts'
import { startDocument } from './documentFlow.ts'
import { MAX_FILE_BYTES, targetOf } from './ImportDialog.tsx'
import type { Pack, PackKind } from './model.ts'

/**
 * «Добавить документ» (docs/screens/knowledge.md): вид записи → файл → извлечение полей.
 * База знаний не меняется, пока человек не проверит поля и не одобрит запись на странице
 * работы. Окно можно закрыть: извлечение идёт в ядре, а поля работа подхватит на своей странице.
 */

interface Props {
  workspaceId: string
  orgName: string | undefined
  packRefs: { ref: string, pack: Pack }[]
  kinds: PackKind[]
  initialKind: string | undefined
  onClose: () => void
}

function reasonOf(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  if (error.status === 413 || error.code === 'body_too_large') return t`the file is too large`
  if (error.kind === 'forbidden') return t`you have no right to add to the knowledge base`
  return error.detail ?? error.code
}

export function DocumentDialog({ workspaceId, orgName, packRefs, kinds, initialKind, onClose }: Props) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const me = useMe().data?.principal.id
  const [kindKey, setKindKey] = useState(initialKind ?? kinds[0]?.kind ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [taskRef, setTaskRef] = useState<string | null>(null)
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
      await startDocument(target, file, me, step, task => setTaskRef(task.publicId))
    } catch (error) {
      const reason = reasonOf(error)
      setRows(r => [...r.filter(x => x.state !== 'wait'), { state: 'fail', text: t`Stopped: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: ['tasks'] })
      void client.invalidateQueries({ queryKey: ['attention'] })
    }
  }

  const started = taskRef !== null || rows.length > 0
  return (
    <Dialog title={t`Add a document`} sub={orgName} onClose={onClose} hint={t`Reversible: nothing is written until you approve the fields`}
      footer={taskRef !== null
        ? (
          <>
            <Button variant="ghost" onClick={onClose}>{t`Close`}</Button>
            <Button variant="brand" onClick={() => { onClose(); void navigate({ to: '/work/$ref', params: { ref: taskRef } }) }}>{t`Open the work`}</Button>
          </>
        )
        : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button>
            <Button variant="brand" disabled={!ready || busy || started} onClick={() => void submit()}>{t`Add and read the fields`}</Button>
          </>
        )}>
      <div className="tc-form">
        <Field label={t`What the document is`} wide>
          <select className="tc-select" value={kindKey} disabled={busy || started} onChange={e => setKindKey(e.target.value)}>
            {kinds.map(k => <option key={k.kind} value={k.kind}>{k.title ?? k.kind}</option>)}
          </select>
        </Field>
        <Field label={t`File`} wide help={tooLarge ? t`The file is larger than 25 MB.` : t`PDF, DOCX, a scan or a photo: the text and the fields are read from it.`}>
          <input className="tc-input" type="file" disabled={busy || started} aria-invalid={tooLarge || undefined} onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      {started
        ? null
        : (
          <Consequences items={[
            { tone: 'info', k: t`Work`, v: t`a “knowledge document” work is raised with the file and its history; you decide on it` },
            { tone: 'info', k: t`Fields`, v: t`proposed from the document with quotes; you check and correct them before the decision` },
            { tone: 'ok', k: t`Knowledge base`, v: t`the record appears only after you approve; the document itself is kept as the source` },
          ]} />
        )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
      {busy && taskRef !== null ? <p className="tc-muted">{t`You can close this window: the work page picks the fields up when the document is read.`}</p> : null}
    </Dialog>
  )
}
