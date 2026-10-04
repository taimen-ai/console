import { useLingui } from '@lingui/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { API, consoleFetch, cpGet } from './client.ts'

/**
 * Экраны пакетов (TAI-ADR-0066): описания видов и данные под блок. Контракт — docs/views.md.
 * Описание вида кэшируется по `(key, locale)` без срока годности — ревизию меняет пакет, о
 * чём журнал сообщает событием `view.*` (тогда кэш сбрасывается, api/live.tsx). Данные блока —
 * обычный кэш экрана, событие процесса перечитывает их.
 */

export type ViewFormat = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'due' | 'duration' | 'principal' | 'status' | 'link'

export interface ViewSummary {
  key: string
  title: string
  revision: number
  hash: string
  package: { key: string, version: string }
  /** `group` — закрытый список: `work` | `knowledge` | `packages` (по умолчанию). */
  nav?: { group?: 'work' | 'knowledge' | 'packages' | (string & {}), icon?: string, order?: number }
  source: { kind: 'process' | 'tasks' | 'knowledge' | (string & {}), process?: string, instance?: boolean }
}

export interface Column { key: string, title: string, format?: ViewFormat }
export interface Filter { field: string, title: string, type: 'text' | 'enum' | 'number' | 'date', options?: { value: string, title: string }[] }

export type Block =
  | { block: 'metrics', items: { title: string, format?: ViewFormat }[] }
  | { block: 'table' | 'list', columns: Column[], filters?: Filter[], sort?: { field: string, title: string }[], open?: { view: string } }
  | { block: 'board', card: { fields: { key: string, format?: ViewFormat }[] }, open?: { view: string } }
  | { block: 'chart', type: 'bar' | 'line' | 'donut' | (string & {}), title?: string, format?: ViewFormat }
  | { block: 'header' }
  | { block: 'fields', section?: string, items: { key: string, label: string, format?: ViewFormat }[] }
  | { block: 'steps' | 'timeline' | 'artifacts' }
  | { block: 'related', title?: string, relations?: string[] }
  | { block: string & {} }

export interface View extends ViewSummary { layout: Block[] }

export interface QueryRequest {
  block: number
  params?: Record<string, string>
  filter?: { field: string, op: 'eq' | 'in' | 'gte' | 'lte' | 'prefix', value: unknown }[]
  sort?: { field: string, dir: 'asc' | 'desc' }[]
  limit?: number
  cursor?: string | null
}

export function useViews() {
  const { i18n } = useLingui()
  const locale = i18n.locale
  return useQuery({
    queryKey: ['views', 'list', locale],
    staleTime: Infinity,
    queryFn: ({ signal }) => cpGet<{ items: ViewSummary[] }>(`/views?locale=${encodeURIComponent(locale)}`, signal).then(r => r.items),
    // Ядро без видов (снимок старше TAI-ADR-0066) — меню просто без пунктов пакетов.
    retry: false,
  })
}

export function useView(key: string) {
  const { i18n } = useLingui()
  const locale = i18n.locale
  return useQuery({
    queryKey: ['views', 'one', key, locale],
    staleTime: Infinity,
    queryFn: ({ signal }) => cpGet<View>(`/views/${encodeURIComponent(key)}?locale=${encodeURIComponent(locale)}`, signal),
  })
}

/** Данные одного блока вида. Предыдущая страница остаётся на экране, пока грузится новая. */
export function useBlock<T>(key: string, request: QueryRequest, enabled = true) {
  const { i18n } = useLingui()
  const locale = i18n.locale
  return useQuery({
    queryKey: ['views', 'data', key, locale, request],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const response = await consoleFetch(`${API}/cp/views/${encodeURIComponent(key)}:query?locale=${encodeURIComponent(locale)}`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request),
      })
      return await response.json() as T
    },
  })
}
