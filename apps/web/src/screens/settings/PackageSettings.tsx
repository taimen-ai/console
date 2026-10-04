import { Button, Callout, Combobox, Consequences, DecisionStatus, DegradedBanner, Dialog, IdentityBlock, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { ApiError, cpGet } from '../../api/client.ts'
import { pathErrors } from '../../api/fieldErrors.ts'
import { executorKind, usePrincipals } from '../../api/directory.ts'
import { useTaskTypes } from '../../api/executors.ts'
import { useScope, workspaceOptions } from '../../api/scope.tsx'
import { fieldOfPath, saveSettings, usePackageSettings, useSettingsVersions, type PackageSettings } from '../../api/settings.ts'
import type { Page } from '../../api/types.ts'
import { SchemaForm, type RefControlProps } from '../../forms/SchemaForm.tsx'
import { defaultUi, validate, visibleFields, type Errors, type Values } from '../../forms/schema.ts'
import { clock } from '../../lib/format.ts'
import { when } from '../task/history.ts'
import { initials } from '../work/rows.ts'
import { SubZone } from './SubZone.tsx'

/**
 * Раздел пакета на экране «Настройки» (TAI-ADR-0067, контракт `docs/settings.md`): форма по
 * схеме и `uischema` пакета, «по умолчанию» у несохранённых значений, ошибки ядра у полей,
 * последствия до кнопки, история версий с возвратом. Без права изменения — только чтение.
 */

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Что отправить: явно заданные (сохранённые или изменённые) видимые значения; прочее — по умолчанию. */
export function settingsPayload(explicit: Set<string>, values: Values, visible: Set<string>): Values {
  return Object.fromEntries([...explicit].filter(k => visible.has(k) && values[k] !== undefined && values[k] !== '').map(k => [k, values[k]]))
}

function reasonOf(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  switch (error.code) {
    case 'version_conflict': return t`someone changed the settings meanwhile — reopen them and try again`
    case 'settings_invalid': return t`some values do not fit — see the fields`
    case 'unknown_ref': return t`a chosen object no longer exists — see the fields`
    case 'secret_material_rejected': return t`a value looks like a secret — secrets do not belong in settings`
    case 'package_not_installed': return t`the package is no longer installed`
    case 'settings_not_declared': return t`the package no longer declares settings`
    case 'if_match_required': case 'invalid_if_match': return t`the core did not accept the version of the settings — reopen them and try again`
    default: return error.kind === 'forbidden' ? t`you have no right to change these settings` : error.detail ?? error.code
  }
}

/** Ошибки ядра по полям — общий разбор `pathErrors` (одна форма на платформу). */
export const fieldErrors = (error: unknown): Record<string, string> => pathErrors(error)

export function PackageSettingsSection({ pkg }: { pkg: string }) {
  const q = usePackageSettings(pkg)
  // Строки состояния — над формой: форма пересоздаётся на новой версии, итог сохранения остаётся.
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  if (q.isPending) return <p className="tc-muted">{t`Loading…`}</p>
  if (q.isError) return <DegradedBanner.Section text={q.error instanceof ApiError && q.error.status === 404 ? t`This package has no settings.` : t`Could not load the settings: no connection to the core.`} />
  // Новая версия — форма заново с сохранёнными значениями.
  // История — вне формы: диалог возврата переживает новую версию.
  return (
    <>
      <SettingsForm key={`${q.data.package}:${q.data.version}`} data={q.data} rows={rows} setRows={setRows} />
      <History data={q.data} />
    </>
  )
}

function SettingsForm({ data, rows, setRows }: { data: PackageSettings, rows: DecisionStatusRow[], setRows: (rows: DecisionStatusRow[]) => void }) {
  const client = useQueryClient()
  const ui = data.uischema ?? defaultUi(data.schema)
  const props = data.schema.properties ?? {}
  const [values, setValues] = useState<Values>(() => ({ ...data.effective }))
  const [explicit, setExplicit] = useState<Set<string>>(() => new Set(Object.keys(data.values)))
  const [errors, setErrors] = useState<Errors>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const readOnly = !data.canManage

  const visible = visibleFields(ui, values)
  const payload = settingsPayload(explicit, values, visible)
  const dirty = !same(payload, Object.fromEntries(Object.entries(data.values).filter(([k]) => visible.has(k))))
  // Несохранённое не пропадает молча: переход внутри консоли — диалог, закрытие вкладки — вопрос браузера.
  const blocker = useBlocker({ shouldBlockFn: () => dirty && !busy, enableBeforeUnload: () => dirty && !busy, withResolver: true })

  const toDefault = (key: string): void => {
    setExplicit(s => { const n = new Set(s); n.delete(key); return n })
    setValues(v => ({ ...v, [key]: props[key]?.default }))
  }
  const hints: Record<string, ReactNode> = {}
  for (const key of Object.keys(props)) {
    if (!explicit.has(key)) hints[key] = t`default`
    else if (!readOnly && props[key]?.default !== undefined) {
      hints[key] = (
        <>
          {same(values[key], data.values[key]) ? t`saved` : t`changed, not saved yet`}
          {' · '}
          <button type="button" className="st-link-btn" onClick={() => toDefault(key)}>{t`back to default`}</button>
        </>
      )
    }
  }

  const save = async (): Promise<void> => {
    const found = validate(data.schema, ui, values)
    setErrors(found)
    setServerErrors({})
    if (Object.keys(found).length > 0) return
    setBusy(true)
    setRows([{ state: 'wait', text: t`Saving the settings…`, at: clock(new Date()) }])
    try {
      const saved = await saveSettings(data.package, payload, data.version)
      const version = saved.version
      setRows([{ state: 'done', text: t`Saved — version ${version}; new steps of the package use it`, at: clock(new Date()) }])
      void client.invalidateQueries({ queryKey: ['package-settings'] })
    } catch (error) {
      setServerErrors(fieldErrors(error))
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not saved: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="st-form">
      {readOnly ? <Callout tone="info">{t`Read only: you have no right to change the settings of this package.`}</Callout> : null}
      <SchemaForm schema={data.schema} ui={ui} values={values} errors={errors} serverErrors={serverErrors} hints={hints} disabled={readOnly || busy}
        renderRef={p => <RefControl {...p} />}
        onChange={(k, v) => {
          setValues(s => ({ ...s, [k]: v }))
          setExplicit(s => new Set(s).add(k))
          setErrors(e => { const { [k]: _, ...rest } = e; return rest })
          setServerErrors(e => { const { [k]: _, ...rest } = e; return rest })
        }} />
      {!readOnly
        ? (
          <>
            {dirty
              ? (
                <Consequences items={[
                  { tone: 'info', k: t`Where it acts`, v: t`new steps of processes, rules and views of the package; decisions already taken do not change` },
                  { tone: 'info', k: t`History`, v: t`a new version with your name; the previous one stays in the history` },
                  { tone: 'ok', k: t`Reversible`, v: t`yes — return any version from the history` },
                ]} />
              )
              : null}
            <div className="st-actions">
              <Button variant="brand" disabled={!dirty || busy} onClick={() => void save()}>{t`Save`}</Button>
              <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setValues({ ...data.effective }); setExplicit(new Set(Object.keys(data.values))); setErrors({}); setServerErrors({}); setRows([]) }}>{t`Discard changes`}</Button>
            </div>
          </>
        )
        : null}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
      {blocker.status === 'blocked'
        ? (
          <Dialog title={t`The changes are not saved`} sub={data.title} onClose={() => blocker.reset()}
            footer={<><Button variant="ghost" onClick={() => blocker.reset()}>{t`Stay`}</Button><Button variant="danger" onClick={() => blocker.proceed()}>{t`Leave without saving`}</Button></>}>
            <Consequences items={[
              { tone: 'warn', k: t`Changes`, v: t`are lost: the package keeps acting by the saved values` },
              { tone: 'info', k: t`To keep them`, v: t`stay and press “Save”` },
            ]} />
          </Dialog>
        )
        : null}
    </div>
  )
}

