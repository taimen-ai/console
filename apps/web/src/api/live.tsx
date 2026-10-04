import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { API, cpGet } from './client.ts'
import type { EventPage, JournalEvent } from './types.ts'

/**
 * Живой журнал ядра: WebSocket BFF `{base}/api/ws` (туннель к `/events/ws`, токен остаётся в
 * BFF). Поток начинается с хвоста журнала на момент открытия консоли, после обрыва
 * переподключается с последнего полученного курсора с отступом до 30 с.
 *
 * Событие — сигнал перечитать конкретные запросы TanStack Query, а не источник данных
 * (CON-ADR-0001, п. 4): по типу события помечаются устаревшими ключи (`INVALIDATES`).
 * Экраны, которым событие нужно само (журнал, счёт дня), подписываются `useJournal`.
 */

const MAX_BACKOFF_MS = 30_000
/** Отказ ядра, который повтором не лечится: неверный фильтр или курсор, нет прав. */
const FATAL_CLOSE = new Set([4400, 4403, 4404])

/** Какие запросы устаревают от события: по префиксу типа. */
const INVALIDATES: [prefix: string, keys: QueryKey[]][] = [
  ['approval.', [['attention'], ['approvals']]],
  ['task.', [['attention'], ['tasks'], ['task'], ['views', 'data']]],
  ['work.', [['tasks'], ['task']]],
  ['run.', [['runs'], ['attention']]],
  ['claim.', [['claims']]],
  ['artifact.', [['artifacts']]],
  ['knowledge.', [['knowledge']]],
  // Экраны пакетов: новая ревизия вида — описания; ход процессов — данные блоков.
  ['view.', [['views']]],
  ['process', [['views', 'data']]],
]

export interface Live {
  /** Поток открыт сейчас. */
  connected: boolean
  /** Время последних данных: открытие потока или последнее событие. */
  at: Date | null
  /** Код закрытия ядра, после которого поток не переподключается. */
  error: number | null
}

type Listener = (event: JournalEvent) => void
interface LiveContext extends Live { subscribe: (listener: Listener) => () => void }

const Context = createContext<LiveContext | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const listeners = useRef(new Set<Listener>())
  const [state, setState] = useState<Live>({ connected: false, at: null, error: null })

  useEffect(() => {
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let backoff = 1_000
    let closed = false
    let cursor: string | null = null
    const pending = new Set<string>()
    let flush: ReturnType<typeof setTimeout> | undefined
    const invalidate = (type: string): void => {
      for (const [prefix, keys] of INVALIDATES) if (type.startsWith(prefix)) for (const key of keys) pending.add(JSON.stringify(key))
      // Пачка событий — одно перечитывание.
      clearTimeout(flush)
      flush = setTimeout(() => {
        for (const key of pending) void client.invalidateQueries({ queryKey: JSON.parse(key) as QueryKey })
        pending.clear()
      }, 250)
    }
    const open = (): void => {
      if (closed || cursor === null) return
      const url = new URL(`${API}/ws`, window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('after', cursor)
      socket = new WebSocket(url)
      socket.onopen = () => { backoff = 1_000; setState({ connected: true, at: new Date(), error: null }) }
      socket.onmessage = (message) => {
        let event: JournalEvent
        try { event = JSON.parse(String(message.data)) as JournalEvent } catch { return }
        if (typeof event.cursor === 'string') cursor = event.cursor
        setState(s => ({ ...s, at: new Date() }))
        invalidate(event.type)
        for (const listener of listeners.current) listener(event)
      }
      socket.onclose = (event) => {
        setState(s => ({ ...s, connected: false }))
        if (closed) return
        if (FATAL_CLOSE.has(event.code)) {
          setState(s => ({ ...s, error: event.code }))
          return
        }
        timer = setTimeout(open, backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
    const start = async (): Promise<void> => {
      try {
        // Хвост журнала: поток идёт с этого места, прошлое экраны читают запросами.
        const page = await cpGet<EventPage>('/events?tail=1')
        cursor = page.nextCursor
        open()
      } catch {
        if (!closed) timer = setTimeout(() => void start(), backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
    void start()
    return () => {
      closed = true
      clearTimeout(timer)
      clearTimeout(flush)
      socket?.close()
    }
  }, [client])

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener)
    return () => { listeners.current.delete(listener) }
  }, [])
  const value = useMemo<LiveContext>(() => ({ ...state, subscribe }), [state, subscribe])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useLive(): LiveContext {
  const value = useContext(Context)
  if (value === null) throw new Error('LiveProvider is missing')
  return value
}

/** Подписка экрана на события журнала: обработчик всегда свежий, подписка одна. */
export function useJournal(onEvent: Listener): void {
  const { subscribe } = useLive()
  const handler = useRef(onEvent)
  useEffect(() => { handler.current = onEvent })
  useEffect(() => subscribe(event => handler.current(event)), [subscribe])
}
