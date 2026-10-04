# Console

*English. Russian version: [README.ru.md](README.ru.md)*

The web console of the Taimen organizational runtime. Owners, operators and auditors
see how people, AI agents and processes do the work of the organization, where a
human decision is needed and what has changed — and adjust the rules of the work.

The console is one container: a thin **BFF** (backend for frontend, [Hono](https://hono.dev/)
on Node.js) serves the **SPA** (React) and its API under a common path prefix
(`/console` by default). The browser never holds a platform token: the BFF signs the
person in through an OIDC identity provider, exchanges the login for short-lived
audience tokens in the IAM Service and proxies the SPA's calls to the Control Plane and
the assistant (human harness launcher) on the person's behalf.

Status: `v0.1` — first public release. Screens: Today, Work, a single work item (task),
Knowledge base, package views, Journal, Settings (people, roles, package settings,
connections, secrets) and the assistant panel.

## Layout

| Directory | What |
|---|---|
| `apps/web` | SPA: React 19, Vite, TanStack Router and Query, Lingui |
| `apps/bff` | BFF on Hono: OIDC login + IAM federation, sessions, allow-listed proxy to the Control Plane and the harness, serves the SPA |
| `apps/devstack` | development stand: in-process fakes of the IdP, IAM, Control Plane and harness launcher, with the BFF and Vite on top |
| `apps/e2e` | end-to-end tests (Playwright + axe) against the devstack |
| `apps/keycloak-theme` | optional Keycloak login theme in the console's design ([Keycloakify](https://www.keycloakify.dev/)) |
| `packages/ui` | design-system components in TSX (parity with `design-system/`) |
| `packages/tokens` | CSS variables generated from `design-system/tokens.json` |
| `packages/api` | Control Plane API types from the snapshot `openapi/control-plane.json` |
| `design-system/` | the design system: tokens, component bundle and previews, fonts, icons |

## Quick start (development)

You need Node.js 24 (see `.nvmrc`) and pnpm in the version pinned by `packageManager`
(`corepack enable`).

```bash
pnpm install
pnpm dev
```

The console opens at <http://localhost:5173/console/>. Sign-in goes the full OIDC way
through the devstack's identity provider, which lets you in without a password; the data
is a fictional organization held in memory. `pnpm dev --static` serves the production
build of the SPA through the BFF at <http://localhost:8090/console/> — the same way as the
container image (CSP, `<base>` under the prefix).

Checks before a commit: `pnpm check` — types, lint, unit tests and translation coverage.
End-to-end tests: `pnpm e2e` (install the browser once with
`pnpm --filter @console/e2e exec playwright install chromium`); they build the SPA and run
it behind the real BFF on the devstack, check every screen for console errors and serious
accessibility violations (WCAG 2.1 A/AA), the main actions and a narrow viewport.

## Languages

English is the source language and the default; Russian is a translation. Strings are
written in English in code with Lingui macros; `pnpm --filter @console/web i18n:extract`
updates the catalogs `apps/web/src/locales/{en,ru}/messages.po`, and the translation goes
into the Russian catalog. An untranslated string fails `i18n:check` and the production
build. Built-in labels of design-system components are `en`/`ru` dictionaries in the
components themselves (`LocaleProvider`). Which languages to offer and which one is the
default is set at start-up with `CONSOLE_LOCALES` and `CONSOLE_DEFAULT_LOCALE`.

## Running in production

The image is built from the repository root with the [`Dockerfile`](Dockerfile); the BFF
listens on port `8090`, `GET {prefix}/healthz` is liveness and `GET {prefix}/readyz` is
readiness (the identity provider is reachable). The process runs as uid `10001`; the only
writable path is the session directory `/data/sessions` (mount a volume to keep sessions
across restarts).

The console needs, on the same public origin:

- an **OIDC identity provider** with a confidential client for the console (Keycloak in
  the reference deployment; client id `runtime-console` by default) whose redirect URI is
  `{public origin}{prefix}/_auth/callback` and post-logout redirect URI is
  `{public origin}{prefix}/`;
- the **IAM Service** with this identity provider registered for federation
  (`federation:exchange`), and the tenant id;
- the **Control Plane** API, and optionally the **harness launcher** for the assistant.

Configuration is environment variables only; secrets are files, the environment holds
their paths. The full list with defaults is [`.env.example`](.env.example) and
[`apps/bff/src/config.ts`](apps/bff/src/config.ts); an invalid value stops the start-up
with a clear reason.

| Variable | Default | Meaning |
|---|---|---|
| `CONSOLE_PUBLIC_URL` | — | public origin, e.g. `https://ops.example.com` |
| `CONSOLE_BASE_PATH` | `/console` | path prefix of the console |
| `CONSOLE_COOKIE_SECRET_FILE` | — | file with a random secret of at least 32 bytes (session cookie HMAC, login cookie and session store encryption) |
| `CONSOLE_OIDC_ISSUER` | — | issuer URL of the identity provider |
| `CONSOLE_OIDC_CLIENT_ID` | `runtime-console` | OIDC client id |
| `CONSOLE_OIDC_SECRET_FILE` | — | file with the OIDC client secret |
| `CONSOLE_IAM_URL` | `http://iam-service:8010` | IAM Service |
| `CONSOLE_IAM_TENANT` | — | IAM tenant id |
| `CONSOLE_IDENTITY_PROVIDER` | `keycloak` | identity provider key registered in IAM |
| `CONSOLE_CONTROL_PLANE_URL` | `http://control-plane-api:8000` | Control Plane API |
| `CONSOLE_LAUNCHER_URL` | `http://harness-launcher:8080/harness` | harness launcher (assistant), with its path prefix |
| `CONSOLE_CP_SCOPES` | `control-plane:read control-plane:write` | scope ceiling requested for the Control Plane audience |
| `CONSOLE_SESSION_TTL_HOURS` | `12` | session lifetime |
| `CONSOLE_SESSION_STORE_DIR` | unset (image: `/data/sessions`) | directory of the encrypted session file; unset — memory only |
| `CONSOLE_IDP_ADMIN` | `off` | `keycloak` — "Add person" also creates the user in Keycloak (see below) |
| `CONSOLE_KEYCLOAK_URL`, `CONSOLE_KEYCLOAK_REALM` | derived from the issuer | Keycloak Admin API location |
| `CONSOLE_KEYCLOAK_ADMIN_CLIENT_ID` | `console-people` | service-account client for the Admin API |
| `CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE` | — | its secret, required with `CONSOLE_IDP_ADMIN=keycloak` |
| `CONSOLE_PRODUCT_NAME` | `Console` | product name in the tab title and on the sign-in page |
| `CONSOLE_ORG_NAME` | unset | organization name shown until the Control Plane names the tenant |
| `CONSOLE_LOCALES` | `en,ru` | offered languages |
| `CONSOLE_DEFAULT_LOCALE` | `en` | default language |

Branding and languages are runtime settings served to the SPA by `GET {prefix}/api/config`;
they are not baked into the bundle, so one image serves any deployment.

With `CONSOLE_IDP_ADMIN=keycloak` the console creates the Keycloak user itself when an
administrator adds a person. It uses a dedicated client with a service account and only
the `realm-management` roles `manage-users`, `view-users` and `query-users`. Without it the
administrator enters the `sub` of an existing user, and the console works with any OIDC
provider.

The Control Plane API snapshot used for the BFF allow-list and the client types is
`openapi/control-plane.json`; refresh it with
`node scripts/snapshot-openapi.ts --base <Control Plane URL>`.

In the Taimen umbrella repository the console is the `console` profile of the local
compose file; it depends on the `idp` profile (Keycloak).

## Design

The design system "Taimen Console" — tokens, components and the first-layer vocabulary — is
the only source of visual decisions. Its copy lives in [`design-system/`](design-system/);
where it comes from is described in [`design-system/SOURCE.md`](design-system/SOURCE.md).
The design-system notes are written in Russian.

## Contributing, security, licence

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute (a CLA is required).
- [SECURITY.md](SECURITY.md) — how to report a vulnerability.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [TRADEMARK.md](TRADEMARK.md).

Licensed under the Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Third-party components and their licences are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
