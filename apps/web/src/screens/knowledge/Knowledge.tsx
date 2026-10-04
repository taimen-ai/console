import { Button, DataTable, DegradedBanner, EmptyState, FilterChip, JournalEntry, PageHeader, ProblemCard, SearchField, Zone } from '@console/ui'
import { plural, t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useQuery } from '@tanstack/react-query'
import { ImportDialog } from './ImportDialog.tsx'
import { DocumentDialog } from './DocumentDialog.tsx'
import { DOCUMENT_TYPE } from './documentFlow.ts'
import { useTaskTypes } from '../../api/executors.ts'
import { useScope } from '../../api/scope.tsx'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { cpGet } from '../../api/client.ts'
import { executorKind, usePrincipals } from '../../api/directory.ts'
import type { EventPage, JournalEvent } from '../../api/types.ts'
import { clock, dayMonth, startOfToday } from '../../lib/format.ts'
import { ChipSelect } from '../work/ChipSelect.tsx'
import { initials } from '../work/rows.ts'
import { cell, dateText, entryHref, sourceText } from './format.tsx'
import { columnsOf, daysLeft, expiring, matchesText, sourcesOf, type Entity, type PackKind } from './model.ts'
import { rememberWorkspace, useKnowledgeBase } from './useKnowledgeBase.ts'
import './knowledge.css'

/**
 * Экран «База знаний» (docs/screens/knowledge.md): что организация знает о себе — по видам
 * знаний включённых пакетов, со сроками действия; что требует внимания; откуда знания и что
 * изменилось. База знаний — у корня дерева пространств (namespace корня, CP-ADR-0060).
 *
 * Только реализованный API: у `entities:query` нет источника факта и времени обновления —
 * колонок «Источник» и «Обновлено» нет; источники — по событиям сверки.
 */

export interface KnowledgeSearch { kind?: string, q?: string, ws?: string }

export function parseKnowledgeSearch(raw: Record<string, unknown>): KnowledgeSearch {
  const out: KnowledgeSearch = {}
  if (typeof raw.kind === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(raw.kind)) out.kind = raw.kind
  if (typeof raw.q === 'string' && raw.q.trim() !== '') out.q = raw.q.trim().slice(0, 200)
  if (typeof raw.ws === 'string' && /^[0-9a-f-]{36}$/i.test(raw.ws)) out.ws = raw.ws
  return out
}

/** Узкая ширина: карточки «Требует внимания» — столбиком, суть не обрезается. */
function useNarrow(): boolean {
  const query = '(max-width: 720px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const on = (): void => setNarrow(list.matches)
    list.addEventListener('change', on)
    return () => list.removeEventListener('change', on)
  }, [])
  return narrow
}

