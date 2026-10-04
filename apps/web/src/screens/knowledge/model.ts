/**
 * Модель «Базы знаний» (docs/screens/knowledge.md) без React: виды знаний из пакетов,
 * колонки таблицы по схеме атрибутов вида, сроки действия и поиск. Консоль не знает
 * предметных видов — всё берётся из описания пакета (`KnowledgePackOut.kinds`).
 */

export interface AttrSchema { type?: string, format?: string, enum?: string[], oneOf?: { const?: unknown, title?: string }[], title?: string, description?: string }
export interface PackKind {
  kind: string
  title?: string
  description?: string
  attributes?: { properties?: Record<string, AttrSchema>, required?: string[] }
}
/** Связь пакета (`relations` описания): имя, подпись, какие виды соединяет. */
export interface PackRelation { relation: string, title?: string, fromKinds?: string[], toKinds?: string[] }
export interface Pack { name: string, version: string, ref?: string | null, kinds: PackKind[], relations?: PackRelation[] }
/** Связь записи и её другой конец (`include.relations`, CP-ADR-0060 амендмент 2026-10-03). */
export interface EntityRelation { relation: string, direction: 'out' | 'in', kind: string, key: string, title: string }
export interface Entity {
  kind: string
  key: string
  title: string
  attributes: Record<string, unknown>
  /** Контракт `KnowledgeEntityOut` (CP-ADR-0060, амендмент 2026-10-03): начало и конец версии, источники — старший первым. */
  validFrom?: string | null
  validTo?: string | null
  sources?: { source?: string, sourcePath?: string }[]
  relations?: EntityRelation[] | null
  /** Переходные поля (прежнее ядро): старший источник и начало версии. */
  source?: string
  valid_from?: string | null
}

/** С какого момента запись верна: поле контракта, иначе переходное. */
export const knownSince = (e: Entity): string | undefined => (typeof e.validFrom === 'string' ? e.validFrom : typeof e.valid_from === 'string' ? e.valid_from : undefined)

/** Связи записи группами по связи пакета: подпись — из пакета, направление `in` — «обратная». */
export function relationGroups(relations: EntityRelation[], packRelations: PackRelation[]): { key: string, relation: string, direction: 'out' | 'in', title: string, items: EntityRelation[] }[] {
  const groups = new Map<string, { key: string, relation: string, direction: 'out' | 'in', title: string, items: EntityRelation[] }>()
  for (const r of relations) {
    const key = `${r.direction}:${r.relation}`
    const title = packRelations.find(p => p.relation === r.relation)?.title ?? r.relation
    const g = groups.get(key) ?? { key, relation: r.relation, direction: r.direction, title, items: [] }
    g.items.push(r)
    groups.set(key, g)
  }
  // Сначала прямые связи (запись — субъект), затем обратные.
  return [...groups.values()].sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'out' ? -1 : 1))
}

/** Источники записи без повторов: `git:control-plane`, `1c`, `manual`. */
export function sourcesOf(entity: Entity): string[] {
  const all = [entity.source, ...(entity.sources ?? []).map(s => s.source)].filter((s): s is string => typeof s === 'string' && s !== '')
  return [...new Set(all)]
}

/** Виды знаний включённых пакетов; при совпадении имени побеждает пакет, включённый раньше. */
export function kindsOf(packs: readonly Pack[]): PackKind[] {
  const seen = new Map<string, PackKind>()
  for (const pack of packs) for (const kind of pack.kinds) if (!seen.has(kind.kind)) seen.set(kind.kind, kind)
  return [...seen.values()]
}

/** Поля, которые важнее остальных для таблицы: идентификатор, суть, состояние, деньги. */
const PRIORITY = ['number', 'type', 'subject', 'issuer', 'inn', 'status', 'direction', 'amount', 'code', 'model', 'quantity', 'unitName', 'costPrice', 'date']
/** Не колонки: название уже в заголовке строки, начало срока и служебное — во второй слой. */
const SKIP = new Set(['name', 'validFrom', 'validUntil', 'currency', 'description', 'characteristics', 'limits', 'okpd2', 'coverage', 'kpp', 'address', 'paymentTerms', 'limitAmount'])

export interface Column { key: string, title: string, schema: AttrSchema }

/** До `max` колонок атрибутов по схеме вида; срок действия — отдельной колонкой, если вид его знает. */
export function columnsOf(kind: PackKind | undefined, max = 3): { columns: Column[], validity: boolean } {
  const props = kind?.attributes?.properties ?? {}
  const keys = Object.keys(props).filter(k => !SKIP.has(k) && props[k]!.type !== 'object')
  keys.sort((a, b) => rank(a) - rank(b))
  return {
    columns: keys.slice(0, max).map(key => ({ key, title: props[key]!.title ?? key, schema: props[key]! })),
    validity: 'validUntil' in props,
  }
}
const rank = (key: string): number => { const i = PRIORITY.indexOf(key); return i === -1 ? PRIORITY.length : i }

/** Дата `YYYY-MM-DD` (день, без часового пояса) → полночь по часам браузера. */
export function parseDay(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/** Сколько календарных дней до даты: 0 — сегодня, отрицательное — уже прошла. */
export function daysLeft(value: unknown, now = new Date()): number | undefined {
  const day = parseDay(value)
  if (day === undefined) return undefined
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((day.getTime() - today.getTime()) / 86_400_000)
}

export interface Expiring { entity: Entity, days: number, until: string }

/**
 * Требует внимания: срок действия истекает в ближайшие `leadDays` или истёк не раньше
 * `graceDays` назад — так же, как считает правило `knowledge-expiry` пакета
 * базы знаний (`defaultLeadDays: 30`, `graceDays: 7`).
 */
export function expiring(entities: readonly Entity[], now = new Date(), leadDays = 30, graceDays = 7): Expiring[] {
  const out: Expiring[] = []
  for (const entity of entities) {
    const until = entity.attributes.validUntil
    const days = daysLeft(until, now)
    if (days !== undefined && days <= leadDays && days >= -graceDays) out.push({ entity, days, until: until as string })
  }
  return out.sort((a, b) => a.days - b.days)
}

/** Поиск по названию и текстовым атрибутам: каждое слово — подстрока, без учёта регистра. */
export function matchesText(entity: Entity, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const values = Object.values(entity.attributes).flatMap(v => typeof v === 'string' || typeof v === 'number' ? [String(v)] : Array.isArray(v) ? v.map(String) : [])
  const hay = [entity.title, entity.key, ...values].join('\n').toLowerCase()
  return terms.every(term => hay.includes(term))
}

/**
 * Подпись значения перечисления по схеме: `oneOf: [{const, title}]` (JSON Schema). Пакеты
 * пока дают только `enum` без подписей — тогда значение показывается как есть.
 */
export function enumTitle(schema: AttrSchema, value: unknown): string | undefined {
  return schema.oneOf?.find(o => o.const === value)?.title
}
