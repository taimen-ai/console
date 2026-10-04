import { t } from '@lingui/core/macro'
import { useQueries, useQuery } from '@tanstack/react-query'
import { cpGet } from './client.ts'
import { usePrincipals } from './directory.ts'
import { subtreeOf, useScope } from './scope.tsx'
import type { Page, Principal } from './types.ts'

/**
 * Что можно выбрать при поручении (решения владельца 2026-10-03):
 * - **типы работ** — только разрешённые в пространстве: `effectiveTaskTypes` в ответе
 *   `GET /workspaces/{id}` (TASK-001306, на staging с 2026-10-03). Нет поля (старое ядро) —
 *   доступны все активные типы;

 * - **исполнители типа** — `GET /task-types/{id}/executors?workspaceId=` (TASK-001307: люди по
 *   ролям типа, агенты по описанию; у маршрута только `workspaceId`, и он обязателен, без `limit`). Без пространства или без маршрута
 *   (404, старое ядро) — консоль считает сама: агенты
 *   реестра, которые берут работу (есть `spec.work` и исполнитель, не наблюдатель; личности правил
 *   без размещения — нет), чей `spec.work.taskTypes` содержит тип (или не задан), чьё пространство
 *   покрывает выбранное; исполнитель `skills` — только типы с `execution` (скилл), прочие — без;
 *   люди — участники пространства (ролей у типа ещё нет — не ограничивают).
 */

export interface TaskTypeLite {
  id: string
  key: string
  version: number
  displayName: string
  status: string
  description?: string
  acceptance?: { key: string, kind: string, description?: string }[]
  /** Тип исполняется скиллом (M2.2): берёт исполнитель `skills`. */
  execution?: { skill?: string } | null
}

export interface Executor {
  id: string
  kind: 'human' | 'agent' | 'service' | (string & {})
  displayName: string
  /** Роли, по которым человек подходит (ядро), — подпись в списке. */
  roles?: string[]
}

interface WorkspaceOut { id: string, effectiveTaskTypes?: string[] | null }
interface AgentLite {
  key: string
  displayName: string
  principalId: string | null
  workspaceId: string | null
  status: string
  state: string
  revision?: { spec?: { work?: { taskTypes?: string[] }, executor?: { kind?: string } } } | null
}
interface ParticipantOut { principalId: string, kind: string, displayName: string, status: string, roles?: { key?: string, name?: string, displayName?: string }[] }

/** Активные типы, разрешённые в пространстве (`effectiveTaskTypes`: null или нет поля — все). */
export function allowedTypes(types: TaskTypeLite[], effective: string[] | null | undefined): TaskTypeLite[] {
  const active = types.filter(ty => ty.status === 'active')
  return Array.isArray(effective) ? active.filter(ty => effective.includes(ty.key)) : active
}

export function useTaskTypes(workspaceId: string | null | undefined) {
  const types = useQuery({
    queryKey: ['task-types', 'active'], staleTime: 5 * 60_000,
    queryFn: ({ signal }) => cpGet<Page<TaskTypeLite>>('/task-types?status=active&limit=200', signal),
  })
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId], enabled: !!workspaceId, staleTime: 60_000,
    queryFn: ({ signal }) => cpGet<WorkspaceOut>(`/workspaces/${workspaceId}`, signal),
  })
  return { types: allowedTypes(types.data?.items ?? [], workspace.data?.effectiveTaskTypes), loading: types.isPending, failed: types.isError }
}

/** Исполнители-наблюдатели: читают внешний мир, работу не берут. */
const OBSERVERS = new Set(['observer', 'git-connector'])

/** Агент реестра может брать тип в пространстве: берёт работу вообще, тип в `spec.work.taskTypes` (или список не задан), пространство агента — само или предок. */
export function agentTakes(agent: AgentLite, type: Pick<TaskTypeLite, 'key' | 'execution'> | undefined, workspaceId: string | null | undefined, covers: (agentWs: string, ws: string) => boolean): boolean {
  if (agent.status === 'retired' || agent.state === 'stopped' || agent.principalId === null) return false
  const spec = agent.revision?.spec
  const kind = spec?.executor?.kind
  if (spec?.work === undefined || kind === undefined || OBSERVERS.has(kind)) return false
  if (type !== undefined && (kind === 'skills') !== Boolean(type.execution?.skill)) return false
  const typeKey = type?.key
  const list = spec.work.taskTypes
  if (typeKey !== undefined && Array.isArray(list) && !list.includes(typeKey)) return false
  if (workspaceId && agent.workspaceId && !covers(agent.workspaceId, workspaceId)) return false
  return true
}

