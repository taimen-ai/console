# Тема входа Keycloak

Страницы входа Keycloak в дизайн-системе консоли: вход, смена временного пароля, сброс пароля,
ошибки, истёкшая страница и прочие страницы темы `login`. Собрана Keycloakify 11 из токенов
(`@console/tokens`) и стилей компонентов (`@console/ui`); светлая и тёмная тема — по системе,
языки — из realm (в том числе русский).

- Каркас страниц — `src/login/Template.tsx` (свой), формы — страницы Keycloakify
  (`keycloakify/login/DefaultPage`) с классами Keycloak, переведёнными в классы дизайн-системы
  (`src/login/classes.ts`); стили Keycloak (PatternFly) не подключаются, своё — `src/login/theme.css`.
- `pnpm --filter @console/keycloak-theme dev` — страницы на моках: `?page=login.ftl`,
  `login-update-password.ftl`, `error.ftl`…; `&lang=ru`, `&error=1`.
- `pnpm --filter @console/keycloak-theme run build-keycloak-theme` — `dist_keycloak/console-keycloak-theme.jar`
  (нужны Maven и JDK 17+).
- `Dockerfile` — образ Keycloak с темой (контекст — корень репозитория консоли); включение —
  `loginTheme: console` у realm.

Тема только для Keycloak: при другом провайдере входа его страницы остаются его.
