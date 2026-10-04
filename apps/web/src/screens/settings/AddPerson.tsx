import { Button, Combobox, Consequences, DecisionStatus, DegradedBanner, Dialog, Field, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../../api/client.ts'
import { addPerson, usePendingPeople, type FlowReport, type PendingPerson, type PersonInput, type StepError, type StepName } from '../../api/org.ts'
import { PRESETS, presetOf, type Preset } from '../../api/people.ts'
import { useRoles } from '../../api/roles.ts'
import { useScope, workspaceOptions } from '../../api/scope.tsx'
import { clock } from '../../lib/format.ts'
import { SubZone } from './SubZone.tsx'

/**
 * «Люди и роли» → «Добавить человека» (поток BFF `apps/bff/src/org.ts`, TAI-ADR-0058 п.6):
 * учётка в IAM, вход у провайдера (его `sub`), участник ядра, права, пространство и роли — одним
 * идемпотентным потоком от имени администратора людей. Пользователя у самого провайдера входа
 * консоль не заводит (`deploy/README.md` суперпроекта, «Завести человека»). Недоведённое видно в
 * «Не доведены» — по данным серверов, повтор доводит.
 */

const now = (): string => clock(new Date())

export function stepTitle(step: StepName): string {
  switch (step) {
    case 'idp_user': return t`User at the identity provider`
    case 'iam_principal': return t`Account in IAM`
    case 'identity': return t`Sign-in at the identity provider`
    case 'cp_principal': return t`Participant of the organization`
    case 'binding': return t`Rights`
    case 'member': return t`Workspace`
    case 'roles': return t`Roles`
  }
}

export function stepError(error: StepError | undefined): string {
  if (error === undefined) return t`unknown error`
  switch (error.code) {
    case 'permission_escalation': return t`you cannot give rights you do not hold: ${(error.missing ?? []).join(', ')}`
    case 'permission_denied': return t`you have no right to do this`
    case 'identity_mismatch': return t`this person signs in under another identifier — check the identifier`
    case 'identity_bound_elsewhere': return t`this sign-in already belongs to another participant`
    case 'identity_disabled': return t`this sign-in is disabled in IAM`
    case 'identity_unverifiable': return t`IAM cannot tell whose sign-in this is — update IAM`
    case 'person_disabled': return t`the person is disabled — enable them on their page`
    case 'lookup_incomplete': return t`too many participants to check — ask the administrator of the platform`
    case 'upstream_unavailable': return t`the service did not answer — try again, the flow continues where it stopped`
    case 'cannot_disable_self': return t`you cannot disable yourself`
    case 'iam_login_closed': return t`the sign-in is closed in IAM; only an administrator opens it`
    case 'iam_principal_unknown': return t`the person never signed in — nothing to enable`
    case 'use_agent_retire': return t`an agent is retired by its package`
    case 'use_agent_publish': return t`an agent is enabled by its package`
    case 'idp_admin_disabled': return t`the console does not create users at the identity provider here — enter the identifier`
    case 'idp_user_exists': return t`the identity provider has a user with this login but another e-mail`
    case 'idp_user_ambiguous': return t`the identity provider has several users with this e-mail`
    case 'idp_admin_unauthorized':
    case 'idp_admin_forbidden': return t`the console has no right to manage users at the identity provider`
    case 'idp_unavailable': return t`the identity provider did not answer — try again`
    default: return error.code
  }
}

/** Отказ IAM выдать `iam:people` — не администратор людей. */
export const noPeopleAdmin = (error: unknown): boolean => error instanceof ApiError && error.kind === 'forbidden' && error.code === 'no_permission'

function rowsOf(report: FlowReport): DecisionStatusRow[] {
  return report.steps.map(s => ({
    state: s.status === 'failed' ? 'fail' : s.status === 'pending' ? 'wait' : 'done',
    text: s.status === 'failed' ? t`${stepTitle(s.name)}: ${stepError(s.error)}`
      : s.status === 'reused' ? t`${stepTitle(s.name)}: already there`
        : s.status === 'pending' ? t`${stepTitle(s.name)}: not reached`
          : stepTitle(s.name),
    at: now(),
  }))
}

const EMPTY = { displayName: '', email: '', subject: '', workspaceId: '', roleIds: [] as string[], preset: 'work' as Preset | 'admin', createIdpUser: true }

export function AddPersonDialog({ initial, onClose }: { initial?: Partial<PersonInput>, onClose: () => void }) {
  const client = useQueryClient()
  const scope = useScope()
  const roles = useRoles()
  // Консоль заводит пользователя у провайдера, если развёртывание это включило.
  const idpAdmin = usePendingPeople().data?.idpAdmin === true
  const spaces = workspaceOptions(scope.nodes)
  const [form, setForm] = useState({
    ...EMPTY, ...initial,
    workspaceId: initial?.workspaceId ?? scope.ws ?? spaces[0]?.value ?? '',
    // «Довести»: права из прерванного потока — их набор (прочее — «Работа»).
    preset: initial?.permissions === undefined ? EMPTY.preset
      : initial.permissions.includes('admin') ? 'admin' as const
        : presetOf(initial.permissions) === 'custom' ? EMPTY.preset : presetOf(initial.permissions) as Preset,
  })
  const [report, setReport] = useState<FlowReport | null>(null)
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const set = (key: 'displayName' | 'email' | 'subject') => (e: { target: { value: string } }): void => setForm(f => ({ ...f, [key]: e.target.value }))
  const creating = idpAdmin && form.createIdpUser && (initial?.subject ?? '') === ''
  const ready = form.displayName.trim() !== '' && /^[^\s@]+@[^\s@]+$/.test(form.email.trim()) && (creating || form.subject.trim() !== '') && form.workspaceId !== ''
  // Роли — организации и выбранного пространства (роль пространства действует и в потомках).
  const roleOptions = (roles.data ?? []).filter(r => r.workspaceId === null || r.workspaceId === form.workspaceId).sort((a, b) => a.name.localeCompare(b.name))

  const run = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Adding the person…`, at: now() }])
    try {
      const result = await addPerson({
        displayName: form.displayName.trim(), email: form.email.trim(), subject: creating ? '' : form.subject.trim(), workspaceId: form.workspaceId,
        ...(creating ? { createIdpUser: true } : {}),
        roleIds: form.roleIds.filter(id => roleOptions.some(r => r.id === id)),
        permissions: form.preset === 'admin' ? ['admin'] : PRESETS[form.preset],
      })
      setReport(result)
      setRows(rowsOf(result))
      void client.invalidateQueries({ queryKey: ['principals'] })
      void client.invalidateQueries({ queryKey: ['org', 'people', 'pending'] })
      void client.invalidateQueries({ queryKey: ['principal'] })
    } catch (error) {
      const reason = noPeopleAdmin(error) ? t`you are not an administrator of people (IAM group people-admins)` : error instanceof ApiError && error.code === 'invalid_person' ? t`check the fields` : t`no connection`
      setRows([{ state: 'fail', text: t`Not added: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }

  const done = report?.complete === true
  return (
    <Dialog wide title={t`Add a person`} sub={t`An account in IAM, the sign-in, rights, the workspace and roles — in one go. Repeating it finishes what stopped.`} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={!ready || busy} onClick={() => void run()}>{report !== null ? t`Finish` : t`Add`}</Button></>}>
      {done ? null : (
        <>
          <div className="tc-form">
            <Field label={t`Full name`}><input className="tc-input" value={form.displayName} onChange={set('displayName')} maxLength={200} autoComplete="off" /></Field>
            <Field label={t`E-mail`}><input className="tc-input" type="email" value={form.email} onChange={set('email')} maxLength={254} autoComplete="off" /></Field>
            {idpAdmin && (initial?.subject ?? '') === ''
              ? (
                <label className="pc-check ap-wide">
                  <input type="checkbox" checked={form.createIdpUser} onChange={e => setForm(f => ({ ...f, createIdpUser: e.target.checked }))} />
                  {t`Create the user at the identity provider (login — the e-mail, a temporary password)`}
                </label>
              )
              : null}
            {creating ? null : (
              <Field label={t`Identifier at the identity provider`} wide help={t`The user is created at the identity provider beforehand; here goes their identifier there (sub). Not the e-mail: the sign-in is checked by this identifier.`}>
                <input className="tc-input tc-mono" value={form.subject} onChange={set('subject')} maxLength={500} autoComplete="off" spellCheck={false} />
              </Field>
            )}
            <Field label={t`Workspace`}>
              <Combobox label={t`Workspace`} value={form.workspaceId === '' ? null : form.workspaceId} onChange={v => { if (v !== null) setForm(f => ({ ...f, workspaceId: v })) }} options={spaces} />
            </Field>
            <Field label={t`Rights`} help={t`You cannot give rights you do not hold.`}>
              <select className="tc-select" value={form.preset} onChange={e => setForm(f => ({ ...f, preset: e.target.value as Preset | 'admin' }))}>
                <option value="observe">{t`Observe`}</option>
                <option value="work">{t`Work`}</option>
                <option value="manage">{t`Manage`}</option>
                <option value="admin">{t`Administrator (everything)`}</option>
              </select>
            </Field>
            <Field label={t`Roles`} wide help={roleOptions.length === 0 ? t`No roles in this workspace.` : t`Roles of the organization and of the chosen workspace.`}>
              <div className="ap-roles" role="group" aria-label={t`Roles`}>
                {roleOptions.map(r => (
                  <label key={r.id} className="ap-role">
                    <input type="checkbox" checked={form.roleIds.includes(r.id)} onChange={e => setForm(f => ({ ...f, roleIds: e.target.checked ? [...f.roleIds, r.id] : f.roleIds.filter(x => x !== r.id) }))} />
                    {r.name}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <Consequences items={[
            { tone: 'info', k: t`Sign-in`, v: creating ? t`the person signs in with the link and the temporary password you get at the end` : t`the person signs in with the link you get at the end` },
            { tone: form.preset === 'admin' ? 'warn' : 'info', k: t`Rights`, v: form.preset === 'admin' ? t`everything, including managing people and rights` : t`can be changed later on the person's page` },
          ]} />
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
      {done && report.loginUrl !== null
        ? (
          <div className="ap-done">
            <p>{t`Send the person this link to sign in for the first time:`}</p>
            <p className="tc-mono ap-link">{report.loginUrl}</p>
            <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(report.loginUrl!)}>{t`Copy the link`}</Button>
            {report.idpUser?.temporaryPassword !== undefined
              ? (
                <>
                  <p>{t`Temporary password — shown only now; at the first sign-in the person sets their own:`}</p>
                  <p className="tc-mono ap-link">{report.idpUser.temporaryPassword}</p>
                  <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(report.idpUser!.temporaryPassword!)}>{t`Copy the password`}</Button>
                </>
              )
              : report.idpUser?.created === false
                ? <p className="tc-muted">{t`The user at the identity provider already existed — the person signs in with their own password.`}</p>
                : null}
          </div>
        )
        : null}
    </Dialog>
  )
}

/** «Не доведены» — добавления, остановившиеся посреди; «Довести» повторяет поток. */
export function PendingPeople({ onFinish }: { onFinish: (initial: Partial<PersonInput>) => void }) {
  const pending = usePendingPeople()
  if (pending.isError) return noPeopleAdmin(pending.error) ? null : <DegradedBanner.Section text={t`Could not check unfinished additions.`} />
  const items = pending.data?.items ?? []
  if (items.length === 0) return null
  const missing = (p: PendingPerson): string => p.missing.map(stepTitle).join(', ')
  return (
    <SubZone title={t`Unfinished`} count={items.length}>
      <p className="tc-muted">{t`Additions that stopped midway. Finishing repeats the flow: what is done is not done twice.`}</p>
      <ul className="ap-pending">
        {items.map(p => (
          <li key={p.iamPrincipalId ?? p.cpPrincipalId ?? p.displayName}>
            <span className="ap-who"><b>{p.displayName}</b> <span className="tc-muted">{p.kind === 'iam_only' ? t`only in IAM — finish with the same e-mail as the first time` : t`missing: ${missing(p)}`}</span></span>
            <Button variant="secondary" size="sm" onClick={() => onFinish(p.input ?? { displayName: p.displayName })}>{t`Finish`}</Button>
          </li>
        ))}
      </ul>
      {pending.data?.truncated === true ? <p className="tc-muted">{t`Not everything was checked: too many participants.`}</p> : null}
    </SubZone>
  )
}

