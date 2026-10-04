import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Button, EmptyState } from '@console/ui'
import { ApiError } from '../api/client.ts'

/**
 * Граница ошибок экрана: сбой одного экрана не роняет каркас — меню, ассистент и связь
 * остаются. Человеку — что случилось и что сделать; технические подробности — в консоли
 * браузера, не на экране.
 */
export function ScreenFailure({ error, reset }: { error: unknown, reset?: () => void }) {
  useLingui()
  const kind = error instanceof ApiError ? error.kind : 'bug'
  const title = kind === 'forbidden' ? t`You have no access to this screen`
    : kind === 'unavailable' ? t`The core is unavailable`
      : kind === 'client' ? t`The core rejected the request`
        : t`Something went wrong on this screen`
  const body = kind === 'forbidden' ? t`Ask the organization owner for access.`
    : kind === 'unavailable' ? t`The data could not be loaded. Try again in a minute.`
      : t`Try again. If it keeps happening, tell your administrator.`
  if (kind === 'bug') console.error(error)
  return (
    <div role="alert">
      <EmptyState title={title} body={body} />
      {reset !== undefined ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" onClick={reset}>{t`Try again`}</Button></div> : null}
    </div>
  )
}

export function NotFound() {
  useLingui()
  return <EmptyState title={t`There is no such screen`} body={t`Check the address or go back to Today.`} />
}
