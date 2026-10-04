import { Button, Consequences, Dialog, Field } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useState } from 'react'

/**
 * Подтверждение отказа (решение владельца 2026-10-03): «Отклонить» и «Вернуть» — с причиной.
 * Отказ необратим, а причина — то, что исполнитель получит вместо результата: она уходит в
 * решение ядра (`comment`) и видна в истории работы. «Согласовать» и «Принять» — в один клик.
 */
export function DeclineDialog({ title, review, onConfirm, onClose }: { title: string, review: boolean, onConfirm: (reason: string) => void, onClose: () => void }) {
  const [reason, setReason] = useState('')
  const ready = reason.trim() !== ''
  return (
    <Dialog alert title={review ? t`Return the work?` : t`Decline?`} sub={title} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t`Cancel`}</Button><Button variant="danger" disabled={!ready} onClick={() => { onConfirm(reason.trim()); onClose() }}>{review ? t`Return` : t`Decline`}</Button></>}>
      <div className="tc-form">
        <Field label={review ? t`What to fix` : t`Why`} wide help={t`Required: the executor gets it instead of the result; it stays in the history of the work.`}>
          <textarea className="tc-textarea" rows={3} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
      </div>
      <Consequences items={review
        ? [
            { tone: 'warn', k: t`The result`, v: t`is not accepted; the work goes back to the executor with your note` },
            { tone: 'info', k: t`Reversible`, v: t`the decision is not — the executor hands in again` },
          ]
        : [
            { tone: 'warn', k: t`The request`, v: t`is declined; what waited for it does not go on` },
            { tone: 'info', k: t`Reversible`, v: t`no — a new approval is requested again` },
          ]} />
    </Dialog>
  )
}
