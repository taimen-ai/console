import { Button, DegradedBanner, EmptyState, FilterChip, Icon, PageHeader, SearchField, WorkGroup, WorkRow, type ComboOption } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useInfiniteQuery, useQueries, useQuery, type InfiniteData } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { cpGet } from '../../api/client.ts'
import { useScope, useScopedAttention } from '../../api/scope.tsx'
import { executorMeta, useExecutors, useTaskTypes, type Executor } from '../../api/executors.ts'
import { useMe, usePrincipals, useTasks } from '../../api/directory.ts'
import type { Approval, Attention, AttentionItem, Page, Task } from '../../api/types.ts'
import { startOfToday } from '../../lib/format.ts'
import { useDay } from '../today/day.ts'
import { AssignDialog } from './AssignDialog.tsx'
import type { WorkProposal } from './proposal.ts'
import { ChipCombo } from './ChipCombo.tsx'
import { ChipSelect } from './ChipSelect.tsx'
import { initials, notStarted, rowOf, type RowContext } from './rows.ts'
import { DUE_OPTIONS, matches, mergeTasks, taskStreams, type DueFilter, type SortKey, type WorkSearch } from './search.ts'
import './work.css'

/**
 * Экран «Работа» (docs/screens/work.md): вся работа организации — людей, агентов и
 * процессов — по тому, что ей нужно сейчас. Список, а не канбан.
 *
 * Группы и откуда они берутся (только реализованный API ядра):
 * - «Ждёт вас» — решения из `GET /me/attention`;
 * - «Застряла» — `GET /tasks?systemStatusCategory=paused`, работа в работе с проваленной
 *   проверкой и сигналы attention о работе (исполнитель падает, срок близко, а не начата);
 * - «В работе», «Не начата» — `GET /tasks` по категории, страницами (счётчиков у ядра нет);
 * - «Сделано и проверено сегодня» — события `task.verified` дня (фильтра по дате завершения
 *   у `/tasks` нет).
 *
 * Фильтры — в адресе экрана: ссылка воспроизводит вид, ассистент получает его с контекстом.
 * Живое обновление — журнал помечает устаревшими запросы `tasks` и `attention`.
 */

const PAGE = 20

/**
 * Страница группы: слитые потоки (`taskStreams`) и курсор каждого — `null` в начале,
 * `false`, когда поток дочитан. Без «Только моё» поток один.
 */
type Cursors = (string | null | false)[]
interface MergedPage { items: Task[], cursors: Cursors }
type TaskPages = InfiniteData<MergedPage, Cursors | null>

function useCategory(category: string, search: WorkSearch, me: string | undefined, enabled: boolean) {
  const scope = useScope()
  return useInfiniteQuery<MergedPage, Error, TaskPages, readonly unknown[], Cursors | null>({
    queryKey: ['tasks', 'work', category, search, me, scope.ws],
    initialPageParam: null,
    getNextPageParam: last => (last.cursors.some(c => c !== false) ? last.cursors : undefined),
    enabled: enabled && scope.ready,
    queryFn: async ({ pageParam, signal }) => {
      const streams = taskStreams(search, me)
      const cursors: Cursors = pageParam ?? streams.map(() => null)
      const pages = await Promise.all(streams.map((params, i) => {
        const cursor = cursors[i] ?? null
        if (cursor === false) return null
        for (const [k, v] of scope.params()) params.set(k, v)
        params.set('systemStatusCategory', category)
        params.set('limit', String(PAGE))
        if (cursor !== null) params.set('cursor', cursor)
        return cpGet<Page<Task>>(`/tasks?${params}`, signal)
      }))
      return {
        items: mergeTasks(pages.map(p => p?.items ?? []), search.sort),
        cursors: pages.map(p => (p === null || p.nextCursor === null ? false : p.nextCursor)),
      }
    },
  })
}

/** Все прочитанные строки группы; один и тот же номер из двух потоков — один раз. */
const flat = (data: TaskPages | undefined): Task[] => {
  const seen = new Set<string>()
  return (data?.pages ?? []).flatMap(p => p.items).filter(task => (seen.has(task.id) ? false : (seen.add(task.id), true)))
}

/** Сигналы attention о работе, которые делают её «застрявшей». */
const STUCK_KINDS = new Set(['task.blocked', 'task.delegated_failing', 'task.due_not_started', 'approval.undecidable'])

interface Group {
  key: string
  title: string
  rows: Task[]
  /** Число в заголовке; «12+» — дочитаны не все страницы. */
  count: ReactNode
  human?: boolean
  hint?: string
  more?: () => void
  /** Действие на строке: «Решить» / «Принять». */
  action?: (task: Task) => string | undefined
  loading: boolean
  failed: boolean
}

