import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { useQueries, useQuery } from '@tanstack/react-query'
import { API, consoleFetch, cpGet, cpPost } from './client.ts'
import type { Page } from './types.ts'

/**
 * Человек в организации (TAI-ADR-0068, контракт консоли `docs/people.md`): профиль участника
 * ядра, связка IAM с правами и режимом видимости, участие в пространствах. Права — плоский
 * набор ядра; консоль показывает их наборами («наблюдает», «работает», «управляет
 * организацией») и раскрывает группами. `admin` консоль не выдаёт и не снимает.
 */

export interface Profile { jobTitle?: string, email?: string, phone?: string, note?: string }
export interface PersonOut { id: string, kind: string, displayName: string, status: string, version?: number, profile?: Profile }
export type Visibility = 'tenant' | 'members'
export interface Binding { id: string, principalId: string, issuer: string, iamTenantId: string, iamPrincipalId: string, permissions: string[], status: string, visibility?: Visibility }

/** Права ядра группами — для «Подробно». Порядок и состав — каталог ядра на 2026-10-03. */
export const PERMISSION_GROUPS: { key: string, title: MessageDescriptor, items: [string, MessageDescriptor][] }[] = [
  { key: 'work', title: msg`Work`, items: [
    ['tasks.read', msg`see work`], ['tasks.write', msg`create, change and comment work`], ['tasks.claim', msg`take work to do`], ['claims.manage', msg`take work away from an executor`],
  ] },
  { key: 'decisions', title: msg`Decisions`, items: [
    ['approvals.read', msg`see approvals`], ['approvals.decide', msg`decide approvals`], ['approvals.manage', msg`request and cancel approvals`],
  ] },
  { key: 'materials', title: msg`Materials and knowledge`, items: [
    ['artifacts.read', msg`see materials`], ['artifacts.write', msg`add materials`], ['observations.write', msg`record observations`], ['skills.invoke', msg`run skills`],
  ] },
  { key: 'processes', title: msg`Processes and goals`, items: [
    ['processes.read', msg`see processes`], ['processes.write', msg`start processes`], ['processes.operate', msg`suspend and cancel processes`],
    ['goals.read', msg`see goals`], ['goals.write', msg`change goals`],
  ] },
  { key: 'org', title: msg`Organization`, items: [
    ['workspaces.read', msg`see workspaces`], ['workspaces.manage', msg`manage workspaces and participation`], ['org.read', msg`see roles`], ['org.manage', msg`give and revoke roles`],
    ['principals.read', msg`see people and agents`], ['principals.write', msg`change people: details, rights, visibility`], ['agents.read', msg`see agents`], ['projects.read', msg`see projects`],
  ] },
  { key: 'automation', title: msg`Rules and types of work`, items: [
    ['rules.read', msg`see rules`], ['rules.write', msg`turn rules on and off`], ['task_types.read', msg`see types of work`], ['task_types.manage', msg`change types of work`],
  ] },
  { key: 'system', title: msg`Sign-in and journal`, items: [
    ['sessions.open', msg`work through the assistant and plugins`], ['events.read', msg`read the journal of events`],
  ] },
]

/** Все права, которые консоль знает (каталог ядра без `admin`). */
export const KNOWN = new Set(PERMISSION_GROUPS.flatMap(g => g.items.map(([k]) => k)))

export type Preset = 'observe' | 'work' | 'manage'
const READ = ['principals.read', 'tasks.read', 'events.read', 'workspaces.read', 'org.read', 'artifacts.read', 'approvals.read', 'projects.read', 'task_types.read', 'goals.read', 'rules.read', 'agents.read', 'processes.read', 'sessions.open']
const WORK = [...READ, 'tasks.write', 'tasks.claim', 'approvals.decide', 'artifacts.write', 'observations.write', 'skills.invoke', 'goals.write', 'processes.write']
const MANAGE = [...WORK, 'org.manage', 'rules.write', 'principals.write', 'workspaces.manage', 'approvals.manage', 'claims.manage', 'task_types.manage', 'processes.operate']
export const PRESETS: Record<Preset, string[]> = { observe: READ, work: WORK, manage: MANAGE }

