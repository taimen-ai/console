import { Button, Consequences, DecisionStatus, DegradedBanner, Dialog, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, cpGet, cpPost } from '../../api/client.ts'
import type { Page } from '../../api/types.ts'
import { clock, since } from '../../lib/format.ts'

/**
 * «Правила» на экране «Настройки» — рычаг автономии: какие правила заводят работу сами
 * (`GET /rules`), включить или выключить (`:enable` / `:disable`) с последствиями до кнопки.
 * Архивные не показываются. Пакет, который поставил правило, — подписью.
 */

export interface Rule { id: string, key: string, description: string, status: 'enabled' | 'disabled' | 'archived' | (string & {}), trigger: { kind?: string }, enabledAt: string | null, updatedAt: string, package: { key: string, version: string } | null }

function triggerText(kind: string | undefined): string {
  switch (kind) {
    case 'event': return t`on an event`
    case 'schedule': return t`on schedule`
    case 'observation': return t`on an observation`
    default: return kind ?? '—'
  }
}

export function RulesSection() {
  const rules = useQuery({ queryKey: ['rules'], queryFn: ({ signal }) => cpGet<Page<Rule>>('/rules?limit=200', signal).then(p => p.items.filter(r => r.status !== 'archived')) })
  const [toggling, setToggling] = useState<Rule | null>(null)
  if (rules.isPending) return <p className="tc-muted">{t`Loading…`}</p>
  if (rules.isError) return <DegradedBanner.Section text={rules.error instanceof ApiError && rules.error.kind === 'forbidden' ? t`You have no right to read the rules.` : t`Could not load the rules: no connection to the core.`} />
  const sorted = [...rules.data].sort((a, b) => Number(b.status === 'enabled') - Number(a.status === 'enabled') || a.key.localeCompare(b.key))
  return (
    <>
      <p className="tc-muted st-lead">{t`Rules raise work by themselves when their conditions hold. A disabled rule raises nothing; work it has already raised stays.`}</p>
      {sorted.length === 0 ? <p className="tc-muted">{t`There are no rules yet: they come with packages.`}</p> : (
        <ul className="st-rules">
          {sorted.map(r => (
            <li key={r.id} className={r.status === 'enabled' ? '' : 'st-off'}>
              <div className="st-rule-main">
                <span className="st-rule-title">{r.description || r.key}</span>
                <span className="tc-muted st-rule-meta">
                  <span className="tc-mono">{r.key}</span> · {triggerText(r.trigger?.kind)}{r.package !== null ? ` · ${t`package`} ${r.package.key}` : ''}
                </span>
              </div>
              <span className={`st-rule-state ${r.status === 'enabled' ? 'st-on-label' : ''}`}>{r.status === 'enabled' ? t`on` : t`off`}</span>
              <Button variant={r.status === 'enabled' ? 'ghost' : 'secondary'} size="sm" onClick={() => setToggling(r)}>{r.status === 'enabled' ? t`Turn off` : t`Turn on`}</Button>
            </li>
          ))}
        </ul>
      )}
      {toggling !== null ? <ToggleDialog rule={toggling} onClose={() => setToggling(null)} /> : null}
    </>
  )
}

function ToggleDialog({ rule, onClose }: { rule: Rule, onClose: () => void }) {
  const client = useQueryClient()
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const enabling = rule.status !== 'enabled'
  const toggle = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: enabling ? t`Turning the rule on…` : t`Turning the rule off…`, at: clock(new Date()) }])
    try {
      await cpPost(`/rules/${rule.id}:${enabling ? 'enable' : 'disable'}`, {})
      setRows([{ state: 'done', text: enabling ? t`On — recorded in the core` : t`Off — recorded in the core`, at: clock(new Date()) }])
      setDone(true)
      void client.invalidateQueries({ queryKey: ['rules'] })
    } catch (error) {
      const reason = error instanceof ApiError ? (error.kind === 'forbidden' ? t`you have no right to change rules` : error.detail ?? error.code) : t`no connection to the core`
      setRows([{ state: 'fail', text: t`Not recorded: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
    }
  }
  const since_ = rule.enabledAt !== null ? since(rule.enabledAt) : undefined
  return (
    <Dialog title={enabling ? t`Turn the rule on` : t`Turn the rule off`} sub={rule.description || rule.key} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy} onClick={() => void toggle()}>{enabling ? t`Turn on` : t`Turn off`}</Button></>}>
      {done ? null : (
        <Consequences items={enabling
          ? [
              { tone: 'warn', k: t`What happens`, v: t`the rule starts raising work by itself when its conditions hold` },
              { tone: 'info', k: t`On whose behalf`, v: t`the identity of the rule; the history of the work shows the rule` },
              { tone: 'ok', k: t`Reversible`, v: t`yes — turn it off again` },
            ]
          : [
              { tone: 'warn', k: t`What happens`, v: since_ !== undefined ? t`the rule stops raising work; it has been on ${since_}` : t`the rule stops raising work` },
              { tone: 'info', k: t`Work already raised`, v: t`stays and goes on as before` },
              { tone: 'ok', k: t`Reversible`, v: t`yes — turn it on again` },
            ]} />
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
