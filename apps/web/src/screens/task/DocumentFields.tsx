import { Button, DecisionStatus, Field, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, BASE_PATH, cpGet, cpPatch } from '../../api/client.ts'
import type { Task } from '../../api/types.ts'
import { SchemaForm } from '../../forms/SchemaForm.tsx'
import { defaultUi, validate, type FormSchema, type Values } from '../../forms/schema.ts'
import { clock } from '../../lib/format.ts'
import { extracted, syncExtraction } from '../knowledge/documentFlow.ts'
import type { Pack, PackKind } from '../knowledge/model.ts'

/**
 * Поля документа на странице работы `knowledge-document` (docs/screens/task.md): что
 * предложило извлечение — название, ключ записи и поля вида, — и правка перед решением.
 * Одобрение записывает в базу знаний ровно сохранённые поля, поэтому решение ждёт, пока
 * правки не сохранены. Если поток прервался до переноса полей (вкладку закрыли), страница
 * переносит выход извлечения сама (`syncExtraction`).
 */

type Fields = { pack?: string, kind?: string, definitions?: Pack[], documentKey?: string, textStatus?: string, attributes?: Record<string, unknown>, key?: string, title?: string, fileArtifactId?: string, filename?: string }

/** Схема полей вида: из описаний пакетов в работе, иначе — из ядра. */
function useKind(fields: Fields) {
  const inTask = (fields.definitions ?? []).flatMap(d => d.kinds ?? []).find(k => k.kind === fields.kind)
  const fromCore = useQuery({
    queryKey: ['knowledge', 'pack', fields.pack], enabled: inTask === undefined && fields.pack !== undefined, staleTime: 5 * 60_000, retry: false,
    queryFn: ({ signal }) => cpGet<Pack>(`/knowledge/packs/${encodeURIComponent(fields.pack!)}`, signal),
  })
  return inTask ?? fromCore.data?.kinds.find(k => k.kind === fields.kind)
}

function schemaOf(kind: PackKind | undefined): FormSchema {
  return { type: 'object', properties: (kind?.attributes?.properties ?? {}) as FormSchema['properties'], required: kind?.attributes?.required ?? [] }
}

/** Исходный файл — артефакт пространства (заводится раньше работы), в «Материалах» его нет. */
function SourceFile({ fields }: { fields: Fields }) {
  if (fields.fileArtifactId === undefined) return null
  const name = fields.filename ?? fields.fileArtifactId
  return <p className="tk-doc-file">{t`File:`} <a href={`${BASE_PATH}/documents/${encodeURIComponent(fields.fileArtifactId)}`}>{name}</a></p>
}

export function DocumentFields({ task, decisionPending }: { task: Task, decisionPending: boolean }) {
  const client = useQueryClient()
  const fields = (task.customFields ?? {}) as Fields
  const open = !task.systemStatusCategory.startsWith('terminal')
  const ready = typeof fields.documentKey === 'string' && fields.documentKey !== ''
  const kind = useKind(fields)
  // Поток прервался после извлечения — перенести поля здесь (один раз на версию работы).
  const sync = useQuery({
    queryKey: ['task', task.id, 'extraction', task.version], enabled: open && !ready && extracted(task), retry: false, staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const out = await syncExtraction(task, signal)
      if (out !== null) void client.invalidateQueries({ queryKey: ['task'] })
      return out
    },
  })

  const [draft, setDraft] = useState<{ version: number, title: string, key: string, attributes: Values } | null>(null)
  const current = draft !== null && draft.version === task.version ? draft : { version: task.version, title: fields.title ?? '', key: fields.key ?? '', attributes: { ...(fields.attributes ?? {}) } }
  const dirty = draft !== null && draft.version === task.version
  const schema = schemaOf(kind)
  const ui = defaultUi(schema)
  const errors = validate(schema, ui, current.attributes)
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Saving the fields…`, at: clock(new Date()) }])
    try {
      const fresh = await cpGet<Task>(`/tasks/${task.id}`)
      await cpPatch<Task>(`/tasks/${task.id}`, { customFields: { ...(fresh.customFields ?? {}), title: current.title.trim(), key: current.key.trim(), attributes: current.attributes } }, task.version)
      setDraft(null)
      setRows([{ state: 'done', text: t`Saved — the decision writes exactly these fields`, at: clock(new Date()) }])
      void client.invalidateQueries({ queryKey: ['task'] })
    } catch (error) {
      const reason = error instanceof ApiError ? (error.code === 'version_conflict' ? t`the work changed meanwhile — reload the page` : error.detail ?? error.code) : t`no connection to the core`
      setRows([{ state: 'fail', text: t`Not saved: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <div className="tk-doc">
        <SourceFile fields={fields} />
        <p className="tc-muted">
          {fields.fileArtifactId === undefined ? t`No file is attached yet — the work waits for it.`
            : !extracted(task) ? t`The document is being read: the skill executor proposes the fields with quotes.`
              : sync.isError ? t`Could not put the proposed fields into the work.`
                : t`Putting the proposed fields into the work…`}
        </p>
        {sync.isError ? <Button variant="secondary" size="sm" onClick={() => void sync.refetch()}>{t`Try again`}</Button> : null}
      </div>
    )
  }
  const edit = (patch: Partial<typeof current>): void => setDraft({ ...current, ...patch, version: task.version })
  return (
    <div className="tk-doc">
      <SourceFile fields={fields} />
      {fields.textStatus === 'ocr' ? <p className="tc-muted">{t`The text was recognized from a scan — check the values against the document.`}</p> : null}
      {fields.textStatus === 'needs_manual_input' ? <p className="tk-doc-warn">{t`The text of the document could not be read — fill the fields by hand from the document.`}</p> : null}
      <div className="tc-form">
        <Field label={t`Title of the record`} wide><input className="tc-input" value={current.title} disabled={!open || busy} maxLength={500} onChange={e => edit({ title: e.target.value })} /></Field>
        <Field label={t`Key of the record`} wide help={t`Empty — derived from the fields.`}><input className="tc-input tc-mono" value={current.key} disabled={!open || busy} maxLength={512} onChange={e => edit({ key: e.target.value })} /></Field>
      </div>
      {kind === undefined
        ? <p className="tc-muted">{t`The fields of this kind are not known to the console — they are written as proposed.`}</p>
        : <SchemaForm schema={schema} ui={ui} values={current.attributes} errors={errors} disabled={!open || busy} onChange={(k, v) => edit({ attributes: { ...current.attributes, [k]: v } })} />}
      {open
        ? (
          <div className="tk-doc-actions">
            <Button variant="secondary" size="sm" disabled={!dirty || busy || Object.keys(errors).length > 0} onClick={() => void save()}>{t`Save the fields`}</Button>
            <span className="tc-muted">{dirty ? (decisionPending ? t`Save before deciding: approval writes the saved fields.` : t`Not saved yet.`) : t`Approval writes these fields into the knowledge base.`}</span>
          </div>
        )
        : null}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </div>
  )
}
