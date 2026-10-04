import { Callout, DegradedBanner, EmptyState, IdentityBlock, PageHeader, StatusMark, Zone } from '@console/ui'
import { plural, t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Fragment, useEffect, type ReactNode } from 'react'
import { BASE_PATH, cpPost } from '../../api/client.ts'
import { executorKind, usePrincipals } from '../../api/directory.ts'
import { statusOf, workHref, initials } from '../work/rows.ts'
import { when } from '../task/history.ts'
import { cell, dateText, entryHref, sourceText } from './format.tsx'
import { daysLeft, knownSince, relationGroups, sourcesOf, type AttrSchema, type Entity } from './model.ts'
import { useEntityRelations, useKnowledgeBase } from './useKnowledgeBase.ts'
import './knowledge.css'

/**
 * Страница документа базы знаний (`/knowledge/entry?kind=&key=`): одна запись — договор,
 * удостоверяющий документ, актив, организация — со всеми сведениями по схеме её вида,
 * сроком действия и работой, которую по ней завело правило сроков.
 *
 * У ядра нет чтения одной записи по ключу: запись берётся из того же чтения базы, что и
 * список (общий кэш). Источника факта, истории и связей `entities:query` не отдаёт — их нет.
 */

export interface EntrySearch { kind?: string, key?: string, ws?: string }

export function parseEntrySearch(raw: Record<string, unknown>): EntrySearch {
  const out: EntrySearch = {}
  if (typeof raw.kind === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(raw.kind)) out.kind = raw.kind
  if (typeof raw.key === 'string' && raw.key.length > 0 && raw.key.length <= 500) out.key = raw.key
  if (typeof raw.ws === 'string' && /^[0-9a-f-]{36}$/i.test(raw.ws)) out.ws = raw.ws
  return out
}

/** Срок действия фразой: «действует до 13 октября — через 10 дней», «срок истёк …», «бессрочно». */
function validity(from: unknown, until: unknown): { text: string, warn: boolean } | undefined {
  const days = daysLeft(until)
  if (until === undefined || days === undefined) {
    if (from === undefined) return undefined
    const since = dateText(from)
    return { text: t`Valid since ${since}, no end date`, warn: false }
  }
  const date = dateText(until)
  if (days < 0) {
    const ago = plural(-days, { one: '# day ago', other: '# days ago' })
    return { text: t`Expired on ${date} — ${ago}`, warn: true }
  }
  if (days === 0) return { text: t`Expires today`, warn: true }
  const left = plural(days, { one: 'in # day', other: 'in # days' })
  return { text: t`Valid until ${date} — ${left}`, warn: days <= 30 }
}

/**
 * Ссылка без организации (`ws`) — старая или набранная руками: запись ищется во всех корнях
 * дерева одним запросом вида на корень, найденный корень дописывается в адрес.
 */
function useFindRoot(search: EntrySearch, roots: { id: string }[], enabled: boolean) {
  const navigate = useNavigate({ from: '/knowledge/entry' })
  const found = useQueries({
    queries: roots.map(r => ({
      queryKey: ['knowledge', 'find', r.id, search.kind, search.key],
      enabled: enabled && search.kind !== undefined && search.key !== undefined,
      staleTime: 60_000,
      queryFn: () => cpPost<{ items: Entity[] }>('/knowledge/entities:query', { workspaceId: r.id, kinds: [search.kind], limit: 500 })
        .then(p => p.items.some(e => e.key === search.key))
        .catch(() => false),
    })),
  })
  const at = roots.find((_, i) => found[i]?.data === true)
  useEffect(() => {
    if (at !== undefined) void navigate({ search: prev => ({ ...prev, ws: at.id }), replace: true })
  }, [at, navigate])
  return { searching: enabled && found.some(q => q.isPending) }
}

