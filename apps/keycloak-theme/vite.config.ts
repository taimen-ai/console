import react from '@vitejs/plugin-react'
import { keycloakify } from 'keycloakify/vite-plugin'
import { defineConfig } from 'vite'

/**
 * Тема входа Keycloak в дизайн-системе консоли (Keycloakify). `pnpm build-keycloak-theme` —
 * jar для Keycloak 26 (`dist_keycloak/console-keycloak-theme.jar`): тема входа `console`,
 * без темы учётной записи. `pnpm dev` — экраны на моках (`?page=login.ftl` и т. п.).
 */
export default defineConfig({
  plugins: [
    react(),
    keycloakify({
      themeName: 'console',
      accountThemeImplementation: 'none',
      keycloakVersionTargets: { '22-to-25': false, 'all-other-versions': 'console-keycloak-theme.jar' },
    }),
  ],
})