/** Выбор объекта платформы по `x-ref`: участник, пространство, тип работы, роль, календарь. */
function RefControl(p: RefControlProps) {
  const ref = p.field['x-ref']
  if (ref === 'principal') return <PrincipalRef {...p} />
  if (ref === 'workspace') return <WorkspaceRef {...p} />
  if (ref === 'taskType') return <TaskTypeRef {...p} />
  if (ref === 'role' || ref === 'calendar') return <ListRef {...p} path={ref === 'role' ? '/roles?limit=200' : '/calendars?limit=200'} kind={ref} />
  return <input className="tc-input" value={typeof p.value === 'string' ? p.value : ''} disabled={p.disabled} aria-label={p.label} onChange={e => p.onChange(e.target.value)} />
}

const refProps = (p: RefControlProps) => ({ label: p.label, value: typeof p.value === 'string' ? p.value : null, disabled: p.disabled, invalid: p.invalid, onChange: (v: string | null) => p.onChange(v ?? undefined), clearLabel: t`not chosen` })

function PrincipalRef(p: RefControlProps) {
  const people = usePrincipals().data
  const options = [...(people?.values() ?? [])].filter(x => x.status === 'active').sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(x => ({ value: x.id, label: x.displayName, kind: executorKind(x), glyph: initials(x.displayName) }))
  return <Combobox {...refProps(p)} options={options} />
}