export function Knowledge({ search }: { search: KnowledgeSearch }) {
  useLingui()
  const narrow = useNarrow()
  const navigate = useNavigate({ from: '/knowledge' })
  const set = (patch: Partial<KnowledgeSearch>): void => {
    void navigate({ search: prev => Object.fromEntries(Object.entries({ ...prev, ...patch }).filter(([, v]) => v !== undefined && v !== '')), replace: true })
  }

  // Организация — корень области из шапки; свой выбор — только при «Все пространства».
  const scope = useScope()
  const { roots, root, workspace, kinds, packRefs, packsReady, entities, workFor, failed } = useKnowledgeBase(search.ws ?? scope.node?.rootId)
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  // «Добавить документ» — только где работа «документ в базу знаний» разрешена (пакет установлен).
  const documents = useTaskTypes(root).types.some(ty => ty.key === DOCUMENT_TYPE)
  const ws = workspace?.id
  useEffect(() => { if (ws !== undefined) rememberWorkspace(ws) }, [ws])
  const changes = useQuery({
    queryKey: ['knowledge', 'events'],
    queryFn: ({ signal }) => cpGet<EventPage>('/events?types=knowledge.&tail=50&limit=50', signal).then(p => p.items),
  })
  const people = usePrincipals().data

  const all = entities.data?.items ?? []
  const counts = new Map<string, number>()
  for (const e of all) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  // Виды без знаний — в конце; выбранный по умолчанию — первый непустой.
  const ordered = [...kinds].sort((a, b) => Number((counts.get(b.kind) ?? 0) > 0) - Number((counts.get(a.kind) ?? 0) > 0))
  const current = ordered.find(k => k.kind === search.kind) ?? ordered[0]

  const [text, setText] = useState(search.q ?? '')
  useEffect(() => {
    const value = text.trim()
    if (value === (search.q ?? '')) return
    const timer = setTimeout(() => set({ q: value === '' ? undefined : value }), 250)
    return () => clearTimeout(timer)
  })

  const attention = expiring(all)

  return (
    <div className="kb">
      <PageHeader title={t`Knowledge`} lead={t`What the organization knows about itself — agreements, credentials, counterparties, offerings — with validity dates.`}
        actions={(
          <>
            {roots.length > 1 && scope.ws === null ? <ChipSelect label={t`Organization`} value={workspace?.id ?? ''} onChange={v => set({ ws: v, kind: undefined })} options={roots.map(r => ({ value: r.id, label: r.name }))} /> : null}
            <Button variant="secondary" size="sm" disabled={!packsReady || kinds.length === 0 || root === undefined} onClick={() => setImporting(true)}>{t`Load a table`}</Button>
            {documents ? <Button variant="secondary" size="sm" disabled={!packsReady || kinds.length === 0 || root === undefined} onClick={() => setAdding(true)}>{t`Add a document`}</Button> : null}
          </>
        )} />
      {importing && root !== undefined
        ? <ImportDialog workspaceId={root} orgName={workspace?.name} packRefs={packRefs} kinds={kinds} initialKind={current?.kind} onClose={() => setImporting(false)} />
        : null}
      {adding && root !== undefined
        ? <DocumentDialog workspaceId={root} orgName={workspace?.name} packRefs={packRefs} kinds={kinds} initialKind={current?.kind} onClose={() => setAdding(false)} />
        : null}
      {failed ? <DegradedBanner.Section text={t`Could not load the knowledge base: no connection to the core.`} /> : null}
      <div className="kb-grid">
        <div className="kb-col">
          {attention.length > 0
            ? (
              <Zone title={t`Needs attention`} count={attention.length} tone="problem">
                <div className="kb-attn">
                  {attention.map(({ entity, days, until }) => {
                    const work = workFor(entity)
                    const owner = work?.assigneeId ? people?.get(work.assigneeId)?.displayName : undefined
                    const title = work?.title ?? ''
                    const where = work !== undefined ? (owner !== undefined ? t`work raised: ${title} · ${owner}` : t`work raised: ${title}`) : t`no work raised for it yet`
                    return (
                      <ProblemCard key={`${entity.kind}:${entity.key}`} row={!narrow} severity={days < 0 ? 'failed' : 'approaching'}
                        diagnosis={<a href={entryHref(entity, ws)}>{expiryText(entity.title, until, days)}</a>} where={where}
                        {...(work !== undefined ? { actions: [{ label: t`Open the work`, variant: 'secondary' as const, onClick: () => void navigate({ to: '/work/$ref', params: { ref: work.publicId } }) }] } : {})} />
                    )
                  })}
                </div>
              </Zone>
            )
            : null}

          <Zone label={t`Knowledge`} className="kb-z-table">
            <SearchField placeholder={t`Find: agreement, organization, document`} label={t`Find in the knowledge base`} value={text} onChange={e => setText(e.target.value)} style={{ marginBottom: 12 }} />
            <div className="kb-kinds" role="group" aria-label={t`Kinds of knowledge`}>
              {ordered.map(k => (
                <FilterChip key={k.kind} label={k.title ?? k.kind} pressed={k.kind === current?.kind} onClick={() => set({ kind: k.kind })}
                  {...(entities.data !== undefined ? { count: counted(counts.get(k.kind) ?? 0, entities.data.partial) } : {})} />
              ))}
            </div>
            {current !== undefined
              ? <KindTable ws={ws} kindTitle={current.title ?? current.kind} kind={current} rows={all.filter(e => e.kind === current.kind && matchesText(e, search.q ?? ''))} loading={entities.isPending} filtering={search.q !== undefined} />
              : packsReady && !failed ? <EmptyState title={t`No kinds of knowledge are enabled`} body={t`Kinds come from the knowledge packs enabled for the organization.`} /> : null}
            {entities.data?.partial === true ? <p className="tc-muted kb-note">{t`The knowledge base is larger than the console reads at once: the first 2000 entries are shown.`}</p> : null}
          </Zone>
        </div>

        <div className="kb-col">
          <Zone title={t`Where knowledge comes from`}>
            <Sources events={changes.data} />
          </Zone>
          <Zone title={t`What changed`}>
            <Changes events={changes.data} people={people} />
          </Zone>
        </div>
      </div>
    </div>
  )
}

