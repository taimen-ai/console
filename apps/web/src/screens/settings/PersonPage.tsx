import { Button, Callout, Combobox, Consequences, DecisionStatus, DegradedBanner, Dialog, EmptyState, Field, PageHeader, Zone, type DecisionStatusRow } from '@console/ui'
import { i18n } from '@lingui/core'
import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, BASE_PATH } from '../../api/client.ts'
import { pathErrors } from '../../api/fieldErrors.ts'
import { useMe } from '../../api/directory.ts'
import { useAssignments, useRoles, type RoleAssignment } from '../../api/roles.ts'
import type { Principal } from '../../api/types.ts'
import { GiveDialog, RevokeDialog } from './People.tsx'
import './settings.css'
import {
  PERMISSION_GROUPS, PRESETS, addMember, diff, disablePerson, nextPermissions, presetOf, removeMember, saveBinding, savePerson, useBindings, useMemberships, usePerson,
  type Binding, type PersonOut, type Preset, type Profile, type Visibility,
} from '../../api/people.ts'
import { disablePersonFlow, enablePersonFlow, type DisableReport, type StepError } from '../../api/org.ts'
import { useScope, workspaceOptions } from '../../api/scope.tsx'
import { noPeopleAdmin, stepError } from './AddPerson.tsx'
import { clock } from '../../lib/format.ts'

/**
 * Страница человека `/settings/people/{id}` (TAI-ADR-0068, `docs/people.md`): сведения
 * (профиль участника ядра), права (набор + подробно, свои — только чтение), роли, видимость
 * (режим связки и участие в пространствах). Ядро без `PATCH /principals` или без
 * `visibility` у связки — честно: «ядро пока не умеет».
 */

const now = (): string => clock(new Date())
const label = (perm: string): string => {
  for (const g of PERMISSION_GROUPS) for (const [k, d] of g.items) if (k === perm) return i18n._(d)
  return perm
}

function reasonOf(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  if (error.kind === 'forbidden') return error.details?.missing !== undefined ? t`you cannot give rights you do not have yourself` : t`you have no right to change people`
  switch (error.code) {
    case 'version_conflict': case 'if_match_required': case 'invalid_if_match': return t`someone changed this person meanwhile — reopen and try again`
    case 'validation_error': return t`some fields do not fit — see the fields`
    case 'secret_material_rejected': return t`a value looks like a secret — secrets do not belong here`
    case 'member_exists': return t`already participates there`
    case 'principal_managed_by_registry': return t`an agent is described by its package`
    case 'cannot_disable_self': return t`you cannot disable yourself`
    case 'permission_escalation': return t`this person has full access (admin) — only someone with admin can do this`
    case 'principal_not_active': return t`the person is disabled — enable them first`
    case 'visibility_requires_human': return t`only a person can be limited to own workspaces; agents and services get it from their description`
    default: return error.status === 404 || error.status === 405 ? t`the core does not support this yet` : error.detail ?? error.code
  }
}

export function PersonPage({ id }: { id: string }) {
  useLingui()
  const me = useMe().data?.principal.id
  const person = usePerson(id)
  const bindings = useBindings(id)
  const back = <nav className="pc-crumbs" aria-label={t`Path`}><a href={`${BASE_PATH}/settings?section=people`}>{t`← People and roles`}</a></nav>
  if (person.isPending) return <div className="pc-page" aria-busy="true">{back}<p className="tc-muted">{t`Loading…`}</p></div>
  if (person.isError) {
    return (
      <div className="pc-page">
        {back}
        {person.error instanceof ApiError && person.error.status === 404
          ? <EmptyState title={t`Person not found`} body={t`They may have been removed, or you have no right to see people.`} />
          : <DegradedBanner.Section text={reasonOf(person.error)} />}
      </div>
    )
  }
  const p = person.data
  const active = bindings.data?.find(b => b.status === 'active')
  const self = id === me
  const lead = [p.profile?.jobTitle, p.status !== 'active' ? t`disabled` : undefined, self ? t`this is you` : undefined].filter(Boolean).join(' · ')
  return (
    <div className="pc-page">
      {back}
      <PageHeader title={p.displayName} {...(lead !== '' ? { lead } : {})} />
      <Zone title={t`Access`}>
        <div className="pc-body"><AccessPart person={p} bindings={bindings.data ?? []} self={self} /></div>
      </Zone>
      <Zone title={t`Details`}>
        <div className="pc-body"><ProfileForm key={p.id} person={p} /></div>
      </Zone>
      <Zone title={t`Rights`}>
        <div className="pc-body">{bindings.isPending ? <p className="tc-muted">{t`Loading…`}</p>
          : bindings.isError ? <DegradedBanner.Section text={reasonOf(bindings.error)} />
            : active === undefined ? <p className="tc-muted">{t`No sign-in to the organization — no rights here. A person gets them with the first sign-in.`}</p>
              : <RightsForm key={active.id} binding={active} self={self} name={p.displayName} />}</div>
      </Zone>
      <Zone title={t`Roles`}>
        <div className="pc-body"><RolesPart person={p} /></div>
      </Zone>
      <Zone title={t`Visibility`}>
        <div className="pc-body"><VisibilityPart key={active?.id ?? 'none'} person={p} binding={active} self={self} /></div>
      </Zone>
    </div>
  )
}

