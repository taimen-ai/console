/**
 * Заглушка launcher'а харнесса по контракту `surface/1` (docs/contracts/harness-surface
 * суперпроекта): история беседы, поток SSE с курсором, сообщение с идемпотентностью по
 * requestId, подтверждения. Ассистент здесь не думает — отвечает по кускам заготовкой,
 * в которой видно, какой контекст экрана собрал BFF. Одна беседа на человека: та же, что в
 * Telegram (сообщения из Telegram лежат в истории с `surface: telegram`).
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { FINANCE, P, today } from './data.ts'

interface Message { id: string, role: 'user' | 'assistant', surface?: 'window' | 'telegram' | 'console', text: string, at: string, requestId?: string, screenContext?: Record<string, unknown> }
interface StreamEvent { type: string, cursor: string, at: string, data: Record<string, unknown> }

const yesterday = (hh: number, mm: number): string => new Date(Date.parse(today(hh, mm)) - 86_400_000).toISOString()

const messages: Message[] = [
  { id: 'm-1', role: 'user', surface: 'telegram', text: 'Сколько счетов оплатили на этой неделе?', at: yesterday(18, 40) },
  { id: 'm-2', role: 'assistant', text: 'С понедельника оплачено 27 счетов, все проверены по платежам в банке. Два ждут согласования.', at: yesterday(18, 41) },
  { id: 'm-3', role: 'assistant', text: 'Процесс «Оплата счетов» просит согласовать оплату счёта №417 «Альфа-Снаб», 184 500 ₽: сумма выше порога 150 000 ₽.', at: today(12, 37) },
  { id: 'm-4', role: 'assistant', text: '«Сверить счёт №421» дважды не прошла проверку: сумма в счёте 99 600 ₽, в акте сверки из 1С — 96 000 ₽. Агенту это не исправить — нужен исправленный счёт от «Вектора».', at: today(13, 12) },
]
const seen = new Map<string, { body: string, messageId: string }>()
const buffer: StreamEvent[] = []
const streams = new Set<ServerResponse>()
let seq = 0

const send = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

function write(res: ServerResponse, e: StreamEvent): void {
  res.write(`event: ${e.type}\nid: ${e.cursor}\ndata: ${JSON.stringify({ ...e.data, cursor: e.cursor, at: e.at })}\n\n`)
}

function push(type: string, data: Record<string, unknown>): void {
  const event: StreamEvent = { type, cursor: `c${++seq}`, at: new Date().toISOString(), data }
  buffer.push(event)
  if (buffer.length > 500) buffer.shift()
  for (const res of streams) write(res, event)
}

const later = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Ответ ассистента ходом: начало, сводка инструмента, куски, итоговое сообщение, конец. */
async function answer(question: Message): Promise<void> {
  const turnId = randomUUID()
  push('turn.started', { turnId, requestId: question.requestId })
  const context = question.screenContext
  await later(400)
  if (context !== undefined) {
    push('tool.summary', { turnId, tool: 'cp_get_task', title: `Смотрю «${String(context.label ?? context.kind)}»`, status: 'started' })
    await later(500)
    push('tool.summary', { turnId, tool: 'cp_get_task', title: `Смотрю «${String(context.label ?? context.kind)}»`, status: 'succeeded' })
  }
  // «Поручи…» — предложение работы ссылкой: консоль покажет карточку «Будет заведено».
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const proposal = `/console/work/new?${new URLSearchParams({
    title: 'Сверить счёт №430 «Полюс»', type: 'invoice-reconcile', exec: P.reconciler.id, ws: FINANCE, due: tomorrow,
    result: 'Акт сверки без расхождений или список расхождений с суммами',
  })}`
  const text = /поручи|assign/i.test(question.text)
    ? `Подготовил работу — проверьте и заведите:\n\n[Сверить счёт №430 «Полюс»](${proposal})`
    : context !== undefined
    ? `Это ответ стенда разработки: настоящий ассистент ответит по данным экрана «${String(context.label ?? context.kind)}». Вопрос: «${question.text}».`
    : `Это ответ стенда разработки без контекста экрана. Вопрос: «${question.text}».`
  const id = randomUUID()
  for (const piece of text.match(/.{1,24}(\s|$)/g) ?? [text]) {
    push('delta', { messageId: id, text: piece })
    await later(60)
  }
  const reply: Message = { id, role: 'assistant', text, at: new Date().toISOString() }
  messages.push(reply)
  push('message', { message: reply })
  push('turn.ended', { turnId, requestId: question.requestId, status: 'completed' })
}

/** Проактивное сообщение: ассистент пишет сам, без вопроса — через `delayMs` после запуска. */
export function proactive(delayMs: number): void {
  setTimeout(() => {
    const message: Message = { id: randomUUID(), role: 'assistant', text: 'Агент «Подготовщик заявок» падает при запуске, две заявки на тендеры ждут его. Срок подачи первой — завтра в 10:00.', at: new Date().toISOString() }
    messages.push(message)
    push('message', { message })
  }, delayMs).unref()
}

export function handle(req: IncomingMessage, res: ServerResponse, body: string): void {
  const url = new URL(req.url ?? '/', 'http://launcher')
  const m = /^\/harness\/_launcher\/internal\/principals\/([^/]+)\/surface\/(message|stream|history|approval)$/.exec(url.pathname)
  if (m === null || !String(req.headers.authorization ?? '').startsWith('Bearer ')) return send(res, 404, { error: { code: 'not_found' } })
  const op = m[2]
  if (op === 'history') {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100)
    const before = url.searchParams.get('before')
    const ordered = [...messages].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    const from = before !== null ? ordered.findIndex(x => x.id === before) + 1 : 0
    const items = ordered.slice(from, from + limit)
    return send(res, 200, { items, nextBefore: from + limit < ordered.length ? items.at(-1)?.id ?? null : null })
  }
  if (op === 'stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    const after = url.searchParams.get('after') ?? req.headers['last-event-id']
    const from = typeof after === 'string' ? buffer.findIndex(e => e.cursor === after) : -1
    write(res, { type: 'ready', cursor: `c${seq}`, at: new Date().toISOString(), data: { resumed: from >= 0 } })
    if (from >= 0) for (const e of buffer.slice(from + 1)) write(res, e)
    streams.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    res.on('close', () => { clearInterval(ping); streams.delete(res) })
    return
  }
  if (op === 'approval') return send(res, 200, { status: 'resolved' })
  // message: тот же requestId и то же тело — исходный ответ; другое тело — 409.
  const input = JSON.parse(body) as { requestId: string, text: string, screenContext?: Record<string, unknown> }
  const known = seen.get(input.requestId)
  if (known !== undefined) {
    if (known.body !== body) return send(res, 409, { error: { code: 'request_id_reused' } })
    return send(res, 202, { requestId: input.requestId, messageId: known.messageId, queued: false })
  }
  const context = input.screenContext !== undefined
    ? Object.fromEntries(Object.entries(input.screenContext).filter(([k]) => ['kind', 'id', 'label', 'url'].includes(k)))
    : undefined
  const message: Message = { id: randomUUID(), role: 'user', surface: 'console', text: input.text, at: new Date().toISOString(), requestId: input.requestId, ...(context !== undefined ? { screenContext: context } : {}) }
  seen.set(input.requestId, { body, messageId: message.id })
  messages.push(message)
  send(res, 202, { requestId: input.requestId, messageId: message.id, queued: false })
  push('message', { message })
  void answer({ ...message, ...(input.screenContext !== undefined ? { screenContext: input.screenContext } : {}) })
}
