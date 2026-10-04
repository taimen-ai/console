import { Button, DataTable, DegradedBanner, EmptyState, Icon, IdentityBlock, PageHeader, SearchField, StatusMark, Zone } from '@console/ui'
import { useQuery } from '@tanstack/react-query'
import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { ApiError, BASE_PATH } from '../../api/client.ts'
import { executorKind, taskQuery, usePrincipals } from '../../api/directory.ts'
import { StepForm, useStepForm } from '../../forms/StepForm.tsx'
import type { Principal } from '../../api/types.ts'
import { useBlock, useView, type Block, type QueryRequest } from '../../api/views.ts'
import { since } from '../../lib/format.ts'
import { when } from '../task/history.ts'
import { ChipSelect } from '../work/ChipSelect.tsx'
import { entryHref } from '../knowledge/format.tsx'
import { initials, workHref } from '../work/rows.ts'
import { Chart, type ChartPoint } from './Chart.tsx'
import { formatValue, statusMark } from './values.tsx'
import './view.css'

/**
 * Экран пакета (TAI-ADR-0066): консоль рисует вид из закрытого набора блоков версии 1 своими
 * компонентами дизайн-системы; данные каждого блока — `POST /views/{key}:query` (docs/views.md).
 * Консоль не знает предметных видов, полей и этапов — только блоки и форматы.
 *
 * Адреса: `/v/{key}` — вид коллекции, `/v/{key}/{id}` — вид одного экземпляра (`params.id`).
 * Блок, которого эта версия консоли не рисует, — заглушка, а не ошибка экрана.
 */

type People = Map<string, Principal> | undefined
export const viewHref = (key: string, id?: string): string => `${BASE_PATH}/v/${encodeURIComponent(key)}${id !== undefined ? `/${encodeURIComponent(id)}` : ''}`

/** Блоки, которые рисует эта версия консоли (набор версии 1). */
export const SUPPORTED_BLOCKS = new Set(['header', 'metrics', 'board', 'chart', 'table', 'list', 'fields', 'steps', 'timeline', 'artifacts', 'related'])

export function ViewScreen({ viewKey, id }: { viewKey: string, id?: string }) {
  useLingui()
  const view = useView(viewKey)
  const people = usePrincipals().data
  if (view.isPending) return <div className="vw" aria-busy="true"><p className="tc-muted">{t`Loading…`}</p></div>
  if (view.isError) {
    const missing = view.error instanceof ApiError && view.error.status === 404
    return (
      <div className="vw">
        <PageHeader title={missing ? t`Screen not found` : t`Screen`} />
        {missing ? <EmptyState title={t`There is no such screen`} body={t`The package that declared it may have been removed, or the screen is not available to your role.`} /> : <DegradedBanner.Section text={t`Could not load the screen: no connection to the core.`} />}
      </div>
    )
  }
  const v = view.data
  const params = id !== undefined ? { id } : undefined
  const hasHeader = v.layout.some(b => b.block === 'header')
  return (
    <div className="vw">
      {hasHeader ? null : <PageHeader title={v.title} />}
      <div className="vw-blocks">
        {v.layout.map((block, index) => (
          <BlockView key={index} viewKey={v.key} index={index} block={block} params={params} people={people} />
        ))}
      </div>
    </div>
  )
}

function BlockView({ viewKey, index, block, params, people }: { viewKey: string, index: number, block: Block, params: Record<string, string> | undefined, people: People }) {
  if (!SUPPORTED_BLOCKS.has(block.block)) {
    return <div className="vw-unknown"><Icon name="info" /><span>{t`This part of the screen needs a newer console.`}</span></div>
  }
  const base = { viewKey, index, params, people }
  switch (block.block) {
    case 'header': return <HeaderBlock {...base} />
    case 'metrics': return <MetricsBlock {...base} block={block as Extract<Block, { block: 'metrics' }>} />
    case 'board': return <BoardBlock {...base} block={block as Extract<Block, { block: 'board' }>} />
    case 'chart': return <ChartBlock {...base} block={block as Extract<Block, { block: 'chart' }>} />
    case 'table': case 'list': return <TableBlock {...base} block={block as Extract<Block, { block: 'table' | 'list' }>} />
    case 'fields': return <FieldsBlock {...base} block={block as Extract<Block, { block: 'fields' }>} />
    case 'steps': return <StepsBlock {...base} />
    case 'timeline': return <TimelineBlock {...base} />
    case 'artifacts': return <ArtifactsBlock {...base} />
    case 'related': return <RelatedBlock {...base} block={block as Extract<Block, { block: 'related' }>} />
    default: return null
  }
}

interface BlockProps { viewKey: string, index: number, params: Record<string, string> | undefined, people: People }

function request(index: number, params: Record<string, string> | undefined, extra: Partial<QueryRequest> = {}): QueryRequest {
  return { block: index, ...(params !== undefined ? { params } : {}), ...extra }
}