/** Роли человека: где действует каждая, отозвать; «Дать роль» — те же диалоги, что в списке людей. */
function RolesPart({ person }: { person: PersonOut }) {
  const roles = useRoles()
  const scope = useScope()
  const assignments = useAssignments([person.id])
  const [giving, setGiving] = useState(false)
  const [revoking, setRevoking] = useState<RoleAssignment | null>(null)
  const principal = { id: person.id, kind: 'human', displayName: person.displayName, status: person.status } as Principal
  const wsName = new Map(scope.nodes.map(n => [n.id, n.name]))
  const where = (ws: string | null): string => ws === null ? t`whole organization` : wsName.get(ws) ?? t`a workspace`
  const list = assignments.byPrincipal.get(person.id)
  return (
    <>
      <p className="tc-muted pc-lead">{t`A role is a rule for picking who does work; authority is separate.`}</p>
      {list === undefined ? <p className="tc-muted">{assignments.failed ? t`could not load` : t`Loading…`}</p>
        : list.length === 0 ? <p className="tc-muted">{t`no roles`}</p>
          : (
            <ul className="pp-roles" aria-label={t`Roles of ${person.displayName}`}>
              {list.map(a => (
                <li key={a.id} className="pp-role">
                  <span className="pp-role-text"><span>{a.role.name}</span> <span className="tc-muted pp-meta">{where(a.workspaceId)}</span></span>
                  <button type="button" className="pp-x" aria-label={t`Revoke the role ${a.role.name} from ${person.displayName}`} onClick={() => setRevoking(a)}>×</button>
                </li>
              ))}
            </ul>
          )}
      <div className="st-actions"><Button variant="secondary" disabled={!roles.isSuccess || person.status !== 'active'} onClick={() => setGiving(true)}>{t`Give a role`}</Button></div>
      {giving && roles.isSuccess ? <GiveDialog person={principal} roles={roles.data} held={list ?? []} where={where} onClose={() => setGiving(false)} /> : null}
      {revoking !== null ? <RevokeDialog person={principal} assignment={revoking} where={where} onClose={() => setRevoking(null)} /> : null}
    </>
  )
}

function useRefresh(id: string) {
  const client = useQueryClient()
  return (): void => {
    void client.invalidateQueries({ queryKey: ['principal', id] })
    void client.invalidateQueries({ queryKey: ['principals'] })
    void client.invalidateQueries({ queryKey: ['workspace'] })
  }
}

const PROFILE_FIELDS: { key: keyof Profile, label: () => string, type?: string, max: number }[] = [
  { key: 'jobTitle', label: () => t`Position`, max: 200 },
  { key: 'email', label: () => t`Work email`, type: 'email', max: 320 },
  { key: 'phone', label: () => t`Phone`, type: 'tel', max: 50 },
  { key: 'note', label: () => t`Note`, max: 2000 },
]

