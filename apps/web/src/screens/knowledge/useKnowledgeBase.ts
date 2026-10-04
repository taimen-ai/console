import { useQueries, useQuery } from '@tanstack/react-query'
import { ApiError } from '../../api/client.ts'
import { cpGet, cpPost } from '../../api/client.ts'
import type { Page, Task } from '../../api/types.ts'
import { kindsOf, type Entity, type EntityRelation, type Pack } from './model.ts'

/**
 * База знаний организации — общая для списка и страницы документа (один кэш TanStack Query):
 * корень дерева пространств → пакеты знаний корня → виды → все записи одним
 * `entities:query` на виды; работы правила `knowledge-expiry` — по `customFields.kind/key`.
 */

interface TreeNode { id: string, name: string, parentId: string | null }
interface PacksOut { rootWorkspaceId: string, effective: string[] }
interface EntityPage { items: Entity[], nextCursor: string | null }

/** Больше не читаем: 4 страницы по 500 — экран говорит, что показана часть. */
const MAX_PAGES = 4

async function loadEntities(workspaceId: string, kinds: string[], signal: AbortSignal): Promise<{ items: Entity[], partial: boolean }> {
  const items: Entity[] = []
  // Не больше 20 видов в одном запросе (контракт ядра).
  for (let i = 0; i < kinds.length; i += 20) {
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const res: EntityPage = await cpPost<EntityPage>('/knowledge/entities:query', { workspaceId, kinds: kinds.slice(i, i + 20), limit: 500, ...(cursor !== null ? { cursor } : {}) })
      items.push(...res.items)
      cursor = res.nextCursor
      if (cursor === null) break
    }
    if (cursor !== null) return { items, partial: true }
  }
  return { items, partial: false }
}

const WS_KEY = 'console.knowledge.ws'
export function rememberedWorkspace(): string | null { try { return localStorage.getItem(WS_KEY) } catch { return null } }
export function rememberWorkspace(id: string): void { try { localStorage.setItem(WS_KEY, id) } catch { /* приватное окно */ } }

export function useKnowledgeBase(ws: string | undefined) {
  const tree = useQuery({ queryKey: ['workspaces', 'tree'], staleTime: 5 * 60_000, queryFn: ({ signal }) => cpGet<{ roots: TreeNode[] }>('/workspaces/tree?depth=0&includeProjects=false', signal) })
  const roots = tree.data?.roots ?? []
  // Без явного выбора — последняя открытая организация, иначе первый корень.
  const remembered = rememberedWorkspace()
  const workspace = roots.find(r => r.id === ws) ?? roots.find(r => r.id === remembered) ?? roots[0]

  const config = useQuery({
    queryKey: ['knowledge', 'packs', workspace?.id], enabled: workspace !== undefined, staleTime: 5 * 60_000,
    queryFn: ({ signal }) => cpGet<PacksOut>(`/workspaces/${workspace!.id}/knowledge-packs`, signal),
  })
  const packQueries = useQueries({
    queries: (config.data?.effective ?? []).map(ref => ({
      queryKey: ['knowledge', 'pack', ref], staleTime: Infinity,
      queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<Pack>(`/knowledge/packs/${encodeURIComponent(ref)}`, signal),
    })),
  })
  const packs = packQueries.map(q => q.data).filter((p): p is Pack => p !== undefined)
  /** Пакеты со ссылкой, под которой они включены (`company@1`), — в порядке включения. */
  const packRefs = (config.data?.effective ?? []).flatMap((ref, i) => packQueries[i]?.data !== undefined ? [{ ref, pack: packQueries[i].data }] : [])
  const kinds = kindsOf(packs)
  const packsReady = config.isSuccess && packQueries.every(q => q.isSuccess)

  const root = config.data?.rootWorkspaceId ?? workspace?.id
  const entities = useQuery({
    queryKey: ['knowledge', 'entities', root, kinds.map(k => k.kind).join(',')],
    enabled: root !== undefined && packsReady && kinds.length > 0,
    queryFn: ({ signal }) => loadEntities(root!, kinds.map(k => k.kind), signal),
  })
  const expiryWork = useQuery({
    queryKey: ['tasks', 'knowledge-expiry'],
    queryFn: ({ signal }) => Promise.all(['backlog', 'active', 'blocked', 'terminal_success'].map(c => cpGet<Page<Task>>(`/tasks?typeKey=knowledge-expiry&systemStatusCategory=${c}&limit=100`, signal))).then(pages => pages.flatMap(p => p.items)),
  })
  /** Работы правила по записи: открытые первыми. */
  const workOf = (e: Entity): Task[] => (expiryWork.data ?? []).filter(task => task.customFields?.kind === e.kind && task.customFields?.key === e.key)
  const workFor = (e: Entity): Task | undefined => workOf(e).find(task => task.systemStatusCategory !== 'terminal_success')
  const failed = tree.isError || config.isError || packQueries.some(q => q.isError) || entities.isError

  return { roots, root, workspace, kinds, packRefs, packsReady, entities, expiryWork, workOf, workFor, failed }
}

/** Сколько страниц вида дочитываем в поисках записи со связями (по 100 — предел ядра с `include`). */
const RELATION_PAGES = 10

/**
 * Связи одной записи: `entities:query` её вида с `include.relations: "*"` постранично, пока не
 * встретится ключ (чтения одной записи по ключу у ядра нет). Ядро без `include` (до TASK-001300)
 * отвечает 400/422 — тогда `unsupported`, и страница связи не показывает.
 */
export function useEntityRelations(root: string | undefined, kind: string | undefined, key: string | undefined) {
  return useQuery({
    queryKey: ['knowledge', 'relations', root, kind, key], enabled: root !== undefined && kind !== undefined && key !== undefined, staleTime: 60_000, retry: false,
    queryFn: async ({ signal }): Promise<{ relations: EntityRelation[] | null, unsupported: boolean }> => {
      let cursor: string | null = null
      try {
        for (let page = 0; page < RELATION_PAGES; page++) {
          const res: EntityPage = await cpPost<EntityPage>('/knowledge/entities:query', { workspaceId: root, kinds: [kind], limit: 100, include: { relations: '*', direction: 'both', limit: 50 }, ...(cursor !== null ? { cursor } : {}) })
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
          const found = res.items.find(e => e.key === key)
          if (found !== undefined) return { relations: found.relations ?? [], unsupported: found.relations === undefined }
          cursor = res.nextCursor
          if (cursor === null) break
        }
        return { relations: null, unsupported: false }
      } catch (error) {
        if (error instanceof ApiError && (error.status === 400 || error.status === 422)) return { relations: null, unsupported: true }
        throw error
      }
    },
  })
}
