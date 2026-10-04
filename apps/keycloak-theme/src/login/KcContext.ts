/* eslint-disable @typescript-eslint/no-empty-object-type -- форма расширения контекста Keycloakify */
import type { ExtendKcContext } from 'keycloakify/login'
import type { KcEnvName, ThemeName } from '../kc.gen'

/** Контекст страницы, который Keycloak кладёт в `window.kcContext` (своих полей тема не добавляет). */
export type KcContextExtension = { themeName: ThemeName, properties: Record<KcEnvName, string> & {} }
export type KcContextExtensionPerPage = {}
export type KcContext = ExtendKcContext<KcContextExtension, KcContextExtensionPerPage>