function ProfileForm({ person }: { person: PersonOut }) {
  const refresh = useRefresh(person.id)
  const supported = person.version !== undefined
  const [name, setName] = useState(person.displayName)
  const [profile, setProfile] = useState<Profile>(() => ({ ...person.profile }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const clean = (p: Profile): Profile => Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'string' && v.trim() !== '').map(([k, v]) => [k, (v as string).trim()]))
  const dirty = name.trim() !== person.displayName || JSON.stringify(clean(profile)) !== JSON.stringify(clean(person.profile ?? {}))
  const save = async (): Promise<void> => {
    if (name.trim() === '') { setErrors({ displayName: t`a name is required` }); return }
    setBusy(true)
    setErrors({})
    setRows([{ state: 'wait', text: t`Saving the details…`, at: now() }])
    try {
      await savePerson(person.id, person.version!, { ...(name.trim() !== person.displayName ? { displayName: name.trim() } : {}), profile: clean(profile) })
      setRows([{ state: 'done', text: t`Saved — the new details are shown everywhere`, at: now() }])
      refresh()
    } catch (error) {
      setErrors(pathErrors(error, 'profile/'))
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not saved: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {!supported ? <Callout tone="info">{t`The core does not let change the details of people yet — it comes with the people-access feature.`}</Callout> : null}
      <div className="tc-form">
        <Field label={t`Full name`} help={errors.displayName}>
          <input className="tc-input" value={name} maxLength={200} disabled={!supported || busy} aria-invalid={errors.displayName !== undefined} onChange={e => setName(e.target.value)} />
        </Field>
        {PROFILE_FIELDS.map(f => (
          <Field key={f.key} label={f.label()} {...(f.key === 'note' ? { wide: true } : {})} help={errors[f.key]}>
            {f.key === 'note'
              ? <textarea className="tc-textarea" rows={2} maxLength={f.max} value={profile[f.key] ?? ''} disabled={!supported || busy} aria-invalid={errors[f.key] !== undefined} onChange={e => setProfile(p => ({ ...p, [f.key]: e.target.value }))} />
              : <input className="tc-input" type={f.type ?? 'text'} maxLength={f.max} value={profile[f.key] ?? ''} disabled={!supported || busy} aria-invalid={errors[f.key] !== undefined} onChange={e => setProfile(p => ({ ...p, [f.key]: e.target.value }))} />}
          </Field>
        ))}
      </div>
      {supported
        ? (
          <div className="st-actions">
            <Button variant="brand" disabled={!dirty || busy} onClick={() => void save()}>{t`Save details`}</Button>
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setName(person.displayName); setProfile({ ...person.profile }); setErrors({}); setRows([]) }}>{t`Discard changes`}</Button>
          </div>
        )
        : null}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </>
  )
}

