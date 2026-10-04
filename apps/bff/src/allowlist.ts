/**
 * Allow-list прокси: пары «метод + шаблон пути» из снимка openapi (plan «Дизайн → BFF»).
 *
 * Чтение (GET) открыто для всех путей снимка под префиксом. Изменение — только операции из
 * явного списка, и только если снимок их знает: операция из списка, которой нет в снимке,
 * не открывается, а попадает в `missing` (BFF пишет её в журнал при старте) — снимок
 * обновляется `scripts/snapshot-openapi.ts`. Всё прочее — 404.
 */
export interface Route {
  method: string
  /** Шаблон пути из openapi, например `/api/v1/tasks/{task_ref}`. */
  template: string
  regex: RegExp
  /** Длина литеральной части: из нескольких совпавших шаблонов берётся самый конкретный. */
  weight: number
}

/**
 * Управляющие действия консоли (CON-ADR-0001, экраны docs/screens/). Только то, что экраны
 * делают кнопками; всё прочее — 404, даже если ядро это умеет.
 */
export const CONTROL_PLANE_MUTATIONS = [
  // «Поручить работу» и правка работы: исполнитель, срок, статус по переходам типа
  'POST /api/v1/tasks',
  'PATCH /api/v1/tasks/{task_ref}',
  'POST /api/v1/tasks/{task_ref}/comments',
  // Форма шага процесса с участием человека: ответы — PATCH, затем завершение работы
  'POST /api/v1/tasks/{task_ref}:complete',
  // Решения ожидающих подтверждений
  'POST /api/v1/approvals/{approval_id}:approve',
  'POST /api/v1/approvals/{approval_id}:reject',
  'POST /api/v1/approvals/{approval_id}:cancel',
  // Вмешательство в исполнение: остановить попытку, снять и вернуть исполнителя
  'POST /api/v1/runs/{run_id}:request-cancel',
  'POST /api/v1/runs/{run_id}:cancel',
  'POST /api/v1/claims/{claim_id}:release',
  'POST /api/v1/claims/{claim_id}:reclaim',
  'POST /api/v1/process-instances/{instance_id}:cancel',
  // «База знаний» → «Загрузить таблицу» (пакет базы знаний с типом `knowledge-import`): файл и план — артефакты
  // работы, план и шаблон — скиллы без побочных эффектов, решение — согласование-ворота;
  // запись в базу делает исход решения в ядре, не консоль
  'PUT /api/v1/artifact-contents',
  'POST /api/v1/artifacts',
  'POST /api/v1/skills/{skill_ref}:invoke',
  'POST /api/v1/approvals',
  // «Настройки» → «Правила»: рычаг автономии — включить и выключить правило
  'POST /api/v1/rules/{rule_id}:enable',
  'POST /api/v1/rules/{rule_id}:disable',
  // Экраны пакетов (TAI-ADR-0066, CP-ADR-0080): запрос под вид — чтение, оформленное POST'ом
  'POST /api/v1/views/{view_key}:query',
  // Чтение, оформленное POST'ом: поиск сущностей базы знаний и «могу ли я X на Y» для кнопок
  'POST /api/v1/knowledge/entities:query',
  'POST /api/v1/authz:check',
  // «Передать» без роли — «Дать роль»; «Настройки» → «Люди и роли»: дать и отозвать роль,
  // завести роль и поправить её название (право org.manage)
  'POST /api/v1/principals/{principal_id}/roles',
  'POST /api/v1/principals/{principal_id}/roles/{role_id}:revoke',
  'POST /api/v1/roles',
  'PATCH /api/v1/roles/{role_id}',
  // Карточка человека (TAI-ADR-0068): права и видимость — upsert связки IAM (principals.write),
  // участие в пространствах (workspaces.manage)
  'POST /api/v1/principals/{principal_id}/iam-bindings',
  // Отключить и включить человека (CP-ADR-0077): связки, сессии, захваты — разом
  'POST /api/v1/principals/{principal_id}:disable',
  // Включение человека — только поток BFF `{base}/api/org/people/{id}:enable` (routes/org.ts):
  // голое `:enable` ядра обошло бы его проверки (вход в IAM, права новой связки).
  'POST /api/v1/workspaces/{workspace_id}/members',
  'POST /api/v1/workspaces/{workspace_id}/members/{principal_id}:remove',
  // «Ждёт вас»: отзыв на элемент своего списка (CP-ADR-0071 §4)
  'POST /api/v1/me/attention/{item_key}:feedback',
  // «Настройки» → «Пакеты» (TAI-ADR-0067, CP-ADR-0081): новая версия настроек пакета
  'PUT /api/v1/packages/{key}/settings',
  // «Настройки» → «Подключения» (CP-ADR-0079): ввод ключа, секрета приложения и секрета агента
  // идёт транзитом в хранилище ядра — журнал BFF пишет только шаблон маршрута, тела не пишет никогда
  'PUT /api/v1/connection-types/{key}/oauth-app',
  'POST /api/v1/connections',
  'PATCH /api/v1/connections/{key}',
  'POST /api/v1/connections/{key}:authorize',
  'PUT /api/v1/connections/{key}/token',
  'POST /api/v1/connections/{key}:revoke',
  'PUT /api/v1/agents/{key}/secrets/{name}',
  'DELETE /api/v1/agents/{key}/secrets/{name}',
] as const

