import { ProblemCard } from '@console/ui'
import { t } from '@lingui/core/macro'
import type { Artifact, Task, TaskComment, Verification } from '../../api/types.ts'
import { since } from '../../lib/format.ts'
import type { Action } from './TaskActions.tsx'

/**
 * Проблема работы (docs/screens/scenario-421.md, шаг 2): диагноз словами и путь вперёд.
 *
 * Проваленная проверка не закрывает работу: ядро возвращает её исполнителю, и тот берётся
 * снова сам; третий провал подряд останавливает работу в статусе категории `blocked` —
 * она ждёт человека (CP-ADR-0067 §5). Пока работа не остановлена, путь вперёд — передать
 * или снять; остановленную можно ещё и «Повторить как было».
 */

/** Сколько провалов подряд останавливает работу — константа ядра (CP-ADR-0067 §5). */
export const FAILURE_LIMIT = 3

/** Провалы подряд от последней непроваленной попытки; отменённые серию не прерывают. */
export function failuresInRow(verifications: Verification[]): number {
  let n = 0
  for (const v of verifications) {
    if (v.status === 'failed') n += 1
    else if (v.status !== 'cancelled') break
  }
  return n
}

/** Изменилось ли что-то у работы после провала: комментарий или материал (не протокол попытки). */
export function changedAfter(at: string | null | undefined, comments: TaskComment[], artifacts: Artifact[]): boolean {
  if (!at) return false
  return comments.some(c => c.createdAt > at) || artifacts.some(a => a.type !== 'transcript' && a.createdAt > at)
}

interface Props {
  task: Task
  /** Попытки проверки, новые первыми. */
  verifications: Verification[]
  onAction: (action: Action) => void
}

export function Problem({ task, verifications, onAction }: Props) {
  const blocked = task.systemStatusCategory === 'blocked'
  const last = verifications[0]
  const failed = last?.status === 'failed' ? last : undefined
  if (!blocked && failed === undefined) return null

  const row = failed !== undefined ? failuresInRow(verifications) : 0
  const check = failed?.results.find(r => r.status === 'failed')
  const what = check !== undefined ? failed?.checks.find(c => c.key === check.key)?.description ?? check.key : undefined
  const why = check?.message ?? check?.reason
  let diagnosis: string
  if (failed !== undefined && what !== undefined) {
    diagnosis = why !== undefined ? t`Did not pass the check “${what}”: ${why}` : t`Did not pass the check “${what}”`
  } else if (failed !== undefined) {
    diagnosis = t`Did not pass the acceptance check`
  } else {
    diagnosis = t`The work is stopped and waits for a person`
  }
  const limit = FAILURE_LIMIT
  const where = failed === undefined
    ? undefined
    : blocked
      ? t`failures in a row: ${row} — the core stopped the work`
      : row >= limit
        ? t`failures in a row: ${row} — returned to the executor; the next failure stops the work again`
        : t`failure ${row} of ${limit} — the executor retries by itself; after ${limit} the work stops and waits for a person`
  const when = since(failed?.finishedAt)

  return (
    <ProblemCard severity={blocked ? 'blocked' : 'failed'} diagnosis={diagnosis}
      {...(where !== undefined ? { where } : {})} {...(when !== undefined ? { since: when } : {})}
      actions={[
        ...(blocked ? [{ label: t`Retry as it was`, variant: 'secondary' as const, onClick: () => onAction('retry') }] : []),
        { label: t`Hand over`, ...(blocked ? {} : { variant: 'secondary' as const }), onClick: () => onAction('handoff') },
        { label: t`Withdraw`, variant: 'ghost' as const, onClick: () => onAction('cancel') },
      ]} />
  )
}