/** Какой набор у прав: совпадение по известным правам; `admin` и неизвестные права не учитываются. */
export function presetOf(permissions: string[]): Preset | 'custom' {
  const known = [...new Set(permissions.filter(p => KNOWN.has(p)))].sort().join(',')
  for (const key of ['observe', 'work', 'manage'] as const) if ([...PRESETS[key]].sort().join(',') === known) return key
  return 'custom'
}

/** Новые права: выбранные известные права + то, чего консоль не знает (в т.ч. `admin`), — как было. */
export function nextPermissions(current: string[], chosen: string[]): string[] {
  return [...new Set([...current.filter(p => !KNOWN.has(p)), ...chosen.filter(p => KNOWN.has(p))])].sort()
}

/** Что изменится: какие права появятся и какие пропадут. */
export function diff(before: string[], after: string[]): { added: string[], removed: string[] } {
  const a = new Set(before)
  const b = new Set(after)
  return { added: after.filter(p => !a.has(p)), removed: before.filter(p => !b.has(p)) }
}

export function usePerson(id: string) {
  return useQuery({ queryKey: ['principal', id, 'card'], retry: false, queryFn: ({ signal }) => cpGet<PersonOut>(`/principals/${id}`, signal) })
}

export function useBindings(id: string) {
  return useQuery({ queryKey: ['principal', id, 'bindings'], retry: false, queryFn: ({ signal }) => cpGet<{ items: Binding[] }>(`/principals/${id}/iam-bindings`, signal).then(r => r.items) })
}

/** Где человек участвует: участники каждого пространства дерева (у ядра нет списка «пространства человека»). */
export function useMemberships(personId: string, workspaceIds: string[]) {
  const results = useQueries({
    queries: workspaceIds.map(ws => ({
      queryKey: ['workspace', ws, 'members'], retry: false, staleTime: 30_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<Page<{ principalId: string }>>(`/workspaces/${ws}/members?limit=200`, signal).then(p => p.items.map(x => x.principalId)),
    })),
  })
  const member = workspaceIds.filter((_, i) => results[i]?.data?.includes(personId) === true)
  return { member, pending: results.some(r => r.isPending), failed: results.some(r => r.isError), forbidden: results.some(r => (r.error as { status?: number } | null)?.status === 403) }
}

export async function savePerson(id: string, version: number, body: { displayName?: string, profile?: Profile }): Promise<PersonOut> {
  const response = await consoleFetch(`${API}/cp/principals/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'if-match': `"principal-${version}"` },
    body: JSON.stringify(body),
  })
  return await response.json() as PersonOut
}

/** Upsert связки: права целиком и, если задан, режим видимости. */
export const saveBinding = (b: Binding, permissions: string[], visibility?: Visibility): Promise<Binding> =>
  cpPost<Binding>(`/principals/${b.principalId}/iam-bindings`, { issuer: b.issuer, iamTenantId: b.iamTenantId, iamPrincipalId: b.iamPrincipalId, permissions, ...(visibility !== undefined ? { visibility } : {}) })

export const addMember = (workspaceId: string, principalId: string): Promise<unknown> => cpPost(`/workspaces/${workspaceId}/members`, { principalId })
export const removeMember = (workspaceId: string, principalId: string): Promise<unknown> => cpPost(`/workspaces/${workspaceId}/members/${principalId}:remove`, {})

/** Отключить: связки отозваны, сессии закрыты, захваты сняты — одним вызовом (CP-ADR-0077). */
export const disablePerson = (id: string, reason: string): Promise<PersonOut> => cpPost<PersonOut>(`/principals/${id}:disable`, reason.trim() !== '' ? { reason: reason.trim() } : {})
/* Включить — только потоком BFF (`api/org.ts`, `enablePersonFlow`): голое `:enable` ядра консоль
   не зовёт — оно обошло бы вход в IAM и выбор прав. */
