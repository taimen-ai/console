import { Button, Combobox, Consequences, DecisionStatus, DegradedBanner, Dialog, Field, IdentityBlock, SearchField, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, BASE_PATH } from '../../api/client.ts'
import { useMe, usePrincipals } from '../../api/directory.ts'
import { assignRole, createRole, holderCounts, revokeRole, slugOf, updateRole, useAssignments, useRoles, type Role, type RoleAssignment } from '../../api/roles.ts'
import { useScope, workspaceOptions } from '../../api/scope.tsx'
import type { Principal } from '../../api/types.ts'
import { clock } from '../../lib/format.ts'
import { initials } from '../work/rows.ts'
import { AddPersonDialog, PendingPeople } from './AddPerson.tsx'
import type { PersonInput } from '../../api/org.ts'
import { SubZone } from './SubZone.tsx'

/**
 * «Настройки» → «Люди и роли»: кто в организации и какие у кого роли. Роль — правило подбора
 * исполнителя работы (требования задачи, проверка ядра при взятии работы); полномочия —
 * отдельно, их роль не даёт. Здесь: дать и отозвать роль человеку — во всей организации или
 * в пространстве (роль на пространство действует и в его потомках), завести роль, поправить
 * её название; добавить человека и довести недоведённое (`AddPerson.tsx`, поток BFF через IAM
 * и ядро — только администратору людей). Агентам роли задаёт их описание в пакете — здесь их
 * нет. Чтение — `org.read`, изменения — `org.manage`.
 */

const now = (): string => clock(new Date())

function reasonOf(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  if (error.kind === 'forbidden') return t`you have no right to manage roles`
  switch (error.code) {
    case 'role_already_assigned': return t`the person already holds this role there`
    case 'role_slug_taken': return t`a role with this key already exists there`
    case 'version_conflict': return t`someone changed the role meanwhile — reopen it and try again`
    case 'not_found': return t`it is already gone — reopen the section`
    default: return error.detail ?? error.code
  }
}

