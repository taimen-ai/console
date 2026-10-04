import type { DecisionStatusRow } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, cpPost } from '../api/client.ts'
import type { Approval } from '../api/types.ts'
import { clock } from '../lib/format.ts'

/**
 * Решение по согласованию: нажатие — ещё не действие. Кнопка сменяется строками состояния
 * («Согласую…» → «Согласовано — записано в ядре»); отказ ядра — словами, с причиной
 * (docs/screens/scenario-421.md, «Нажатие ≠ подтверждённое действие»). Один ключ
 * идемпотентности на нажатие: повтор запроса после обрыва не решит дважды.
 *
 * `review` — приёмка результата («Принять» / «Вернуть»), иначе согласование.
 */
export function useDecision(approvalId: string, review: boolean, onDecided?: () => void) {
  const client = useQueryClient()
  const [rows, setRows] = useState<DecisionStatusRow[] | null>(null)
  const mutation = useMutation({
    mutationFn: ({ verb, comment }: { verb: 'approve' | 'reject', comment?: string }) => cpPost<Approval>(`/approvals/${approvalId}:${verb}`, comment !== undefined && comment.trim() !== '' ? { comment: comment.trim() } : {}, crypto.randomUUID()),
    onMutate: ({ verb }) => {
      onDecided?.()
      setRows([{ state: 'wait', text: verb === 'approve' ? (review ? t`Accepting…` : t`Approving…`) : t`Declining…`, at: clock(new Date()) }])
    },
    onSuccess: (result, { verb }) => {
      setRows([{ state: 'done', text: verb === 'approve' ? (review ? t`Accepted — recorded in the core` : t`Approved — recorded in the core`) : t`Declined — recorded in the core`, at: clock(result.decisionAt ?? new Date()) }])
      void client.invalidateQueries({ queryKey: ['attention'] })
      void client.invalidateQueries({ queryKey: ['approvals'] })
      void client.invalidateQueries({ queryKey: ['task'] })
    },
    onError: (error) => {
      const reason = error instanceof ApiError ? error.detail ?? error.code : ''
      const text = error instanceof ApiError && error.kind === 'client' ? t`The core did not accept the decision: ${reason}` : t`Not sent: no connection to the core`
      setRows([{ state: 'fail', text, at: clock(new Date()) }])
    },
  })
  /** `comment` — причина отказа: уходит исполнителю и в историю работы (`ApprovalDecisionRequest`). */
  return { rows, decide: (verb: 'approve' | 'reject', comment?: string) => mutation.mutate({ verb, ...(comment !== undefined ? { comment } : {}) }), pending: mutation.isPending }
}
