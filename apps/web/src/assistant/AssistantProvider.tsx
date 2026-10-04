import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { ApiError, leftForLogin, redirectToLogin } from '../api/client.ts'
import { initialConversation, reduce, type Conversation, type Outgoing } from './conversation.ts'
import { decideApproval, loadHistory, newRequestId, sendMessage, streamRefusal, streamUrl, STREAM_EVENT_TYPES, type StreamEvent } from './surface.ts'

/**
 * Ассистент с любого экрана (docs/screens/assistant.md). Перенесено из прежней консоли
 * (web/console/app/src/assistant/AssistantProvider.tsx) с решениями владельца 2026-10-01:
 *
 * - Беседа одна на человека, та же, что в Telegram: консоль её не хранит, состояние живёт до
 *   перезагрузки вкладки и восстанавливается из `history`.
 * - Контекст экрана — данными: с сообщением уходит адрес текущего экрана (`screenUrl`), проекцию
 *   по нему собирает BFF из ядра. Плашки «Получает данные» нет — контекст передаётся всегда;
 *   «Обсудить» на объекте подставляет адрес объекта.
 * - Ассистент пишет сам: поток открыт, пока вкладка консоли видна, — новые сообщения
 *   ассистента при закрытой панели считаются непрочитанными (счётчик на кнопке), просьба
 *   подтвердить действие — срочной (accent). История грузится при открытии панели: первая
 *   страница — знак присутствия человека, контейнер дописывает «пока вас не было».
 * - Поток, закрытый с 401, уводит на вход; с `429 too_many_streams` — не переподключается сам.
 * - Открытая панель помнится между экранами и перезагрузками; ⌘J / Ctrl+J — открыть и закрыть.
 */

export interface ScreenRef { url: string, label: string }

export interface Assistant {
  open: boolean
  toggle: (next?: boolean) => void
  /** Открыть панель с контекстом объекта (не уводя с экрана). */
  discuss: (target: ScreenRef) => void
  /** Экран, данные которого уйдут с сообщением. */
  context: ScreenRef
  conversation: Conversation
  send: (text: string) => void
  retry: (requestId: string) => void
  decide: (approvalRequestId: string, decision: 'allow' | 'reject') => void
  loadEarlier: () => void
  reconnect: () => void
  /** Новые сообщения ассистента, пока панель была закрыта; urgent — среди них просьба подтвердить. */
  unread: number
  urgent: boolean
  /** Черновик сообщения: переживает закрытие панели. */
  draft: string
  setDraft: (text: string) => void
  focusToken: number
}

const AssistantContext = createContext<Assistant | null>(null)

export function useAssistant(): Assistant {
  const value = useContext(AssistantContext)
  if (value === null) throw new Error('AssistantProvider is missing')
  return value
}

const codeOf = (error: unknown): string => error instanceof ApiError ? error.code : 'network'
const MAX_BACKOFF_MS = 30_000
const OPEN_KEY = 'console.assistant.open'

const OPEN_PARAM = 'assistant'

/**
 * Открыта ли панель при загрузке: адрес `?assistant=open` (туда ведёт `/harness/` стенда)
 * или прошлый выбор человека. Служебный параметр снимается с адреса: перезагрузка и «назад»
 * панель заново не открывают.
 */
function readOpen(): boolean {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    if (params.get(OPEN_PARAM) === 'open') {
      params.delete(OPEN_PARAM)
      const query = params.toString()
      window.history.replaceState(window.history.state, '', window.location.pathname + (query !== '' ? `?${query}` : '') + window.location.hash)
      storeOpen(true)
      return true
    }
  }
  try { return localStorage.getItem(OPEN_KEY) === '1' } catch { return false }
}
function storeOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* приватное окно — не помним */ }
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = (): void => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

