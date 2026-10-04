/**
 * Конфигурация BFF — только окружение и файлы секретов (секреты читаются из файлов, в
 * окружении — пути к ним). Окружение проверяется схемой при старте: неверное значение —
 * отказ запуска с понятной причиной, а не сбой на первом запросе. Бренд и языки отдаются
 * SPA при запуске (`GET {base}/api/config`), а не печатаются в бандл (CON-ADR-0001, п. 4).
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'
import { MIN_COOKIE_SECRET_BYTES } from './crypto.ts'

/**
 * Audiences, в которые консоль обменивает вход человека. `iam` — управление людьми (scope
 * `iam:people`): IAM выдаёт его только членам группы администраторов людей.
 */
export type Audience = 'control-plane' | 'human-harness' | 'iam'

/** Языки интерфейса. Английский — основной язык открытой поставки. */
export const LOCALES = ['en', 'ru'] as const
export type Locale = typeof LOCALES[number]

export interface Brand {
  /** Имя продукта — заголовок вкладки и страницы входа. */
  productName: string
  /** Название организации в строке состояния, пока ядро не назвало tenant. */
  orgName: string | null
}

export interface Config {
  host: string
  port: number
  /** Публичный origin без пути, например `https://cp.example.com`. */
  publicOrigin: string
  /** Префикс пути консоли без завершающего `/`, например `/console`; `''` — корень. */
  basePath: string
  secureCookies: boolean
  /** Секрет cookie (≥32 байт): из него выводятся ключ HMAC сессии и ключ AES-GCM cookie входа. */
  cookieKey: Buffer
  sessionTtlMs: number
  /** Каталог, где сессии переживают перезапуск (зашифрованный файл); null — только память. */
  sessionStoreDir: string | null
  oidc: {
    issuer: string
    clientId: string
    clientSecret: string
    scopes: string
    redirectUri: string
    postLogoutRedirectUri: string
  }
  iam: { url: string, tenantId: string, identityProvider: string }
  /**
   * Заводить пользователя у провайдера входа при «Добавить человека» (`idp-admin.ts`); null —
   * выключено, администратор вводит `sub` готового пользователя.
   */
  idpAdmin: { kind: 'keycloak', url: string, realm: string, clientId: string, secret: string } | null
  upstreams: { controlPlane: string, launcher: string }
  /** Scope, которые явно запрашиваются у federation по каждому audience. */
  scopes: Record<Audience, string[]>
  openapiDir: string
  /** Сборка SPA; null — BFF отдаёт только API и вход (разработка идёт через Vite). */
  staticDir: string | null
  bodyLimitBytes: number
  uploadLimitBytes: number
  brand: Brand
  /** Языки, которые предлагает консоль, и язык по умолчанию. */
  locales: Locale[]
  defaultLocale: Locale
}

const HERE = dirname(fileURLToPath(import.meta.url))

export class ConfigError extends Error {
  constructor(message: string) { super(`console-bff: ${message}`) }
}

const url = v.pipe(v.string(), v.url())
const port = v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(65_535))
const positive = v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(1))
const optional = <T extends v.GenericSchema<string, unknown>>(schema: T, fallback: string) =>
  v.pipe(v.optional(v.string(), fallback), v.transform(s => s === '' ? fallback : s), schema)