export function PeopleSection() {
  const principals = usePrincipals()
  const roles = useRoles()
  const me = useMe().data?.principal.id
  const scope = useScope()
  const [query, setQuery] = useState('')
  const [giving, setGiving] = useState<Principal | null>(null)
  const [revoking, setRevoking] = useState<{ person: Principal, assignment: RoleAssignment } | null>(null)
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [adding, setAdding] = useState<Partial<PersonInput> | null>(null)
  const people = [...(principals.data?.values() ?? [])].filter(p => p.kind === 'human').sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.displayName.localeCompare(b.displayName))
  const assignments = useAssignments(people.map(p => p.id))
  const wsName = new Map(scope.nodes.map(n => [n.id, n.name]))
  const where = (workspaceId: string | null): string => workspaceId === null ? t`whole organization` : wsName.get(workspaceId) ?? t`a workspace`
  const counts = holderCounts(assignments.byPrincipal)
  const q = query.trim().toLowerCase()
  const shown = q === '' ? people : people.filter(p => p.displayName.toLowerCase().includes(q) || (assignments.byPrincipal.get(p.id) ?? []).some(a => a.role.name.toLowerCase().includes(q)))

  if (roles.isError && roles.error instanceof ApiError && roles.error.kind === 'forbidden') {
    return <DegradedBanner.Section text={t`You have no right to read roles (org.read).`} />
  }
  return (
    <div className="pp">
      <p className="tc-muted st-lead">{t`A role is a rule for picking who does work: work can require a role, and whoever lacks it cannot take the work. Authority is separate — a role does not give it. People are added here by an administrator of people; agents get roles from their description.`}</p>
      <PendingPeople onFinish={setAdding} />
      <SubZone title={t`People`} {...(principals.isSuccess ? { count: people.length } : {})}>
        <div className="pp-search"><SearchField label={t`Find a person or a role`} placeholder={t`Find a person or a role`} value={query} onChange={e => setQuery(e.target.value)} /></div>
        {principals.isPending ? <p className="tc-muted">{t`Loading…`}</p> : null}
        {principals.isError ? <DegradedBanner.Section text={t`Could not load the people: no connection to the core.`} /> : null}
        {principals.isSuccess && shown.length === 0 ? <p className="tc-muted">{q === '' ? t`No people yet.` : t`Nobody found.`}</p> : null}
        <ul className="pp-people">
          {shown.map((p) => {
            const list = assignments.byPrincipal.get(p.id)
            return (
              <li key={p.id} className={p.status === 'active' ? undefined : 'pp-off'}>
                <div className="pp-who">
                  <a className="pp-link" href={`${BASE_PATH}/settings/people/${p.id}`}>
                    <IdentityBlock kind="human" name={p.id === me ? t`${p.displayName} (you)` : p.displayName} label={initials(p.displayName)} inline size="sm" />
                  </a>
                  {p.status !== 'active' ? <span className="tc-muted pp-meta">{t`disabled`}</span> : null}
                </div>
                <ul className="pp-roles" aria-label={t`Roles of ${p.displayName}`}>
                  {list === undefined ? <li className="tc-muted pp-meta">{assignments.failed ? t`could not load` : '…'}</li> : null}
                  {list !== undefined && list.length === 0 ? <li className="tc-muted pp-meta">{t`no roles`}</li> : null}
                  {(list ?? []).map(a => (
                    <li key={a.id} className="pp-role">
                      <span className="pp-role-text"><span>{a.role.name}</span> <span className="tc-muted pp-meta">{where(a.workspaceId)}</span></span>
                      <button type="button" className="pp-x" aria-label={t`Revoke the role ${a.role.name} from ${p.displayName}`} onClick={() => setRevoking({ person: p, assignment: a })}>×</button>
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" size="sm" disabled={p.status !== 'active' || !roles.isSuccess} onClick={() => setGiving(p)}>{t`Give a role`}</Button>
              </li>
            )
          })}
        </ul>
        <div className="st-actions"><Button variant="secondary" onClick={() => setAdding({})}>{t`Add a person`}</Button></div>
      </SubZone>
      <SubZone title={t`Roles`} {...(roles.isSuccess ? { count: roles.data.length } : {})}>
        {roles.isPending ? <p className="tc-muted">{t`Loading…`}</p> : null}
        {roles.isError ? <DegradedBanner.Section text={t`Could not load the roles: no connection to the core.`} /> : null}
        {roles.isSuccess && roles.data.length === 0 ? <p className="tc-muted">{t`No roles yet: they come with packages or are created here.`}</p> : null}
        {roles.isSuccess && roles.data.length > 0
          ? (
            <table className="pp-table">
              <thead><tr><th scope="col">{t`Role`}</th><th scope="col">{t`Where it acts`}</th><th scope="col">{t`People`}</th><th scope="col"><span className="tc-sr">{t`Actions`}</span></th></tr></thead>
              <tbody>
                {[...roles.data].sort((a, b) => a.name.localeCompare(b.name)).map(r => (
                  <tr key={r.id}>
                    <th scope="row">
                      <span className="pp-role-name">{r.name}</span>
                      <span className="tc-muted pp-meta"><span className="tc-mono">{r.slug}</span>{r.package != null ? ` · ${t`package`} ${r.package.key}` : ''}{r.description ? ` · ${r.description}` : ''}</span>
                    </th>
                    <td data-label={t`Where it acts`}>{where(r.workspaceId)}</td>
                    <td data-label={t`People`}>{assignments.pending ? '…' : counts.get(r.id) ?? 0}</td>
                    <td><Button variant="ghost" size="sm" onClick={() => setEditing(r)}>{t`Edit`}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          : null}
        <div className="st-actions"><Button variant="secondary" disabled={!roles.isSuccess} onClick={() => setEditing('new')}>{t`New role`}</Button></div>
      </SubZone>
      {adding !== null ? <AddPersonDialog initial={adding} onClose={() => setAdding(null)} /> : null}
      {giving !== null && roles.isSuccess ? <GiveDialog person={giving} roles={roles.data} held={assignments.byPrincipal.get(giving.id) ?? []} where={where} onClose={() => setGiving(null)} /> : null}
      {revoking !== null ? <RevokeDialog person={revoking.person} assignment={revoking.assignment} where={where} onClose={() => setRevoking(null)} /> : null}
      {editing !== null ? <RoleDialog role={editing === 'new' ? null : editing} taken={new Set((roles.data ?? []).map(r => `${r.workspaceId ?? ''}:${r.slug}`))} where={where} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function useRefresh() {
  const client = useQueryClient()
  return (): void => {
    void client.invalidateQueries({ queryKey: ['principal'] })
    void client.invalidateQueries({ queryKey: ['roles'] })
  }
}

export function GiveDialog({ person, roles, held, where, onClose }: { person: Principal, roles: Role[], held: RoleAssignment[], where: (ws: string | null) => string, onClose: () => void }) {
  const refresh = useRefresh()
  const scope = useScope()
  const [roleId, setRoleId] = useState<string | null>(null)
  const [ws, setWs] = useState<string | null>(null)
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const role = roles.find(r => r.id === roleId)
  // Роль пространства действует только в нём и его потомках — выдать её шире нельзя.
  const fixedWs = role?.workspaceId ?? null
  const target = fixedWs ?? ws
  const already = role !== undefined && held.some(a => a.role.id === role.id && a.workspaceId === target)
  const give = async (): Promise<void> => {
    if (role === undefined) return
    setBusy(true)
    setRows([{ state: 'wait', text: t`Giving the role…`, at: now() }])
    try {
      await assignRole(person.id, role.id, target)
      setRows([{ state: 'done', text: t`Given — recorded in the core`, at: now() }])
      setDone(true)
      refresh()
    } catch (error) {
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not given: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  const name = role?.name ?? ''
  const place = where(target)
  return (
    <Dialog title={t`Give a role`} sub={person.displayName} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy || role === undefined || already} onClick={() => void give()}>{t`Give`}</Button></>}>
      {done ? null : (
        <>
          <div className="tc-form">
            <Field label={t`Role`} wide>
              <Combobox label={t`Role`} value={roleId} onChange={setRoleId} placeholder={t`choose a role`} emptyText={t`No roles`}
                options={roles.map(r => ({ value: r.id, label: r.name, search: r.slug, meta: held.some(a => a.role.id === r.id) ? t`already held` : r.slug }))} />
            </Field>
            <Field label={t`Where`} wide help={fixedWs !== null ? t`This role belongs to a workspace and acts only there.` : t`In a workspace the role acts there and in its nested workspaces.`}>
              <Combobox label={t`Where`} value={target} onChange={setWs} disabled={fixedWs !== null} clearLabel={t`whole organization`} placeholder={t`whole organization`}
                options={workspaceOptions(scope.nodes)} />
            </Field>
          </div>
          {already ? <p className="tc-muted">{t`${person.displayName} already holds this role there.`}</p> : null}
          <Consequences items={[
            { tone: 'info', k: t`What happens`, v: role !== undefined ? t`${person.displayName} can take work that requires “${name}” — ${place}` : t`choose a role` },
            { tone: 'info', k: t`Authority`, v: t`does not change: rights to actions are checked by the core separately` },
            { tone: 'ok', k: t`Reversible`, v: t`yes — revoke the role` },
          ]} />
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}

export function RevokeDialog({ person, assignment, where, onClose }: { person: Principal, assignment: RoleAssignment, where: (ws: string | null) => string, onClose: () => void }) {
  const refresh = useRefresh()
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const name = assignment.role.name
  const place = where(assignment.workspaceId)
  const revoke = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Revoking the role…`, at: now() }])
    try {
      await revokeRole(person.id, assignment.role.id, assignment.workspaceId)
      setRows([{ state: 'done', text: t`Revoked — recorded in the core`, at: now() }])
      setDone(true)
      refresh()
    } catch (error) {
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not revoked: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog alert title={t`Revoke the role “${name}”`} sub={person.displayName} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="danger" disabled={busy} onClick={() => void revoke()}>{t`Revoke`}</Button></>}>
      {done ? null : (
        <Consequences items={[
          { tone: 'warn', k: t`What happens`, v: t`${person.displayName} cannot take new work that requires “${name}” — ${place}` },
          { tone: 'info', k: t`Work already taken`, v: t`stays with them; to move it, hand it over` },
          { tone: 'ok', k: t`Reversible`, v: t`yes — give the role again` },
        ]} />
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}

function RoleDialog({ role, taken, where, onClose }: { role: Role | null, taken: Set<string>, where: (ws: string | null) => string, onClose: () => void }) {
  const refresh = useRefresh()
  const scope = useScope()
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [slug, setSlug] = useState('')
  const [ws, setWs] = useState<string | null>(null)
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const key = slug.trim() !== '' ? slug.trim() : slugOf(name)
  const keyProblem = role !== null || key === '' ? undefined : !/^[a-z0-9][a-z0-9-]{1,62}$/.test(key) ? t`2–63 lower-case Latin letters, digits and dashes` : taken.has(`${ws ?? ''}:${key}`) ? t`this key is taken there` : undefined
  const changed = role === null ? name.trim() !== '' : name.trim() !== role.name || description !== (role.description ?? '')
  const save = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: role === null ? t`Creating the role…` : t`Saving…`, at: now() }])
    try {
      if (role === null) await createRole({ slug: key, name: name.trim(), description, workspaceId: ws })
      else await updateRole(role, { ...(name.trim() !== role.name ? { name: name.trim() } : {}), ...(description !== (role.description ?? '') ? { description } : {}) })
      setRows([{ state: 'done', text: role === null ? t`Created — recorded in the core` : t`Saved — recorded in the core`, at: now() }])
      setDone(true)
      refresh()
    } catch (error) {
      const reason = reasonOf(error)
      setRows([{ state: 'fail', text: t`Not recorded: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={role === null ? t`New role` : t`Edit the role`} {...(role !== null ? { sub: role.slug } : {})} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy || !changed || name.trim() === '' || keyProblem !== undefined || key === ''} onClick={() => void save()}>{role === null ? t`Create` : t`Save`}</Button></>}>
      {done ? null : (
        <>
          <div className="tc-form">
            <Field label={t`Name`} wide><input className="tc-input" value={name} maxLength={200} onChange={e => setName(e.target.value)} /></Field>
            <Field label={t`What the role is for`} wide><textarea className="tc-textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field>
            {role === null
              ? (
                <>
                  <Field label={t`Key`} wide help={keyProblem ?? t`Packages and work refer to the role by this key; it never changes. By default — from the name.`}>
                    <input className="tc-input tc-mono" value={slug} placeholder={slugOf(name)} aria-invalid={keyProblem !== undefined} onChange={e => setSlug(e.target.value)} />
                  </Field>
                  <Field label={t`Where`} wide help={t`A role of a workspace can be given only there and in its nested workspaces.`}>
                    <Combobox label={t`Where`} value={ws} onChange={setWs} clearLabel={t`whole organization`} placeholder={t`whole organization`} options={workspaceOptions(scope.nodes)} />
                  </Field>
                </>
              )
              : <p className="tc-muted">{t`Acts: ${where(role.workspaceId)}. The key and the place do not change.`}</p>}
          </div>
          <Consequences items={role === null
            ? [
                { tone: 'info', k: t`What happens`, v: t`the role appears; work can require it and people can be given it` },
                { tone: 'ok', k: t`Reversible`, v: t`the name can be changed; a role is not deleted` },
              ]
            : [
                { tone: 'info', k: t`What happens`, v: t`the new name is shown everywhere; who holds the role does not change` },
                { tone: 'ok', k: t`Reversible`, v: t`yes — rename again` },
              ]} />
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
