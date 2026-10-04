# Консоль

*Русская версия. English: [README.md](README.md)*

Веб-консоль организационного runtime Taimen: владелец, оператор и аудитор видят, как
работают люди, агенты и процессы, где нужно решение человека и что изменилось, — и
настраивают правила работы.

Консоль — один контейнер: тонкий **BFF** (backend for frontend, [Hono](https://hono.dev/)
на Node.js) отдаёт **SPA** (React) и её API под общим префиксом пути (по умолчанию
`/console`). Токенов платформы в браузере нет: BFF проводит вход человека через OIDC IdP,
обменивает вход на короткоживущие токены audience в IAM Service и проксирует вызовы SPA к
Control Plane и ассистенту (launcher харнесса человека) от имени этого человека.

Статус: `v0.1` — первый публичный выпуск. Экраны: «Сегодня», «Работа», одна работа
(задача), «База знаний», экраны пакетов, «Журнал», «Настройки» (люди, роли, настройки
пакетов, подключения, секреты) и панель ассистента.

## Раскладка

| Каталог | Что |
|---|---|
| `apps/web` | SPA: React 19, Vite, TanStack Router и Query, Lingui |
| `apps/bff` | BFF на Hono: вход OIDC + federation IAM, сессии, прокси к ядру и харнессу по allow-list, отдача SPA |
| `apps/devstack` | стенд разработки: заглушки IdP, IAM, ядра и launcher'а в процессе, поверх них BFF и Vite |
| `apps/e2e` | сквозные тесты (Playwright + axe) на стенде разработки |
| `apps/keycloak-theme` | необязательная тема входа Keycloak в дизайне консоли ([Keycloakify](https://www.keycloakify.dev/)) |
| `packages/ui` | компоненты дизайн-системы на TSX (паритет с `design-system/`) |
| `packages/tokens` | CSS-переменные из `design-system/tokens.json` |
| `packages/api` | типы API ядра из снимка `openapi/control-plane.json` |
| `design-system/` | дизайн-система: токены, бандл и превью компонентов, шрифты, иконки |

## Быстрый старт (разработка)

Нужны Node.js 24 (см. `.nvmrc`) и pnpm версии из `packageManager` (`corepack enable`).

```bash
pnpm install
pnpm dev
```

Консоль — <http://localhost:5173/console/>: вход идёт полным путём OIDC через IdP стенда
разработки, без пароля; данные — вымышленная организация в памяти. `pnpm dev --static` —
собранная SPA через BFF на <http://localhost:8090/console/>, как в образе (CSP, `<base>`
под префикс).

Проверки перед коммитом — `pnpm check`: типы, линтер, модульные тесты и полнота
переводов. Сквозные тесты — `pnpm e2e` (браузер — один раз
`pnpm --filter @console/e2e exec playwright install chromium`): собранная SPA за настоящим
BFF на стенде разработки, каждый экран без ошибок в консоли браузера и без серьёзных
нарушений доступности (WCAG 2.1 A/AA), основные действия, узкая ширина.

## Языки

Английский — исходный язык и язык по умолчанию, русский — перевод. Строки пишутся в коде
по-английски макросами Lingui; `pnpm --filter @console/web i18n:extract` обновляет каталоги
`apps/web/src/locales/{en,ru}/messages.po`, перевод вписывается в русский каталог.
Непереведённая строка роняет `i18n:check` и боевую сборку. Встроенные подписи компонентов
дизайн-системы — словари `en`/`ru` в самих компонентах (`LocaleProvider`). Какие языки
предлагать и какой по умолчанию — `CONSOLE_LOCALES` и `CONSOLE_DEFAULT_LOCALE` при запуске.

## Запуск в эксплуатации

Образ собирается из корня репозитория по [`Dockerfile`](Dockerfile); BFF слушает порт
`8090`, `GET {префикс}/healthz` — живость, `GET {префикс}/readyz` — готовность (IdP
доступен). Процесс работает под uid `10001`; писать он может только в каталог сессий
`/data/sessions` (том на нём сохраняет вход через перезапуск).

Консоли нужны на том же публичном origin:

- **OIDC IdP** с confidential-клиентом консоли (в эталонной поставке — Keycloak, client id
  по умолчанию `runtime-console`), redirect URI `{origin}{префикс}/_auth/callback`, адрес
  после выхода `{origin}{префикс}/`;
- **IAM Service**, в котором этот IdP заведён для federation (`federation:exchange`), и id
  tenant'а;
- API **Control Plane** и, для ассистента, **launcher харнесса**.

Конфигурация — только переменные окружения; секреты — файлами, в окружении — пути к ним.
Полный список со значениями по умолчанию — [`.env.example`](.env.example) и
[`apps/bff/src/config.ts`](apps/bff/src/config.ts), таблица — в [README.md](README.md).
Неверное значение останавливает запуск с понятной причиной.

Бренд (`CONSOLE_PRODUCT_NAME`, `CONSOLE_ORG_NAME`) и языки — настройки запуска: SPA получает
их из `GET {префикс}/api/config`, в бандл они не печатаются, один образ годится для любой
поставки.

С `CONSOLE_IDP_ADMIN=keycloak` консоль сама заводит пользователя Keycloak, когда
администратор добавляет человека: служебным клиентом с service account и только ролями
`realm-management` `manage-users`, `view-users`, `query-users`. Без этого администратор
вводит `sub` готового пользователя, и консоль работает с любым OIDC IdP.

Снимок API ядра для allow-list BFF и типов клиента — `openapi/control-plane.json`;
обновляет его `node scripts/snapshot-openapi.ts --base <адрес Control Plane>`.

В umbrella-репозитории Taimen консоль — профиль `console` локального compose; он тянет
профиль `idp` (Keycloak).

## Дизайн

Дизайн-система «Taimen Console» — токены, компоненты, словарь первого слоя — единственный
источник визуальных решений. Копия — [`design-system/`](design-system/), откуда она и что
изменено — [`design-system/SOURCE.md`](design-system/SOURCE.md).

## Участие, безопасность, лицензия

- [CONTRIBUTING.md](CONTRIBUTING.md) — как предложить изменение (нужно подписать CLA).
- [SECURITY.md](SECURITY.md) — как сообщить об уязвимости.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [TRADEMARK.md](TRADEMARK.md).

Лицензия — Apache 2.0, см. [LICENSE](LICENSE) и [NOTICE](NOTICE). Сторонние компоненты и их
лицензии — [THIRD_PARTY.md](THIRD_PARTY.md).