function WorkspaceRef(p: RefControlProps) {
  const scope = useScope()
  return <Combobox {...refProps(p)} options={workspaceOptions(scope.nodes)} />
}

function TaskTypeRef(p: RefControlProps) {
  const { types } = useTaskTypes(null)
  return <Combobox {...refProps(p)} options={types.map(ty => ({ value: ty.key, label: ty.displayName || ty.key, search: ty.key }))} />
}

/** Роли и календари — списком ядра; нет права читать (403) — ввод ключа или id текстом. */
function ListRef(p: RefControlProps & { path: string, kind: string }) {
  const q = useQuery({ queryKey: ['ref-list', p.kind], retry: false, staleTime: 5 * 60_000, queryFn: ({ signal }) => cpGet<Page<{ id: string, key?: string, name?: string, displayName?: string }>>(p.path, signal) })
  if (q.isError) return <input className="tc-input" value={typeof p.value === 'string' ? p.value : ''} disabled={p.disabled} aria-label={p.label} onChange={e => p.onChange(e.target.value)} />
  const options = (q.data?.items ?? []).map(x => ({ value: p.kind === 'calendar' ? x.key ?? x.id : x.id, label: x.displayName ?? x.name ?? x.key ?? x.id, search: x.key ?? '' }))
  return <Combobox {...refProps(p)} options={options} />
}

function History({ data }: { data: PackageSettings }) {
  const versions = useSettingsVersions(data.package)
  const people = usePrincipals().data
  const [restore, setRestore] = useState<number | null>(null)
  const props = data.schema.properties ?? {}
  const pathTitle = (path: string): string => props[fieldOfPath(path)]?.title ?? fieldOfPath(path)
  const items = versions.data ?? []
  return (
    <SubZone title={t`History of changes`} {...(items.length > 0 ? { count: items.length } : {})}>
      {versions.isError ? <DegradedBanner.Section text={t`Could not load the history.`} /> : items.length === 0 ? <p className="tc-muted">{t`Nothing has been changed yet — the default values act.`}</p> : (
        <ol className="st-history">
          {items.map((v) => {
            const who = v.updatedBy !== null ? people?.get(v.updatedBy) : undefined
            const changed = v.changedPaths.map(pathTitle).join(', ')
            const n = v.version
            return (
              <li key={v.version}>
                <span className="st-history-ver">{t`Version ${n}`}</span>
                {who !== undefined ? <IdentityBlock kind={executorKind(who)} name={who.displayName} label={initials(who.displayName)} inline size="sm" /> : null}
                <span className="tc-muted">{when(v.updatedAt)}</span>
                {changed !== '' ? <span className="st-history-changed">{t`changed: ${changed}`}</span> : null}
                {v.version === data.version
                  ? <span className="tc-muted">{t`current`}</span>
                  : data.canManage ? <Button variant="ghost" size="sm" onClick={() => setRestore(v.version)}>{t`Return this version`}</Button> : null}
              </li>
            )
          })}
        </ol>
      )}
      {restore !== null ? <RestoreDialog data={data} version={items.find(v => v.version === restore)!} onClose={() => setRestore(null)} /> : null}
    </SubZone>
  )
}

function RestoreDialog({ data, version, onClose }: { data: PackageSettings, version: { version: number, values: Values }, onClose: () => void }) {
  const client = useQueryClient()
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const n = version.version
  const restore = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Returning the values…`, at: clock(new Date()) }])
    try {
      const saved = await saveSettings(data.package, version.values, data.version)
      const next = saved.version
      setRows([{ state: 'done', text: t`Returned — the values of version ${n} are now version ${next}`, at: clock(new Date()) }])
      setDone(true)
      void client.invalidateQueries({ queryKey: ['package-settings'] })
    } catch (error) {
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not returned: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={t`Return version ${n}`} sub={data.title} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy} onClick={() => void restore()}>{t`Return`}</Button></>}>
      {done ? null : (
        <Consequences items={[
          { tone: 'info', k: t`Values`, v: t`become as in version ${n}; it is recorded as a new version` },
          { tone: 'info', k: t`Where it acts`, v: t`new steps of processes, rules and views of the package` },
          { tone: 'ok', k: t`Reversible`, v: t`yes — the current values stay in the history` },
        ]} />
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
