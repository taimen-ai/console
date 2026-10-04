import { i18n } from '@lingui/core'

/**
 * Язык интерфейса. Исходные строки — английские (основной язык открытой поставки), русский —
 * каталог перевода `src/locales/ru/messages.po`. Какие языки предлагать и какой по умолчанию,
 * решает развёртывание (`GET {base}/api/config`); выбор человека помнится в браузере.
 *
 * Порядок выбора: сохранённый выбор → языки браузера → язык по умолчанию развёртывания.
 */
export const LOCALES = ['en', 'ru'] as const
export type Locale = typeof LOCALES[number]

const KEY = 'console.locale'
const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

export function pickLocale(available: readonly string[], fallback: string, languages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages : []): Locale {
  const offered = available.filter(isLocale)
  let saved: string | null = null
  try { saved = localStorage.getItem(KEY) } catch { /* приватное окно */ }
  if (isLocale(saved) && offered.includes(saved)) return saved
  for (const lang of languages) {
    const base = lang.toLowerCase().split('-')[0]
    if (isLocale(base) && offered.includes(base)) return base
  }
  return isLocale(fallback) && offered.includes(fallback) ? fallback : offered[0] ?? 'en'
}

const catalogs: Record<Locale, () => Promise<{ messages: Record<string, unknown> }>> = {
  en: () => import('./locales/en/messages.po'),
  ru: () => import('./locales/ru/messages.po'),
}

/** Загрузить каталог и переключить язык; `<html lang>` — для чтения с экрана и переносов. */
export async function activate(locale: Locale): Promise<void> {
  const { messages } = await catalogs[locale]()
  i18n.loadAndActivate({ locale, messages: messages as never })
  document.documentElement.lang = locale
}

/** Выбор человека: помнится в браузере и применяется сразу. */
export async function chooseLocale(locale: Locale): Promise<void> {
  try { localStorage.setItem(KEY, locale) } catch { /* приватное окно — до перезагрузки */ }
  await activate(locale)
}

export { i18n }
