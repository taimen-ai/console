import { createGetKcContextMock } from 'keycloakify/login/KcContext'
import { kcEnvDefaults, themeNames } from '../../kc.gen'
import type { KcContextExtension, KcContextExtensionPerPage } from '../KcContext'

/** Контекст страниц для разработки и тестов — как его отдал бы Keycloak. */
const kcContextExtension: KcContextExtension = { themeName: themeNames[0]!, properties: { ...kcEnvDefaults } }
const kcContextExtensionPerPage: KcContextExtensionPerPage = {}

export const { getKcContextMock } = createGetKcContextMock({
  kcContextExtension,
  kcContextExtensionPerPage,
  overrides: {
    realm: { displayName: 'Console', displayNameHtml: 'Console', internationalizationEnabled: true },
    locale: {
      currentLanguageTag: 'en',
      supported: [{ languageTag: 'en', label: 'English', url: '?kc_locale=en' }, { languageTag: 'ru', label: 'Русский', url: '?kc_locale=ru' }],
    },
  },
  overridesPerPage: {},
})
