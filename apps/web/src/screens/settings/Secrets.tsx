import { Button, Consequences, DecisionStatus, DegradedBanner, Dialog, Field, StatusMark, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, cpGet } from '../../api/client.ts'
import { deleteAgentSecret, setAgentSecret, type AgentSecret } from '../../api/connections.ts'
import { usePrincipals } from '../../api/directory.ts'
import type { Page } from '../../api/types.ts'
import { clock } from '../../lib/format.ts'
import { when } from '../task/history.ts'

/**
 * «Настройки» → «Секреты агентов» (CP-ADR-0079 §11, CP-ADR-0073): какие секреты нужны агенту,
 * объявляет его описание в пакете (`placement.secrets`), а значения вводит администратор
 * здесь. По каждому объявленному имени — задан ли он, кто и когда; «Ввести» / «Заменить» /
 * «Удалить». Значение, у которого имени больше нет в описании, — «не объявлен», его можно
 * только удалить. Значения уходят в хранилище секретов ядра и нигде не показываются.
 */

interface AgentLite { key: string, displayName: string, status: string, revision?: { spec?: { placement?: { secrets?: unknown[] } } } | null }

const now = (): string => clock(new Date())

/** Объявленные имена секретов: строки или `{name}` — как в описании агента. */
export function declaredSecrets(agent: AgentLite): string[] {
  const list = agent.revision?.spec?.placement?.secrets ?? []
  return [...new Set(list.map(x => (typeof x === 'string' ? x : typeof x === 'object' && x !== null && 'name' in x ? String((x as { name: unknown }).name) : '')).filter(Boolean))]
}

/** Строки агента: объявленные (заданы или нет) и заданные без объявления. */
export function secretRows(declared: string[], set: AgentSecret[]): { name: string, declared: boolean, secret: AgentSecret | undefined }[] {
  const byName = new Map(set.map(s => [s.name, s]))
  return [
    ...declared.map(name => ({ name, declared: true, secret: byName.get(name) })),
    ...set.filter(s => !declared.includes(s.name)).map(s => ({ name: s.name, declared: false, secret: s })),
  ]
}

function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return t`no connection to the core`
  if (error.kind === 'forbidden') return t`you have no right to manage secrets of agents`
  switch (error.code) {
    case 'secret_store_unavailable': return t`the secret store is unavailable — try again later`
    case 'agent_retired': return t`the agent is retired`
    case 'invalid_secret_name': return t`the name may hold lower-case letters, digits and dashes`
    default: return error.status === 404 ? t`the core does not support secrets of agents yet` : error.detail ?? error.code
  }
}

