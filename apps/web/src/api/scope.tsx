import { Combobox, type ComboOption } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cpGet } from './client.ts'

/**
 * Область работы консоли — одно пространство (workspace) на всю консоль: выбирается в шапке,
 * хранится в браузере и читается из адреса (`?ws=<id>` или `?ws=all` на любом экране).
 * Экраны показывают только его поддерево: списки работ и «Ждёт вас» — фильтром ядра
 * (`workspaceId` + `includeDescendants`), журнал и попытки — по `workspaceId` записи.
 * «Все» — без ограничения (для тех, у кого несколько организаций). Пока человек не выбрал сам —
 * корень, где его больше всего ждёт («Ждёт вас»), иначе первый корень; в браузере хранится только
 * явный выбор.
 */

export interface WsNode { id: string, name: string, parentId: string | null, depth: number, path: string[], rootId: string }
interface TreeNode { id: string, name: string, parentId?: string | null, children?: TreeNode[] }

const KEY = 'console.scope'
const ALL = 'all'

function stored(): string | null { try { return localStorage.getItem(KEY) } catch { return null } }
function store(value: string): void { try { localStorage.setItem(KEY, value) } catch { /* приватное окно */ } }
function fromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const ws = new URLSearchParams(window.location.search).get('ws')
  return ws !== null && (ws === ALL || /^[0-9a-f-]{36}$/i.test(ws)) ? ws : null
}

export function flattenTree(roots: TreeNode[]): WsNode[] {
  const out: WsNode[] = []
  const walk = (nodes: TreeNode[], parent: WsNode | null): void => {
    for (const n of nodes) {
      const node: WsNode = { id: n.id, name: n.name, parentId: parent?.id ?? null, depth: parent === null ? 0 : parent.depth + 1, path: [...(parent?.path ?? []), n.name], rootId: parent?.rootId ?? n.id }
      out.push(node)
      walk(n.children ?? [], node)
    }
  }
  walk(roots, null)
  return out
}

/** Пространство и все его потомки. */
export function subtreeOf(nodes: WsNode[], id: string): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) if (n.parentId !== null && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true }
  }
  return ids
}

/** Выбор по сохранённому: из адреса, из браузера, иначе предложенный корень, иначе первый. */
export function resolveScope(nodes: WsNode[], wanted: string | null, preferred?: string | null): string | null {
  if (wanted === ALL) return null
  if (wanted !== null && nodes.some(n => n.id === wanted)) return wanted
  if (preferred && nodes.some(n => n.id === preferred)) return preferred
  return nodes.find(n => n.depth === 0)?.id ?? null
}

/** Корень, в котором больше всего пространств из списка (элементы «Ждёт вас»); поровну — раньше в дереве. */
export function busiestRoot(nodes: WsNode[], workspaceIds: (string | null | undefined)[]): string | null {
  const rootOf = new Map(nodes.map(n => [n.id, n.rootId]))
  const count = new Map<string, number>()
  for (const id of workspaceIds) { const root = id ? rootOf.get(id) : undefined; if (root !== undefined) count.set(root, (count.get(root) ?? 0) + 1) }
  let best: string | null = null
  for (const n of nodes) if (n.depth === 0 && (count.get(n.id) ?? 0) > (best === null ? 0 : count.get(best) ?? 0)) best = n.id
  return best
}

export interface Scope {
  /** Выбранное пространство; null — «Все». */
  ws: string | null
  node: WsNode | undefined
  nodes: WsNode[]
  ready: boolean
  set: (ws: string | null) => void
  /** Принадлежит ли пространство области (null — без пространства: только при «Все»). */
  contains: (workspaceId: string | null | undefined) => boolean
  /** Параметры запроса ядра: `workspaceId` + `includeDescendants`; при «Все» — пусто. */
  params: () => URLSearchParams
}

const ScopeContext = createContext<Scope | null>(null)

export function ScopeProvider({ children }: { children: ReactNode }) {
  const tree = useQuery({ queryKey: ['workspaces', 'tree', 'all'], staleTime: 5 * 60_000, queryFn: ({ signal }) => cpGet<{ roots: TreeNode[] }>('/workspaces/tree?includeProjects=false', signal) })
  const nodes = useMemo(() => flattenTree(tree.data?.roots ?? []), [tree.data])
  const [wanted, setWanted] = useState<string | null>(() => fromUrl() ?? stored())
  // Умолчание, пока человек не выбрал: корень, где его больше всего ждёт.
  const waiting = useQuery({
    queryKey: ['attention', 'all'], enabled: wanted === null,
    queryFn: ({ signal }) => cpGet<{ items: { workspaceId?: string | null }[] }>('/me/attention', signal),
  })
  const preferred = busiestRoot(nodes, (waiting.data?.items ?? []).map(i => i.workspaceId))
  const ws = tree.isSuccess && (wanted !== null || !waiting.isPending) ? resolveScope(nodes, wanted, preferred) : (wanted === ALL || wanted === null ? null : wanted)
  const subtree = useMemo(() => ws === null ? null : subtreeOf(nodes, ws), [nodes, ws])
  const set = useCallback((next: string | null) => { const value = next ?? ALL; store(value); setWanted(value) }, [])
  const scope = useMemo<Scope>(() => ({
    ws, nodes, ready: tree.isError || (tree.isSuccess && (wanted !== null || !waiting.isPending)), set,
    node: nodes.find(n => n.id === ws),
    contains: id => subtree === null || (id !== null && id !== undefined && subtree.has(id)),
    params: () => ws === null ? new URLSearchParams() : new URLSearchParams({ workspaceId: ws, includeDescendants: 'true' }),
  }), [ws, nodes, subtree, tree.isSuccess, tree.isError, set, wanted, waiting.isPending])
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>
}

const OUTSIDE: Scope = { ws: null, node: undefined, nodes: [], ready: true, set: () => {}, contains: () => true, params: () => new URLSearchParams() }

export function useScope(): Scope { return useContext(ScopeContext) ?? OUTSIDE }

/** Варианты пространств для Combobox: дерево с отступами, поиск по пути. */
export function workspaceOptions(nodes: WsNode[], within?: Set<string>): ComboOption[] {
  return nodes.filter(n => within === undefined || within.has(n.id)).map(n => ({
    value: n.id, label: n.name, depth: n.depth, search: n.path.join(' '),
    ...(n.depth > 0 ? { meta: n.path.slice(0, -1).join(' / ') } : {}),
  }))
}

/** «Ждёт вас» в области: ядро фильтрует по пространству с потомками. */
export function useScopedAttention<T>() {
  const scope = useScope()
  return useQuery({
    queryKey: ['attention', scope.ws], enabled: scope.ready,
    queryFn: ({ signal }) => { const q = scope.params().toString(); return cpGet<T>(`/me/attention${q !== '' ? `?${q}` : ''}`, signal) },
  })
}

/** Переключатель области в шапке. */
export function ScopePicker() {
  const scope = useScope()
  if (scope.nodes.length === 0) return null
  return (
    <Combobox label={t`Workspace`} options={workspaceOptions(scope.nodes)} value={scope.ws} onChange={v => scope.set(v)}
      clearLabel={t`All workspaces`} placeholder={t`All workspaces`} />
  )
}