/**
 * Кто может взять работу этого типа в пространстве; без типа — все исполнители пространства.
 * `within` — для фильтров области: годятся и агенты дочерних пространств (область включает
 * поддерево), а не только те, чьё пространство покрывает выбранное.
 */
export function useExecutors(type: Pick<TaskTypeLite, 'id' | 'key' | 'execution'> | undefined, workspaceId: string | null | undefined, { within = false }: { within?: boolean } = {}) {
  const scope = useScope()
  const principals = usePrincipals()
  const core = useQuery({
    queryKey: ['executors', type?.id ?? null, workspaceId ?? null], enabled: type !== undefined && !!workspaceId, retry: false, staleTime: 60_000,
    queryFn: ({ signal }) => cpGet<{ items: (Executor & { principalId?: string })[] }>(`/task-types/${type!.id}/executors?workspaceId=${workspaceId}`, signal),
  })
  // Ядро отвечает только для пространства (`workspaceId` обязателен); без него и при 404
  // (маршрута ещё нет) считаем сами. Прочие ошибки — тоже, но честно.
  const fallback = type === undefined || !workspaceId || core.isError
  const agents = useQuery({
    queryKey: ['agents', 'registry'], enabled: fallback, staleTime: 60_000,
    queryFn: ({ signal }) => cpGet<Page<AgentLite>>('/agents?limit=200', signal),
  })
  // Участники: выбранного пространства, а для фильтров области — и всех его потомков.
  const spaces = !workspaceId ? [] : within ? [...subtreeOf(scope.nodes, workspaceId)] : [workspaceId]
  const participants = useQueries({
    queries: spaces.map(ws => ({
      queryKey: ['participants', ws], enabled: fallback, staleTime: 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<Page<ParticipantOut>>(`/workspaces/${ws}/participants?limit=200`, signal),
    })),
  })
  // Без права на участников хоть одного пространства — запасной путь «все люди», а не половина.
  const participantsOk = spaces.length > 0 && participants.every(q => q.isSuccess)

  if (!fallback && core.data !== undefined) {
    return { executors: core.data.items.map(e => ({ ...e, id: e.principalId ?? e.id })), loading: false, byCore: true }
  }
  const covers = (agentWs: string, ws: string): boolean => subtreeOf(scope.nodes, agentWs).has(ws) || (within && subtreeOf(scope.nodes, ws).has(agentWs))
  const fromAgents: Executor[] = (agents.data?.items ?? [])
    .filter(a => agentTakes(a, type, workspaceId, covers))
    .map(a => ({ id: a.principalId!, kind: 'agent', displayName: a.displayName }))
  // Люди: участники пространства (или поддерева); без пространства или без права на участников — все люди.
  const people: Executor[] = participantsOk
    ? participants.flatMap(q => q.data?.items ?? []).filter(p => p.kind === 'human' && p.status === 'active').map(p => ({ id: p.principalId, kind: 'human', displayName: p.displayName, roles: (p.roles ?? []).map(r => r.displayName ?? r.name ?? r.key ?? '').filter(Boolean) }))
    : [...(principals.data?.values() ?? [])].filter((p: Principal) => p.kind === 'human' && p.status === 'active').map(p => ({ id: p.id, kind: 'human', displayName: p.displayName }))
  const seen = new Set<string>()
  const executors = [...people, ...fromAgents].filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  const loading = (type !== undefined && !!workspaceId && core.isPending) || agents.isPending || principals.isPending || (fallback && participants.some(q => q.isPending))
  return { executors, loading, byCore: false }
}

/** Подпись исполнителя в списке: вид и роли. */
export function executorMeta(e: Executor): string {
  if (e.kind === 'agent') return t`agent`
  if (e.kind === 'service') return t`service`
  return (e.roles ?? []).join(', ')
}
