import { Button, Callout, Combobox, Consequences, DecisionStatus, DegradedBanner, Dialog, Field, IdentityBlock, StatusMark, type DecisionStatusRow, type Status } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { ApiError, BASE_PATH, browser } from '../../api/client.ts'
import { pathErrors } from '../../api/fieldErrors.ts'
import {
  KEY_PATTERN, authorizeConnection, createConnection, revokeConnection, setConnectionToken, setOAuthApp, typeOf, updateConnection,
  useConnection, useConnectionTypes, useConnections, useOAuthApp,
  type Connection, type ConnectionStatus, type ConnectionType, type OAuthReturn,
} from '../../api/connections.ts'
import { executorKind, usePrincipals } from '../../api/directory.ts'
import { SchemaForm } from '../../forms/SchemaForm.tsx'
import { defaultUi, validate, type Errors, type FormSchema, type Values } from '../../forms/schema.ts'
import { clock, since } from '../../lib/format.ts'
import { when } from '../task/history.ts'
import { initials } from '../work/rows.ts'
import { SubZone } from './SubZone.tsx'
import { StageRoles, isStageRolesField, type StageRole } from './StageRoles.tsx'

/**
 * «Настройки» → «Подключения» (CP-ADR-0079, контракт `docs/connections.md`, экран
 * `docs/screens/settings.md`): подключения организации к внешним системам — статус, кто
 * подключил, последняя проверка; «Подключить» (OAuth: тип → согласие у провайдера → возврат
 * сюда), «Вставить ключ», «Отозвать»; настройки подключения по схеме его типа; приложения
 * OAuth типов; секреты агентов по имени. Значение ключа или секрета живёт только в поле ввода
 * до отправки: ответы его не несут, после ввода консоль показывает лишь имя и время.
 */

const href = (connection?: string): string => `${BASE_PATH}/settings?section=connections${connection !== undefined ? `&connection=${encodeURIComponent(connection)}` : ''}`

/** Статус подключения → знак дизайн-системы и слово. */
function statusMark(status: ConnectionStatus): { status: Status, label: string } {
  switch (status) {
    case 'active': return { status: 'verified', label: t`connected` }
    case 'pending': return { status: 'queued', label: t`not connected yet` }
    case 'expired': return { status: 'failed', label: t`access lost` }
    case 'revoked': return { status: 'paused', label: t`revoked` }
  }
}

/** Код причины ядра (`statusReason`, `reason` возврата) → слова. */
export function reasonText(code: string | null | undefined): string | undefined {
  switch (code) {
    case null: case undefined: return undefined
    case 'consent_denied': return t`access was declined in the other system`
    case 'provider_error': return t`the other system answered with an error`
    case 'invalid_account': return t`the account from the other system does not fit this type`
    case 'oauth_exchange_failed': return t`the other system did not exchange the code for access`
    case 'secret_store_unavailable': return t`the secret store was unavailable`
    case 'initiator_not_authorized': return t`whoever started connecting no longer has the right`
    case 'token_expired': return t`the key has expired`
    case 'refresh_rejected': return t`the other system refused to extend access`
    default: return code
  }
}

const authText = (auth: string | null): string => auth === 'oauth2' ? t`sign-in in the other system (OAuth)` : auth === 'token' ? t`access key` : '—'

function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  if (error.kind === 'forbidden') return t`you have no right to manage connections`
  switch (error.code) {
    case 'oauth_app_not_configured': return t`the OAuth application of this type is not entered yet — see “OAuth applications” below`
    case 'oauth_not_configured': return t`the installation has no OAuth return address (CP_OAUTH_REDIRECT_URI, CP_CONNECTIONS_RETURN_URL) — the administrator of the installation sets it`
    case 'auth_not_supported': return t`this type of connection does not connect this way`
    case 'secret_store_unavailable': return t`the secret store is unavailable — try again later`
    case 'invalid_account': return t`the account does not fit this type`
    case 'invalid_expiry': return t`the expiry date must be in the future`
    case 'connection_key_taken': return t`a connection with this key already exists`
    case 'unknown_connection_type': return t`this type of connection is not available`
    case 'version_conflict': return t`someone changed the connection meanwhile — reopen it and try again`
    case 'invalid_connection_settings': return t`some settings do not fit — see the fields`
    case 'secret_material_rejected': return t`a value looks like a secret — secrets do not belong in settings`
    case 'invalid_secret_name': return t`the name may hold lower-case letters, digits and dashes`
    case 'agent_retired': return t`the agent is retired`
    case 'oauth_app_owned_by_other_tenant': return t`this type's application belongs to another organization of the installation`
    case 'oauth_app_write_conflict': return t`another write happened at the same time — try again`
    default: return error.status === 404 ? t`the core does not support connections yet` : error.detail ?? error.code
  }
}

