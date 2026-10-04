import '@console/tokens/tokens.css'
import '@console/ui/styles.css'
import './styles/app.css'
import { I18nProvider } from '@lingui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError, getConfig, getSession, redirectToLogin } from './api/client.ts'
import { activate, i18n, pickLocale, type Locale } from './i18n.ts'
import { launch, router } from './routes.tsx'
import { UiLocale } from './shell/UiLocale.tsx'
import { NotFound, ScreenFailure } from './shell/Failure.tsx'

/**
 * Запуск: конфигурация развёртывания (бренд и языки — из окружения BFF, не из сборки),
 * язык, сессия. Нет сессии — вход через IdP с возвратом на тот же адрес. Тема — по системе
 * (prefers-color-scheme), пока выбора темы в консоли нет.
 */
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof ApiError && (error.kind === 'auth' || error.kind === 'forbidden' || error.kind === 'client')) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
})

router.update({
  ...router.options,
  defaultErrorComponent: ({ error, reset }) => <ScreenFailure error={error} reset={reset} />,
  defaultNotFoundComponent: () => <NotFound />,
})

async function start(): Promise<void> {
  document.documentElement.dataset.density = 'comfortable'
  const config = await getConfig()
  launch.locales = config.locales as Locale[]
  await activate(pickLocale(config.locales, config.defaultLocale))
  await getSession()
  const title = (): void => {
    const leaf = router.state.matches.at(-1)?.staticData.title
    document.title = leaf !== undefined ? `${i18n._(leaf)} — ${config.brand.productName}` : config.brand.productName
  }
  router.subscribe('onResolved', title)
  i18n.on('change', title)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <UiLocale>
          <QueryClientProvider client={client}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </UiLocale>
      </I18nProvider>
    </StrictMode>,
  )
}

start().catch((error: unknown) => {
  if (error instanceof ApiError && error.status === 401) return redirectToLogin()
  // До загрузки каталогов текст — на обоих языках.
  document.getElementById('root')!.textContent = 'The console is unavailable: no connection to the server. Try again later. — Консоль недоступна: нет связи с сервером.'
})
