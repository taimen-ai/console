import type { ReactNode } from 'react'
import type { ViewFormat } from '../../api/views.ts'
import { formatValue } from './values.tsx'

/**
 * Блок `chart` экрана пакета: столбцы, линия или кольцо по точкам `{label, value}`
 * (docs/views.md). Подписи и значения — текстом рядом с фигурой: экранный диктор читает
 * список, а сама фигура (`aria-hidden`) — только для глаза. Цвета — токены дизайн-системы.
 */

export interface ChartPoint { label: string, value: unknown }

const COLORS = ['var(--brand)', 'var(--accent)', 'var(--status-verified)', 'var(--status-blocked)', 'var(--status-running)', 'var(--text-muted)']

/** Число для фигуры: сумма `money` или число; прочее — 0. */
export function numeric(value: unknown): number {
  if (typeof value === 'number') return value
  if (value !== null && typeof value === 'object') {
    const amount = (value as { amount?: unknown }).amount
    const n = typeof amount === 'number' ? amount : Number(amount)
    return Number.isFinite(n) ? n : 0
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function Chart({ type, title, format, points }: { type: string, title?: string, format?: ViewFormat, points: ChartPoint[] }) {
  const values = points.map(p => numeric(p.value))
  const max = Math.max(...values, 0)
  const total = values.reduce((s, v) => s + v, 0)
  const legend = (
    <ul className="vw-chart-legend">
      {points.map((p, i) => (
        <li key={i}>
          {type !== 'bar' ? <span className="vw-chart-swatch" aria-hidden="true" style={{ background: COLORS[i % COLORS.length] }} /> : null}
          <span className="vw-chart-label">{p.label}</span>
          {type === 'bar' ? <span className="vw-chart-track" aria-hidden="true"><span style={{ width: `${max > 0 ? (values[i]! / max) * 100 : 0}%` }} /></span> : null}
          <span className="vw-chart-value">{formatValue(p.value, format)}</span>
        </li>
      ))}
    </ul>
  )

  let figure: ReactNode = null
  if (type === 'line' && points.length > 1) {
    const w = 600, h = 140
    const xy = values.map((v, i) => `${(i / (points.length - 1)) * w},${h - (max > 0 ? (v / max) * (h - 10) : 0) - 5}`).join(' ')
    figure = <svg className="vw-chart-line" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={xy} fill="none" stroke="var(--brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
  } else if (type === 'donut' && total > 0) {
    const r = 15.915 // длина окружности ≈ 100
    const shares = values.map(v => (v / total) * 100)
    // Смещение доли — 25 (начало сверху) минус сумма предыдущих долей.
    const offsets = shares.map((_, i) => 25 - shares.slice(0, i).reduce((s, x) => s + x, 0))
    figure = (
      <svg className="vw-chart-donut" viewBox="0 0 42 42" aria-hidden="true">
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--border-subtle)" strokeWidth="6" />
        {shares.map((share, i) => (
          <circle key={i} cx="21" cy="21" r={r} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="6" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={offsets[i]} />
        ))}
      </svg>
    )
  }

  return (
    <figure className={`vw-chart vw-chart-${type}`}>
      {title !== undefined ? <figcaption className="vw-chart-title">{title}</figcaption> : null}
      {figure}
      {legend}
    </figure>
  )
}