const now = (): string => clock(new Date())

/** День `YYYY-MM-DD` по местному времени — в форме поля даты. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Ошибки полей настроек — общий разбор `pathErrors` (`details.errors[]` и прежний `details.path`). */
export const settingsFieldErrors = (error: unknown): Record<string, string> => pathErrors(error)

/** Пустые строки — «не задано»: ядро ждёт отсутствие поля, а не `""`. */
export function cleanSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSettings)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, cleanSettings(v)]))
  }
  return value
}

/** Учётка подходит к шаблону типа целиком; шаблон не компилируется — проверит ядро. */
export function accountFits(pattern: string | undefined, account: string): boolean {
  if (pattern === undefined) return account !== ''
  try { return new RegExp(`^(?:${pattern})$`).test(account) } catch { return true }
}

export function ConnectionsSection({ open, back }: { open?: string, back: OAuthReturn }) {
  const list = useConnections()
  const types = useConnectionTypes()
  const [creating, setCreating] = useState(false)
  const people = usePrincipals().data
  const unsupported = list.isError && list.error instanceof ApiError && list.error.status === 404
  if (unsupported) {
    return <DegradedBanner.Section text={t`The core does not support connections yet: they come with the secret store and the connections feature of the core.`} />
  }
  const items = list.data ?? []
  return (
    <div className="cn">
      <p className="tc-muted st-lead">{t`Accounts of the organization in other systems: agents and connectors act through them. Keys and secrets go straight to the secret store — nobody sees them after entry, the console neither.`}</p>
      <ReturnNotice back={back} connections={items} />
      {list.isPending ? <p className="tc-muted">{t`Loading…`}</p> : null}
      {list.isError ? <DegradedBanner.Section text={list.error instanceof ApiError && list.error.kind === 'forbidden' ? t`You have no right to read connections.` : t`Could not load the connections: no connection to the core.`} /> : null}
      {list.isSuccess && items.length === 0 ? <p className="tc-muted">{t`No connections yet. Connection types come with packages; connect the first account below.`}</p> : null}
      {items.length > 0
        ? (
          <ul className="cn-list">
            {items.map((c) => {
              const mark = statusMark(c.status)
              const type = typeOf(types.data, c)
              const who = c.connectedBy !== null ? people?.get(c.connectedBy)?.displayName : undefined
              const checked = c.lastCheckedAt !== null ? when(c.lastCheckedAt) : undefined
              const reason = reasonText(c.statusReason)
              return (
                <li key={c.id} className={open === c.key ? 'cn-open' : undefined}>
                  <a className="cn-row" href={href(open === c.key ? undefined : c.key)} aria-current={open === c.key ? 'true' : undefined} aria-expanded={open === c.key}>
                    <span className="cn-main">
                      <span className="cn-title">{c.displayName}</span>
                      <span className="tc-muted cn-meta">{type?.spec.displayName ?? c.type}{c.account !== null ? ` · ${c.account}` : ''}</span>
                    </span>
                    <span className="cn-side">
                      <StatusMark status={mark.status} label={mark.label} machine={c.status} />
                      <span className="tc-muted cn-meta">
                        {reason ?? (c.status === 'active' && checked !== undefined ? t`checked ${checked}` : who !== undefined ? t`connected by ${who}` : '')}
                      </span>
                    </span>
                  </a>
                  {open === c.key ? <ConnectionCard connectionKey={c.key} types={types.data} /> : null}
                </li>
              )
            })}
          </ul>
        )
        : null}
      {open !== undefined && list.isSuccess && !items.some(c => c.key === open) ? <Callout>{t`There is no connection “${open}”.`}</Callout> : null}
      <div className="st-actions">
        <Button variant="secondary" disabled={!types.isSuccess || types.data.every(ty => ty.status !== 'active')} onClick={() => setCreating(true)}>{t`New connection`}</Button>
        {types.isSuccess && types.data.every(ty => ty.status !== 'active') ? <span className="tc-muted cn-meta">{t`No package brings a connection type yet.`}</span> : null}
      </div>
      {creating && types.isSuccess ? <CreateDialog types={types.data.filter(ty => ty.status === 'active')} taken={new Set(items.map(c => c.key))} onClose={() => setCreating(false)} /> : null}
      <OAuthApps types={types.data ?? []} />
    </div>
  )
}

