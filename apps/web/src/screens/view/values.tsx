import { IdentityBlock, StatusMark, type Status } from '@console/ui'
import { t } from '@lingui/core/macro'
import type { ReactNode } from 'react'
import { executorKind } from '../../api/directory.ts'
import type { Principal } from '../../api/types.ts'
import type { ViewFormat } from '../../api/views.ts'
import { i18n } from '../../i18n.ts'
import { due } from '../../lib/format.ts'
import { duration, when } from '../task/history.ts'
import { initials } from '../work/rows.ts'

/**
 * Значение блока вида по формату (docs/views.md, «Значения по формату»). Консоль не знает
 * предметных полей: форму значения задаёт формат, который объявил автор пакета.
 */

const locale = (): string => i18n.locale || 'en'

/** Сумма: строка десятичной записи или число; валюта — ISO 4217. */
export function moneyText(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return typeof value === 'number' ? value.toLocaleString(locale()) : undefined
  const { amount, currency } = value as { amount?: unknown, currency?: unknown }
  const n = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : Number.NaN
  if (Number.isNaN(n)) return undefined
  try {
    return typeof currency === 'string'
      ? n.toLocaleString(locale(), { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 })
      : n.toLocaleString(locale())
  } catch { return n.toLocaleString(locale()) }
}

/** Категория статуса экземпляра или работы → знак дизайн-системы. */
export function statusMark(category: string | undefined): Status {
  switch (category) {
    case 'completed': case 'terminal_success': return 'verified'
    case 'failed': return 'failed'
    case 'waiting_human': return 'waiting_human'
    // Экземпляр приостановлен (`suspended`, ProcessInstanceStatus) — стоит, пока его не продолжат.
    case 'suspended': return 'blocked'
    case 'cancelled': case 'terminal_cancelled': return 'stale'
    case 'blocked': return 'blocked'
    case 'backlog': return 'queued'
    default: return 'running'
  }
}

/** Длительность ISO 8601 (`P1DT2H30M`, `PT90.5S`) в миллисекундах; не разобрать — null. */
export function parseIsoDuration(text: string): number | null {
  const m = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text.trim())
  if (m === null || text.trim() === 'P' || text.trim().endsWith('T')) return null
  const [w, d, h, min, sec] = m.slice(1).map(x => (x === undefined ? 0 : Number(x)))
  return ((((w! * 7 + d!) * 24 + h!) * 60 + min!) * 60 + sec!) * 1000
}

export function formatValue(value: unknown, format: ViewFormat | undefined, people?: Map<string, Principal>): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="tc-muted">—</span>
  switch (format) {
    case 'money': return moneyText(value) ?? String(value)
    case 'number': return typeof value === 'number' ? value.toLocaleString(locale()) : String(value)
    case 'percent': return typeof value === 'number' ? value.toLocaleString(locale(), { style: 'percent', maximumFractionDigits: 1 }) : String(value)
    case 'date': {
      const d = new Date(String(value))
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
    }
    case 'datetime': return when(String(value))
    case 'due': {
      const text = due(String(value))
      return text === t`overdue` ? <span className="vw-overdue">{text}</span> : text ?? String(value)
    }
    case 'duration': {
      // Ядро отдаёт ISO 8601 (`PT5400S`, CP-ADR-0080 А3); число — секунды (прежняя форма стенда).
      const ms = typeof value === 'number' ? value * 1000 : parseIsoDuration(String(value))
      return ms === null ? String(value) : duration(ms)
    }
    case 'principal': {
      const p = people?.get(String(value))
      return p !== undefined ? <IdentityBlock kind={executorKind(p)} name={p.displayName} label={initials(p.displayName)} inline size="sm" /> : <span className="tc-muted">{t`Participant`}</span>
    }
    case 'status': {
      const s = value as { title?: unknown, category?: unknown }
      return <StatusMark status={statusMark(typeof s.category === 'string' ? s.category : undefined)} label={typeof s.title === 'string' ? s.title : ''} />
    }
    case 'link': {
      const l = value as { href?: unknown, title?: unknown }
      // Только http(s) и адреса консоли: ссылка пришла из данных пакета.
      return typeof l.href === 'string' && /^(https?:\/\/|\/)/i.test(l.href)
        ? <a href={l.href} {...(/^https?:/i.test(l.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{typeof l.title === 'string' ? l.title : l.href}</a>
        : String(l.title ?? '')
    }
    default:
      if (typeof value === 'object') return moneyText(value) ?? <span className="tc-muted">…</span>
      return String(value)
  }
}
