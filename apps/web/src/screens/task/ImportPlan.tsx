import { Button, DecisionStatus, type DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, cpGet } from '../../api/client.ts'
import { useMe } from '../../api/directory.ts'
import type { Approval, Artifact, Task } from '../../api/types.ts'
import { clock } from '../../lib/format.ts'
import { FILE_TYPE, PLAN_TYPE, planImport, planLine, type Plan } from '../knowledge/importFlow.ts'

/**
 * План загрузки таблицы на странице работы `knowledge-import` (docs/screens/task.md): что
 * откроется, изменится и закроется, строки с ошибками. «Построить план заново» — когда
 * поток прервался до плана или база изменилась с плана (исход решения `stale`): тот же файл,
 * новый план, новое решение. Пока решение ждёт — заново не строится: план, на который
 * смотрит решающий, менять под ним нельзя.
 */

const ROW_ERRORS_SHOWN = 50

export function ImportPlan({ task, artifacts, approvals }: { task: Task, artifacts: Artifact[], approvals: Approval[] }) {
  const client = useQueryClient()
  const me = useMe().data?.principal.id
  const plans = artifacts.filter(a => a.type === PLAN_TYPE).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const latest = plans[0]
  const file = artifacts.filter(a => a.type === FILE_TYPE).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const plan = useQuery({
    queryKey: ['artifact', latest?.id, 'content'], enabled: latest !== undefined, staleTime: Infinity,
    queryFn: ({ signal }) => cpGet<Plan>(`/artifacts/${latest!.id}/content`, signal),
  })
  const [rows, setRows] = useState<DecisionStatusRow[]>([])
  const [busy, setBusy] = useState(false)
  const open = !task.systemStatusCategory.startsWith('terminal')
  const waiting = approvals.some(a => a.status === 'pending')
  const canReplan = open && !waiting && file !== undefined && me !== undefined

  const replan = async (): Promise<void> => {
    if (!canReplan) return
    setBusy(true)
    setRows([])
    const step = (text: string, state: 'wait' | 'done' = 'wait'): void => setRows(r => [...r.filter(x => x.state !== 'wait'), { state, text, at: clock(new Date()) }])
    try {
      const current = await cpGet<Task>(`/tasks/${task.id}`)
      await planImport(current, file.id, file.name, me, step)
    } catch (error) {
      const reason = error instanceof ApiError ? error.detail ?? error.code : t`no connection to the core`
      setRows(r => [...r.filter(x => x.state !== 'wait'), { state: 'fail', text: t`Plan not built: ${reason}`, at: clock(new Date()) }])
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: ['task'] })
      void client.invalidateQueries({ queryKey: ['artifacts', 'task', task.id] })
      void client.invalidateQueries({ queryKey: ['approvals', 'task', task.id] })
      void client.invalidateQueries({ queryKey: ['attention'] })
    }
  }

  const p = plan.data
  const errors = p?.rowErrors ?? []
  return (
    <div className="tk-plan">
      {latest === undefined
        ? <p className="tc-muted">{file === undefined ? t`No file is attached to the work.` : t`The plan is not built yet.`}</p>
        : p === undefined
          ? <p className="tc-muted">{plan.isError ? t`Could not read the plan.` : t`Reading the plan…`}</p>
          : (
            <>
              <p className="tk-plan-line">{planLine(p)}</p>
              <dl className="tc-props tk-plan-counts">
                <dt>{t`New`}</dt><dd>{p.counts.opened ?? 0}</dd>
                <dt>{t`Changed`}</dt><dd>{p.counts.changed ?? 0}</dd>
                <dt>{t`Closed`}</dt><dd>{p.counts.closed ?? 0}</dd>
                <dt>{t`Unchanged`}</dt><dd>{p.counts.unchanged ?? 0}</dd>
                <dt>{t`Rows in the file`}</dt><dd>{p.rows}</dd>
                {(p.conflicts?.length ?? 0) > 0 ? <><dt>{t`Key conflicts`}</dt><dd>{p.conflicts!.length}</dd></> : null}
              </dl>
              {errors.length > 0
                ? (
                  <table className="tk-plan-errors">
                    <caption>{t`Rows with errors — fix them in the file and load it again`}</caption>
                    <thead><tr><th scope="col">{t`Row`}</th><th scope="col">{t`Column`}</th><th scope="col">{t`What is wrong`}</th></tr></thead>
                    <tbody>
                      {errors.slice(0, ROW_ERRORS_SHOWN).map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.column ?? '—'}</td><td>{e.message}</td></tr>)}
                    </tbody>
                  </table>
                )
                : null}
              {errors.length > ROW_ERRORS_SHOWN ? <p className="tc-muted">{t`And ${errors.length - ROW_ERRORS_SHOWN} more rows with errors.`}</p> : null}
              {p.truncated === true ? <p className="tc-muted">{t`The lists of keys are shortened; the counts are full.`}</p> : null}
            </>
          )}
      {open && file !== undefined
        ? (
          <div className="tk-plan-actions">
            <Button variant="secondary" size="sm" disabled={!canReplan || busy} onClick={() => void replan()}
              title={waiting ? t`A decision on the current plan is pending` : undefined}>{latest === undefined ? t`Build the plan` : t`Build the plan again`}</Button>
            <span className="tc-muted">{waiting ? t`A decision on the current plan is pending — decide or cancel it first.` : t`The same file, checked against the knowledge base as it is now.`}</span>
          </div>
        )
        : null}
      {rows.length > 0 ? <DecisionStatus rows={rows} /> : null}
    </div>
  )
}