/** Итог OAuth-потока — после возврата от провайдера (`?connection&result&reason`). */
function ReturnNotice({ back, connections }: { back: OAuthReturn, connections: Connection[] }) {
  if (back.result === undefined) return null
  const name = connections.find(c => c.key === back.connection)?.displayName ?? back.connection ?? ''
  if (back.result === 'active') return <Callout tone="info">{t`Connected: ${name}. Agents of the connection get access within a few minutes.`}</Callout>
  if (back.result === 'invalid_state') return <Callout>{t`The connection link is stale or already used — start connecting again.`}</Callout>
  const reason = reasonText(back.reason) ?? t`unknown reason`
  return <Callout>{t`Not connected: ${name} — ${reason}. Nothing changed; try again or enter a key.`}</Callout>
}

function Fact({ k, children }: { k: ReactNode, children: ReactNode }) {
  return <><dt>{k}</dt><dd>{children}</dd></>
}

function ConnectionCard({ connectionKey, types }: { connectionKey: string, types: ConnectionType[] | undefined }) {
  const q = useConnection(connectionKey)
  const people = usePrincipals().data
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  // Итог сохранения настроек — здесь: форма пересоздаётся на новой версии подключения.
  const [settingsRows, setSettingsRows] = useState<DecisionStatusRow[]>([])
  const [dialog, setDialog] = useState<'token' | 'revoke' | null>(null)
  const [busy, setBusy] = useState(false)
  if (q.isPending) return <p className="tc-muted cn-card">{t`Loading…`}</p>
  if (q.isError) return <div className="cn-card"><DegradedBanner.Section text={errorText(q.error)} /></div>
  const c = q.data
  const type = typeOf(types, c)
  const auth = type?.spec.auth ?? []
  const who = c.connectedBy !== null ? people?.get(c.connectedBy) : undefined

  const connect = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Asking the core for the sign-in address…`, at: now() }])
    try {
      const r = await authorizeConnection(c.key)
      if (r.authorizeUrl === null) throw new ApiError(409, 'repeat')
      setRows([{ state: 'done', text: t`Going to the other system for consent…`, at: now() }])
      browser.assign(r.authorizeUrl)
    } catch (error) {
      const reason = errorText(error)
      setRows([{ state: 'fail', text: t`Not started: ${reason}`, at: now() }])
      setBusy(false)
    }
  }

  return (
    <div className="cn-card">
      <dl className="cn-facts">
        <Fact k={t`Type`}>{type?.spec.displayName ?? c.type}{type?.package != null ? <span className="tc-muted"> · {t`package`} {type.package.key}</span> : null}</Fact>
        <Fact k={t`Key`}><span className="tc-mono">{c.key}</span></Fact>
        <Fact k={t`Account`}>{c.account ?? '—'}</Fact>
        <Fact k={t`Connected with`}>{authText(c.auth)}</Fact>
        <Fact k={t`Connected by`}>
          {who !== undefined ? <IdentityBlock kind={executorKind(who)} name={who.displayName} label={initials(who.displayName)} inline size="sm" /> : '—'}
          {c.connectedAt !== null ? <span className="tc-muted"> · {when(c.connectedAt)}</span> : null}
        </Fact>
        <Fact k={t`Last check`}>{c.lastCheckedAt !== null ? when(c.lastCheckedAt) : t`not checked yet`}</Fact>
        {c.expiresAt !== null ? <Fact k={t`Key expires`}>{when(c.expiresAt)}</Fact> : null}
        {c.statusReason !== null || c.statusMessage !== null
          ? <Fact k={t`Why`}>{reasonText(c.statusReason)}{c.statusMessage !== null ? <span className="tc-muted"> · {c.statusMessage}</span> : null}</Fact>
          : null}
        <Fact k={t`Agents`}>{(c.agents ?? []).length > 0 ? (c.agents ?? []).map(a => <span key={a} className="tc-mono cn-chip">{a}</span>) : <span className="tc-muted">{t`no agent uses it yet`}</span>}</Fact>
      </dl>
      <div className="st-actions">
        {auth.includes('oauth2')
          ? <Button variant={c.status === 'active' ? 'secondary' : 'brand'} disabled={busy} onClick={() => void connect()}>{c.status === 'pending' || c.status === 'revoked' ? t`Connect` : t`Connect again`}</Button>
          : null}
        {auth.includes('token') ? <Button variant={auth.includes('oauth2') || c.status === 'active' ? 'secondary' : 'brand'} disabled={busy} onClick={() => setDialog('token')}>{t`Enter a key`}</Button> : null}
        {c.status !== 'revoked' ? <Button variant="ghost" disabled={busy} onClick={() => setDialog('revoke')}>{t`Revoke`}</Button> : null}
      </div>
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
      {type !== undefined && Object.keys(type.spec.settingsSchema.properties ?? {}).length > 0
        ? <ConnectionSettings key={`${c.key}:${c.version}`} connection={c} schema={type.spec.settingsSchema} rows={settingsRows} setRows={setSettingsRows} />
        : null}
      {dialog === 'token' && type !== undefined ? <TokenDialog connection={c} type={type} onClose={() => setDialog(null)} /> : null}
      {dialog === 'revoke' ? <RevokeDialog connection={c} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

function useRefresh() {
  const client = useQueryClient()
  return (): void => { void client.invalidateQueries({ queryKey: ['connections'] }) }
}

function CreateDialog({ types, taken, onClose }: { types: ConnectionType[], taken: Set<string>, onClose: () => void }) {
  const refresh = useRefresh()
  const [typeKey, setTypeKey] = useState<string | null>(types.length === 1 ? types[0]!.key : null)
  const type = types.find(ty => ty.key === typeKey)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const effectiveKey = key.trim() !== '' ? key.trim() : type?.spec.defaultKey ?? ''
  const keyProblem = effectiveKey === '' ? undefined : !KEY_PATTERN.test(effectiveKey) ? t`lower-case letters, digits and dashes; starts with a letter or a digit` : taken.has(effectiveKey) ? t`this key is taken — give another one` : undefined
  const create = async (): Promise<void> => {
    if (type === undefined || keyProblem !== undefined) return
    setBusy(true)
    setRows([{ state: 'wait', text: t`Creating the connection…`, at: now() }])
    try {
      const c = await createConnection({ type: type.key, key: effectiveKey, ...(name.trim() !== '' ? { displayName: name.trim() } : {}) })
      refresh()
      browser.assign(href(c.key))
    } catch (error) {
      const reason = errorText(error)
      setRows([{ state: 'fail', text: t`Not created: ${reason}`, at: now() }])
      setBusy(false)
    }
  }
  return (
    <Dialog title={t`New connection`} sub={t`An account of the organization in another system`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy || type === undefined || keyProblem !== undefined} onClick={() => void create()}>{t`Create`}</Button></>}>
      <div className="tc-form">
        <Field label={t`Type`} wide help={type?.spec.description ?? undefined}>
          <Combobox label={t`Type`} value={typeKey} onChange={setTypeKey} options={types.map(ty => ({ value: ty.key, label: ty.spec.displayName, search: ty.key }))} />
        </Field>
        <Field label={t`Name`} wide help={t`How people see the connection; by default — the name of the type.`}>
          <input className="tc-input" value={name} placeholder={type?.spec.displayName ?? ''} maxLength={200} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label={t`Key`} wide help={keyProblem ?? t`Packages and agents refer to the connection by this key; it never changes. By default — “${type?.spec.defaultKey ?? '…'}”.`}>
          <input className="tc-input tc-mono" value={key} placeholder={type?.spec.defaultKey ?? ''} aria-invalid={keyProblem !== undefined} onChange={e => setKey(e.target.value)} />
        </Field>
      </div>
      <Consequences items={[
        { tone: 'info', k: t`What happens`, v: t`the connection appears as “not connected yet”; access is given by the next step — sign-in or a key` },
        { tone: 'ok', k: t`Reversible`, v: t`a connection is not deleted, but can be revoked` },
      ]} />
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}

function TokenDialog({ connection, type, onClose }: { connection: Connection, type: ConnectionType, onClose: () => void }) {
  const refresh = useRefresh()
  const field = type.spec.accountField ?? undefined
  const [account, setAccount] = useState(connection.account ?? '')
  // Значение ключа — только в этом поле до отправки; после успеха поле очищается.
  const [token, setToken] = useState('')
  const [expires, setExpires] = useState('')
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const accountOk = accountFits(field?.pattern, account.trim())
  // Сегодняшний день — один раз на открытие: срок «до» — не раньше завтра по местному времени.
  const [today] = useState(() => localDay(new Date()))
  const expiresOk = expires === '' || expires > today
  const save = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Sending the key to the secret store…`, at: now() }])
    try {
      await setConnectionToken(connection.key, { account: account.trim(), token, ...(expires !== '' ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}) })
      setToken('')
      setDone(true)
      setRows([{ state: 'done', text: t`Connected with the key — it is in the secret store; the console does not show it`, at: now() }])
      refresh()
    } catch (error) {
      const reason = errorText(error)
      setRows([{ state: 'fail', text: t`Not connected: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={t`Enter a key`} sub={connection.displayName} onClose={() => { setToken(''); onClose() }}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={() => { setToken(''); onClose() }} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy || !accountOk || token === '' || !expiresOk} onClick={() => void save()}>{t`Connect`}</Button></>}>
      {done ? null : (
        <>
          <div className="tc-form">
            <Field label={field?.title ?? t`Account`} wide help={!accountOk && account !== '' ? t`does not fit this type` : field?.description ?? undefined}>
              <input className="tc-input" value={account} aria-invalid={!accountOk && account !== ''} autoComplete="off" spellCheck={false} onChange={e => setAccount(e.target.value)} />
            </Field>
            <Field label={t`Key`} wide help={t`It goes straight to the secret store. After saving nobody sees it — the console neither.`}>
              <input className="tc-input tc-mono" type="password" value={token} autoComplete="new-password" spellCheck={false} maxLength={8192} onChange={e => setToken(e.target.value)} />
            </Field>
            <Field label={t`Valid until`} help={!expiresOk ? t`the date must be in the future` : t`Optional: the connection turns “access lost” after this day.`}>
              <input className="tc-input" type="date" value={expires} aria-invalid={!expiresOk} onChange={e => setExpires(e.target.value)} />
            </Field>
          </div>
          <Consequences items={[
            { tone: 'info', k: t`What happens`, v: connection.auth === 'oauth2' ? t`the key replaces the sign-in in the other system; the previous access is deleted` : connection.auth === 'token' ? t`the key replaces the previous one; the previous key is destroyed` : t`the connection becomes “connected”` },
            { tone: 'info', k: t`Agents`, v: (connection.agents ?? []).length > 0 ? t`${(connection.agents ?? []).join(', ')} — get access within a few minutes` : t`no agent uses the connection yet` },
            { tone: 'ok', k: t`Reversible`, v: t`yes — revoke the connection or enter another key` },
          ]} />
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}

function RevokeDialog({ connection, onClose }: { connection: Connection, onClose: () => void }) {
  const refresh = useRefresh()
  const [reason, setReason] = useState('')
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const agents = connection.agents ?? []
  const revoke = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Revoking: deleting the access from the secret store…`, at: now() }])
    try {
      await revokeConnection(connection.key, reason)
      setDone(true)
      setRows([{ state: 'done', text: t`Revoked — the access is deleted; agents are refused from now on`, at: now() }])
      refresh()
    } catch (error) {
      const text = errorText(error)
      setRows([{ state: 'fail', text: t`Not revoked: ${text}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog alert title={t`Revoke the connection`} sub={connection.displayName} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="danger" disabled={busy} onClick={() => void revoke()}>{t`Revoke`}</Button></>}>
      {done ? null : (
        <>
          <Consequences items={[
            { tone: 'warn', k: t`Access`, v: t`is deleted from the secret store at once, with all its versions` },
            { tone: 'warn', k: t`Agents`, v: agents.length > 0 ? t`${agents.join(', ')} — are refused from the next request` : t`no agent uses the connection` },
            { tone: 'info', k: t`What stays`, v: t`the connection, its key, settings and history` },
            { tone: 'ok', k: t`Reversible`, v: t`yes — connect again under the same key` },
          ]} />
          <div className="tc-form">
            <Field label={t`Why`} wide help={t`Optional; recorded with the connection.`}>
              <textarea className="tc-textarea" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
            </Field>
          </div>
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}

/** Настройки подключения по `settingsSchema` его типа; роли этапов класса CRM — своим редактором. */
function ConnectionSettings({ connection, schema, rows, setRows }: { connection: Connection, schema: FormSchema, rows: DecisionStatusRow[], setRows: (rows: DecisionStatusRow[]) => void }) {
  const refresh = useRefresh()
  const props = schema.properties ?? {}
  const rolesKey = Object.keys(props).find(k => isStageRolesField(props[k]!))
  const formSchema: FormSchema = rolesKey === undefined ? schema : { ...schema, properties: Object.fromEntries(Object.entries(props).filter(([k]) => k !== rolesKey)) }
  const ui = defaultUi(formSchema)
  const [values, setValues] = useState<Values>(() => ({ ...connection.settings }))
  const [errors, setErrors] = useState<Errors>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const payload = cleanSettings(values) as Values
  const dirty = JSON.stringify(payload) !== JSON.stringify(cleanSettings(connection.settings))
  const blocker = useBlocker({ shouldBlockFn: () => dirty && !busy, enableBeforeUnload: () => dirty && !busy, withResolver: true })

  const save = async (): Promise<void> => {
    const found = validate(formSchema, ui, values)
    setErrors(found)
    setServerErrors({})
    if (Object.keys(found).length > 0) return
    setBusy(true)
    setRows([{ state: 'wait', text: t`Saving the settings…`, at: now() }])
    try {
      await updateConnection(connection.key, connection.version, { settings: payload })
      setRows([{ state: 'done', text: t`Saved — the connector and agents read them on their next pass`, at: now() }])
      refresh()
    } catch (error) {
      setServerErrors(settingsFieldErrors(error))
      const reason = errorText(error)
      setRows([{ state: 'fail', text: t`Not saved: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  const change = (k: string, v: unknown): void => {
    setValues(s => ({ ...s, [k]: v }))
    setErrors(e => { const { [k]: _, ...rest } = e; return rest })
    setServerErrors(e => Object.fromEntries(Object.entries(e).filter(([p]) => p !== k && !p.startsWith(`${k}/`))))
  }
  return (
    <section className="cn-settings" aria-label={t`Settings of the connection`}>
      <h3 className="cn-h">{t`Settings`}</h3>
      <p className="tc-muted st-lead">{t`Not secret: the connector and agents of the connection read them. The type of the connection decides what is here.`}</p>
      {rolesKey !== undefined
        ? <StageRoles connection={connection} field={props[rolesKey]!} value={(values[rolesKey] as StageRole[] | undefined) ?? []} disabled={busy} errors={serverErrors} errorPrefix={rolesKey} onChange={v => change(rolesKey, v)} />
        : null}
      {Object.keys(formSchema.properties ?? {}).length > 0
        ? <SchemaForm schema={formSchema} ui={ui} values={values} errors={errors} serverErrors={serverErrors} disabled={busy} onChange={change} />
        : null}
      <div className="st-actions">
        <Button variant="brand" disabled={!dirty || busy} onClick={() => void save()}>{t`Save settings`}</Button>
        <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setValues({ ...connection.settings }); setErrors({}); setServerErrors({}); setRows([]) }}>{t`Discard changes`}</Button>
      </div>
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
      {blocker.status === 'blocked'
        ? (
          <Dialog title={t`The changes are not saved`} sub={connection.displayName} onClose={() => blocker.reset()}
            footer={<><Button variant="ghost" onClick={() => blocker.reset()}>{t`Stay`}</Button><Button variant="danger" onClick={() => blocker.proceed()}>{t`Leave without saving`}</Button></>}>
            <Consequences items={[{ tone: 'warn', k: t`Changes`, v: t`are lost: the connection keeps the saved settings` }]} />
          </Dialog>
        )
        : null}
    </section>
  )
}

/** «Приложения OAuth»: client id и secret приложения провайдера — один раз на тип. */
function OAuthApps({ types }: { types: ConnectionType[] }) {
  const oauthTypes = [...new Map(types.filter(ty => ty.spec.auth.includes('oauth2')).sort((a, b) => a.version - b.version).map(ty => [ty.key, ty])).values()]
  if (oauthTypes.length === 0) return null
  return (
    <SubZone title={t`OAuth applications`} count={oauthTypes.length}>
      <p className="tc-muted st-lead">{t`To connect over sign-in, the other system needs an application of the organization: its client id and secret are entered once per type. The secret goes to the secret store; replacing it destroys the previous one.`}</p>
      <ul className="cn-apps">{oauthTypes.map(ty => <OAuthAppRow key={ty.key} type={ty} />)}</ul>
    </SubZone>
  )
}

function OAuthAppRow({ type }: { type: ConnectionType }) {
  const app = useOAuthApp(type.key)
  const [editing, setEditing] = useState(false)
  const configured = app.data?.configured === true
  const updated = app.data?.updatedAt != null ? since(app.data.updatedAt) : undefined
  return (
    <li>
      <span className="cn-main">
        <span className="cn-title">{type.spec.displayName}</span>
        <span className="tc-muted cn-meta">
          {app.isPending ? t`Loading…` : app.isError ? errorText(app.error) : configured ? t`entered: ${app.data?.clientId ?? ''}${updated !== undefined ? ` · ${updated}` : ''}` : t`not entered — connecting over sign-in is not possible yet`}
        </span>
      </span>
      <Button variant={configured ? 'ghost' : 'secondary'} size="sm" disabled={!app.isSuccess} onClick={() => setEditing(true)}>{configured ? t`Replace` : t`Enter`}</Button>
      {editing ? <OAuthAppDialog type={type} clientId={app.data?.clientId ?? ''} configured={configured} onClose={() => setEditing(false)} /> : null}
    </li>
  )
}

function OAuthAppDialog({ type, clientId: current, configured, onClose }: { type: ConnectionType, clientId: string, configured: boolean, onClose: () => void }) {
  const client = useQueryClient()
  const [clientId, setClientId] = useState(current)
  const [secret, setSecret] = useState('')
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Sending the application to the secret store…`, at: now() }])
    try {
      await setOAuthApp(type.key, { clientId: clientId.trim(), clientSecret: secret })
      setSecret('')
      setDone(true)
      setRows([{ state: 'done', text: t`Saved — new sign-ins of this type use the application`, at: now() }])
      void client.invalidateQueries({ queryKey: ['connections', 'oauth-app', type.key] })
    } catch (error) {
      const reason = errorText(error)
      setRows([{ state: 'fail', text: t`Not saved: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  const close = (): void => { setSecret(''); onClose() }
  return (
    <Dialog title={configured ? t`Replace the OAuth application` : t`Enter the OAuth application`} sub={type.spec.displayName} onClose={close}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={close} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy || clientId.trim() === '' || secret === ''} onClick={() => void save()}>{t`Save`}</Button></>}>
      {done ? null : (
        <>
          <div className="tc-form">
            <Field label={t`Client id`} wide help={t`From the settings of the integration in the other system.`}>
              <input className="tc-input tc-mono" value={clientId} maxLength={500} autoComplete="off" spellCheck={false} onChange={e => setClientId(e.target.value)} />
            </Field>
            <Field label={t`Client secret`} wide help={t`It goes straight to the secret store. After saving nobody sees it — the console neither.`}>
              <input className="tc-input tc-mono" type="password" value={secret} maxLength={4096} autoComplete="new-password" spellCheck={false} onChange={e => setSecret(e.target.value)} />
            </Field>
          </div>
          <Consequences items={[
            { tone: configured ? 'warn' : 'info', k: t`Secret`, v: configured ? t`replaces the previous one; the previous secret is destroyed` : t`is kept in the secret store only` },
            { tone: 'info', k: t`Where it acts`, v: t`new sign-ins of connections of this type; existing connections keep their access` },
          ]} />
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