/** Схема окружения: имя переменной → проверка и значение по умолчанию. */
const Env = v.object({
  CONSOLE_PUBLIC_URL: url,
  CONSOLE_BASE_PATH: optional(v.pipe(v.string(), v.regex(/^(\/[A-Za-z0-9_-]+)*\/?$/, 'путь из латиницы, цифр, «-» и «_»')), '/console'),
  CONSOLE_HOST: optional(v.string(), '0.0.0.0'),
  CONSOLE_PORT: optional(port, '8090'),
  CONSOLE_COOKIE_SECRET_FILE: v.pipe(v.string(), v.minLength(1)),
  CONSOLE_SESSION_TTL_HOURS: optional(positive, '12'),
  CONSOLE_SESSION_STORE_DIR: v.optional(v.string()),
  CONSOLE_OIDC_ISSUER: url,
  CONSOLE_OIDC_CLIENT_ID: optional(v.string(), 'runtime-console'),
  CONSOLE_OIDC_SECRET_FILE: v.pipe(v.string(), v.minLength(1)),
  // Без offline_access: refresh token, привязанный к сессии IdP, Keycloak выдаёт и так.
  CONSOLE_OIDC_SCOPES: optional(v.string(), 'openid profile email'),
  CONSOLE_IAM_URL: optional(url, 'http://iam-service:8010'),
  CONSOLE_IAM_TENANT: v.pipe(v.string(), v.minLength(1, 'IAM tenant обязателен (UUID из bootstrap)')),
  CONSOLE_IDENTITY_PROVIDER: optional(v.string(), 'keycloak'),
  // Пользователь у IdP заводится консолью: только Keycloak; пусто — выключено.
  CONSOLE_IDP_ADMIN: optional(v.picklist(['', 'off', 'keycloak']), 'off'),
  // Admin API Keycloak: по умолчанию — из issuer (`…/realms/<realm>`); внутри сети — адрес контейнера.
  CONSOLE_KEYCLOAK_URL: v.optional(v.string()),
  CONSOLE_KEYCLOAK_REALM: v.optional(v.string()),
  CONSOLE_KEYCLOAK_ADMIN_CLIENT_ID: optional(v.string(), 'console-people'),
  CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE: v.optional(v.string()),
  CONSOLE_CONTROL_PLANE_URL: optional(url, 'http://control-plane-api:8000'),
  // Launcher смонтирован под префиксом (/harness) и ждёт его в пути — адрес с префиксом.
  CONSOLE_LAUNCHER_URL: optional(url, 'http://harness-launcher:8080/harness'),
  // Права по делу решает ядро (binding); scope — потолок токена.
  CONSOLE_CP_SCOPES: optional(v.string(), 'control-plane:read control-plane:write'),
  CONSOLE_OPENAPI_DIR: optional(v.string(), join(HERE, '..', '..', '..', 'openapi')),
  CONSOLE_STATIC_DIR: v.optional(v.string()),
  CONSOLE_BODY_LIMIT_BYTES: optional(positive, String(4 * 1024 * 1024)),
  /** Файл в хранилище артефактов (`PUT /artifact-contents`): таблицы и документы больше JSON-тел. */
  CONSOLE_UPLOAD_LIMIT_BYTES: optional(positive, String(25 * 1024 * 1024)),
  CONSOLE_PRODUCT_NAME: optional(v.string(), 'Console'),
  CONSOLE_ORG_NAME: v.optional(v.string()),
  CONSOLE_LOCALES: optional(v.string(), LOCALES.join(',')),
  CONSOLE_DEFAULT_LOCALE: optional(v.picklist(LOCALES), 'en'),
})

const trim = (s: string): string => s.replace(/\/+$/, '')
const words = (value: string): string[] => value.split(/[\s,]+/).filter(Boolean)

/** `/console/` → `/console`, `/` → `''`. */
export function normalizeBasePath(raw: string): string {
  const path = `/${raw.replace(/^\/+|\/+$/g, '')}`
  return path === '/' ? '' : path
}

