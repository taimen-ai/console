import { Button, DegradedBanner, EmptyState, FilterChip, PageHeader, type ComboOption } from '@console/ui'
import { i18n } from '@lingui/core'
import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Fragment, useEffect, useState } from 'react'
import { ApiError, BASE_PATH, cpGet } from '../../api/client.ts'
import { executorKind, usePrincipals } from '../../api/directory.ts'
import { useJournal } from '../../api/live.tsx'
import { useScope } from '../../api/scope.tsx'
import type { EventPage, JournalEvent } from '../../api/types.ts'
import { ChipCombo } from '../work/ChipCombo.tsx'
import { initials } from '../work/rows.ts'
import { AUDIT_TYPES, FAMILIES, eventParams, matches, periodOf, toCsv, toJsonl, type Family, type JournalSearch } from './journal.ts'
import './journal.css'

/**
 * Экран «Журнал» (docs/screens/journal.md) — для аудиторов: все записи журнала ядра от новых к
 * старым, кто, что, когда и над чем; запись раскрывается целиком (полезная нагрузка, id,
 * курсор); выгрузка показанного — CSV и JSON Lines. Новые записи приходят живым потоком, но
 * не сдвигают ленту, пока человек читает: «Показать N новых». Логика фильтров — `journal.ts`.
 */

const PAGE = 200
/** Больше страниц назад не дочитываем сами: экран говорит, докуда прочитано. */
const MAX_SCAN_PAGES = 50
/** Сколько строк показать, прежде чем перестать дочитывать ради фильтров консоли. */
const ENOUGH = 50

type Pages = InfiniteData<EventPage, string | null>

/** Что случилось — словами; незнакомый тип показывается как есть. */
export function typeLabel(type: string): string {
  switch (type) {
    case 'task.created': return t`work raised`
    case 'task.updated': return t`work changed`
    case 'task.claimed': return t`work taken`
    case 'task.released': return t`work released`
    case 'task.completed': return t`work submitted`
    case 'task.verified': return t`work verified`
    case 'task.verification_failed': return t`work failed verification`
    case 'task.migrated': return t`work moved to a new type`
    case 'task.commented': return t`comment`
    case 'work.reconciled': return t`work withdrawn`
    case 'work.derived': return t`work derived by a rule`
    case 'run.started': return t`attempt started`
    case 'run.failed': return t`attempt failed`
    case 'run.succeeded': return t`attempt succeeded`
    case 'claim.expired': return t`claim expired`
    case 'claim.released': return t`claim released`
    case 'artifact.created': return t`material added`
    case 'artifact.content_read': return t`material content read`
    case 'artifact.content_purged': return t`material content deleted`
    case 'approval.requested': return t`sign-off requested`
    case 'approval.approved': return t`approved`
    case 'approval.rejected': return t`declined`
    case 'approval.cancelled': return t`sign-off request cancelled`
    case 'principal.created': return t`participant added`
    case 'principal.disabled': return t`participant disabled`
    case 'principal.enabled': return t`participant enabled`
    case 'iam_binding.created': return t`rights given`
    case 'iam_binding.updated': return t`rights changed`
    case 'iam_binding.revoked': return t`rights revoked`
    case 'role.assigned': return t`role given`
    case 'role.revoked': return t`role revoked`
    case 'role.created': return t`role created`
    case 'role.updated': return t`role changed`
    case 'session.opened': return t`session opened`
    case 'session.closed': return t`session closed`
    case 'session.expired': return t`session expired`
    case 'api_key.created': return t`API key created`
    case 'api_key.revoked': return t`API key revoked`
    case 'api_key.break_glass_issued': return t`emergency key issued`
    case 'delegation.created': return t`authority delegated`
    case 'delegation.revoked': return t`delegation revoked`
    case 'rule.created': return t`rule created`
    case 'rule.updated': return t`rule changed`
    case 'rule.enabled': return t`rule enabled`
    case 'rule.disabled': return t`rule disabled`
    case 'rule.archived': return t`rule archived`
    case 'rule.evaluated': return t`rule evaluated`
    case 'agent.revision_published': return t`agent description published`
    case 'agent.retired': return t`agent retired`
    case 'agent.state_changed': return t`agent state changed`
    case 'knowledge.changed': return t`knowledge changed`
    case 'event_journal.archived': return t`journal archived`
    case 'event_journal.pruned': return t`journal pruned`
    case 'tenant.bootstrapped': return t`organization set up`
    default: return type
  }
}