function RightsForm({ binding, self, name }: { binding: Binding, self: boolean, name: string }) {
  const refresh = useRefresh(binding.principalId)
  const current = presetOf(binding.permissions)
  const [chosen, setChosen] = useState<string[]>(() => binding.permissions)
  const [detail, setDetail] = useState(current === 'custom')
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const next = nextPermissions(binding.permissions, chosen)
  const change = diff(binding.permissions, next)
  const preset = presetOf(next)
  const admin = binding.permissions.includes('admin')
  const presets: [Preset, string, string][] = [
    ['observe', t`Observes`, t`sees work, decisions, materials and the organization; changes nothing`],
    ['work', t`Works`, t`also takes and does work, decides approvals, adds materials`],
    ['manage', t`Manages the organization`, t`also rules, roles, people, workspaces and types of work`],
  ]
  const toggle = (perm: string, on: boolean): void => setChosen(c => on ? [...new Set([...c, perm])] : c.filter(p => p !== perm))
  const save = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Saving the rights…`, at: now() }])
    try {
      await saveBinding(binding, next)
      setRows([{ state: 'done', text: t`Saved — they act from the next request of the person`, at: now() }])
      refresh()
    } catch (error) {
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not saved: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {self ? <Callout tone="info">{t`These are your own rights: they are not changed here, so that you do not lose access. Another administrator can change them.`}</Callout> : null}
      {admin ? <Callout tone="info">{t`${name} has full access (admin). The console neither gives nor takes it away.`}</Callout> : null}
      <div className="pc-presets" role="radiogroup" aria-label={t`Set of rights`}>
        {presets.map(([key, title, hint]) => (
          <label key={key} className={preset === key ? 'pc-preset pc-on' : 'pc-preset'}>
            <input type="radio" name={`preset-${binding.id}`} checked={preset === key} disabled={self || busy} onChange={() => setChosen(PRESETS[key])} />
            <b>{title}</b><span className="tc-muted pc-hint">{hint}</span>
          </label>
        ))}
        {preset === 'custom' ? <p className="tc-muted pc-hint">{t`Now: a custom set — rights chosen one by one.`}</p> : null}
      </div>
      <button type="button" className="st-link-btn pc-toggle" aria-expanded={detail} onClick={() => setDetail(d => !d)}>{detail ? t`Hide the rights one by one` : t`Show the rights one by one`}</button>
      {detail
        ? (
          <div className="pc-groups">
            {PERMISSION_GROUPS.map(g => (
              <fieldset key={g.key} className="pc-group">
                <legend>{i18n._(g.title)}</legend>
                {g.items.map(([perm, d]) => (
                  <label key={perm} className="pc-perm">
                    <input type="checkbox" checked={chosen.includes(perm)} disabled={self || busy} onChange={e => toggle(perm, e.target.checked)} />
                    <span>{i18n._(d)}</span>
                    <span className="tc-mono tc-muted pc-hint">{perm}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        )
        : null}
      {!self && (change.added.length > 0 || change.removed.length > 0)
        ? (
          <>
            <Consequences items={[
              ...(change.added.length > 0 ? [{ tone: 'info' as const, k: t`Will be able to`, v: change.added.map(label).join(', ') }] : []),
              ...(change.removed.length > 0 ? [{ tone: 'warn' as const, k: t`Will lose`, v: change.removed.map(label).join(', ') }] : []),
              { tone: 'info', k: t`When`, v: t`from the next request of ${name}; work already taken stays` },
              { tone: 'ok', k: t`Reversible`, v: t`yes — change the rights again` },
            ]} />
            <div className="st-actions">
              <Button variant="brand" disabled={busy} onClick={() => void save()}>{t`Save rights`}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => { setChosen(binding.permissions); setRows([]) }}>{t`Discard changes`}</Button>
            </div>
          </>
        )
        : null}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </>
  )
}

function VisibilityPart({ person, binding, self }: { person: PersonOut, binding: Binding | undefined, self: boolean }) {
  const refresh = useRefresh(person.id)
  const scope = useScope()
  const ids = scope.nodes.map(n => n.id)
  const memberships = useMemberships(person.id, ids)
  const supported = binding?.visibility !== undefined
  const [mode, setMode] = useState<Visibility>(binding?.visibility ?? 'tenant')
  const [adding, setAdding] = useState<string | null>(null)
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const name = (id: string): string => scope.nodes.find(n => n.id === id)?.name ?? id
  const memberNames = memberships.member.map(name)
  const changed = binding !== undefined && supported && mode !== binding.visibility
  const run = async (text: string, done: string, act: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text, at: now() }])
    try {
      await act()
      setRows([{ state: 'done', text: done, at: now() }])
      refresh()
    } catch (error) {
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not recorded: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {person.kind !== 'human' ? <Callout tone="info">{t`What an agent or a service sees is set by its description, not here: “only own workspaces” is for people.`}</Callout>
        : binding === undefined ? <p className="tc-muted">{t`No sign-in — the person sees nothing; participation still matters for picking executors.`}</p>
        : !supported ? <Callout tone="info">{t`The core does not limit what a person sees yet — it comes with the people-access feature. Participation below already counts for picking executors.`}</Callout>
          : (
            <div className="pc-presets" role="radiogroup" aria-label={t`What the person sees`}>
              <label className={mode === 'tenant' ? 'pc-preset pc-on' : 'pc-preset'}>
                <input type="radio" name={`vis-${person.id}`} checked={mode === 'tenant'} disabled={self || busy} onChange={() => setMode('tenant')} />
                <b>{t`Whole organization`}</b><span className="tc-muted pc-hint">{t`sees the work of all workspaces — what the rights allow`}</span>
              </label>
              <label className={mode === 'members' ? 'pc-preset pc-on' : 'pc-preset'}>
                <input type="radio" name={`vis-${person.id}`} checked={mode === 'members'} disabled={self || busy} onChange={() => setMode('members')} />
                <b>{t`Only own workspaces`}</b><span className="tc-muted pc-hint">{t`sees only the workspaces they participate in, and the nested ones; anything else is “not found” for them`}</span>
              </label>
            </div>
          )}
      {self && supported ? <p className="tc-muted pc-hint">{t`Your own visibility is not changed here.`}</p> : null}
      <div className="pc-members">
        <p className="pc-sub">{t`Participates in`}</p>
        {memberships.forbidden ? <p className="tc-muted">{t`You have no right to see participation.`}</p>
          : memberships.pending ? <p className="tc-muted">{t`Loading…`}</p>
            : memberNames.length === 0 ? <p className="tc-muted">{t`no workspace`}</p>
              : (
                <ul className="pc-ws" aria-label={t`Workspaces of ${person.displayName}`}>
                  {memberships.member.map(ws => (
                    <li key={ws}>
                      <span>{name(ws)}</span>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(t`Removing from the workspace…`, t`Removed — recorded in the core`, () => removeMember(ws, person.id))}>{t({ id: 'people.membership.remove', message: 'Remove' })}</Button>
                    </li>
                  ))}
                </ul>
              )}
        <div className="pc-add">
          <Combobox label={t`Add to a workspace`} value={adding} onChange={setAdding} placeholder={t`add to a workspace`}
            options={workspaceOptions(scope.nodes).filter(o => o.value !== null && !memberships.member.includes(o.value))} />
          <Button variant="secondary" disabled={adding === null || busy} onClick={() => { const ws = adding!; void run(t`Adding to the workspace…`, t`Added — recorded in the core`, () => addMember(ws, person.id)).then(() => setAdding(null)) }}>{t`Add`}</Button>
        </div>
      </div>
      {changed
        ? (
          <>
            <Consequences items={mode === 'members'
              ? [
                  memberNames.length === 0
                    ? { tone: 'warn' as const, k: t`What happens`, v: t`${person.displayName} participates nowhere and will not see any work` }
                    : { tone: 'warn' as const, k: t`What happens`, v: t`${person.displayName} will see only: ${memberNames.join(', ')} and the nested workspaces` },
                  { tone: 'info', k: t`Work already assigned`, v: t`stays with them, even outside what they see` },
                  { tone: 'ok', k: t`Reversible`, v: t`yes — return “Whole organization”` },
                ]
              : [
                  { tone: 'info', k: t`What happens`, v: t`${person.displayName} sees the work of all workspaces — what the rights allow` },
                  { tone: 'ok', k: t`Reversible`, v: t`yes` },
                ]} />
            <div className="st-actions">
              <Button variant="brand" disabled={busy} onClick={() => void run(t`Saving the visibility…`, t`Saved — acts from the next request`, () => saveBinding(binding!, binding!.permissions, mode))}>{t`Save visibility`}</Button>
            </div>
          </>
        )
        : null}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </>
  )
}

/**
 * «Доступ»: активен ли человек и есть ли вход. «Отключить» и «Включить» — потоки BFF через IAM
 * и ядро (`api/org.ts`): вход закрывается и открывается и в IAM; права после включения называет
 * оператор (прежние или набор). Без права администратора людей отключение идёт только ядром.
 */
function AccessPart({ person, bindings, self }: { person: PersonOut, bindings: Binding[], self: boolean }) {
  const refresh = useRefresh(person.id)
  const client = useQueryClient()
  const [open, setOpen] = useState<'disable' | 'enable' | null>(null)
  const active = bindings.find(b => b.status === 'active')
  const revoked = bindings.find(b => b.status === 'revoked')
  const disabled = person.status !== 'active'
  return (
    <>
      <p className="pc-status">
        {disabled ? <b className="pc-off">{t`Disabled`}</b> : <b>{t`Active`}</b>}
        <span className="tc-muted"> · {active !== undefined ? t`can sign in` : revoked !== undefined ? t`sign-in revoked` : t`never signed in`}</span>
      </p>
      {self ? <p className="tc-muted pc-hint">{t`You cannot disable yourself.`}</p> : (
        <div className="st-actions">
          {disabled
            ? <Button variant="secondary" onClick={() => setOpen('enable')}>{t`Enable`}</Button>
            : <Button variant="ghost" onClick={() => setOpen('disable')}>{t`Disable`}</Button>}
        </div>
      )}
      {open === 'disable' ? <AccessDialog mode="disable" person={person} restore={undefined} onClose={() => setOpen(null)} onDone={() => { refresh(); void client.invalidateQueries({ queryKey: ['tasks'] }) }} /> : null}
      {open === 'enable' ? <AccessDialog mode="enable" person={person} restore={revoked} onClose={() => setOpen(null)} onDone={refresh} /> : null}
    </>
  )
}

function AccessDialog({ mode, person, restore, onClose, onDone }: { mode: 'disable' | 'enable', person: PersonOut, restore: Binding | undefined, onClose: () => void, onDone: () => void }) {
  const [reason, setReason] = useState('')
  // Права после включения: прежние (отозванной связки) или набор — называет оператор.
  const [rights, setRights] = useState<'previous' | Preset>(restore !== undefined ? 'previous' : 'work')
  const [key] = useState(() => crypto.randomUUID())
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const name = person.displayName
  const step = (state: DecisionStatusRow['state'], text: string): void => setRows(r => [...r.filter(x => x.state !== 'wait'), { state, text, at: now() }])
  const flowFailed = (error: (StepError & { service: 'iam' | 'cp' }) | undefined): void => {
    const where = error?.service === 'iam' ? t`IAM` : t`the core`
    const text = stepError(error)
    step('fail', t`Stopped at ${where}: ${text}. Repeating finishes what is left.`)
  }
  const run = async (): Promise<void> => {
    setBusy(true)
    setRows([])
    try {
      if (mode === 'disable') {
        step('wait', t`Disabling: closing the sign-in in IAM, revoking rights, closing sessions, releasing work…`)
        let report: DisableReport
        try {
          report = await disablePersonFlow(person.id, reason)
        } catch (error) {
          if (!noPeopleAdmin(error)) throw error
          // Не администратор людей: только ядро — вход в IAM остаётся, но сделать ничего нельзя.
          await disablePerson(person.id, reason)
          step('done', t`Disabled in the organization`)
          step('done', t`The account in IAM stays open: closing it needs an administrator of people — without rights it gives nothing`)
          setDone(true)
          onDone()
          return
        }
        if (!report.complete) { flowFailed(report.error); onDone(); return }
        step('done', report.iam === 'skipped' ? t`No account in IAM — nothing to close` : t`Sign-in closed in IAM`)
        step('done', t`Disabled in the organization — rights revoked, sessions closed`)
      } else {
        step('wait', t`Enabling: opening the sign-in in IAM, enabling, giving rights…`)
        const permissions = rights === 'previous' && restore !== undefined ? restore.permissions : PRESETS[rights === 'previous' ? 'work' : rights]
        const report = await enablePersonFlow(person.id, reason, permissions, key)
        if (!report.complete) { flowFailed(report.error); onDone(); return }
        step('done', report.iam === 'reused' ? t`The sign-in in IAM was already open` : t`Sign-in opened in IAM`)
        step('done', report.cp === 'reused' ? t`Already active in the organization` : t`Enabled in the organization`)
        step('done', report.binding === 'reused' ? t`Rights were already there` : t`Rights given — act from the next sign-in`)
      }
      setDone(true)
      onDone()
    } catch (error) {
      const text = noPeopleAdmin(error) ? t`enabling needs an administrator of people (IAM group people-admins)` : reasonOf(error)
      step('fail', t`Not recorded: ${text}`)
    } finally {
      setBusy(false)
    }
  }
  const previousSet = restore !== undefined ? presetOf(restore.permissions) : 'custom'
  return (
    <Dialog alert={mode === 'disable'} title={mode === 'disable' ? t`Disable ${name}` : t`Enable ${name}`} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant={mode === 'disable' ? 'danger' : 'brand'} disabled={busy} onClick={() => void run()}>{mode === 'disable' ? t`Disable` : t`Enable`}</Button></>}>
      {done ? null : (
        <>
          <Consequences items={mode === 'disable'
            ? [
                { tone: 'warn', k: t`Sign-in`, v: t`is closed in IAM and revoked in the organization at once; open sessions of the assistant and plugins are closed` },
                { tone: 'warn', k: t`Work in hand`, v: t`is released: the work stays assigned to ${name} — hand it over` },
                { tone: 'info', k: t`What stays`, v: t`the person, their roles, history and authorship` },
                { tone: 'ok', k: t`Reversible`, v: t`yes — enable again and name the rights` },
              ]
            : [
                { tone: 'info', k: t`What happens`, v: t`${name} can sign in again and is active` },
                { tone: 'info', k: t`Rights`, v: t`revoked rights do not come back by themselves — they are given anew` },
              ]} />
          <div className="tc-form">
            {mode === 'enable'
              ? (
                <Field label={t`Rights after enabling`} help={t`You cannot give rights you do not hold.`}>
                  <select className="tc-select" value={rights} onChange={e => setRights(e.target.value as 'previous' | Preset)}>
                    {restore !== undefined ? <option value="previous">{previousSet === 'custom' ? t`Previous rights (${restore.permissions.length})` : t`Previous rights`}</option> : null}
                    <option value="observe">{t`Observe`}</option>
                    <option value="work">{t`Work`}</option>
                    <option value="manage">{t`Manage`}</option>
                  </select>
                </Field>
              )
              : null}
            <Field label={t`Why`} wide help={t`Optional; recorded in the journal.`}>
              <textarea className="tc-textarea" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
            </Field>
          </div>
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