function secret(path: string, name: string): string {
  let value: string
  try { value = readFileSync(path, 'utf8').trim() } catch { throw new ConfigError(`файл из ${name} не читается`) }
  if (value === '') throw new ConfigError(`файл из ${name} пуст`)
  return value
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = v.safeParse(Env, env)
  if (!parsed.success) {
    const issues = parsed.issues.map(i => `${v.getDotPath(i) ?? '?'}: ${i.message}`).join('; ')
    throw new ConfigError(`окружение не прошло проверку — ${issues}`)
  }
  const e = parsed.output
  const cookieKey = Buffer.from(secret(e.CONSOLE_COOKIE_SECRET_FILE, 'CONSOLE_COOKIE_SECRET_FILE'), 'utf8')
  if (cookieKey.length < MIN_COOKIE_SECRET_BYTES) throw new ConfigError(`секрет cookie короче ${MIN_COOKIE_SECRET_BYTES} байт`)
  const locales = words(e.CONSOLE_LOCALES)
  const unknown = locales.filter(l => !(LOCALES as readonly string[]).includes(l))
  if (unknown.length > 0 || locales.length === 0) throw new ConfigError(`CONSOLE_LOCALES: известны только ${LOCALES.join(', ')}`)
  if (!locales.includes(e.CONSOLE_DEFAULT_LOCALE)) throw new ConfigError('CONSOLE_DEFAULT_LOCALE должен быть среди CONSOLE_LOCALES')
  const publicOrigin = new URL(e.CONSOLE_PUBLIC_URL).origin
  const basePath = normalizeBasePath(e.CONSOLE_BASE_PATH)
  let idpAdmin: Config['idpAdmin'] = null
  if (e.CONSOLE_IDP_ADMIN === 'keycloak') {
    const issuer = /^(.*)\/realms\/([^/]+)\/?$/.exec(trim(e.CONSOLE_OIDC_ISSUER))
    const url = e.CONSOLE_KEYCLOAK_URL !== undefined && e.CONSOLE_KEYCLOAK_URL !== '' ? e.CONSOLE_KEYCLOAK_URL : issuer?.[1]
    const realm = e.CONSOLE_KEYCLOAK_REALM !== undefined && e.CONSOLE_KEYCLOAK_REALM !== '' ? e.CONSOLE_KEYCLOAK_REALM : issuer?.[2]
    if (url === undefined || realm === undefined) throw new ConfigError('CONSOLE_IDP_ADMIN=keycloak: задайте CONSOLE_KEYCLOAK_URL и CONSOLE_KEYCLOAK_REALM (issuer не вида …/realms/<realm>)')
    if (!v.safeParse(v.pipe(v.string(), v.url()), url).success) throw new ConfigError('CONSOLE_KEYCLOAK_URL: не адрес')
    if (e.CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE === undefined || e.CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE === '') throw new ConfigError('CONSOLE_IDP_ADMIN=keycloak: нужен CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE')
    idpAdmin = { kind: 'keycloak', url: trim(url), realm, clientId: e.CONSOLE_KEYCLOAK_ADMIN_CLIENT_ID, secret: secret(e.CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE, 'CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE') }
  }
  return {
    host: e.CONSOLE_HOST,
    port: e.CONSOLE_PORT,
    publicOrigin,
    basePath,
    secureCookies: publicOrigin.startsWith('https://'),
    cookieKey,
    sessionTtlMs: e.CONSOLE_SESSION_TTL_HOURS * 3_600_000,
    sessionStoreDir: e.CONSOLE_SESSION_STORE_DIR !== undefined && e.CONSOLE_SESSION_STORE_DIR !== '' ? resolve(e.CONSOLE_SESSION_STORE_DIR) : null,
    oidc: {
      issuer: trim(e.CONSOLE_OIDC_ISSUER),
      clientId: e.CONSOLE_OIDC_CLIENT_ID,
      clientSecret: secret(e.CONSOLE_OIDC_SECRET_FILE, 'CONSOLE_OIDC_SECRET_FILE'),
      scopes: e.CONSOLE_OIDC_SCOPES,
      redirectUri: `${publicOrigin}${basePath}/_auth/callback`,
      postLogoutRedirectUri: `${publicOrigin}${basePath}/`,
    },
    iam: { url: trim(e.CONSOLE_IAM_URL), tenantId: e.CONSOLE_IAM_TENANT, identityProvider: e.CONSOLE_IDENTITY_PROVIDER },
    idpAdmin,
    upstreams: { controlPlane: trim(e.CONSOLE_CONTROL_PLANE_URL), launcher: trim(e.CONSOLE_LAUNCHER_URL) },
    scopes: { 'control-plane': words(e.CONSOLE_CP_SCOPES), 'human-harness': ['harness:use'], iam: ['iam:people'] },
    openapiDir: resolve(e.CONSOLE_OPENAPI_DIR),
    staticDir: e.CONSOLE_STATIC_DIR !== undefined && e.CONSOLE_STATIC_DIR !== '' ? resolve(e.CONSOLE_STATIC_DIR) : null,
    bodyLimitBytes: e.CONSOLE_BODY_LIMIT_BYTES,
    uploadLimitBytes: e.CONSOLE_UPLOAD_LIMIT_BYTES,
    brand: { productName: e.CONSOLE_PRODUCT_NAME, orgName: e.CONSOLE_ORG_NAME !== undefined && e.CONSOLE_ORG_NAME !== '' ? e.CONSOLE_ORG_NAME : null },
    locales: locales as Locale[],
    defaultLocale: e.CONSOLE_DEFAULT_LOCALE,
  }
}
