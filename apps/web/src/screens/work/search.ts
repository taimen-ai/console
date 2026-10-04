import type { Task } from '../../api/types.ts'
import { startOfToday } from '../../lib/format.ts'

/**
 * Фильтры экрана «Работа» — параметры адреса `/work?…`. Одни и те же фильтры уходят в ядро
 * (`GET /tasks`) и применяются к работе, которую экран берёт не из `/tasks` (решения
 * attention, сделанное за день из журнала), — чтобы группа не показывала лишнего.
 */

export const DUE_OPTIONS = ['overdue', 'today', 'week'] as const
export type DueFilter = typeof DUE_OPTIONS[number]
export type SortKey = 'createdAt' | 'dueDate' | 'startDate'

export interface WorkSearch {
  q?: string
  /** «Только моё»: исполнитель — я или отвечаю я. */
  mine?: boolean
  type?: string
  /** Исполнитель (principal id). */
  exec?: string
  /** Отвечает (principal id). */
  owner?: string
  due?: DueFilter
  sort?: SortKey
}

const text = (v: unknown, max = 200): string | undefined => typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v: unknown): string | undefined => typeof v === 'string' && UUID.test(v) ? v : undefined

/** Разбор адреса: неизвестное и неверное отбрасывается, а не уходит в ядро. */
export function parseWorkSearch(raw: Record<string, unknown>): WorkSearch {
  const out: WorkSearch = {}
  const q = text(raw.q)
  if (q !== undefined) out.q = q
  if (raw.mine === true || raw.mine === 'true' || raw.mine === '1') out.mine = true
  const type = text(raw.type, 64)
  if (type !== undefined) out.type = type
  const exec = id(raw.exec)
  if (exec !== undefined) out.exec = exec
  const owner = id(raw.owner)
  if (owner !== undefined) out.owner = owner
  if ((DUE_OPTIONS as readonly unknown[]).includes(raw.due)) out.due = raw.due as DueFilter
  if (raw.sort === 'dueDate' || raw.sort === 'startDate') out.sort = raw.sort
  return out
}

/** Окно срока: [from, to) по часам браузера. */
export function dueWindow(due: DueFilter, now = new Date()): { from?: Date, to: Date } {
  const today = startOfToday(now)
  switch (due) {
    case 'overdue': return { to: now }
    case 'today': return { from: today, to: new Date(today.getTime() + 86_400_000) }
    case 'week': return { from: today, to: new Date(today.getTime() + 7 * 86_400_000) }
  }
}

/** Параметры `GET /tasks` (без категории, страницы и курсора) для одного исполнителя и отвечающего. */
function baseParams(search: WorkSearch, who: { assignee?: string | undefined, owner?: string | undefined }, now: Date): URLSearchParams {
  const params = new URLSearchParams()
  if (search.q !== undefined) params.set('q', search.q)
  if (search.type !== undefined) params.set('typeKey', search.type)
  if (who.assignee !== undefined) params.set('assigneeId', who.assignee)
  if (who.owner !== undefined) params.set('ownerId', who.owner)
  if (search.due !== undefined) {
    const w = dueWindow(search.due, now)
    if (w.from !== undefined) params.set('dueFrom', w.from.toISOString())
    params.set('dueTo', w.to.toISOString())
  }
  if (search.sort !== undefined) params.set('sort', search.sort)
  return params
}

/**
 * Запросы `GET /tasks` под фильтры. «Только моё» — «исполнитель я ИЛИ отвечаю я»: ядро не умеет
 * ИЛИ по `assigneeId`/`ownerId`, поэтому два потока, которые консоль сливает (`mergeTasks`).
 * Фильтр «Выполняет» в этом режиме не действует; «Отвечает» сужает оба потока.
 */
export function taskStreams(search: WorkSearch, me: string | undefined, now = new Date()): URLSearchParams[] {
  if (search.mine !== true || me === undefined) return [baseParams(search, { assignee: search.exec, owner: search.owner }, now)]
  const streams = [baseParams(search, { assignee: me, owner: search.owner }, now)]
  if (search.owner === undefined || search.owner === me) streams.push(baseParams(search, { owner: me }, now))
  return streams
}

/** Параметры одного запроса — для вида без «Только моё» (первый поток). */
export function taskParams(search: WorkSearch, me: string | undefined, now = new Date()): URLSearchParams {
  return taskStreams(search, me, now)[0]!
}

/** Порядок ядра: по созданию — новые сверху; по дате — раньше сверху, без даты в конце. */
export function compareTasks(sort: SortKey | undefined): (a: Task, b: Task) => number {
  if (sort === 'dueDate' || sort === 'startDate') {
    return (a, b) => {
      const x = a[sort] ?? null
      const y = b[sort] ?? null
      if (x !== y) {
        if (x === null) return 1
        if (y === null) return -1
        return x < y ? -1 : 1
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }
  }
  return (a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
}

/** Слить потоки: без повторов, в порядке ядра. */
export function mergeTasks(lists: Task[][], sort: SortKey | undefined): Task[] {
  const seen = new Set<string>()
  return lists.flat().filter(task => (seen.has(task.id) ? false : (seen.add(task.id), true))).sort(compareTasks(sort))
}

/** Те же фильтры на стороне консоли; поиск — как у ядра: каждое слово — подстрока. */
export function matches(task: Task, search: WorkSearch, me: string | undefined, now = new Date()): boolean {
  if (search.q !== undefined) {
    const hay = `${task.title}\n${task.description}\n${task.publicId}`.toLowerCase()
    if (!search.q.toLowerCase().split(/\s+/).filter(Boolean).every(term => hay.includes(term))) return false
  }
  if (search.type !== undefined && task.typeKey !== search.type) return false
  if (search.mine === true && me !== undefined) {
    if (task.assigneeId !== me && task.ownerId !== me) return false
  } else if (search.exec !== undefined && task.assigneeId !== search.exec) return false
  if (search.owner !== undefined && task.ownerId !== search.owner) return false
  if (search.due !== undefined) {
    if (task.dueDate === null || task.dueDate === undefined) return false
    const d = new Date(task.dueDate)
    const w = dueWindow(search.due, now)
    if ((w.from !== undefined && d < w.from) || d >= w.to) return false
  }
  return true
}
