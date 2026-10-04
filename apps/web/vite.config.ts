import { lingui } from '@lingui/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Разработка: SPA под `/console/`, API и вход — в BFF стенда (`pnpm dev` в корне). Сборка —
 * с относительной базой: префикс пути задаётся при запуске, BFF вписывает его в `<base>`.
 */
const BFF = 'http://127.0.0.1:8090'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/console/',
  // Каталоги .po компилируются при импорте; макросы Lingui — без Babel. Нет перевода — сборка падает.
  plugins: [react(), lingui({ macroTransform: true, failOnMissing: command === 'build' })],
  server: {
    proxy: {
      '/console/api': { target: BFF, ws: true },
      '/console/_auth': { target: BFF },
      '/console/healthz': { target: BFF },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, assetsDir: 'assets', sourcemap: true },
}))
