import { useQueries, useQuery } from '@tanstack/react-query'
import type { ExecutorKind } from '@console/ui'
import { cpGet } from './client.ts'
import type { HarnessContext, Page, Principal, Task } from './types.ts'

/**
 * Справочники экранов: участники (люди, агенты, процессы) и заголовки работ. Ядро отдаёт их
 * постранично без счётчиков; участников консоль дочитывает целиком (их десятки), работы —
 * поштучно по id, с кэшем TanStack Query.
 */

/** Вид исполнителя для знака: человек ○, агент ▢, процесс или правило ⬡. */
export function executorKind(p: Pick<Principal, 'kind'> | undefined): ExecutorKind {
  if (p?.kind === 'human') return 'human'
  if (p?.kind === 'agent') return 'agent'
  return 'process'
}

const MAX_PAGES = 20

export function usePrincipals() {
  return useQuery({
    queryKey: ['principals'],
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const all = new Map<string, Principal>()
      let cursor: string | null = null
      for (let i = 0; i < MAX_PAGES; i++) {
        const page: Page<Principal> = await cpGet<Page<Principal>>(`/principals?limit=200${cursor !== null ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, signal)
        for (const p of page.items) all.set(p.id, p)
        cursor = page.nextCursor
        if (cursor === null) break
      }
      return all
    },
  })
}

export function useMe() {
  return useQuery({ queryKey: ['harness-context'], queryFn: ({ signal }) => cpGet<HarnessContext>('/harness/context', signal), staleTime: 5 * 60_000 })
}

export const taskQuery = (ref: string) => ({
  queryKey: ['task', ref] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<Task>(`/tasks/${encodeURIComponent(ref)}`, signal),
  staleTime: 30_000,
})

/** Работы по id (или publicId): Map ref → работа, пока не загружено — нет ключа. */
export function useTasks(refs: readonly string[]): Map<string, Task> {
  const unique = [...new Set(refs)]
  const results = useQueries({ queries: unique.map(ref => taskQuery(ref)) })
  const out = new Map<string, Task>()
  unique.forEach((ref, i) => {
    const data = results[i]?.data
    if (data !== undefined) out.set(ref, data)
  })
  return out
}
