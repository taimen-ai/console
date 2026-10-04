import { defineConfig, devices } from '@playwright/test'

/**
 * Сквозные тесты консоли: собранная SPA за настоящим BFF на стенде разработки
 * (`apps/devstack --static`): CSP, `<base>` под префикс, вход OIDC через IdP стенда.
 * Стенд — один на прогон и живёт в памяти, поэтому тесты идут по одному. Перед прогоном
 * нужна сборка веба (`pnpm build`).
 */
const PORT = 8090

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/console/`,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning ../devstack/src/main.ts --static --quiet',
    url: `http://localhost:${PORT}/console/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
