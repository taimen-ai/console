import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cpGet } from '../../api/client.ts'
import { useJournal } from '../../api/live.tsx'
import type { EventPage, JournalEvent } from '../../api/types.ts'
import { startOfToday } from '../../lib/format.ts'

/**
 * Журнал за сегодня — основа «Итога», «Потока работы» и «Что произошло»
 * (docs/screens/today.md). Счётчиков в ядре нет: события дня дочитываются назад от хвоста
 * журнала (`tail`, затем `before = prevCursor`) до полуночи по часам браузера. Новые события
 * приходят живым потоком и дописываются в тот же список — без перечитывания.
 *
 * Читаются только типы, которые экран считает: события работы, решений и попыток.
 */
export const DAY_TYPES = ['task.', 'work.', 'approval.', 'run.'] as const
const PAGE = 200
/** Больше страниц за день не читаем: экран показывает, что счёт неполный. */
const MAX_PAGES = 25

export interface Day {
  events: JournalEvent[]
  /** Дочитать до полуночи не удалось (журнал длиннее MAX_PAGES страниц). */
  partial: boolean
  since: string
}

const query = (params: URLSearchParams): string => {
  for (const t of DAY_TYPES) params.append('types', t)
  return `/events?${params}`
}

export async function readDay(signal: AbortSignal, now = new Date()): Promise<Day> {
  const since = startOfToday(now)
  const events: JournalEvent[] = []
  let before: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const params: URLSearchParams = before === null ? new URLSearchParams({ tail: String(PAGE), limit: String(PAGE) }) : new URLSearchParams({ before, limit: String(PAGE) })
    const page: EventPage = await cpGet<EventPage>(query(params), signal)
    // Страница в порядке доставки (старые → новые); сегодняшние — в конце.
    const today = page.items.filter(e => new Date(e.occurredAt) >= since)
    events.unshift(...today)
    const reachedYesterday = page.items.length > 0 && new Date(page.items[0]!.occurredAt) < since
    if (reachedYesterday || page.prevCursor === null) return { events, partial: false, since: since.toISOString() }
    before = page.prevCursor
  }
  return { events, partial: true, since: since.toISOString() }
}

export function useDay() {
  const client = useQueryClient()
  const day = useQuery({ queryKey: ['day', startOfToday().toISOString()], queryFn: ({ signal }) => readDay(signal), staleTime: Infinity })
  useJournal((event) => {
    if (!DAY_TYPES.some(t => event.type.startsWith(t))) return
    client.setQueryData<Day>(['day', startOfToday().toISOString()], (current) => {
      if (current === undefined || current.events.some(e => e.id === event.id)) return current
      return { ...current, events: [...current.events, event] }
    })
  })
  return day
}

/** Работы (id сущности), с которыми сегодня случилось событие одного из типов. */
export function distinct(events: JournalEvent[], type: string): Set<string> {
  return new Set(events.filter(e => e.type === type).map(e => e.entityId))
}
