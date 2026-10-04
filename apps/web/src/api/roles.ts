import { useQueries, useQuery } from '@tanstack/react-query'
import { cpGet, cpPatch, cpPost } from './client.ts'
import type { Page } from './types.ts'

/**
 * Роли работы. Роль у работы — правило подбора исполнителя: требования задачи
 * (`GET /tasks/{ref}/requirements`, роли — slug'ами) ядро проверяет, когда исполнитель берёт
 * работу (`403 not_eligible`), а не при назначении. Кто занимает роль там, где работа, —
 * `GET /roles/{id}/principals?workspaceId=` (тот же охват, что у проверки ядра: роль на
 * пространство действует и в его потомках). Права: `org.read` на роли и их владельцев,
 * `org.manage` — дать роль.
 */

export interface Role { id: string, slug: string, name: string, description?: string, workspaceId: string | null, version: number, package?: { key: string, version: string } | null }
/** Роль участника: где она действует — `workspaceId` (null — вся организация). */
export interface RoleAssignment { id: string, principalId: string, workspaceId: string | null, createdAt: string, role: Role }
export interface RequiredRole { id: string, slug: string, name: string }
interface Requirements { roles: { id: string, slug: string }[], capabilities: { id: string, name: string }[], skills: { id: string, name: string, version: string }[] }

export function useRoles() {
  return useQuery({
    queryKey: ['roles'], staleTime: 5 * 60_000, retry: false,
    queryFn: ({ signal }) => cpGet<Page<Role>>('/roles?limit=200', signal).then(p => p.items),
  })
}

/**
 * Роли, которых требует работа, и кто их занимает в её пространстве. `holders` — по id роли;
 * нет права читать роли (403) — `forbidden`, проверка «нет роли» не показывается.
 */
export function useTaskRoles(task: { id: string, workspaceId: string | null }) {
  const req = useQuery({ queryKey: ['task', task.id, 'requirements'], retry: false, queryFn: ({ signal }) => cpGet<Requirements>(`/tasks/${task.id}/requirements`, signal) })
  const roles = useRoles()
  const ids = (req.data?.roles ?? []).map(r => r.id)
  const holders = useQueries({
    queries: ids.map(id => ({
      queryKey: ['roles', id, 'holders', task.workspaceId], retry: false, staleTime: 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<Page<{ id: string }>>(`/roles/${id}/principals?${task.workspaceId !== null ? `workspaceId=${task.workspaceId}&` : ''}limit=200`, signal).then(p => new Set(p.items.map(x => x.id))),
    })),
  })
  const names = new Map((roles.data ?? []).map(r => [r.id, r.name]))
  const required: RequiredRole[] = (req.data?.roles ?? []).map(r => ({ id: r.id, slug: r.slug, name: names.get(r.id) ?? r.slug }))
  const byRole = new Map<string, Set<string>>()
  ids.forEach((id, i) => { const h = holders[i]?.data; if (h !== undefined) byRole.set(id, h) })
  const forbidden = [req.error, roles.error, ...holders.map(h => h.error)].some(e => e !== null && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 403)
  return {
    required,
    holders: byRole,
    requirements: req.data,
    ready: req.isSuccess && holders.every(h => h.isSuccess),
    forbidden,
  }
}

/** Каких требуемых ролей нет у участника; пока владельцы не известны — роль не считается недостающей. */
export function missingRoles(principalId: string, required: RequiredRole[], holders: Map<string, Set<string>>): RequiredRole[] {
  return required.filter(r => holders.get(r.id) !== undefined && !holders.get(r.id)!.has(principalId))
}

/** Роли, которые никто не занимает в пространстве работы. */
export const vacantRoles = (required: RequiredRole[], holders: Map<string, Set<string>>): RequiredRole[] =>
  required.filter(r => holders.get(r.id)?.size === 0)

/** Требования без указанных ролей — для «Назначить без роли»; прочие требования остаются. */
export function withoutRoles(req: Requirements, drop: string[]): { roles: string[], capabilities: string[], skills: string[] } {
  return {
    roles: req.roles.map(r => r.slug).filter(s => !drop.includes(s)),
    capabilities: req.capabilities.map(c => c.name),
    // Точная ли версия навыка, ответ ядра не говорит — передаётся точной: строже, но не шире.
    skills: req.skills.map(s => `${s.name}@${s.version}`),
  }
}

/** Дать роль участнику в пространстве работы (`org.manage`). */
export const assignRole = (principalId: string, roleId: string, workspaceId: string | null): Promise<unknown> =>
  cpPost(`/principals/${principalId}/roles`, { roleId, ...(workspaceId !== null ? { workspaceId } : {}) })

/** Роли каждого из участников (`GET /principals/{id}/roles`) — по участнику. */
export function useAssignments(principalIds: string[]) {
  const results = useQueries({
    queries: principalIds.map(id => ({
      queryKey: ['principal', id, 'roles'], retry: false, staleTime: 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<{ items: RoleAssignment[] }>(`/principals/${id}/roles`, signal).then(r => r.items),
    })),
  })
  const byPrincipal = new Map<string, RoleAssignment[]>()
  principalIds.forEach((id, i) => { const d = results[i]?.data; if (d !== undefined) byPrincipal.set(id, d) })
  return { byPrincipal, pending: results.some(r => r.isPending), failed: results.some(r => r.isError) }
}

/** Сколько людей занимает каждую роль (по прочитанным назначениям людей). */
export function holderCounts(byPrincipal: Map<string, RoleAssignment[]>): Map<string, number> {
  const out = new Map<string, number>()
  for (const list of byPrincipal.values()) for (const roleId of new Set(list.map(a => a.role.id))) out.set(roleId, (out.get(roleId) ?? 0) + 1)
  return out
}

/** Отозвать роль в её охвате (`workspaceId` назначения). */
export const revokeRole = (principalId: string, roleId: string, workspaceId: string | null): Promise<unknown> =>
  cpPost(`/principals/${principalId}/roles/${roleId}:revoke`, workspaceId !== null ? { workspaceId } : {})

export const createRole = (input: { slug: string, name: string, description: string, workspaceId: string | null }): Promise<Role> =>
  cpPost<Role>('/roles', { slug: input.slug, name: input.name, description: input.description, ...(input.workspaceId !== null ? { workspaceId: input.workspaceId } : {}) })

export const updateRole = (role: Role, body: { name?: string, description?: string }): Promise<Role> =>
  cpPatch<Role>(`/roles/${role.id}`, body, role.version, 'role')

/** Слаг роли из названия: латиница, цифры, дефисы (кириллица — транслитом). */
export function slugOf(name: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }
  return [...name.toLowerCase()].map(c => map[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}