/**
 * Маршруты ядра по принятому контракту, которых ещё нет в снимке openapi (настройки пакетов,
 * подключения, профиль человека). Открываются без снимка; как только снимок
 * их знает, запись отсюда удаляется (`pendingKnown` в журнале старта BFF подсказывает когда).
 */
export const CONTROL_PLANE_PENDING = [
  // Сведения о человеке (TAI-ADR-0068, people-access T002): профиль участника
  'PATCH /api/v1/principals/{principal_id}',
] as const

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'

/**
 * Параметры пути со своей формой — по шаблону маршрута, а не по имени параметра: форма
 * описана для одной операции и не расползается на другие, где параметр назван так же. По
 * умолчанию параметр — один сегмент без `:`. Ключ элемента «Ждёт вас» (CP-ADR-0071) —
 * `<ruleKey>:<entityId>` с UUID 8-4-4-4-12; двоеточие в нём — часть ключа, ядро (Starlette
 * `{item_key}`) ждёт его сырым, поэтому форма ключа описана точно.
 */
const PARAM_PATTERNS: Record<string, Record<string, string>> = {
  '/api/v1/me/attention/{item_key}:feedback': { item_key: `[A-Za-z][A-Za-z0-9_.-]{0,99}:${UUID}` },
  // Скиллы, которые консоль вызывает кнопками: только без побочных эффектов. Прочие — 404,
  // даже если у человека есть право: вызывать скилл из консоли — решение экрана, а не права.
  '/api/v1/skills/{skill_ref}:invoke': { skill_ref: 'knowledge\\.(?:import_plan|template)@[0-9]+' },
}

export function compile(method: string, template: string): Route {
  const patterns = PARAM_PATTERNS[template] ?? {}
  let weight = 0
  const source = template.split(/(\{[^}]+\})/).map((part) => {
    if (/^\{[^}]+\}$/.test(part)) return patterns[part.slice(1, -1)] ?? '[^/:]+'
    weight += part.length
    return escape(part)
  }).join('')
  return { method, template, regex: new RegExp(`^${source}$`), weight }
}

interface OpenApi { paths?: Record<string, Record<string, unknown>> }

export class AllowList {
  readonly routes: Route[]
  readonly missing: string[]

  /** Ожидаемые маршруты, которые снимок уже знает: их пора убрать из `CONTROL_PLANE_PENDING`. */
  readonly pendingKnown: string[]

  constructor(routes: Route[], missing: string[] = [], pendingKnown: string[] = []) {
    this.routes = [...routes].sort((a, b) => b.weight - a.weight)
    this.missing = missing
    this.pendingKnown = pendingKnown
  }

  static fromOpenApi(doc: OpenApi, options: { prefix: string, mutations?: readonly string[], pending?: readonly string[], exclude?: RegExp }): AllowList {
    const known = new Set<string>()
    const routes: Route[] = []
    for (const [template, operations] of Object.entries(doc.paths ?? {})) {
      if (!template.startsWith(`${options.prefix}/`) || options.exclude?.test(template)) continue
      for (const method of Object.keys(operations)) known.add(`${method.toUpperCase()} ${template}`)
      if ('get' in operations) routes.push(compile('GET', template))
    }
    const missing: string[] = []
    for (const entry of options.mutations ?? []) {
      if (!known.has(entry)) { missing.push(entry); continue }
      const [method, template] = entry.split(' ') as [string, string]
      routes.push(compile(method, template))
    }
    const pendingKnown: string[] = []
    for (const entry of options.pending ?? []) {
      if (known.has(entry)) { pendingKnown.push(entry); continue }
      const [method, template] = entry.split(' ') as [string, string]
      routes.push(compile(method, template))
    }
    return new AllowList(routes, missing, pendingKnown)
  }

  /**
   * Шаблон для метода и сырого (не декодированного) пути или null. Путь с `.`/`..`,
   * закодированными `/`, `\` или `:` не проходит: upstream мог бы разобрать его иначе.
   */
  match(method: string, rawPath: string): Route | null {
    if (!safePath(rawPath)) return null
    return this.routes.find(route => route.method === method && route.regex.test(rawPath)) ?? null
  }
}

export function safePath(rawPath: string): boolean {
  if (/%2f|%5c|%3a|\\/i.test(rawPath)) return false
  for (const segment of rawPath.split('/')) {
    let decoded: string
    try { decoded = decodeURIComponent(segment) } catch { return false }
    if (decoded === '.' || decoded === '..') return false
  }
  return true
}