/** Ссылка на объект записи: работа, документ, человек — где консоль их показывает. */
function objectHref(e: JournalEvent): string | null {
  const taskId = typeof e.payload.taskId === 'string' ? e.payload.taskId : null
  switch (e.entityType) {
    case 'task': return `${BASE_PATH}/work/${encodeURIComponent(typeof e.payload.publicId === 'string' ? e.payload.publicId : e.entityId)}`
    case 'approval': case 'run': case 'claim': return taskId !== null ? `${BASE_PATH}/work/${encodeURIComponent(taskId)}` : null
    case 'artifact': return `${BASE_PATH}/documents/${encodeURIComponent(e.entityId)}`
    case 'principal': return `${BASE_PATH}/settings/people/${encodeURIComponent(e.entityId)}`
    default: return null
  }
}

/** Подпись объекта: номер работы, имя участника, иначе вид и начало id. */
function objectLabel(e: JournalEvent, nameOf: (id: string | null) => string): string {
  const str = (k: string): string | undefined => typeof e.payload[k] === 'string' ? e.payload[k] as string : undefined
  if (e.entityType === 'task') return str('publicId') ?? str('title') ?? `task ${e.entityId.slice(0, 8)}`
  if (e.entityType === 'principal') return nameOf(e.entityId)
  const ref = str('taskPublicId') ?? str('publicId')
  return ref !== undefined ? `${e.entityType} · ${ref}` : `${e.entityType} ${e.entityId.slice(0, 8)}`
}

function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = (d = new Date()): string => d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')

