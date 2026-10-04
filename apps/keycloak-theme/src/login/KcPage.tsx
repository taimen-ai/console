import { Suspense, lazy } from 'react'
import DefaultPage from 'keycloakify/login/DefaultPage'
import { useI18n } from './i18n'
import type { KcContext } from './KcContext'
import { CLASSES } from './classes'
import Template from './Template'
import './theme.css'

const UserProfileFormFields = lazy(() => import('keycloakify/login/UserProfileFormFields'))

/** Страница по `pageId`: страницы Keycloakify в каркасе и классах консоли. */
export default function KcPage({ kcContext }: { kcContext: KcContext }) {
  const { i18n } = useI18n({ kcContext })
  return (
    <Suspense>
      <DefaultPage
        kcContext={kcContext}
        i18n={i18n}
        classes={CLASSES}
        Template={Template}
        doUseDefaultCss={false}
        UserProfileFormFields={UserProfileFormFields}
        doMakeUserConfirmPassword
      />
    </Suspense>
  )
}
