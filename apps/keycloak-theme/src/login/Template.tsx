import { useEffect } from 'react'
import { kcSanitize } from 'keycloakify/lib/kcSanitize'
import type { TemplateProps } from 'keycloakify/login/TemplateProps'
import { getKcClsx } from 'keycloakify/login/lib/kcClsx'
import { useInitialize } from 'keycloakify/login/Template.useInitialize'
import type { I18n } from './i18n'
import type { KcContext } from './KcContext'

/**
 * Каркас всех страниц входа в дизайн-системе консоли: знак и название организации (realm),
 * выбор языка, заголовок страницы, сообщение Keycloak (`message`, его HTML — через
 * `kcSanitize`), сама форма, «Попробовать другой способ», входы через внешних провайдеров и
 * «нет учётной записи». Логика — как у каркаса Keycloakify (`keycloakify/login/Template`),
 * разметка и стили — свои (`theme.css`); стили Keycloak (PatternFly) не подключаются.
 */
/** Страницы, где вводят пароль: под ними — напоминание, куда он уходит. */
const PASSWORD_PAGES = new Set<string>(['login.ftl', 'login-password.ftl', 'login-update-password.ftl', 'register.ftl'])

export default function Template(props: TemplateProps<KcContext, I18n>) {
  const {
    displayInfo = false, displayMessage = true, displayRequiredFields = false, headerNode, socialProvidersNode = null, infoNode = null,
    documentTitle, kcContext, i18n, doUseDefaultCss, classes, children,
  } = props
  const { kcClsx } = getKcClsx({ doUseDefaultCss, classes })
  const { msg, msgStr, advancedMsgStr, currentLanguage, enabledLanguages } = i18n
  const { realm, auth, url, message, isAppInitiatedAction } = kcContext
  // Имя realm может быть ключом `${…}` — тогда оно на языке страницы из текстов локализации realm.
  const org = advancedMsgStr(realm.displayName || realm.name)

  useEffect(() => {
    document.title = documentTitle ?? msgStr('loginTitle', org)
    document.documentElement.lang = currentLanguage.languageTag
  }, [documentTitle, msgStr, org, currentLanguage.languageTag])

  const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss })
  if (!isReadyToRender) return null

  const tone = message?.type === 'error' ? 'error' : message?.type === 'warning' ? 'warning' : message?.type === 'success' ? 'success' : 'info'
  const attempted = auth !== undefined && auth.showUsername && !auth.showResetCredentials

  return (
    <div className="kt">
      <main className="kt-card">
        <header className="kt-head">
          <span className="kt-brand">
            <span className="kt-mark" aria-hidden="true">{org.slice(0, 1).toUpperCase()}</span>
            <span className="kt-org">{org}</span>
          </span>
          {enabledLanguages.length > 1
            ? (
              <nav className="kt-langs" aria-label={msgStr('ktLanguage')}>
                {enabledLanguages.map(({ languageTag, label, href }) => (
                  <a key={languageTag} href={href} lang={languageTag} aria-current={languageTag === currentLanguage.languageTag ? 'true' : undefined}>{label}</a>
                ))}
              </nav>
            )
            : null}
        </header>

        {attempted
          ? (
            <div className="kt-attempted">
              <span className="kt-muted">{msg('ktSignedInAs')}</span>
              <b id="kc-attempted-username">{auth.attemptedUsername}</b>
              <a id="reset-login" href={url.loginRestartFlowUrl}>{msg('restartLoginTooltip')}</a>
            </div>
          )
          : <h1 id="kc-page-title" className="kt-title">{headerNode}</h1>}
        {displayRequiredFields ? <p className="kt-muted kt-required"><span aria-hidden="true">* </span>{msg('requiredFields')}</p> : null}

        {/* Действиям, начатым приложением, предупреждение «нужно завершить действие» не показывается. */}
        {displayMessage && message !== undefined && (message.type !== 'warning' || !isAppInitiatedAction)
          ? (
            <div className={`kt-message kt-message-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
              <span className={kcClsx('kcAlertTitleClass')} dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }} />
            </div>
          )
          : null}

        <div className="kt-body">{children}</div>

        {auth !== undefined && auth.showTryAnotherWayLink
          ? (
            <form id="kc-select-try-another-way-form" action={url.loginAction} method="post" className="kt-another">
              <input type="hidden" name="tryAnotherWay" value="on" />
              <button type="submit" className="kt-linkbtn">{msg('doTryAnotherWay')}</button>
            </form>
          )
          : null}
        {socialProvidersNode}
        {displayInfo ? <div id="kc-info" className="kt-info">{infoNode}</div> : null}
      </main>
      {PASSWORD_PAGES.has(kcContext.pageId) ? <p className="kt-foot kt-muted">{msg('ktSecure')}</p> : null}
    </div>
  )
}
