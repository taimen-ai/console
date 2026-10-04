import type { StreamEvent, Surface, SurfaceMessage } from './surface.ts'

/**
 * Состояние беседы в панели — чистый редьюсер над событиями `surface/1`, историей и
 * локальными отправками. Беседу строят события `message`; `delta` — только живой показ до
 * итогового `message` (контракт surface/1, «Клиент строит беседу по message»).
 */

/**
 * Связь с потоком: `sleeping`/`waking` — контейнер спит или просыпается; `connecting` — первое
 * подключение после открытия панели (и повторного открытия с курсором); `reconnecting` —
 * только настоящий обрыв; `refused` — поток отказан так, что повтор сам не поможет
 * (`linkError`: `too_many_streams`, `unauthenticated`), переподключение — кнопкой.
 */
export type Link = 'idle' | 'connecting' | 'sleeping' | 'waking' | 'ready' | 'reconnecting' | 'refused' | 'unsupported'

/** Своё сообщение до того, как поток вернул его `message`. */
export interface Outgoing {
  requestId: string
  text: string
  /** Адрес экрана на момент отправки: повтор идёт с тем же, иначе BFF соберёт другое тело. */
  screenUrl?: string
  screenLabel?: string
  at: string
  state: 'sending' | 'sent' | 'failed'
  queued?: boolean
  error?: string
}

export interface ToolCall { tool: string, title: string, status: 'started' | 'succeeded' | 'failed' }
export interface ToolGroup { turnId: string, at: string, calls: ToolCall[] }

export interface AssistantApproval {
  approvalRequestId: string
  turnId?: string
  toolName: string
  reason: string
  expiresAt: string
  at: string
  state: 'pending' | 'deciding' | 'allow' | 'reject' | 'cancelled' | 'expired'
  /** Где решено, если не здесь. */
  surface?: Surface
  error?: string
}

export interface Turn { turnId: string, requestId?: string }

export interface Conversation {
  link: Link
  /** Код отказа потока при `link: 'refused'`. */
  linkError?: string
  /** Курсор последнего события: с него поток продолжается после обрыва и закрытия панели. */
  cursor: string | null
  messages: SurfaceMessage[]
  outgoing: Outgoing[]
  /** Живой текст ответа по `messageId`, пока не пришёл итоговый `message`. */
  deltas: Record<string, string>
  tools: ToolGroup[]
  approvals: AssistantApproval[]
  turn: Turn | null
  turnNote: { status: 'failed' | 'cancelled', error?: string, at: string } | null
  history: { state: 'idle' | 'loading' | 'loaded' | 'failed', nextBefore: string | null, error?: string }
  /** Последний законченный ответ ассистента, пришедший потоком (не историей): его читают вслух. */
  lastReply?: { id: string, text: string }
}

export const initialConversation: Conversation = {
  link: 'idle', cursor: null, messages: [], outgoing: [], deltas: {}, tools: [], approvals: [], turn: null, turnNote: null,
  history: { state: 'idle', nextBefore: null },
}

export type Action =
  | { type: 'link', link: Link, error?: string }
  | { type: 'event', event: StreamEvent }
  | { type: 'history.loading' }
  | { type: 'history.loaded', items: SurfaceMessage[], nextBefore: string | null, older: boolean }
  | { type: 'history.failed', error: string }
  | { type: 'send', message: Outgoing }
  | { type: 'sent', requestId: string, queued: boolean }
  | { type: 'send.failed', requestId: string, error: string }
  | { type: 'retry', requestId: string }
  | { type: 'approval.deciding', id: string }
  | { type: 'approval.decided', id: string, state: AssistantApproval['state'], surface?: Surface }
  | { type: 'approval.failed', id: string, error: string }

const byTime = (a: { at: string }, b: { at: string }): number => Date.parse(a.at) - Date.parse(b.at)