const counted = (n: number, partial: boolean): string => partial ? `${n}+` : String(n)

function expiryText(title: string, until: string, days: number): string {
  const date = dateText(until)
  if (days === 0) return t`${title} expires today`
  if (days < 0) {
    const ago = plural(-days, { one: '# day ago', other: '# days ago' })
    return t`${title} expired on ${date} — ${ago}`
  }
  const left = plural(days, { one: 'in # day', other: 'in # days' })
  return t`${title} expires on ${date} — ${left}`
}

function KindTable({ ws, kind, kindTitle, rows, loading, filtering }: { ws: string | undefined, kind: PackKind, kindTitle: string, rows: Entity[], loading: boolean, filtering: boolean }) {
  const { columns, validity } = columnsOf(kind)
  if (loading) return <p className="tc-muted">{t`Loading…`}</p>
  if (rows.length === 0) return <p className="tc-muted kb-note">{filtering ? t`Nothing found among “${kindTitle}”.` : t`Nothing is known of this kind yet.`}</p>
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title))
  const withSource = rows.some(e => sourcesOf(e).length > 0)
  return (
    <DataTable
      caption={kindTitle}
      columns={[{ key: 'title', title: t`Name` }, ...columns.map(c => ({ key: c.key, title: c.title })), ...(validity ? [{ key: 'validUntil', title: t`Valid until`, num: true }] : []), ...(withSource ? [{ key: 'source', title: t`Source` }] : [])]}
      rows={sorted.map((e) => {
        const days = daysLeft(e.attributes.validUntil)
        const row: Record<string, ReactNode> = {
          key: `${e.kind}:${e.key}`,
          title: <a className="tc-cell-title" href={entryHref(e, ws)}>{e.title || e.key}</a>,
        }
        for (const c of columns) row[c.key] = cell(e.attributes[c.key], c.schema, e, c.key)
        if (withSource) row.source = sourcesOf(e).map(sourceText).join(', ') || <span className="tc-muted">—</span>
        if (validity) {
          row.validUntil = e.attributes.validUntil === undefined
            ? <span className="tc-muted">{t`no end date`}</span>
            : <>{dateText(e.attributes.validUntil)}{days !== undefined && days <= 30 ? <span className="tc-cell-sub tc-cell-warn">{days < 0 ? t`expired` : days === 0 ? t`today` : plural(days, { one: 'in # day', other: 'in # days' })}</span> : null}</>
        }
        return row
      })}
    />
  )
}

/** Откуда знания: по событиям сверки — источник, когда последняя и сколько сущностей в снимке. */
function Sources({ events }: { events: JournalEvent[] | undefined }) {
  if (events === undefined) return <p className="tc-muted">{t`Loading…`}</p>
  const last = new Map<string, JournalEvent>()
  for (const e of events) if (e.type === 'knowledge.snapshot_reconciled') last.set(String(e.payload.source ?? 'unknown'), e)
  if (last.size === 0) return <p className="tc-muted">{t`No reconciliations with sources yet.`}</p>
  return (
    <ul className="kb-list">
      {[...last.entries()].sort((a, b) => b[1].occurredAt.localeCompare(a[1].occurredAt)).map(([source, e]) => {
        const n = Number(e.payload.entityCount ?? 0)
        const at = whenShort(e.occurredAt)
        return (
          <li key={source}>
            <div className="kb-src"><b>{sourceName(source)}</b><span className="tc-num">{plural(n, { one: '# entry', other: '# entries' })}</span></div>
            <span className="kb-note">{t`last reconciliation ${at}`}</span>
          </li>
        )
      })}
    </ul>
  )
}

function sourceName(source: string): string {
  switch (source) {
    case '1c': return '1С'
    case 'manual': return t`Entered manually`
    case 'document': case 'documents': return t`Documents`
    case 'spreadsheet': case 'table': return t`Spreadsheet import`
    default: return sourceText(source)
  }
}

function whenShort(iso: string): string {
  const d = new Date(iso)
  const time = clock(d)
  return d >= startOfToday() ? t`today at ${time}` : dayMonth(d)
}

/**
 * Сводка сверки словами: «добавлено N, изменено N, снято N». Ядро считает версии фактов:
 * `entities.opened` — новые версии, `entities.superseded` — заменённые (изменение),
 * `entities.closed` — закрытые (включая заменённые). Стенд разработки — `created/updated`.
 */
