import { t } from '@lingui/core/macro'
import { pointerKey } from '../forms/schema.ts'
import { ApiError } from './client.ts'

/**
 * Ошибки ядра по полям — одна форма на платформу (CP-ADR-0081, TAI-ADR-0068):
 * `details.errors[{path, code?, message?}]`, `path` — JSON Pointer, без значения поля.
 * Так отвечают `validation_error`, `settings_invalid`, `invalid_connection_settings`,
 * `unknown_ref` и `secret_material_rejected`. Прежняя форма отказа из-за секрета
 * (`details.path`, CP-ADR-0079) тоже понимается. Ключ — путь без ведущего `/`
 * (`approvalThreshold`, `profile/email`); `strip` срезает префикс (`profile/`).
 */
export function pathErrors(error: unknown, strip = ''): Record<string, string> {
  if (!(error instanceof ApiError) || error.details === undefined) return {}
  const key = (path: string): string => {
    const k = pointerKey(path)
    return strip !== '' && k.startsWith(strip) ? k.slice(strip.length) : k
  }
  const text = (e: { code?: string, message?: string }): string =>
    e.message ?? (error.code === 'secret_material_rejected' ? t`looks like a secret` : error.code === 'unknown_ref' ? t`no such object in the organization` : e.code ?? error.code)
  const out: Record<string, string> = {}
  if (Array.isArray(error.details.errors)) {
    for (const e of error.details.errors as { path?: unknown, code?: string, message?: string }[]) if (typeof e.path === 'string') out[key(e.path)] = text(e)
  }
  if (typeof error.details.path === 'string' && out[key(error.details.path)] === undefined) out[key(error.details.path)] = text({})
  return out
}