/** `proposal` — экран открыт ссылкой `/work/new?…`: «Поручить работу» сразу с полями из неё. */
export function Work({ search, proposal }: { search: WorkSearch, proposal?: WorkProposal }) {
  useLingui()
  const navigate = useNavigate({ from: '/work' })
  const set = (patch: Partial<WorkSearch>): void => {
    void navigate({ search: prev => clean({ ...prev, ...patch }), replace: true })
  }

  const me = useMe().data?.principal.id
  const people = usePrincipals()
  const attention = useScopedAttention<Attention>()
  // Ждущие согласования — одним запросом на экран: печать «кто подписывает» у каждой строки.
  const pending = useQuery({ queryKey: ['approvals', 'pending'], queryFn: ({ signal }) => cpGet<Page<Approval>>('/approvals?status=pending&limit=200', signal) })
  const day = useDay()

  // Поиск — в адрес с задержкой: не перечитывать список на каждую букву.
  const [text, setText] = useState(search.q ?? '')
  useEffect(() => {
    const value = text.trim()
    if (value === (search.q ?? '')) return
    const timer = setTimeout(() => set({ q: value === '' ? undefined : value }), 300)
    return () => clearTimeout(timer)
  })

  const [closed, setClosed] = useState<Record<string, boolean>>({ done: true })
  const ready = search.mine !== true || me !== undefined
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [assigning, setAssigning] = useState(proposal !== undefined)
  const activeFilters = [search.mine, search.type, search.exec, search.owner, search.due, search.sort].filter(v => v !== undefined).length

  const filtering = search.q !== undefined || search.mine === true || search.type !== undefined || search.exec !== undefined || search.owner !== undefined || search.due !== undefined
  const active = useCategory('active', search, me, ready)
  // Категории задач ядра: backlog, active, blocked, terminal_* (не путать с категориями проектов).
  const backlog = useCategory('backlog', search, me, ready)
  const blocked = useCategory('blocked', search, me, ready)

  const items = attention.data?.items ?? []
  const decisions = items.filter(i => i.entity.type === 'approval' && i.kind !== 'approval.undecidable')
  const signals = items.filter(i => STUCK_KINDS.has(i.kind) && i.taskId !== null)
  const scope = useScope()
  const verifiedToday = [...new Set((day.data?.events ?? []).filter(e => e.type === 'task.verified' && scope.contains(e.workspaceId)).map(e => e.entityId))]
  // Сделанное за день читается поштучно (`/tasks` не фильтрует по дате завершения) — только
  // когда группа раскрыта или нужен отбор по фильтрам; свёрнутой хватает числа из журнала.
  const doneOpen = closed.done !== true || filtering
  const known = useTasks([...decisions, ...signals].map(i => i.taskId).filter((x): x is string => x !== null).concat(doneOpen ? verifiedToday : []))
  const pickTask = (item: AttentionItem): Task | undefined => item.taskId !== null ? known.get(item.taskId) : undefined
  const ok = (task: Task | undefined): task is Task => task !== undefined && matches(task, search, me)

  // «Застряла»: приостановленные, проваленная проверка и сигналы — без повторов.
  const activeRows = flat(active.data)
  const failing = activeRows.filter(task => task.verification?.status === 'failed')
  const stuck = new Map<string, Task>()
  for (const task of [...flat(blocked.data), ...failing, ...signals.map(pickTask).filter(ok)]) stuck.set(task.id, task)
  const waiting = decisions.map(pickTask).filter(ok)
  const mineIds = new Set(waiting.map(task => task.id))
  const done = verifiedToday.map(id => known.get(id)).filter(ok).filter(task => task.completedAt === null || new Date(task.completedAt) >= startOfToday())

  // Решённые согласования — только у сделанного (подписал кто и когда).
  const decided = useQueries({
    queries: (doneOpen ? done : []).map(task => ({
      queryKey: ['approvals', 'task', task.id],
      staleTime: 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<Page<Approval>>(`/approvals?taskId=${task.id}&limit=20`, signal),
    })),
  })
  const approvalsOf = new Map<string, Approval[]>()
  for (const a of pending.data?.items ?? []) if (a.taskId !== null) approvalsOf.set(a.taskId, [...(approvalsOf.get(a.taskId) ?? []), a])
  for (const q of decided) for (const a of q.data?.items ?? []) if (a.taskId !== null && a.status !== 'pending') approvalsOf.set(a.taskId, [...(approvalsOf.get(a.taskId) ?? []), a])

  // Работа показывается в одной группе: «Ждёт вас» важнее «Застряла», та — важнее категории.
  const stuckRows = [...stuck.values()].filter(task => !mineIds.has(task.id))
  // Активная работа, которую ни разу не брали, — «Не начата», а не «В работе».
  const free = (task: Task): boolean => !stuck.has(task.id) && !mineIds.has(task.id)
  const activeShown = activeRows.filter(task => free(task) && !notStarted(task))
  const plannedShown = [...flat(backlog.data), ...activeRows.filter(notStarted)].filter(free)
  const counted = (rows: Task[], more: boolean): string => more ? `${rows.length}+` : String(rows.length)
  const kindOf = (task: Task): string | undefined => decisions.find(i => i.taskId === task.id)?.kind
  const groups: Group[] = [
    {
      key: 'mine', title: t`Waiting for you`, rows: waiting, count: waiting.length, human: true,
      action: task => kindOf(task) === 'approval.review' ? t`Accept` : t`Decide`,
      loading: attention.isPending, failed: attention.isError,
    },
    {
      key: 'stuck', title: t`Stuck`, rows: stuckRows, count: counted(stuckRows, blocked.hasNextPage), hint: t`blocked, failed verification or nobody is moving it`,
      ...(blocked.hasNextPage ? { more: () => void blocked.fetchNextPage() } : {}),
      loading: blocked.isPending, failed: blocked.isError,
    },
    {
      key: 'active', title: t({ id: 'work.group.active', message: 'In progress' }), rows: activeShown,
      count: counted(activeShown, active.hasNextPage),
      ...(active.hasNextPage ? { more: () => void active.fetchNextPage() } : {}),
      loading: active.isPending, failed: active.isError,
    },
    {
      key: 'planned', title: t({ id: 'work.group.planned', message: 'Not started' }), rows: plannedShown,
      count: counted(plannedShown, backlog.hasNextPage || active.hasNextPage),
      ...(backlog.hasNextPage ? { more: () => void backlog.fetchNextPage() } : {}),
      loading: backlog.isPending || active.isPending, failed: backlog.isError,
    },
    {
      key: 'done', title: t`Done and verified today`, rows: done, count: doneOpen ? done.length : verifiedToday.length,
      loading: day.isPending, failed: day.isError,
    },
  ]

  const shown = groups.filter(g => g.rows.length > 0 || g.loading || g.failed || (!filtering && g.key !== 'mine'))
  const ctx = (task: Task): RowContext => ({ people: people.data, me, approvals: approvalsOf.get(task.id) ?? [] })

  // Фильтры — поиском и в области из шапки: типы, разрешённые в пространстве; люди и агенты, которые там берут работу.
  const { types: scopedTypes } = useTaskTypes(scope.ws)
  const { executors } = useExecutors(undefined, scope.ws, { within: true })
  const personOptions = (list: Executor[]): ComboOption[] => {
    const sorted = [...list].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.displayName.localeCompare(b.displayName)))
    // Выбранный в адресе, но не из области — остаётся вариантом, чтобы чип показал имя.
    const chosen = [search.exec, search.owner].filter((id): id is string => id !== undefined && !list.some(e => e.id === id))
    const extra = chosen.flatMap(id => { const p = people.data?.get(id); return p !== undefined ? [{ id, kind: p.kind, displayName: p.displayName }] : [] })
    return [...sorted, ...extra].map(e => ({ value: e.id, label: e.id === me ? t`me` : e.displayName, search: e.displayName, kind: e.kind === 'human' ? 'human' as const : e.kind === 'agent' ? 'agent' as const : 'process' as const, glyph: initials(e.displayName), meta: executorMeta(e) }))
  }
  const dueLabels: Record<DueFilter, string> = { overdue: t`overdue`, today: t`today`, week: t`this week` }
  const sortLabels: Record<SortKey, string> = { createdAt: t`newest first`, dueDate: t`by due date`, startDate: t`by start date` }

  return (
    <div className="work">
      <PageHeader title={t`Work`} lead={t`All the organization's work — people, agents and processes — by what it needs now.`}
        actions={<Button variant="secondary" onClick={() => setAssigning(true)}>{t`Assign work`}</Button>} />
      {assigning
        ? <AssignDialog {...(proposal !== undefined ? { initial: proposal } : {})} onClose={() => { setAssigning(false); if (proposal !== undefined) void navigate({ to: '/work', search: {}, replace: true }) }} />
        : null}
      <div className="work-bar" role="search">
        <SearchField placeholder={t`Find by title or number`} label={t`Find work`} value={text} onChange={e => setText(e.target.value)} style={{ flex: '0 1 320px', minWidth: 240 }} />
        {/* На узкой ширине фильтры прячутся под кнопкой; число — сколько их включено. */}
        <button type="button" className="tc-chipbtn work-filters-toggle" aria-expanded={filtersOpen} aria-controls="work-filters" onClick={() => setFiltersOpen(o => !o)}>
          {t`Filters`}{activeFilters > 0 ? <span className="tc-chipbtn-count">{activeFilters}</span> : null}<Icon name="chevronDown" />
        </button>
        <div id="work-filters" className="work-filters" data-open={filtersOpen}>
          <FilterChip label={t`Only mine`} pressed={search.mine === true} onClick={() => set({ mine: search.mine === true ? undefined : true })} />
          <ChipCombo label={t`Type of work`} value={search.type ?? ''} allLabel={t`all`} onChange={v => set({ type: v || undefined })}
            options={scopedTypes.map(ty => ({ value: ty.key, label: ty.displayName || ty.key, search: ty.key }))} />
          <ChipCombo label={t`Executes`} value={search.exec ?? ''} allLabel={t`anyone`} onChange={v => set({ exec: v || undefined })} options={personOptions(executors)} />
          <ChipCombo label={t`Owner`} value={search.owner ?? ''} allLabel={t`anyone`} onChange={v => set({ owner: v || undefined })} options={personOptions(executors.filter(e => e.kind === 'human'))} />
          <ChipSelect label={t`Due`} value={search.due ?? ''} onChange={v => set({ due: (v || undefined) as DueFilter | undefined })}
            options={[{ value: '', label: t`any` }, ...DUE_OPTIONS.map(d => ({ value: d, label: dueLabels[d] }))]} />
          <span className="work-spacer" />
          <ChipSelect label={t`Order`} value={search.sort ?? 'createdAt'} onChange={v => set({ sort: v === 'createdAt' ? undefined : v as SortKey })}
            options={(['createdAt', 'dueDate', 'startDate'] as const).map(s => ({ value: s, label: sortLabels[s] }))} />
        </div>
      </div>
      {shown.length > 0
        ? (
          <div className="work-groups">
            {shown.map((g) => {
              const open = closed[g.key] !== true || filtering
              return (
                <WorkGroup key={g.key} title={g.title} count={g.loading ? '…' : g.count} {...(g.hint !== undefined ? { hint: g.hint } : {})} human={g.human === true}
                  open={open} onToggle={() => setClosed(c => ({ ...c, [g.key]: open }))}
                  {...(g.more !== undefined ? { more: true, onMore: g.more } : {})}
                  {...(g.failed ? { empty: <DegradedBanner.Section text={t`Could not load this group: no connection to the core.`} /> } : !g.loading && g.rows.length === 0 ? { empty: <p>{emptyText(g.key)}</p> } : {})}>
                  {g.rows.map((task) => {
                    // Работа без исполнителя — «Назначить»: страница работы откроет «Передать» с подбором по роли.
                    const assign = g.action === undefined && task.assigneeId === null && !task.systemStatusCategory.startsWith('terminal')
                    const action = g.action?.(task) ?? (assign ? t`Assign` : undefined)
                    return <WorkRow key={task.id} {...rowOf(task, ctx(task))} mine={g.human === true}
                      {...(action !== undefined ? { action, onAction: () => void navigate({ to: '/work/$ref', params: { ref: task.publicId }, search: assign ? { act: 'handoff' as const } : {} }) } : {})} />
                  })}
                </WorkGroup>
              )
            })}
          </div>
        )
        : <EmptyState title={t`Nothing found`} body={t`Try another word, a work number or fewer filters.`} />}
    </div>
  )
}

function emptyText(key: string): string {
  switch (key) {
    case 'stuck': return t`Nothing is stuck.`
    case 'active': return t`Nothing is in progress.`
    case 'planned': return t`Everything raised has been started.`
    case 'done': return t`Nothing has been verified today yet.`
    default: return t`Nothing here.`
  }
}

/** Пустые поля не пишутся в адрес. */
function clean(search: WorkSearch): WorkSearch {
  const out: WorkSearch = {}
  for (const [k, v] of Object.entries(search) as [keyof WorkSearch, WorkSearch[keyof WorkSearch]][]) if (v !== undefined && v !== '' && v !== false) (out as Record<string, unknown>)[k] = v
  return out
}

