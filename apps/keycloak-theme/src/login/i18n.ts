import { i18nBuilder } from 'keycloakify/login'
import type { ThemeName } from '../kc.gen'

/**
 * Тексты — сообщения Keycloak (его переводы, в том числе ru) и наши: подписи каркаса темы.
 * Языки показа задаёт realm (`internationalizationEnabled`, `supportedLocales`).
 */
// `ofTypeI18n` — только носитель типа (так устроен i18nBuilder Keycloakify).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { useI18n, ofTypeI18n } = i18nBuilder
  .withThemeName<ThemeName>()
  .withCustomTranslations({
    en: {
      ktLanguage: 'Language',
      ktSignedInAs: 'Signing in as',
      ktSecure: 'Your password goes only to the identity provider of the organization.',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      restartLoginTooltip: 'Sign in as someone else',
    },
    ru: {
      ktLanguage: 'Язык',
      ktSignedInAs: 'Вход как',
      ktSecure: 'Пароль уходит только провайдеру входа организации.',
      // В переводах Keycloak их нет — подсказки кнопки «показать пароль» остались бы английскими.
      showPassword: 'Показать пароль',
      hidePassword: 'Скрыть пароль',
      restartLoginTooltip: 'Войти под другим именем',
    },
  })
  .build()

type I18n = typeof ofTypeI18n

export { useI18n, type I18n }