/** Состояния блока: загрузка, сбой — внутри блока, остальной экран живёт. */
function state(q: { isPending: boolean, isError: boolean }): ReactNode | null {
  if (q.isPending) return <p className="tc-muted">{t`Loading…`}</p>
  if (q.isError) return <DegradedBanner.Section text={t`This part of the screen did not load.`} />
  return null
}

function HeaderBlock({ viewKey, index, params }: BlockProps) {
  const q = useBlock<{ title: string, status?: { title?: string, category?: string }, lead?: string }>(viewKey, request(index, params))
  if (q.data === undefined) return <>{state(q)}</>
  return (
    <PageHeader title={q.data.title}
      {...(q.data.status !== undefined ? { status: { status: statusMark(q.data.status.category), label: q.data.status.title ?? '' } } : {})}
      {...(q.data.lead !== undefined ? { lead: q.data.lead } : {})} />
  )
}

function MetricsBlock({ viewKey, index, params, people, block }: BlockProps & { block: Extract<Block, { block: 'metrics' }> }) {
  const q = useBlock<{ values: unknown[] }>(viewKey, request(index, params))
  return (
    <div className="vw-metrics" role="list">
      {block.items.map((item, i) => (
        <div className="vw-metric" role="listitem" key={i}>
          <span className="vw-metric-title">{item.title}</span>
          <span className="vw-metric-value">{q.data !== undefined ? formatValue(q.data.values[i], item.format ?? 'number', people) : q.isError ? '—' : '…'}</span>
        </div>
      ))}
    </div>
  )
}

function ChartBlock({ viewKey, index, params, block }: BlockProps & { block: Extract<Block, { block: 'chart' }> }) {
  const q = useBlock<{ points: ChartPoint[] }>(viewKey, request(index, params))
  return (
    <Zone className="vw-z-chart">
      {q.data === undefined ? state(q) : (q.data.points ?? []).length === 0 ? <p className="tc-muted">{t`No data for the chart.`}</p>
        : <Chart type={block.type} {...(block.title !== undefined ? { title: block.title } : {})} {...(block.format !== undefined ? { format: block.format } : {})} points={q.data.points} />}
    </Zone>
  )
}

interface Card { id: string, title: string, subtitle?: string, values: Record<string, unknown>, badge?: { title?: string, category?: string } }

