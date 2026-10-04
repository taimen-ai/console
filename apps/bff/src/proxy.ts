/**
 * Транспорт прокси.
 * - HTTP — `fetch` наверх и ответ потоком в браузер (SSE идёт без буферизации). Заголовки в
 *   обе стороны — по белым спискам: cookie браузера наверх не уходят, `set-cookie` и адреса
 *   upstream — вниз.
 * - WebSocket — прозрачный туннель через `upgrade` node:http: рукопожатие уходит наверх с
 *   серверным Bearer, после `101` байты перекачиваются без разбора кадров (из прежней консоли).
 */
import { STATUS_CODES, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Duplex } from 'node:stream'

export const REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'idempotency-key', 'if-match', 'if-none-match', 'last-event-id'] as const
/**
 * Заголовки ответа upstream, которые доходят до браузера. `content-length` не передаётся:
 * `fetch` распаковывает сжатое тело, и длина upstream с ним не совпадает.
 */
const RESPONSE_HEADERS = ['content-type', 'content-disposition', 'etag', 'last-modified', 'retry-after', 'cache-control', 'x-harness-surface-version'] as const
const WS_HEADERS = ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol'] as const
/** На любом ответе API: ответ upstream не исполняется браузером как документ, даже если он HTML. */
export const RESPONSE_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
} as const
/** Сколько ждать рукопожатия WS с ядром. */
export const WS_HANDSHAKE_TIMEOUT_MS = 10_000

export class BodyTooLarge extends Error {}

/** Заголовки запроса браузера по белому списку. */
export function pickRequestHeaders(source: Headers, names: readonly string[] = REQUEST_HEADERS): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = source.get(name)
    if (value !== null) out[name] = value
  }
  return out
}

/** Тело запроса с лимитом: длинное — `BodyTooLarge` ещё до конца чтения. */
export async function readLimited(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new BodyTooLarge()
  if (request.body === null) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > limit) throw new BodyTooLarge()
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Ответ upstream браузеру как есть, потоком; заголовки — по белому списку. */
export function relayResponse(upstream: Response, extra: Record<string, string> = {}): Response {
  const headers = new Headers()
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store')
  for (const [k, v] of Object.entries({ ...extra, ...RESPONSE_SECURITY_HEADERS })) headers.set(k, v)
  return new Response(upstream.body, { status: upstream.status, headers })
}

// ------------------------------------------------------------------ WebSocket

export function pickHeaders(source: IncomingHttpHeaders, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = source[name]
    if (typeof value === 'string') out[name] = value
  }
  return out
}

export function refuseUpgrade(socket: Duplex, status: number): void {
  // Отказ рукопожатия закрывает сокет целиком: полуоткрытым он висел бы до ухода клиента.
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy())
}

/**
 * WebSocket-туннель. Возвращает статус рукопожатия upstream (101 — туннель открыт);
 * `opened` получает функцию закрытия туннеля (её держит сессия). Нет ответа ядра за
 * `timeoutMs` — 504.
 */
export function tunnel(client: Duplex, head: Buffer, req: IncomingMessage, url: URL, headers: Record<string, string>,
  opened: (close: () => void) => void, timeoutMs = WS_HANDSHAKE_TIMEOUT_MS): Promise<number> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve) => {
    let settled = false
    const settle = (status: number): void => {
      clearTimeout(timer)
      if (!settled) { settled = true; resolve(status) }
    }
    const up = send(url, { method: 'GET', headers: { ...pickHeaders(req.headers, WS_HEADERS), ...headers, connection: 'Upgrade', upgrade: 'websocket' } })
    const timer = setTimeout(() => {
      up.destroy()
      refuseUpgrade(client, 504)
      settle(504)
    }, timeoutMs)
    client.on('error', () => up.destroy())
    up.on('upgrade', (response, socket, upHead) => {
      if (settled) { socket.destroy(); return }
      const lines = ['HTTP/1.1 101 Switching Protocols']
      for (let i = 0; i + 1 < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`)
      client.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (upHead.length > 0) client.write(upHead)
      if (head.length > 0) socket.write(head)
      // Сокеты HTTP-сервера полуоткрыты (allowHalfOpen): конец любой стороны закрывает обе.
      const close = (): void => { socket.destroy(); client.destroy() }
      socket.on('error', close).on('end', close).on('close', close)
      client.on('error', close).on('end', close).on('close', close)
      socket.pipe(client).pipe(socket)
      opened(close)
      settle(101)
    })
    up.on('response', (response) => {
      const status = response.statusCode ?? 502
      response.resume()
      if (!settled) refuseUpgrade(client, status)
      settle(status)
    })
    up.on('error', () => {
      if (!settled) refuseUpgrade(client, 502)
      settle(502)
    })
    up.end()
  })
}