export function SecretsSection() {
  const agents = useQuery({ queryKey: ['agents', 'registry'], staleTime: 60_000, retry: false, queryFn: ({ signal }) => cpGet<Page<AgentLite>>('/agents?limit=200', signal) })
  const list = (agents.data?.items ?? []).filter(a => a.status !== 'retired').sort((a, b) => a.displayName.localeCompare(b.displayName))
  const secrets = useQueries({
    queries: list.map(a => ({
      queryKey: ['agent-secrets', a.key], retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) => cpGet<{ items: AgentSecret[] }>(`/agents/${encodeURIComponent(a.key)}/secrets`, signal).then(r => r.items),
    })),
  })
  const [editing, setEditing] = useState<{ agent: AgentLite, name: string, exists: boolean } | null>(null)
  const [removing, setRemoving] = useState<{ agent: AgentLite, name: string, declared: boolean } | null>(null)
  const people = usePrincipals().data
  // Агенты, которым секреты нужны или у которых они уже есть.
  const shown = list.map((a, i) => ({ agent: a, declared: declaredSecrets(a), q: secrets[i] })).filter(x => x.declared.length > 0 || (x.q?.data?.length ?? 0) > 0)
  const missing = shown.reduce((n, x) => n + x.declared.filter(name => !(x.q?.data ?? []).some(s => s.name === name)).length, 0)

  if (agents.isError) return <DegradedBanner.Section text={errorText(agents.error)} />
  return (
    <div className="sx">
      <p className="tc-muted st-lead">{t`Which secrets an agent needs is declared by its description in the package; the values are entered here. They go straight to the secret store: nobody sees them after entry, the console neither, and each agent reads only its own.`}</p>
      {agents.isPending ? <p className="tc-muted">{t`Loading…`}</p> : null}
      {agents.isSuccess && shown.length === 0 && !secrets.some(q => q.isPending) ? <p className="tc-muted">{t`No agent declares secrets.`}</p> : null}
      {missing > 0 ? <p className="sx-missing">{t`Not entered yet: ${missing} — the agents that need them cannot start or work.`}</p> : null}
      {shown.map(({ agent, declared, q }) => {
        const rows = secretRows(declared, q?.data ?? [])
        return (
          <section key={agent.key} className="sx-agent" aria-label={agent.displayName}>
            <h3 className="sx-h">{agent.displayName} <span className="tc-mono tc-muted sx-key">{agent.key}</span></h3>
            {q?.isError ? <DegradedBanner.Section text={errorText(q.error)} /> : q?.isPending ? <p className="tc-muted">{t`Loading…`}</p> : (
              <ul className="sx-list" aria-label={t`Secrets of ${agent.displayName}`}>
                {rows.map((r) => {
                  const who = r.secret !== undefined ? people?.get(r.secret.updatedBy)?.displayName : undefined
                  const at = r.secret !== undefined ? when(r.secret.updatedAt) : ''
                  return (
                    <li key={r.name}>
                      <span className="sx-main">
                        <span className="tc-mono sx-name">{r.name}</span>
                        <span className="tc-muted sx-meta">
                          {!r.declared ? t`not declared by the description any more — delete it if it is not needed` : r.secret !== undefined ? (who !== undefined ? t`entered ${at} · ${who}` : t`entered ${at}`) : t`the agent needs it`}
                        </span>
                      </span>
                      {r.declared ? <StatusMark status={r.secret !== undefined ? 'verified' : 'blocked'} label={r.secret !== undefined ? t`entered` : t`not entered`} /> : <StatusMark status="stale" label={t`not declared`} />}
                      <span className="sx-actions">
                        {r.declared ? <Button variant={r.secret !== undefined ? 'ghost' : 'secondary'} size="sm" onClick={() => setEditing({ agent, name: r.name, exists: r.secret !== undefined })}>{r.secret !== undefined ? t`Replace` : t`Enter`}</Button> : null}
                        {r.secret !== undefined ? <Button variant="ghost" size="sm" onClick={() => setRemoving({ agent, name: r.name, declared: r.declared })}>{t`Delete`}</Button> : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
      {editing !== null ? <SecretDialog agent={editing.agent} name={editing.name} exists={editing.exists} onClose={() => setEditing(null)} /> : null}
      {removing !== null ? <DeleteSecretDialog agent={removing.agent} name={removing.name} declared={removing.declared} onClose={() => setRemoving(null)} /> : null}
    </div>
  )
}

function SecretDialog({ agent, name, exists, onClose }: { agent: AgentLite, name: string, exists: boolean, onClose: () => void }) {
  const client = useQueryClient()
  const [value, setValue] = useState('')
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Sending the secret to the secret store…`, at: now() }])
    try {
      await setAgentSecret(agent.key, name, value)
      setValue('')
      setDone(true)
      setRows([{ state: 'done', text: t`Saved — the agent reads it on its next start`, at: now() }])
      void client.invalidateQueries({ queryKey: ['agent-secrets', agent.key] })
    } catch (error) {
      const reason = errorText(error)
      setRows([{ state: 'fail', text: t`Not saved: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  const close = (): void => { setValue(''); onClose() }
  return (
    <Dialog title={exists ? t`Replace the secret` : t`Enter the secret`} sub={`${agent.displayName} · ${name}`} onClose={close}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={close} disabled={busy}>{t`Cancel`}</Button><Button variant="brand" disabled={busy || value === ''} onClick={() => void save()}>{t`Save`}</Button></>}>
      {done ? null : (
        <>
          <div className="tc-form">
            <Field label={t`Value`} wide help={t`It goes straight to the secret store. After saving nobody sees it — the console neither.`}>
              <input className="tc-input tc-mono" type="password" value={value} maxLength={65536} autoComplete="new-password" spellCheck={false} onChange={e => setValue(e.target.value)} />
            </Field>
          </div>
          <Consequences items={[
            { tone: exists ? 'warn' : 'info', k: t`Value`, v: exists ? t`replaces the previous one; the previous value is destroyed` : t`is kept in the secret store only` },
            { tone: 'info', k: t`Who reads it`, v: t`only this agent, from its next start` },
          ]} />
        </>
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}

function DeleteSecretDialog({ agent, name, declared, onClose }: { agent: AgentLite, name: string, declared: boolean, onClose: () => void }) {
  const client = useQueryClient()
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const remove = async (): Promise<void> => {
    setBusy(true)
    setRows([{ state: 'wait', text: t`Deleting the secret…`, at: now() }])
    try {
      await deleteAgentSecret(agent.key, name)
      setDone(true)
      setRows([{ state: 'done', text: t`Deleted with all its versions`, at: now() }])
      void client.invalidateQueries({ queryKey: ['agent-secrets', agent.key] })
    } catch (error) {
      const reason = errorText(error)
      setRows([{ state: 'fail', text: t`Not deleted: ${reason}`, at: now() }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog alert title={t`Delete the secret`} sub={`${agent.displayName} · ${name}`} onClose={onClose}
      footer={done
        ? <Button variant="secondary" onClick={onClose}>{t`Close`}</Button>
        : <><Button variant="ghost" onClick={onClose} disabled={busy}>{t`Cancel`}</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{t`Delete`}</Button></>}>
      {done ? null : (
        <Consequences items={[
          { tone: 'warn', k: t`Value`, v: t`is destroyed with all its versions; it cannot be returned` },
          declared
            ? { tone: 'warn', k: t`Agent`, v: t`still needs it: until it is entered again, the agent falls back to the file on its node, if there is one` }
            : { tone: 'ok', k: t`Agent`, v: t`its description no longer names this secret` },
        ]} />
      )}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </Dialog>
  )
}