export function Journal({ search }: { search: JournalSearch }) {
  useLingui()
  const navigate = useNavigate({ from: '/journal' })
  const set = (patch: Partial<JournalSearch>): void => {
    void navigate({ search: prev => Object.fromEntries(Object.entries({ ...prev, ...patch }).filter(([, v]) => v !== undefined && v !== '')) as JournalSearch, replace: true })
  }
  const scope = useScope()
  const people = usePrincipals().data
  const serverParams = eventParams(search).toString()
  const pages = useInfiniteQuery<EventPage, Error, Pages, readonly unknown[], string | null>({
    queryKey: ['journal', serverParams],
    initialPageParam: null,
    getNextPageParam: last => last.prevCursor ?? undefined,
    retry: false,
    queryFn: ({ pageParam, signal }) => {
      const params = eventParams(search)
      params.set('limit', String(PAGE))
      if (pageParam === null) params.set('tail', String(PAGE))
      else params.set('before', pageParam)
      return cpGet<EventPage>(`/events?${params}`, signal)
    },
  })
  // Страница — в порядке журнала (старые → новые); лента — от новых к старым.
  const loaded = (pages.data?.pages ?? []).flatMap(p => [...p.items].reverse())
  // Новые записи — при этих фильтрах ядра: сменились фильтры — прежние новые не в счёт.
  const [live, setLive] = useState<{ key: string, fresh: JournalEvent[], shown: JournalEvent[] }>({ key: serverParams, fresh: [], shown: [] })
  const current = live.key === serverParams ? live : { key: serverParams, fresh: [], shown: [] }
  const fresh = current.fresh
  const shownFresh = current.shown
  useJournal((e) => {
    const family = search.family
    if (family !== undefined && !FAMILIES[family].prefixes.some(p => e.type.startsWith(p))) return
    if (search.entityId !== undefined && e.entityId !== search.entityId) return
    setLive((prev) => {
      const base = prev.key === serverParams ? prev : { key: serverParams, fresh: [], shown: [] }
      return base.fresh.some(x => x.id === e.id) || loaded.some(x => x.id === e.id) ? base : { ...base, fresh: [e, ...base.fresh] }
    })
  })
  const all = [...shownFresh, ...loaded]
  const inScope = (ws: string | null): boolean => scope.ws === null || scope.contains(ws)
  const rows = all.filter(e => matches(e, search, inScope))
  const pending = fresh.filter(e => matches(e, search, inScope)).length
  const oldest = loaded.at(-1)
  const { from } = periodOf(search)
  const clientFiltering = search.who !== undefined || search.from !== undefined || search.to !== undefined || scope.ws !== null
  const scanned = pages.data?.pages.length ?? 0
  const reachedStart = pages.isSuccess && !pages.hasNextPage
  // Период и фильтры консоли: дочитать назад до начала периода или до ENOUGH строк, но не дальше MAX_SCAN_PAGES.
  const wantMore = pages.isSuccess && pages.hasNextPage && !pages.isFetchingNextPage && scanned < MAX_SCAN_PAGES
    && ((from !== null && oldest !== undefined && new Date(oldest.occurredAt) >= from) || (clientFiltering && rows.length < ENOUGH))
  useEffect(() => { if (wantMore) void pages.fetchNextPage() }, [wantMore, pages])

  const [open, setOpen] = useState<string | null>(null)
  const nameOf = (id: string | null): string => id === null ? t`System` : people?.get(id)?.displayName ?? id
  const wsName = new Map(scope.nodes.map(n => [n.id, n.path.join(' / ')]))
  const fmt = (iso: string): string => new Date(iso).toLocaleString(i18n.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const peopleOptions: ComboOption[] = [...(people?.values() ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(p => ({ value: p.id, label: p.displayName, search: p.displayName, kind: p.kind === 'human' ? 'human' as const : p.kind === 'agent' ? 'agent' as const : 'process' as const, glyph: initials(p.displayName) }))

  if (pages.isError && pages.error instanceof ApiError && pages.error.kind === 'forbidden') {
    return (
      <div className="jr">
        <PageHeader title={t`Journal`} />
        <DegradedBanner.Section text={t`You have no right to read the journal (events.read).`} />
      </div>
    )
  }
  const exportName = `journal-${stamp()}`
  return (
    <div className="jr">
      <PageHeader title={t`Journal`} lead={t`Who did what and when in the organization — every record of the journal. Records are only appended: nobody changes or deletes them here.`}
        actions={(
          <>
            <Button variant="secondary" disabled={rows.length === 0} onClick={() => download(`${exportName}.csv`, 'text/csv;charset=utf-8', `\uFEFF${toCsv(rows, nameOf)}`)}>{t`Download CSV`}</Button>
            <Button variant="ghost" disabled={rows.length === 0} onClick={() => download(`${exportName}.jsonl`, 'application/x-ndjson', toJsonl(rows))}>{t`JSON Lines`}</Button>
          </>
        )} />
      <div className="jr-bar" role="search" aria-label={t`Filters of the journal`}>
        <div className="jr-chips" role="group" aria-label={t`What`}>
          <FilterChip label={t`Everything`} pressed={search.family === undefined} onClick={() => set({ family: undefined })} />
          {(Object.keys(FAMILIES) as Family[]).map(f => <FilterChip key={f} label={i18n._(FAMILIES[f].title)} pressed={search.family === f} onClick={() => set({ family: search.family === f ? undefined : f })} />)}
        </div>
        <div className="jr-chips">
          <ChipCombo label={t`Who`} value={search.who ?? ''} allLabel={t`anyone`} options={peopleOptions} onChange={v => set({ who: v === '' ? undefined : v })} />
          <label className="jr-date">{t`From`} <input className="tc-input" type="date" value={search.from ?? ''} max={search.to} onChange={e => set({ from: e.target.value || undefined })} /></label>
          <label className="jr-date">{t`To`} <input className="tc-input" type="date" value={search.to ?? ''} min={search.from} onChange={e => set({ to: e.target.value || undefined })} /></label>
          {search.entityId !== undefined
            ? <FilterChip label={t`Object: ${search.entityType ?? ''} ${search.entityId.slice(0, 8)} ×`} pressed onClick={() => set({ entityId: undefined, entityType: undefined })} />
            : null}
        </div>
      </div>
      <p className="tc-muted jr-status" aria-live="polite">
        {pages.isPending ? t`Reading the journal…`
          : t`Shown: ${rows.length} of ${all.length} read.`}
        {' '}
        {oldest !== undefined ? (reachedStart ? t`Read to the start of the journal.` : t`Read back to ${fmt(oldest.occurredAt)}.`) : null}
        {pages.isFetchingNextPage ? ` ${t`Reading further…`}` : null}
        {clientFiltering && !reachedStart && scanned >= MAX_SCAN_PAGES ? ` ${t`Further back — with “Show earlier”.`}` : null}
      </p>
      {pending > 0
        ? <div className="jr-fresh"><Button variant="secondary" size="sm" onClick={() => setLive({ key: serverParams, fresh: [], shown: [...fresh, ...shownFresh] })}>{t`Show ${pending} new records`}</Button></div>
        : null}
      {pages.isError ? <DegradedBanner.Section text={t`Could not read the journal: no connection to the core.`} /> : null}
      {pages.isSuccess && rows.length === 0 && !pages.isFetchingNextPage ? <EmptyState title={t`No records`} body={t`Nothing matches the filters in what was read.`} /> : null}
      {rows.length > 0
        ? (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- прокручиваемая таблица должна получать фокус с клавиатуры (axe scrollable-region-focusable)
          <div className="jr-box" tabIndex={0} role="region" aria-label={t`Records of the journal`}>
            <table className="jr-table">
              <thead>
                <tr><th scope="col">{t`When`}</th><th scope="col">{t`Who`}</th><th scope="col">{t`What`}</th><th scope="col">{t`Object`}</th><th scope="col">{t`Workspace`}</th></tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const href = objectHref(e)
                  const actor = e.actorId !== null ? people?.get(e.actorId) : undefined
                  const expanded = open === e.id
                  return (
                    <Fragment key={e.id}>
                      <tr className={AUDIT_TYPES.has(e.type) ? 'jr-audit' : undefined}>
                        <td className="jr-when">
                          <button type="button" className="jr-toggle" aria-expanded={expanded} aria-controls={`jr-${e.id}`} onClick={() => setOpen(expanded ? null : e.id)}>
                            <span className="tc-mono">{fmt(e.occurredAt)}</span>
                          </button>
                        </td>
                        <td>{nameOf(e.actorId)}{actor !== undefined ? <span className="tc-muted jr-kind"> · {executorKind(actor) === 'human' ? t`person` : executorKind(actor) === 'agent' ? t`agent` : t`process`}</span> : null}</td>
                        <td>{typeLabel(e.type)} <span className="tc-mono tc-muted jr-type">{e.type}</span></td>
                        <td>{href !== null ? <a href={href}>{objectLabel(e, nameOf)}</a> : objectLabel(e, nameOf)} <button type="button" className="st-link-btn jr-only" onClick={() => set({ entityType: e.entityType, entityId: e.entityId })}>{t`all about it`}</button></td>
                        <td>{e.workspaceId !== null ? wsName.get(e.workspaceId) ?? e.workspaceId.slice(0, 8) : '—'}</td>
                      </tr>
                      {expanded
                        ? (
                          <tr id={`jr-${e.id}`} className="jr-detail">
                            <td colSpan={5}>
                              <dl className="jr-ids">
                                <dt>{t`Record`}</dt><dd className="tc-mono">{e.id} · №{e.sequence}</dd>
                                <dt>{t`Who`}</dt><dd className="tc-mono">{e.actorId ?? '—'}</dd>
                                <dt>{t`Object`}</dt><dd className="tc-mono">{e.entityType} {e.entityId}</dd>
                                <dt>{t`Workspace`}</dt><dd className="tc-mono">{e.workspaceId ?? '—'}</dd>
                                <dt>{t`When (UTC)`}</dt><dd className="tc-mono">{e.occurredAt}</dd>
                              </dl>
                              <pre className="jr-payload">{JSON.stringify(e.payload, null, 2)}</pre>
                            </td>
                          </tr>
                        )
                        : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
        : null}
      {pages.hasNextPage && !pages.isFetchingNextPage && (!wantMore)
        ? <div className="jr-more"><Button variant="secondary" size="sm" onClick={() => void pages.fetchNextPage()}>{t`Show earlier`}</Button></div>
        : null}
    </div>
  )
}