export function AssistantProvider({ screen, children }: { screen: ScreenRef, children: ReactNode }) {
  const [open, setOpen] = useState(readOpen)
  // «Обсудить» подставляет объект — только пока человек на том же экране.
  const [override, setOverride] = useState<{ on: string, target: ScreenRef } | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const [draft, setDraft] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [unread, setUnread] = useState(0)
  const [urgent, setUrgent] = useState(false)
  const [conversation, dispatch] = useReducer(reduce, initialConversation)
  const state = useRef(conversation)
  const openRef = useRef(open)
  // Свежие значения для обработчиков потока — после каждой отрисовки, до событий браузера.
  useLayoutEffect(() => {
    state.current = conversation
    openRef.current = open
  })
  const loading = useRef(false)
  const visible = useVisible()

  const history = useCallback(async (older: boolean) => {
    if (loading.current) return
    loading.current = true
    dispatch({ type: 'history.loading' })
    try {
      const page = await loadHistory({ before: older ? state.current.history.nextBefore : null })
      dispatch({ type: 'history.loaded', items: page.items, nextBefore: page.nextBefore, older })
    } catch (error) {
      dispatch({ type: 'history.failed', error: codeOf(error) })
    } finally {
      loading.current = false
    }
  }, [])

  // Открытие панели: история (знак присутствия). Непрочитанное снимает само открытие (toggle).
  useEffect(() => {
    if (!open) return
    if (state.current.history.state === 'idle' || state.current.history.state === 'failed') void history(false)
  }, [open, history])

  // Поток: пока вкладка видна.
  useEffect(() => {
    if (!visible) return
    if (typeof EventSource === 'undefined') {
      dispatch({ type: 'link', link: 'unsupported' })
      return
    }
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let backoff = 1_000
    let closed = false
    const connect = (again: boolean): void => {
      dispatch({ type: 'link', link: again ? 'reconnecting' : 'connecting' })
      const current = new EventSource(streamUrl(state.current.cursor))
      source = current
      for (const type of STREAM_EVENT_TYPES) {
        current.addEventListener(type, (message: MessageEvent<string>) => {
          let data: unknown
          try { data = JSON.parse(message.data) } catch { return }
          if (typeof data !== 'object' || data === null) return
          const raw = data as Record<string, unknown>
          const event = { ...raw, type, cursor: typeof raw.cursor === 'string' ? raw.cursor : message.lastEventId } as StreamEvent
          const known = event.type === 'message' && state.current.messages.some(m => m.id === event.message.id)
          dispatch({ type: 'event', event })
          if (!openRef.current) {
            if (event.type === 'message' && event.message.role === 'assistant' && !known) setUnread(n => n + 1)
            if (event.type === 'approval.requested') { setUnread(n => n + 1); setUrgent(true) }
          }
          if (event.type === 'ready') {
            backoff = 1_000
            // Курсор неизвестен контейнеру (другая жизнь) — беседу перечитать, если она уже видна.
            if (!event.resumed && state.current.history.state === 'loaded') void history(false)
          }
        })
      }
      current.onerror = () => {
        if (closed) return
        dispatch({ type: 'link', link: 'reconnecting' })
        // CONNECTING — браузер переподключится сам с Last-Event-ID; CLOSED — сами, с after.
        if (current.readyState !== EventSource.CLOSED) return
        current.close()
        void (async () => {
          const refusal = await streamRefusal(state.current.cursor)
          if (closed) return
          if (refusal?.status === 401) {
            dispatch({ type: 'link', link: 'refused', error: 'unauthenticated' })
            if (!leftForLogin(refusal)) redirectToLogin()
            return
          }
          if (refusal?.code === 'too_many_streams') {
            dispatch({ type: 'link', link: 'refused', error: refusal.code })
            return
          }
          timer = setTimeout(() => connect(true), backoff)
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
        })()
      }
    }
    connect(false)
    return () => {
      closed = true
      clearTimeout(timer)
      source?.close()
      dispatch({ type: 'link', link: 'idle' })
    }
  }, [visible, history, attempt])

  const deliver = useCallback(async (message: Outgoing) => {
    try {
      const reply = await sendMessage({ requestId: message.requestId, text: message.text, ...(message.screenUrl !== undefined ? { screenUrl: message.screenUrl } : {}) })
      dispatch({ type: 'sent', requestId: message.requestId, queued: reply.queued })
    } catch (error) {
      dispatch({ type: 'send.failed', requestId: message.requestId, error: codeOf(error) })
    }
  }, [])

  const context = override !== null && override.on === screen.url ? override.target : screen

  const send = useCallback((text: string) => {
    const message: Outgoing = { requestId: newRequestId(), text, at: new Date().toISOString(), state: 'sending', screenUrl: context.url, screenLabel: context.label }
    dispatch({ type: 'send', message })
    void deliver(message)
  }, [context, deliver])

  const retry = useCallback((requestId: string) => {
    const message = state.current.outgoing.find(o => o.requestId === requestId)
    if (message === undefined || message.state !== 'failed') return
    dispatch({ type: 'retry', requestId })
    // Тот же requestId, текст и экран: BFF отдаст харнессу прежнее тело, дубля не будет.
    void deliver(message)
  }, [deliver])

  const decide = useCallback((id: string, decision: 'allow' | 'reject') => {
    dispatch({ type: 'approval.deciding', id })
    void (async () => {
      try {
        const reply = await decideApproval(id, decision)
        if (reply.status === 'resolved') dispatch({ type: 'approval.decided', id, state: decision })
        else if (reply.status === 'expired') dispatch({ type: 'approval.decided', id, state: 'expired' })
        else {
          const known = reply.decision === 'allow' || reply.decision === 'reject' || reply.decision === 'cancelled' ? reply.decision : 'expired'
          dispatch({ type: 'approval.decided', id, state: known, ...(reply.surface !== undefined ? { surface: reply.surface } : {}) })
        }
      } catch (error) {
        dispatch({ type: 'approval.failed', id, error: codeOf(error) })
      }
    })()
  }, [])

  const toggle = useCallback((next?: boolean) => {
    const value = next ?? !openRef.current
    storeOpen(value)
    setOpen(value)
    if (value) {
      setUnread(0)
      setUrgent(false)
    }
  }, [])
  const discuss = useCallback((target: ScreenRef) => {
    setOverride({ on: screen.url, target })
    toggle(true)
    setFocusToken(n => n + 1)
  }, [toggle, screen.url])

  const value = useMemo<Assistant>(() => ({
    open, toggle, discuss, context, conversation, send, retry, decide,
    loadEarlier: () => void history(true),
    reconnect: () => setAttempt(n => n + 1),
    unread, urgent, draft, setDraft, focusToken,
  }), [open, toggle, discuss, context, conversation, send, retry, decide, history, unread, urgent, draft, focusToken])

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}
