import { t } from '@lingui/core/macro'
import { i18n } from '../i18n.ts'

/**
 * Время и даты первого слоя — через `Intl` на языке интерфейса; фразы — каталогами Lingui
 * (словарь первого слоя — design-system/vocabulary.md и vocabulary.en.md).
 */

const locale = (): string => i18n.locale || 'en'

export const clock = (d: Date | string): string =>
  (typeof d === 'string' ? new Date(d) : d).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

/** «2 октября» / «October 2». */
export const dayMonth = (d: Date | string): string =>
  (typeof d === 'string' ? new Date(d) : d).toLocaleDateString(locale(), { day: 'numeric', month: 'long' })

/** «Сегодня, 2 октября» / «Today, October 2». */
export const todayLabel = (now = new Date()): string => {
  const date = dayMonth(now)
  return t`Today, ${date}`
}

/** Начало сегодняшнего дня по часам браузера. */
export function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** «с 12:37» сегодня, «с 1 октября» раньше. */
export function since(iso: string | null | undefined, now = new Date()): string | undefined {
  if (iso === null || iso === undefined) return undefined
  const d = new Date(iso)
  const when = d >= startOfToday(now) ? clock(d) : dayMonth(d)
  return t`since ${when}`
}

/** «до 18:00» сегодня, «до 3 октября» позже, «просрочено» в прошлом. */
export function due(iso: string | null | undefined, now = new Date()): string | undefined {
  if (iso === null || iso === undefined) return undefined
  const d = new Date(iso)
  if (d < now) return t`overdue`
  const tomorrow = new Date(startOfToday(now).getTime() + 86_400_000)
  const when = d < tomorrow ? clock(d) : dayMonth(d)
  return t`due ${when}`
}

/** «Сегодня», «Вчера» или дата — разделители ленты. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const days = Math.round((startOfToday(now).getTime() - startOfToday(d).getTime()) / 86_400_000)
  if (days === 0) return t`Today`
  if (days === 1) return t`Yesterday`
  return dayMonth(d)
}

/** Кавычки по языку: “…” в английском, «…» в русском (перевод каталога). */
export const quote = (text: string): string => t`“${text}”`