function BoardBlock({ viewKey, index, params, people, block }: BlockProps & { block: Extract<Block, { block: 'board' }> }) {
  const q = useBlock<{ columns: { key: string, title: string, items: Card[] }[] }>(viewKey, request(index, params))
  if (q.data === undefined) return <Zone>{state(q)}</Zone>
  return (
    <div className="vw-board" role="list" aria-label={t`Board`}>
      {q.data.columns.map(col => (
        <section className="vw-col" key={col.key} role="listitem" aria-label={col.title}>
          <h2 className="vw-col-title">{col.title}<span className="tc-zone-count">{col.items.length}</span></h2>
          <div className="vw-cards">
            {col.items.length === 0 ? <p className="tc-muted vw-empty">—</p> : null}
            {col.items.map(card => (
              <article className="vw-card" key={card.id}>
                {block.open !== undefined ? <a className="vw-card-title" href={viewHref(block.open.view, card.id)}>{card.title}</a> : <span className="vw-card-title">{card.title}</span>}
                {card.subtitle !== undefined ? <span className="vw-card-sub">{card.subtitle}</span> : null}
                <div className="vw-card-fields">{block.card.fields.map(f => <span key={f.key}>{formatValue(card.values[f.key], f.format, people)}</span>)}</div>
                {card.badge !== undefined ? <StatusMark status={statusMark(card.badge.category)} label={card.badge.title ?? ''} /> : null}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function TableBlock({ viewKey, index, params, people, block }: BlockProps & { block: Extract<Block, { block: 'table' | 'list' }> }) {
  // Значение фильтра по полю: enum и text — строка; number и date — «от» и «до».
  const [filters, setFilters] = useState<Record<string, { value?: string, from?: string, to?: string }>>({})
  const [sort, setSort] = useState('')
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const page = cursors.length - 1
  const types = new Map((block.filters ?? []).map(f => [f.field, f.type]))
  const filter = Object.entries(filters).flatMap(([field, v]) => {
    const type = types.get(field)
    const out: QueryRequest['filter'] & object = []
    const num = (s: string): number | string => type === 'number' ? Number(s) : s
    if (v.value !== undefined && v.value.trim() !== '') out.push({ field, op: type === 'text' ? 'prefix' : 'eq', value: v.value.trim() })
    if (v.from !== undefined && v.from !== '' && !(type === 'number' && Number.isNaN(Number(v.from)))) out.push({ field, op: 'gte', value: num(v.from) })
    if (v.to !== undefined && v.to !== '' && !(type === 'number' && Number.isNaN(Number(v.to)))) out.push({ field, op: 'lte', value: num(v.to) })
    return out
  })
  const patch = (field: string, p: { value?: string, from?: string, to?: string }): void => { setFilters(s => ({ ...s, [field]: { ...s[field], ...p } })); setCursors([null]) }
  const q = useBlock<{ items: { id: string, title: string, values: Record<string, unknown> }[], nextCursor: string | null }>(viewKey, request(index, params, {
    ...(filter.length > 0 ? { filter } : {}),
    ...(sort !== '' ? { sort: [{ field: sort, dir: 'asc' }] } : {}),
    limit: 50, cursor: cursors[page] ?? null,
  }))
  const reset = (): void => setCursors([null])
  return (
    <Zone className="vw-table">
      {(block.filters?.length ?? 0) > 0 || (block.sort?.length ?? 0) > 0
        ? (
          <div className="vw-bar" role="search">
            {(block.filters ?? []).map((f) => {
              if (f.type === 'enum') {
                return <ChipSelect key={f.field} label={f.title} value={filters[f.field]?.value ?? ''} onChange={v => patch(f.field, { value: v })}
                  options={[{ value: '', label: t`all` }, ...(f.options ?? []).map(o => ({ value: o.value, label: o.title }))]} />
              }
              if (f.type === 'text') return <TextFilter key={f.field} label={f.title} onChange={v => patch(f.field, { value: v })} />
              const input = f.type === 'date' ? 'date' : 'number'
              return (
                <fieldset key={f.field} className="vw-range">
                  <legend>{f.title}</legend>
                  <input className="tc-input" type={input} aria-label={t`${f.title} from`} placeholder={t`from`} value={filters[f.field]?.from ?? ''} onChange={e => patch(f.field, { from: e.target.value })} />
                  <span aria-hidden="true">—</span>
                  <input className="tc-input" type={input} aria-label={t`${f.title} to`} placeholder={t`to`} value={filters[f.field]?.to ?? ''} onChange={e => patch(f.field, { to: e.target.value })} />
                </fieldset>
              )
            })}
            {(block.sort?.length ?? 0) > 0
              ? <ChipSelect label={t`Order`} value={sort} onChange={(v) => { setSort(v); reset() }} options={[{ value: '', label: t`as is` }, ...(block.sort ?? []).map(s => ({ value: s.field, label: s.title }))]} />
              : null}
          </div>
        )
        : null}
      {q.data === undefined
        ? state(q)
        : q.data.items.length === 0
          ? <p className="tc-muted">{filter.length > 0 ? t`Nothing matches the filters.` : t`Nothing here yet.`}</p>
          : (
            <DataTable
              columns={[{ key: '__title', title: t`Name` }, ...block.columns.map(c => ({ key: c.key, title: c.title }))]}
              rows={q.data.items.map((item) => {
                const row: Record<string, ReactNode> = { key: item.id, __title: block.open !== undefined ? <a className="tc-cell-title" href={viewHref(block.open.view, item.id)}>{item.title}</a> : <span className="tc-cell-title">{item.title}</span> }
                for (const c of block.columns) row[c.key] = formatValue(item.values[c.key], c.format, people)
                return row
              })} />
          )}
      {q.data?.nextCursor !== null && q.data?.nextCursor !== undefined
        ? <button type="button" className="tc-wgroup-more vw-more" onClick={() => setCursors(c => [...c, q.data!.nextCursor])}>{t`Show more`}</button>
        : page > 0 ? <button type="button" className="tc-wgroup-more vw-more" onClick={reset}>{t`Back to the first page`}</button> : null}
    </Zone>
  )
}

/** Текстовый фильтр: в запрос — с задержкой, чтобы не перечитывать на каждую букву. */
function TextFilter({ label, onChange }: { label: string, onChange: (value: string) => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => onChange(text), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange новый на каждой отрисовке; важен только текст
  }, [text])
  return <SearchField placeholder={label} label={label} value={text} onChange={e => setText(e.target.value)} style={{ flex: '0 1 220px' }} />
}

function FieldsBlock({ viewKey, index, params, people, block }: BlockProps & { block: Extract<Block, { block: 'fields' }> }) {
  const q = useBlock<{ values: Record<string, unknown> }>(viewKey, request(index, params))
  return (
    <Zone {...(block.section !== undefined ? { title: block.section } : {})}>
      {q.data === undefined ? state(q) : (
        <dl className="tc-props">
          {block.items.map(item => [<dt key={`${item.key}-t`}>{item.label}</dt>, <dd key={`${item.key}-d`}>{formatValue(q.data.values[item.key], item.format, people)}</dd>])}
        </dl>
      )}
    </Zone>
  )
}

function StepsBlock({ viewKey, index, params, people }: BlockProps) {
  const q = useBlock<{ items: { key: string, title: string, task?: { ref: string, title: string }, assignee?: string, since?: string }[] }>(viewKey, request(index, params))
  return (
    <Zone title={t`Now`} tone="human">
      {q.data === undefined ? state(q) : q.data.items.length === 0 ? <p className="tc-muted">{t`No open steps: nothing is waiting.`}</p> : (
        <ul className="tc-linklist">
          {q.data.items.map((s) => {
            const who = s.assignee !== undefined ? people?.get(s.assignee) : undefined
            const at = since(s.since)
            return (
              <li key={s.key} className="vw-step">
                <div className="vw-step-head">
                  <StatusMark status="running" label={s.title} />
                  {s.task !== undefined ? <a href={workHref(s.task.ref)}>{s.task.title}</a> : null}
                  {who !== undefined ? <IdentityBlock kind={executorKind(who)} name={who.displayName} label={initials(who.displayName)} inline size="sm" /> : null}
                  {at !== undefined ? <span className="tc-age">{at}</span> : null}
                </div>
                {s.task !== undefined ? <StepInline taskRef={s.task.ref} /> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Zone>
  )
}

/** Форма шага прямо на экране пакета: раскрывается по кнопке, если шаг объявил форму. */
function StepInline({ taskRef }: { taskRef: string }) {
  const task = useQuery(taskQuery(taskRef))
  const step = useStepForm(task.data)
  const [open, setOpen] = useState(false)
  if (task.data === undefined || step.form === undefined || task.data.systemStatusCategory.startsWith('terminal')) return null
  return (
    <div className="vw-step-form">
      <Button variant={open ? 'ghost' : 'human'} size="sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? t`Hide the form` : t`Fill in the step`}</Button>
      {open ? <StepForm task={task.data} form={step.form} /> : null}
    </div>
  )
}

function TimelineBlock({ viewKey, index, params, people }: BlockProps) {
  const q = useBlock<{ items: { at: string, title: string, actor?: string }[] }>(viewKey, request(index, params))
  return (
    <Zone title={t`History`}>
      {q.data === undefined ? state(q) : q.data.items.length === 0 ? <p className="tc-muted">{t`No events yet.`}</p> : (
        <ol className="vw-timeline">
          {q.data.items.map((e, i) => {
            const who = e.actor !== undefined ? people?.get(e.actor)?.displayName : undefined
            return <li key={i}><span className="vw-at">{when(e.at)}</span><span>{e.title}</span>{who !== undefined ? <span className="tc-muted"> · {who}</span> : null}</li>
          })}
        </ol>
      )}
    </Zone>
  )
}

/** Связанные записи базы знаний (`:query` → `{items: [{relation, title?, kind, key, entityTitle, direction}]}`), по связям — группами. */
export interface RelatedItem { relation: string, title?: string, kind: string, key: string, entityTitle: string, direction?: 'out' | 'in' }
export function groupRelated(items: RelatedItem[]): { title: string, items: RelatedItem[] }[] {
  const groups = new Map<string, RelatedItem[]>()
  for (const r of items) { const k = r.title ?? r.relation; groups.set(k, [...(groups.get(k) ?? []), r]) }
  return [...groups].map(([title, list]) => ({ title, items: list }))
}

function RelatedBlock({ viewKey, index, params, block }: BlockProps & { block: Extract<Block, { block: 'related' }> }) {
  const q = useBlock<{ items: RelatedItem[] }>(viewKey, request(index, params))
  return (
    <Zone title={block.title ?? t`Related`}>
      {q.data === undefined ? state(q) : q.data.items.length === 0 ? <p className="tc-muted">{t`Nothing related yet.`}</p> : (
        <dl className="tc-props vw-related">
          {groupRelated(q.data.items).map(g => (
            <Fragment key={g.title}>
              <dt>{g.title}</dt>
              <dd>{g.items.map((r, i) => <Fragment key={`${r.kind}:${r.key}`}>{i > 0 ? ', ' : null}<a href={entryHref(r)}>{r.entityTitle}</a></Fragment>)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </Zone>
  )
}

function ArtifactsBlock({ viewKey, index, params }: BlockProps) {
  const q = useBlock<{ items: { id: string, name: string, type: string }[] }>(viewKey, request(index, params))
  return (
    <Zone title={t`Materials`}>
      {q.data === undefined ? state(q) : q.data.items.length === 0 ? <p className="tc-muted">{t`No materials yet.`}</p> : (
        <ul className="tc-linklist">
          {q.data.items.map(a => <li key={a.id}><Icon name="file" /><a href={`${BASE_PATH}/documents/${a.id}`}>{a.name || a.type}</a><span className="tc-age">{a.type}</span></li>)}
        </ul>
      )}
    </Zone>
  )
}
