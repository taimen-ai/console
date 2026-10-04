import { BASE_PATH } from '../../api/client.ts'

/**
 * Предложение работы ссылкой (docs/screens/work.md, «Поручить работу словами»): адрес
 * `/work/new?title=…&type=…&exec=…&owner=…&due=…&ws=…&result=…&basis=…` открывает
 * «Поручить работу» с заполненными полями. Ту же ссылку в ответе ассистента консоль рисует
 * карточкой «Будет заведено» с «Завести работу» / «Изменить» — работа заводится только
 * подписью человека, ассистент сам её не заводит.
 *
 * Параметры:
 * - `title` — что сделать (обязателен), до 500 знаков;
 * - `type` — ключ типа работы; `exec`, `owner` — principal id; `ws` — id пространства;
 * - `due` — срок: дата `ГГГГ-ММ-ДД` (до конца рабочего дня, 18:00 по часам браузера) или
 *   дата-время ISO 8601;
 * - `result` — ожидаемый результат, `basis` — основание (до 2000 знаков).
 * Неверное значение отбрасывается, а не уходит в ядро: человек дополнит его в форме.
 */

export interface WorkProposal {
  title: string
  type?: string
  exec?: string
  owner?: string
  /** Значение поля `datetime-local`: `ГГГГ-ММ-ДДTчч:мм`. */
  due?: string
  ws?: string
  result?: string
  basis?: string
}

export const PROPOSAL_PATH = '/work/new'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i
/** Конец рабочего дня для срока датой. */
const END_OF_DAY = '18:00'

/** Роутер разбирает значения адреса как JSON: «123» приходит числом — это тоже текст. */
const text = (v: unknown, max: number): string | undefined => {
  const s = typeof v === 'number' ? String(v) : v
  return typeof s === 'string' && s.trim() !== '' ? s.trim().slice(0, max) : undefined
}
const pad = (n: number): string => String(n).padStart(2, '0')

/** Срок из ссылки → значение `datetime-local`; неверное — undefined. */
export function dueInput(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isNaN(new Date(`${value}T${END_OF_DAY}`).getTime()) ? undefined : `${value}T${END_OF_DAY}`
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Разбор параметров ссылки; без «что сделать» предложения нет. */
export function parseProposal(raw: Record<string, unknown>): WorkProposal | null {
  const title = text(raw.title, 500)
  if (title === undefined) return null
  const out: WorkProposal = { title }
  const type = text(raw.type, 64)
  if (type !== undefined && TYPE_KEY.test(type)) out.type = type
  for (const key of ['exec', 'owner', 'ws'] as const) {
    const v = raw[key]
    if (typeof v === 'string' && UUID.test(v)) out[key] = v
  }
  const due = dueInput(raw.due)
  if (due !== undefined) out.due = due
  const result = text(raw.result, 2000)
  if (result !== undefined) out.result = result
  const basis = text(raw.basis, 2000)
  if (basis !== undefined) out.basis = basis
  return out
}

/** Ссылка на предложение — для ассистента и для «Изменить». */
export function proposalHref(p: WorkProposal): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && v !== '') q.set(k, v)
  return `${BASE_PATH}${PROPOSAL_PATH}?${q}`
}

/**
 * Предложения в тексте ответа: ссылки на `/work/new?…` — относительные или своего origin,
 * в разметке `[…](…)`, `<…>` или голым адресом. Повторы одной ссылки — одно предложение.
 */
export function findProposals(text: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): WorkProposal[] {
  const path = `${BASE_PATH}${PROPOSAL_PATH}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(https?://[^\\s/<>()]+)?${path}\\?[^\\s<>()\\]]+`, 'g')
  const seen = new Set<string>()
  const out: WorkProposal[] = []
  for (const m of text.matchAll(pattern)) {
    if (m[1] !== undefined && m[1] !== origin) continue
    const query = m[0].slice(m[0].indexOf('?') + 1).replace(/[.,;:!?»"']+$/, '')
    if (seen.has(query)) continue
    seen.add(query)
    const p = parseProposal(Object.fromEntries(new URLSearchParams(query)))
    if (p !== null) out.push(p)
  }
  return out
}

/** Можно заводить без формы: есть что сделать, результат и срок (как у «Завести работу»). */
export const proposalReady = (p: WorkProposal): boolean => p.result !== undefined && p.due !== undefined

/**
 * Ключ идемпотентности предложения — из сообщения и номера ссылки в нём: «Завести работу»
 * после перезагрузки вкладки не заведёт работу второй раз, ядро вернёт ту же.
 */
export async function proposalKey(messageId: string, index: number): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`work-proposal:${messageId}:${index}`)))
  const h = [...bytes.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
