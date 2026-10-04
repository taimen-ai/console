import { defineConfig } from '@lingui/conf'

/**
 * Языки консоли: исходный — английский (основной язык открытой поставки), русский — перевод.
 * Строки пишутся в коде по-английски макросами Lingui; `pnpm i18n:extract` обновляет каталоги,
 * `pnpm i18n:check` падает, если в каком-то языке нет перевода.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'ru'],
  catalogs: [{ path: '<rootDir>/src/locales/{locale}/messages', include: ['<rootDir>/src'] }],
})
