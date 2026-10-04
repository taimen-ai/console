import { Button, Callout, DegradedBanner } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery } from '@tanstack/react-query'
import { cpGet, cpPost } from '../../api/client.ts'
import type { Connection } from '../../api/connections.ts'
import type { Page } from '../../api/types.ts'
import type { FieldSchema } from '../../forms/schema.ts'

/**
 * Роли этапов воронки — настройка подключения класса CRM (`settings.stageRoles`,
 * коннектор CRM): какой этап какой воронки что означает. Воронки и этапы —
 * из знания `crm@1` в пространстве агента-наблюдателя подключения
 * (`POST /knowledge/entities:query`, виды `crm_pipeline` и `crm_stage`): снимок делает
 * коннектор после подключения и затем не реже раза в час. Консоль сохраняет пары
 * `{pipelineId, stageId, role}`; этапа без роли в списке нет.
 */

export interface StageRole { pipelineId: string, stageId: string, role: string }

interface Entity { kind: string, key: string, title: string, attributes: Record<string, unknown> }
interface AgentLite { key: string, workspaceId: string | null, revision?: { spec?: { work?: { workspace?: string } } } | null }

/** Поле — список ролей этапов класса CRM: объекты `{pipelineId, stageId, role}`. */
export function isStageRolesField(field: FieldSchema): boolean {
  const p = field.items?.properties
  return (field.type === 'array' || field.items !== undefined) && p !== undefined && 'pipelineId' in p && 'stageId' in p && 'role' in p
}

