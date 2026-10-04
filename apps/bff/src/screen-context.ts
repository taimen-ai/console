/**
 * Контекст экрана для ассистента (контракт `surface/1`, схема
 * `docs/contracts/harness-surface/screen-context.schema.json` суперпроекта).
 *
 * SPA присылает только адрес экрана (`screenUrl`), а `screenContext` собирает BFF — из
 * данных ядра от имени вошедшего человека (его Bearer, allow-list снимка openapi).
 * Браузеру не верим: присланный им `screenContext` отбрасывается. Контекст передаётся
 * данными, а не снимком экрана (решение владельца 2026-10-01, docs/screens/assistant.md).
 *
 * Проекция — то, что экран уже показывает, в сжатом виде: у работы — заголовок, тип,
 * статус, исполнитель, срок и итог проверки; у обзорных экранов — только вид и адрес.
 * Только идентификаторы, статусы, короткие подписи и время. Query адреса — только из
 * белого списка (`SCREEN_QUERY`), свободный текст поиска не уходит. Сериализованный
 * контекст не больше 8 КБ; сборка укладывается в `CONTEXT_BUDGET_MS`, иначе контекст
 * уходит без проекции.
 */
import { UpstreamError, type CpGet } from './upstream.ts'

export const SCREEN_CONTEXT_MAX_BYTES = 8 * 1024
export const CONTEXT_BUDGET_MS = 3_000
export const SCREEN_QUERY: readonly string[] = ['tab', 'view', 'status', 'kind', 'group', 'key', 'ws', 'family', 'from', 'to']
const QUERY_VALUE = /^[A-Za-z0-9_.:-]{1,100}$/
/**
 * Свои формы значений: ключ записи базы знаний — идентификатор, но с буквами любого языка и
 * `/` (`credential:license:77-Б/00123`); организация — UUID. Свободный текст (`q`) не уходит.
 */
const QUERY_FORMS: Record<string, RegExp> = {
  key: /^[\p{L}\p{N}_.:/-]{1,200}$/u,
  ws: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}
const STR_MAX = 200
const URL_MAX = 500

export type ScreenKind = 'pulse' | 'work' | 'knowledge' | 'artifact' | 'journal' | 'other'

export interface ScreenContext {
  kind: ScreenKind
  id?: string
  label?: string
  url: string
  workspaceId?: string
  projection?: Record<string, unknown>
  capturedAt?: string
}

/** Экраны консоли — те же адреса, что маршруты SPA (`apps/web/src/routes.tsx`). */
const SCREENS: [pattern: RegExp, kind: ScreenKind, label: string][] = [
  [/^$/, 'pulse', 'Сегодня'],
  [/^work$/, 'work', 'Работа'],
  // Форма «Поручить работу» по ссылке-предложению: это не номер работы, ядро не спрашиваем.
  [/^work\/new$/, 'other', 'Поручить работу'],
  [/^work\/([A-Za-z0-9_.-]{1,100})$/, 'work', 'Работа'],
  [/^knowledge$/, 'knowledge', 'База знаний'],
  [/^journal$/, 'journal', 'Журнал'],
  // Документ базы знаний: вид и ключ записи — из белого списка query (`kind`, `key`).
  [/^knowledge\/entry$/, 'knowledge', 'Документ базы знаний'],
  [/^documents\/([0-9A-Fa-f-]{36})$/, 'artifact', 'Документ'],
]

export class ScreenUrlError extends Error {}

export interface ParsedScreen { kind: ScreenKind, id?: string, label: string, url: string, view?: string }

/**
 * Разбор адреса экрана: свой origin, путь консоли под `basePath`, query — из белого
 * списка. Чужое — `ScreenUrlError` (BFF отвечает 400, наверх ничего не уходит).
 */
export function parseScreen(screenUrl: string, origin: string, basePath: string): ParsedScreen {
  let url: URL
  try { url = new URL(screenUrl, origin) } catch { throw new ScreenUrlError('invalid') }
  const root = `${basePath}/`
  if (url.origin !== origin || !url.pathname.startsWith(root)) throw new ScreenUrlError('foreign')
  const rest = url.pathname.slice(root.length).replace(/\/+$/, '')
  if (rest.split('/').some(s => /^\.{1,2}$/.test(s))) throw new ScreenUrlError('dot_segment')
  const kept = new URLSearchParams()
  for (const name of SCREEN_QUERY) {
    const value = url.searchParams.get(name)
    if (value !== null && (QUERY_FORMS[name] ?? QUERY_VALUE).test(value)) kept.set(name, value)
  }
  const query = kept.toString()
  const path = `${url.pathname}${query !== '' ? `?${query}` : ''}`.slice(0, URL_MAX)
  // Экран пакета (TAI-ADR-0066): `/v/{key}` и `/v/{key}/{id}` — ключ вида и экземпляр.
  const pkg = /^v\/([A-Za-z0-9_.-]{1,64})(?:\/([A-Za-z0-9_.:-]{1,100}))?$/.exec(rest)
  if (pkg !== null) return { kind: 'other', label: 'Экран пакета', url: path, view: pkg[1]!, ...(pkg[2] !== undefined ? { id: pkg[2] } : {}) }
  for (const [pattern, kind, label] of SCREENS) {
    const m = pattern.exec(rest)
    if (m !== null) return { kind, label, url: path, ...(m[1] !== undefined ? { id: m[1] } : {}) }
  }
  return { kind: 'other', label: 'Консоль', url: path }
}

