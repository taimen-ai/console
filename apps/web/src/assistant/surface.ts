import { API, ApiError, consoleFetch } from '../api/client.ts'

/**
 * Поверхность беседы `surface/1` (docs/contracts/harness-surface суперпроекта) через BFF
 * `{base}/api/assistant/{message,stream,history,approval}`. Беседа живёт в контейнере
 * харнесса человека и одна на все поверхности (консоль, Telegram); консоль её не хранит —
 * состояние живёт до перезагрузки вкладки и восстанавливается из `history`.
 * Перенесено из прежней консоли (web/console/app/src/assistant).
 */
export const ASSISTANT_API = `${API}/assistant`

export type Surface = 'window' | 'telegram' | 'console'

/** Сообщение беседы (`$defs.message` event.schema.json). */
export interface SurfaceMessage {
  id: string
  role: 'user' | 'assistant'
  surface?: Surface
  text: string
  at: string
  requestId?: string
  screenContext?: { kind?: string, id?: string, label?: string, url?: string }
}

/** `data` события потока. Незнакомые типы клиент пропускает. */
export type StreamEvent = { cursor: string, at: string } & (
  | { type: 'sleeping' | 'waking' }
  | { type: 'ready', resumed: boolean }
  | { type: 'message', message: SurfaceMessage }
  | { type: 'delta', messageId: string, text: string }
  | { type: 'turn.started', turnId: string, requestId?: string }
  | { type: 'turn.ended', turnId: string, requestId?: string, status?: 'completed' | 'failed' | 'cancelled', error?: string }
  | { type: 'tool.summary', turnId: string, tool: string, title: string, status: 'started' | 'succeeded' | 'failed' }
  | { type: 'approval.requested', approvalRequestId: string, turnId?: string, toolName: string, reason: string, expiresAt: string }
  | { type: 'approval.resolved', approvalRequestId: string, decision: 'allow' | 'reject' | 'cancelled', surface?: Surface }
)
export type StreamEventType = StreamEvent['type']
export const STREAM_EVENT_TYPES: readonly StreamEventType[] = [
  'sleeping', 'waking', 'ready', 'message', 'delta', 'turn.started', 'tool.summary', 'approval.requested', 'approval.resolved', 'turn.ended',
]

export interface HistoryPage { items: SurfaceMessage[], nextBefore: string | null }

/** Ответ `POST …/approval`. `expired` — и истёкший, и неизвестный контейнеру (404) запрос. */
export type ApprovalReply =
  | { status: 'resolved' }
  | { status: 'already_resolved', decision?: string, surface?: Surface }
  | { status: 'expired' }

/** UUID v4 — ключ идемпотентности сообщения; повтор после сбоя идёт с тем же. */
export function newRequestId(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const post = (op: string, body: unknown): Promise<Response> => consoleFetch(`${ASSISTANT_API}/${op}`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
})

/**
 * Сообщение: `{requestId, text, screenUrl?}`. `screenUrl` — адрес экрана консоли; контекст
 * экрана по нему собирает BFF. Нет `screenUrl` — человек снял плашку, контекста нет.
 */
export async function sendMessage(body: { requestId: string, text: string, screenUrl?: string }): Promise<{ queued: boolean }> {
  const reply = await (await post('message', body)).json().catch(() => ({})) as { queued?: unknown }
  return { queued: reply.queued === true }
}

export async function loadHistory(params: { before?: string | null, limit?: number } = {}): Promise<HistoryPage> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 50) })
  if (params.before != null) query.set('before', params.before)
  const page = await (await consoleFetch(`${ASSISTANT_API}/history?${query}`, { headers: { accept: 'application/json' } })).json() as Partial<HistoryPage>
  return { items: Array.isArray(page.items) ? page.items : [], nextBefore: typeof page.nextBefore === 'string' ? page.nextBefore : null }
}

export async function decideApproval(approvalRequestId: string, decision: 'allow' | 'reject'): Promise<ApprovalReply> {
  try {
    return await (await post('approval', { approvalRequestId, decision })).json() as ApprovalReply
  } catch (error) {
    // Контейнер не знает запрос (перезапускался) — клиент считает его истёкшим (surface/1).
    if (error instanceof ApiError && error.status === 404 && error.code === 'approval_not_found') return { status: 'expired' }
    throw error
  }
}

/** Адрес потока; `after` — курсор последнего полученного события. */
export const streamUrl = (after: string | null): string => `${ASSISTANT_API}/stream${after !== null ? `?after=${encodeURIComponent(after)}` : ''}`

/**
 * Почему поток закрыт насовсем. EventSource статуса ответа не показывает: `error` с `CLOSED`
 * одинаков для 401, 429 и 5xx. Поэтому тот же адрес запрашивается ещё раз обычным fetch и
 * сразу закрывается: `null` — поток открывается (сбой был мимолётным), иначе — отказ BFF или
 * launcher'а (`401` — сессии нет, `429 too_many_streams` — слишком много потоков). На 401
 * `unauthenticated`/`reauth_required` `consoleFetch` сам уводит на вход.
 */
export async function streamRefusal(after: string | null): Promise<ApiError | null> {
  try {
    const response = await consoleFetch(streamUrl(after), { headers: { accept: 'text/event-stream' } })
    // поток открылся — закрыть сразу: отмена тела обрывает запрос и освобождает место потока
    await response.body?.cancel().catch(() => {})
    return null
  } catch (error) {
    return error instanceof ApiError ? error : new ApiError(0, 'network')
  }
}
