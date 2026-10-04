import '@console/tokens/tokens.css'
import '@console/ui/styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { KcPage } from './kc.gen'

/**
 * В Keycloak страница получает `window.kcContext` от сервера. На стенде разработки (`pnpm dev`)
 * его нет — контекст строится моком: `?page=login.ftl` (по умолчанию), `login-update-password.ftl`,
 * `error.ftl` и т. п.; `&error=1` — с сообщением об ошибке, `&lang=ru` — по-русски.
 */
async function devContext() {
  const { getKcContextMock } = await import('./login/mocks/getKcContextMock')
  const q = new URLSearchParams(location.search)
  const lang = q.get('lang') ?? 'en'
  const pageId = (q.get('page') ?? 'login.ftl') as Parameters<typeof getKcContextMock>[0]['pageId']
  return getKcContextMock({
    pageId,
    overrides: {
      locale: { currentLanguageTag: lang },
      ...(q.get('error') !== null ? { message: { type: 'error', summary: lang === 'ru' ? 'Неверное имя пользователя или пароль.' : 'Invalid username or password.' } } : {}),
    },
  })
}

const kcContext = window.kcContext ?? (import.meta.env.DEV ? await devContext() : undefined)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {kcContext !== undefined ? <KcPage kcContext={kcContext} /> : <p>No Keycloak context.</p>}
  </StrictMode>,
)
