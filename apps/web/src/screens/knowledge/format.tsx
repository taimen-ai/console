import { t } from '@lingui/core/macro'
import type { ReactNode } from 'react'
import { dayMonth } from '../../lib/format.ts'
import { i18n } from '../../i18n.ts'
import { BASE_PATH } from '../../api/client.ts'
import { enumTitle, parseDay, type AttrSchema, type Entity } from './model.ts'

/** «13 октября», с годом — если не в этом году. */
export function dateText(value: unknown): string {
  const d = parseDay(value)
  if (d === undefined) return String(value)
  return d.getFullYear() === new Date().getFullYear() ? dayMonth(d) : d.toLocaleDateString(i18n.locale || 'en', { day: 'numeric', month: 'long', year: 'numeric' })
}

const MONEY = new Set(['amount', 'costPrice', 'limitAmount'])

/** Значение атрибута по его схеме: даты, деньги в валюте записи, перечисления, списки. */
export function cell(value: unknown, schema: AttrSchema, entity: Entity, key: string): ReactNode {
  if (value === undefined || value === null || value === '') return <span className="tc-muted">—</span>
  if (schema.format === 'date') return dateText(value)
  if (typeof value === 'number') {
    const currency = typeof entity.attributes.currency === 'string' && MONEY.has(key) ? entity.attributes.currency : undefined
    try {
      return currency !== undefined ? value.toLocaleString(i18n.locale || 'en', { style: 'currency', currency, maximumFractionDigits: 0 }) : value.toLocaleString(i18n.locale || 'en')
    } catch { return String(value) }
  }
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'boolean') return value ? t`yes` : t`no`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length === 0 ? <span className="tc-muted">—</span> : entries.map(([k, v]) => `${k}: ${String(v)}`).join('; ')
  }
  return enumTitle(schema, value) ?? String(value)
}

/** Адрес страницы документа: вид и ключ — параметрами (ключ содержит «/» и «:»). */
export const entryHref = (e: Pick<Entity, 'kind' | 'key'>, ws?: string): string =>
  `${BASE_PATH}/knowledge/entry?${new URLSearchParams({ kind: e.kind, key: e.key, ...(ws !== undefined ? { ws } : {}) })}`

/** Источник словами: `git:control-plane` → «git · control-plane», `1c` → «1С». */
export function sourceText(source: string): string {
  if (source === '1c') return '1С'
  if (source === 'manual') return t`entered manually`
  const [system, ...rest] = source.split(':')
  return rest.length > 0 ? `${system} · ${rest.join(':')}` : source
}