const short = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value.slice(0, STR_MAX) : undefined

/** Поля работы, которые экран «Задача» показывает в шапке, — и ничего сверх. */
function workProjection(task: Record<string, unknown>): Record<string, unknown> {
  const verification = task.verification as Record<string, unknown> | null | undefined
  const out: Record<string, unknown> = {
    publicId: short(task.publicId),
    title: short(task.title),
    type: short(task.typeKey),
    status: short(task.status),
    statusCategory: short(task.systemStatusCategory),
    assigneeId: short(task.assigneeId),
    ownerId: short(task.ownerId),
    dueDate: short(task.dueDate),
    completedAt: short(task.completedAt),
    verification: verification !== null && typeof verification === 'object' ? short(verification.state ?? verification.status) : undefined,
  }
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key]
  return out
}

/** Ключи с секретами и строки-JWT не проходят ни в каком месте контекста. */
const SECRET_KEY = /token|secret|password|credential|authorization/i
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/

export function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return JWT.test(value) ? '[скрыто]' : value
  if (Array.isArray(value)) return value.map(sanitize)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) if (!SECRET_KEY.test(key)) out[key] = sanitize(v)
    return out
  }
  return value
}

/** Укладывает контекст в 8 КБ: в крайнем случае проекция снимается. */
export function fit(context: ScreenContext): ScreenContext {
  const size = (c: ScreenContext): number => Buffer.byteLength(JSON.stringify(c), 'utf8')
  if (size(context) <= SCREEN_CONTEXT_MAX_BYTES) return context
  const { projection: _dropped, ...rest } = context
  return { ...rest, projection: { error: 'too_large' } }
}

export async function buildScreenContext(
  get: CpGet, screenUrl: string,
  options: { origin: string, basePath: string, now: number, signal: AbortSignal },
): Promise<ScreenContext> {
  const screen = parseScreen(screenUrl, options.origin, options.basePath)
  const context: ScreenContext = { kind: screen.kind, label: screen.label, url: screen.url, capturedAt: new Date(options.now).toISOString() }
  if (screen.id !== undefined) context.id = screen.id
  if (screen.kind === 'work' && screen.id !== undefined) {
    const budget = AbortSignal.any([options.signal, AbortSignal.timeout(CONTEXT_BUDGET_MS)])
    try {
      const task = await get(`/tasks/${encodeURIComponent(screen.id)}`, budget) as Record<string, unknown>
      const projection = workProjection(task)
      if (typeof projection.title === 'string') context.label = projection.title
      if (typeof task.workspaceId === 'string') context.workspaceId = task.workspaceId
      context.projection = projection
    } catch (error) {
      if (options.signal.aborted) throw error
      context.projection = { error: error instanceof UpstreamError ? error.code : budget.aborted ? 'timeout' : 'unavailable' }
    }
  }
  if (screen.view !== undefined) {
    const budget = AbortSignal.any([options.signal, AbortSignal.timeout(CONTEXT_BUDGET_MS)])
    try {
      // Описание вида — название и пакет; данные блоков ассистент берёт своими инструментами.
      const view = await get(`/views/${encodeURIComponent(screen.view)}`, budget) as Record<string, unknown>
      const pack = view.package as { key?: unknown, version?: unknown } | undefined
      const projection: Record<string, unknown> = { view: screen.view }
      if (typeof view.title === 'string') { projection.title = view.title.slice(0, STR_MAX); context.label = projection.title as string }
      if (typeof pack?.key === 'string') projection.package = pack.key
      const source = view.source as { process?: unknown } | undefined
      if (typeof source?.process === 'string') projection.process = source.process
      context.projection = projection
    } catch (error) {
      if (options.signal.aborted) throw error
      context.projection = { view: screen.view, error: error instanceof UpstreamError ? error.code : budget.aborted ? 'timeout' : 'unavailable' }
    }
  }
  if (screen.kind === 'artifact' && screen.id !== undefined) {
    const budget = AbortSignal.any([options.signal, AbortSignal.timeout(CONTEXT_BUDGET_MS)])
    try {
      const artifact = await get(`/artifacts/${encodeURIComponent(screen.id)}`, budget) as Record<string, unknown>
      // Только описание документа: содержимое (`content`, байты хранилища) в контекст не уходит.
      const projection: Record<string, unknown> = {}
      for (const key of ['name', 'type', 'mediaType', 'taskId', 'runId', 'contentState', 'createdAt'] as const) {
        const value = artifact[key]
        if (typeof value === 'string') projection[key] = value.slice(0, STR_MAX)
      }
      if (typeof projection.name === 'string') context.label = projection.name
      if (typeof artifact.workspaceId === 'string') context.workspaceId = artifact.workspaceId
      context.projection = projection
    } catch (error) {
      if (options.signal.aborted) throw error
      context.projection = { error: error instanceof UpstreamError ? error.code : budget.aborted ? 'timeout' : 'unavailable' }
    }
  }
  return fit(sanitize(context) as ScreenContext)
}