function roleLabel(role: string): string {
  switch (role) {
    case 'draft': return t`preparing a proposal`
    default: return role
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : Number.MAX_SAFE_INTEGER)

/** Пайплайны и этапы снимка в порядке CRM: основная воронка первой, архивные — не показываются. */
export function pipelinesOf(entities: Entity[]): { id: string, name: string, stages: { id: string, name: string, outcome: string }[] }[] {
  const stages = entities.filter(e => e.kind === 'crm_stage')
  return entities.filter(e => e.kind === 'crm_pipeline' && e.attributes.archived !== true)
    .sort((a, b) => Number(b.attributes.main === true) - Number(a.attributes.main === true) || num(a.attributes.sort) - num(b.attributes.sort) || a.title.localeCompare(b.title))
    .map(p => ({
      id: str(p.attributes.externalId),
      name: str(p.attributes.name) || p.title,
      stages: stages.filter(s => str(s.attributes.pipelineId) === str(p.attributes.externalId))
        .sort((a, b) => num(a.attributes.sort) - num(b.attributes.sort))
        .map(s => ({ id: str(s.attributes.externalId), name: str(s.attributes.name) || s.title, outcome: str(s.attributes.outcome) })),
    }))
}

/** Роль этапа: заменить или снять (пустая роль — пары нет). */
export function withRole(roles: StageRole[], pipelineId: string, stageId: string, role: string): StageRole[] {
  const rest = roles.filter(r => !(r.pipelineId === pipelineId && r.stageId === stageId))
  return role === '' ? rest : [...rest, { pipelineId, stageId, role }]
}

function useObserverWorkspace(connection: Connection): { workspaceId: string | null | undefined, observer: string | undefined } {
  const observer = typeof connection.settings.observerAgent === 'string' ? connection.settings.observerAgent : undefined
  const agents = useQuery({ queryKey: ['agents', 'registry'], staleTime: 60_000, retry: false, queryFn: ({ signal }) => cpGet<Page<AgentLite>>('/agents?limit=200', signal) })
  if (observer === undefined) return { workspaceId: null, observer }
  if (!agents.isSuccess) return { workspaceId: agents.isError ? null : undefined, observer }
  const agent = agents.data.items.find(a => a.key === observer)
  return { workspaceId: agent?.revision?.spec?.work?.workspace ?? agent?.workspaceId ?? null, observer }
}

export function StageRoles({ connection, field, value, disabled, errors, errorPrefix, onChange }: {
  connection: Connection, field: FieldSchema, value: StageRole[], disabled: boolean, errors: Record<string, string>, errorPrefix: string, onChange: (v: StageRole[]) => void
}) {
  const { workspaceId, observer } = useObserverWorkspace(connection)
  const snapshot = useQuery({
    queryKey: ['crm-snapshot', connection.key, workspaceId], enabled: typeof workspaceId === 'string', retry: false, staleTime: 5 * 60_000,
    queryFn: async () => {
      const out: Entity[] = []
      let cursor: string | null = null
      for (let page = 0; page < 10; page++) {
        const res: { items: Entity[], nextCursor: string | null } = await cpPost('/knowledge/entities:query', {
          workspaceId, kinds: ['crm_pipeline', 'crm_stage'], where: [{ attr: 'connection', op: 'eq', value: connection.key }], limit: 500, ...(cursor !== null ? { cursor } : {}),
        })
        out.push(...res.items)
        cursor = res.nextCursor
        if (cursor === null) break
      }
      return out
    },
  })
  const roles = (field.items?.properties?.role?.enum ?? []).map(String)
  const pipelines = snapshot.isSuccess ? pipelinesOf(snapshot.data) : []
  const known = new Set(pipelines.flatMap(p => p.stages.map(s => `${p.id}:${s.id}`)))
  const orphans = value.map((r, i) => ({ r, i })).filter(({ r }) => snapshot.isSuccess && !known.has(`${r.pipelineId}:${r.stageId}`))
  const errorOf = (pipelineId: string, stageId: string): string | undefined => {
    const i = value.findIndex(r => r.pipelineId === pipelineId && r.stageId === stageId)
    if (i < 0) return undefined
    return errors[`${errorPrefix}/${i}`] ?? errors[`${errorPrefix}/${i}/role`] ?? errors[`${errorPrefix}/${i}/stageId`]
  }

  return (
    <div className="cn-stages" role="group" aria-label={field.title ?? t`Roles of pipeline stages`}>
      <p className="cn-stages-title">{field.title ?? t`Roles of pipeline stages`}</p>
      <p className="tc-muted st-lead">{field.description ?? t`Which stage of which pipeline means what: work starts when a deal reaches a stage with a role.`}</p>
      {observer === undefined
        ? <Callout tone="info">{t`Pipelines come from the observer agent of the connection, and it is not named yet (setting “observerAgent” below).`}</Callout>
        : workspaceId === null
          ? <Callout tone="info">{t`The observer agent “${observer}” is not found — its pipelines cannot be read.`}</Callout>
          : snapshot.isError
            ? <DegradedBanner.Section text={t`Could not read the pipelines of the connection from the knowledge base.`} />
            : snapshot.isPending || workspaceId === undefined
              ? <p className="tc-muted">{t`Loading the pipelines…`}</p>
              : pipelines.length === 0
                ? <Callout tone="info">{t`Waiting for the first snapshot of pipelines: the connector takes it after connecting and then at least once an hour.`}</Callout>
                : pipelines.map(p => (
                  <table key={p.id} className="cn-stage-table">
                    <caption>{p.name}</caption>
                    <thead><tr><th scope="col">{t`Stage`}</th><th scope="col">{t`Role`}</th></tr></thead>
                    <tbody>
                      {p.stages.map((s) => {
                        const current = value.find(r => r.pipelineId === p.id && r.stageId === s.id)?.role ?? ''
                        const error = errorOf(p.id, s.id)
                        return (
                          <tr key={s.id}>
                            <th scope="row">{s.name}{s.outcome === 'won' ? <span className="tc-muted"> · {t`won`}</span> : s.outcome === 'lost' ? <span className="tc-muted"> · {t`lost`}</span> : null}</th>
                            <td>
                              <select className="tc-select" aria-label={t`Role of the stage “${s.name}”`} value={current} disabled={disabled} aria-invalid={error !== undefined}
                                onChange={e => onChange(withRole(value, p.id, s.id, e.target.value))}>
                                <option value="">{t`no role`}</option>
                                {roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                              </select>
                              {error !== undefined ? <span className="cn-err">{error}</span> : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ))}
      {orphans.length > 0
        ? (
          <ul className="cn-orphans">
            {orphans.map(({ r }) => (
              <li key={`${r.pipelineId}:${r.stageId}`}>
                <span>{t`Stage ${r.stageId} of pipeline ${r.pipelineId} — ${roleLabel(r.role)}: it is no longer in the CRM`}</span>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(withRole(value, r.pipelineId, r.stageId, ''))}>{t`Remove`}</Button>
              </li>
            ))}
          </ul>
        )
        : null}
    </div>
  )
}