export function Entry({ search }: { search: EntrySearch }) {
  useLingui()
  const base = useKnowledgeBase(search.ws)
  const people = usePrincipals().data
  const kind = base.kinds.find(k => k.kind === search.kind)
  const entity = base.entities.data?.items.find(e => e.kind === search.kind && e.key === search.key)
  const relations = useEntityRelations(base.root, search.kind, search.key)
  const packRelations = base.packRefs.flatMap(p => p.pack.relations ?? [])
  const loaded = base.entities.isSuccess || (base.packsReady && base.kinds.every(k => k.kind !== search.kind))
  const { searching } = useFindRoot(search, base.roots, search.ws === undefined && loaded && entity === undefined)
  const listHref = `${BASE_PATH}/knowledge?${new URLSearchParams({ ...(search.kind !== undefined ? { kind: search.kind } : {}), ...(base.workspace !== undefined ? { ws: base.workspace.id } : {}) })}`
  const crumbs = [{ label: t`← Knowledge`, href: listHref }, ...(kind !== undefined ? [{ label: kind.title ?? kind.kind }] : [])]

  if (base.failed) return <div className="kb"><PageHeader crumbs={crumbs} title={t`Knowledge`} /><DegradedBanner.Section text={t`Could not load the knowledge base: no connection to the core.`} /></div>
  if (entity === undefined) {
    const loading = !loaded || searching
    return (
      <div className="kb" aria-busy={loading}>
        <PageHeader crumbs={crumbs} title={loading ? t`Loading…` : t`Document not found`} />
        {loading ? null : <EmptyState title={t`There is no such entry in the knowledge base`} body={base.entities.data?.partial === true ? t`The knowledge base is larger than the console reads at once — the entry may be beyond the first 2000.` : t`It may have been removed at the source, or the link is out of date.`} />}
      </div>
    )
  }

  const props = kind?.attributes?.properties ?? {}
  const required = new Set(kind?.attributes?.required ?? [])
  // Сначала поля схемы в её порядке, затем то, чего схема не знает (пришло от источника).
  const keys = [...Object.keys(props), ...Object.keys(entity.attributes).filter(k => !(k in props))]
  const rows: [string, ReactNode][] = keys
    .filter(k => entity.attributes[k] !== undefined || required.has(k))
    .map((k) => {
      const schema: AttrSchema = props[k] ?? {}
      return [schema.title ?? k, cell(entity.attributes[k], schema, entity, k)]
    })
  const valid = validity(entity.attributes.validFrom, entity.attributes.validUntil)
  const work = base.workOf(entity)
  const sources = sourcesOf(entity)

  return (
    <div className="kb">
      <PageHeader crumbs={crumbs} number={entity.key} title={entity.title || entity.key} {...(valid !== undefined ? { lead: valid.text } : {})} />
      {valid?.warn === true && work.every(w => w.systemStatusCategory === 'terminal_success')
        ? <div className="kb-callout"><Callout tone="warning">{t`No work has been raised to renew it yet. The deadline rule raises work for the owner of the role ahead of time; you can also assign it yourself in “Work”.`}</Callout></div>
        : null}
      <div className="kb-grid">
        <div className="kb-col">
          <Zone title={t`Details`}>
            {rows.length > 0
              ? <dl className="tc-props">{rows.map(([label, value]) => [<dt key={`${label}-t`}>{label}</dt>, <dd key={`${label}-d`}>{value}</dd>])}</dl>
              : <p className="tc-muted">{t`No details are known.`}</p>}
          </Zone>
          <Zone title={t`Work on this document`} {...(work.length > 0 ? { count: work.length } : {})}>
            {work.length > 0
              ? (
                <ul className="tc-linklist">
                  {work.map((task) => {
                    const who = task.assigneeId !== null ? people?.get(task.assigneeId) : undefined
                    return (
                      <li key={task.id}>
                        <StatusMark status={statusOf(task, who !== undefined ? executorKind(who) : undefined)} pill={false} />
                        <a href={workHref(task.publicId)}>{task.title}</a>
                        {who !== undefined ? <span className="tc-age"><IdentityBlock kind={executorKind(who)} name={who.displayName} label={initials(who.displayName)} inline size="sm" /></span> : null}
                      </li>
                    )
                  })}
                </ul>
              )
              : <p className="tc-muted">{t`No work has been raised on this document.`}</p>}
          </Zone>
        </div>
        <div className="kb-col">
          {relations.data?.unsupported === true || relations.isError
            ? null
            : (
              <Zone title={t`Relations`} {...(relations.data?.relations ? { count: relations.data.relations.length } : {})}>
                {relations.data === undefined
                  ? <p className="tc-muted">{t`Loading…`}</p>
                  : (relations.data.relations ?? []).length === 0
                      ? <p className="tc-muted">{t`No relations are known.`}</p>
                      : (
                        <dl className="tc-props kb-relations">
                          {relationGroups(relations.data.relations ?? [], packRelations).map(g => (
                            <Fragment key={g.key}>
                              <dt>{g.direction === 'in' ? t`${g.title} (reverse)` : g.title}</dt>
                              <dd>{g.items.map((r, i) => <Fragment key={`${r.kind}:${r.key}`}>{i > 0 ? ', ' : null}<a href={entryHref(r, base.workspace?.id)}>{r.title || r.key}</a></Fragment>)}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      )}
              </Zone>
            )}
          <Zone title={t`Kind of knowledge`}>
            <dl className="tc-props">
              <dt>{t`Kind`}</dt><dd>{kind?.title ?? entity.kind}</dd>
              {kind?.description !== undefined ? <><dt>{t`What it is`}</dt><dd>{kind.description}</dd></> : null}
              <dt>{t`Key`}</dt><dd className="tc-mono kb-key">{entity.key}</dd>
              {sources.length > 0 ? <><dt>{t`Source`}</dt><dd>{sources.map(sourceText).join(', ')}</dd></> : null}
              {knownSince(entity) !== undefined ? <><dt>{t`Known since`}</dt><dd>{when(knownSince(entity)!)}</dd></> : null}
              {base.workspace !== undefined ? <><dt>{t`Organization`}</dt><dd>{base.workspace.name}</dd></> : null}
            </dl>
          </Zone>
        </div>
      </div>
    </div>
  )
}
