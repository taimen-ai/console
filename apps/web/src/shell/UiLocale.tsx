import { LocaleProvider, type Locale } from '@console/ui'
import { useLingui } from '@lingui/react'
import type { ReactNode } from 'react'

/**
 * Язык компонентов дизайн-системы — тот же, что у интерфейса: встроенные подписи
 * `@console/ui` («Закрыть», «Источник», слова статусов) переключаются вместе с каталогами.
 * Язык передаётся явно — без провайдера компоненты взяли бы язык документа.
 */
export function UiLocale({ children }: { children: ReactNode }) {
  const { i18n } = useLingui()
  return <LocaleProvider locale={(i18n.locale === 'ru' ? 'ru' : 'en') as Locale}>{children}</LocaleProvider>
}