/** Сообщения без повторов по `id`, по времени. Своё отправленное уходит, когда пришло из беседы. */
function merge(current: SurfaceMessage[], incoming: SurfaceMessage[]): SurfaceMessage[] {
  const map = new Map(current.map(m => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort(byTime)
}

function settle(state: Conversation, messages: SurfaceMessage[]): Conversation {
  const seen = new Set(messages.map(m => m.requestId).filter((id): id is string => id !== undefined))
  const deltas = { ...state.deltas }
  for (const m of messages) delete deltas[m.id]
  return { ...state, messages, deltas, outgoing: state.outgoing.filter(o => !seen.has(o.requestId)) }
}

const patchApproval = (state: Conversation, id: string, patch: Partial<AssistantApproval>): Conversation => ({
  ...state, approvals: state.approvals.map(a => a.approvalRequestId === id ? { ...a, ...patch } : a),
})

const patchOutgoing = (state: Conversation, requestId: string, patch: Partial<Outgoing>): Conversation => ({
  ...state, outgoing: state.outgoing.map(o => o.requestId === requestId ? { ...o, ...patch } : o),
})

function onEvent(state: Conversation, event: StreamEvent): Conversation {
  const next: Conversation = typeof event.cursor === 'string' && event.cursor !== '' ? { ...state, cursor: event.cursor } : state
  switch (event.type) {
    case 'sleeping': return { ...next, link: 'sleeping' }
    case 'waking': return { ...next, link: 'waking' }
    // Курсор неизвестен контейнеру (перезапуск, вытеснен из буфера): ход, начатый в прежней
    // жизни, уже не закончится событием — «Ассистент отвечает…» и живой текст снимаются.
    case 'ready': return event.resumed ? { ...next, link: 'ready' } : { ...next, link: 'ready', turn: null, deltas: {} }
    case 'message': {
      const fresh = event.message.role === 'assistant' && !next.messages.some(m => m.id === event.message.id)
      const settled = settle(next, merge(next.messages, [event.message]))
      return fresh ? { ...settled, lastReply: { id: event.message.id, text: event.message.text } } : settled
    }
    case 'delta': {
      if (next.messages.some(m => m.id === event.messageId)) return next
      return { ...next, deltas: { ...next.deltas, [event.messageId]: (next.deltas[event.messageId] ?? '') + event.text } }
    }
    case 'turn.started': return { ...next, turn: { turnId: event.turnId, requestId: event.requestId }, turnNote: null }
    case 'turn.ended': {
      const turn = next.turn?.turnId === event.turnId ? null : next.turn
      const note = event.status === 'failed' || event.status === 'cancelled' ? { status: event.status, error: event.error, at: event.at } : null
      // Ход окончен — живые куски без итогового message больше не нужны.
      return { ...next, turn, turnNote: note, deltas: turn === null ? {} : next.deltas }
    }
    case 'tool.summary': {
      const call: ToolCall = { tool: event.tool, title: event.title, status: event.status }
      const group = next.tools.find(g => g.turnId === event.turnId)
      if (group === undefined) return { ...next, tools: [...next.tools, { turnId: event.turnId, at: event.at, calls: [call] }] }
      // started → succeeded/failed одного вызова: обновить последнюю незавершённую строку того же инструмента
      const calls = [...group.calls]
      const running = (c: ToolCall) => c.status === 'started' && c.tool === call.tool
      let open = call.status === 'started' ? -1 : calls.findLastIndex(c => running(c) && c.title === call.title)
      if (open < 0 && call.status !== 'started') open = calls.findLastIndex(running)
      if (open >= 0) calls[open] = call
      else calls.push(call)
      return { ...next, tools: next.tools.map(g => g === group ? { ...g, calls } : g) }
    }
    case 'approval.requested': {
      if (next.approvals.some(a => a.approvalRequestId === event.approvalRequestId)) return next
      return { ...next, approvals: [...next.approvals, {
        approvalRequestId: event.approvalRequestId, turnId: event.turnId, toolName: event.toolName, reason: event.reason,
        expiresAt: event.expiresAt, at: event.at, state: 'pending',
      }] }
    }
    case 'approval.resolved': {
      const known = next.approvals.find(a => a.approvalRequestId === event.approvalRequestId)
      if (known === undefined) return next
      return patchApproval(next, event.approvalRequestId, { state: event.decision, surface: event.surface, error: undefined })
    }
    default: return next
  }
}

export function reduce(state: Conversation, action: Action): Conversation {
  switch (action.type) {
    case 'link': return { ...state, link: action.link, linkError: action.link === 'refused' ? action.error : undefined }
    case 'event': return onEvent(state, action.event)
    case 'history.loading': return { ...state, history: { ...state.history, state: 'loading', error: undefined } }
    case 'history.loaded': {
      const merged = settle(state, merge(state.messages, action.items))
      // Страница «раньше» не сдвигает курсор истории вперёд: nextBefore — от самой старой.
      const nextBefore = action.older || state.history.state !== 'loaded' ? action.nextBefore : state.history.nextBefore ?? action.nextBefore
      return { ...merged, history: { state: 'loaded', nextBefore } }
    }
    case 'history.failed': return { ...state, history: { ...state.history, state: 'failed', error: action.error } }
    case 'send': return { ...state, outgoing: [...state.outgoing, action.message] }
    case 'sent': return state.messages.some(m => m.requestId === action.requestId) ? state : patchOutgoing(state, action.requestId, { state: 'sent', queued: action.queued })
    case 'send.failed': return patchOutgoing(state, action.requestId, { state: 'failed', error: action.error })
    case 'retry': return patchOutgoing(state, action.requestId, { state: 'sending', error: undefined })
    case 'approval.deciding': return patchApproval(state, action.id, { state: 'deciding', error: undefined })
    case 'approval.decided': return patchApproval(state, action.id, { state: action.state, surface: action.surface })
    case 'approval.failed': return patchApproval(state, action.id, { state: 'pending', error: action.error })
  }
}

/** Лента панели: сообщения, свои отправки, сводки инструментов и подтверждения — по времени. */
export type Entry =
  | { kind: 'message', at: string, key: string, message: SurfaceMessage }
  | { kind: 'outgoing', at: string, key: string, outgoing: Outgoing }
  | { kind: 'tools', at: string, key: string, group: ToolGroup }
  | { kind: 'approval', at: string, key: string, approval: AssistantApproval }
  | { kind: 'delta', at: string, key: string, text: string }

export function timeline(state: Conversation, now = new Date().toISOString()): Entry[] {
  const entries: Entry[] = [
    ...state.messages.map(message => ({ kind: 'message' as const, at: message.at, key: `m:${message.id}`, message })),
    ...state.outgoing.map(outgoing => ({ kind: 'outgoing' as const, at: outgoing.at, key: `o:${outgoing.requestId}`, outgoing })),
    ...state.tools.map(group => ({ kind: 'tools' as const, at: group.at, key: `t:${group.turnId}`, group })),
    ...state.approvals.map(approval => ({ kind: 'approval' as const, at: approval.at, key: `a:${approval.approvalRequestId}`, approval })),
  ]
  // стабильная сортировка: при равном времени — порядок поступления
  entries.sort(byTime)
  for (const [id, text] of Object.entries(state.deltas)) entries.push({ kind: 'delta', at: now, key: `d:${id}`, text })
  return entries
}