export function reconcileSummary(counters: Record<string, number>): { added: number, changed: number, removed: number } {
  if ('entities.opened' in counters || 'entities.closed' in counters) {
    const opened = counters['entities.opened'] ?? 0
    const superseded = counters['entities.superseded'] ?? 0
    const closed = counters['entities.closed'] ?? 0
    return { added: Math.max(opened - superseded, 0), changed: superseded, removed: Math.max(closed - superseded, 0) }
  }
  return { added: counters.created ?? 0, changed: counters.updated ?? 0, removed: (counters.retired ?? 0) + (counters.removed ?? 0) }
}

function summaryText(s: { added: number, changed: number, removed: number }): string {
  const parts = [
    s.added > 0 ? `${counterName('created')} ${s.added}` : null,
    s.changed > 0 ? `${counterName('updated')} ${s.changed}` : null,
    s.removed > 0 ? `${counterName('removed')} ${s.removed}` : null,
  ].filter((x): x is string => x !== null)
  return parts.length > 0 ? parts.join(', ') : t`nothing changed`
}

function Changes({ events, people }: { events: JournalEvent[] | undefined, people: ReturnType<typeof usePrincipals>['data'] }) {
  if (events === undefined) return <p className="tc-muted">{t`Loading…`}</p>
  // Есть события об изменениях — сверки без них только шумят: каждая сверка уже видна в «Откуда знания».
  const hasChanges = events.some(e => e.type === 'knowledge.changed')
  const recent = [...events].reverse().filter(e => !(hasChanges && e.type === 'knowledge.snapshot_reconciled')).slice(0, 8)
  if (recent.length === 0) return <p className="tc-muted">{t`No changes yet.`}</p>
  return (
    <div className="tc-journal">
      {recent.map((e) => {
        const who = e.actorId !== null ? people?.get(e.actorId) : undefined
        const actor = { kind: executorKind(who), name: who?.displayName ?? t`core`, label: initials(who?.displayName ?? 'core') }
        // В ленте — время для сегодняшнего и дата для прошлого: колонка узкая.
        const at = new Date(e.occurredAt) >= startOfToday() ? clock(e.occurredAt) : dayMonth(e.occurredAt)
        const source = sourceName(String(e.payload.source ?? ''))
        if (e.type === 'knowledge.changed') {
          const changes = Array.isArray(e.payload.changes) ? e.payload.changes as { kind?: string, change?: string }[] : []
          const count = (c: string): number => changes.filter(x => x.change === c).length
          const kinds = [...new Set(changes.map(x => x.kind).filter((k): k is string => typeof k === 'string'))].slice(0, 3).join(', ')
          const what = summaryText({ added: count('added') + count('opened'), changed: count('changed'), removed: count('removed') + count('closed') })
          return <JournalEntry key={e.id} at={at} actor={actor} verb={t`knowledge changed from`} object={source} why={kinds !== '' ? `${what} · ${kinds}` : what} />
        }
        if (e.type === 'knowledge.snapshot_reconciled') {
          const why = e.payload.duplicate === true ? t`nothing changed` : summaryText(reconcileSummary((e.payload.counters ?? {}) as Record<string, number>))
          return <JournalEntry key={e.id} at={at} actor={actor} verb={t`reconciled knowledge with`} object={source} why={why} />
        }
        if (e.type === 'knowledge.packs_configured') {
          const list = Array.isArray(e.payload.packs) ? (e.payload.packs as unknown[]).map(String).join(', ') : ''
          return <JournalEntry key={e.id} at={at} actor={actor} verb={t`configured the kinds of knowledge`} {...(list !== '' ? { why: list } : {})} />
        }
        if (e.type === 'knowledge.pack_registered') return <JournalEntry key={e.id} at={at} actor={actor} verb={t`registered a knowledge pack`} {...(typeof e.payload.ref === 'string' ? { object: e.payload.ref } : {})} />
        return <JournalEntry key={e.id} at={at} actor={actor} verb={e.type} />
      })}
    </div>
  )
}

function counterName(key: string): string {
  switch (key) {
    case 'created': return t({ id: 'knowledge.counter.created', message: 'added' })
    case 'updated': return t({ id: 'knowledge.counter.updated', message: 'changed' })
    case 'retired': case 'removed': return t({ id: 'knowledge.counter.removed', message: 'removed' })
    default: return key
  }
}
