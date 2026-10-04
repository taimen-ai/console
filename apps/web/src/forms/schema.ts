/**
 * Формы по схеме: подмножество JSON Schema и JSON Forms uischema, которое пишут авторы пакетов
 * (`human.form` шага процесса, CP-ADR-0075; настройки пакета, TAI-ADR-0067). Своя лёгкая
 * реализация вместо библиотеки JSON Forms: строки, перечисления, числа, флажки, даты, вложенные
 * объекты и массивы (скаляров, вариантов перечисления, объектов); раскладки Vertical/Horizontal/
 * Group, Control со `scope` (в том числе вглубь: `#/properties/a/properties/b`), правила SHOW/
 * HIDE/ENABLE/DISABLE по `{scope, schema: {const|enum}}`. Значение и ошибка адресуются путём —
 * сегменты JSON Pointer без ведущего `/` (`a/b`, `list/0/x`); у полей верхнего уровня это имя.
 * Окончательно проверяет ядро.
 */

export interface FieldSchema {
  type?: string | string[]
  title?: string
  description?: string
  enum?: unknown[]
  oneOf?: { const?: unknown, title?: string }[]
  const?: unknown
  format?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  default?: unknown
  properties?: Record<string, FieldSchema>
  required?: string[]
  items?: FieldSchema
  minItems?: number
  maxItems?: number
  /** Ссылка на объект платформы (TAI-ADR-0067): значение — id или ключ, выбирается поиском. */
  'x-ref'?: 'role' | 'principal' | 'workspace' | 'calendar' | 'taskType' | (string & {})
}

export interface FormSchema { type?: string, required?: string[], properties?: Record<string, FieldSchema> }

export interface Rule { effect: 'SHOW' | 'HIDE' | 'ENABLE' | 'DISABLE', condition: { scope: string, schema: { const?: unknown, enum?: unknown[] } } }
export interface UiElement {
  type: 'VerticalLayout' | 'HorizontalLayout' | 'Group' | 'Control' | 'Label' | (string & {})
  scope?: string
  label?: string | boolean
  text?: string
  elements?: UiElement[]
  options?: { multi?: boolean, format?: string, [k: string]: unknown }
  rule?: Rule
}

export type Values = Record<string, unknown>

/** `#/properties/note` → `note`; scope вглубь — undefined (для него — `scopePath`). */
export const fieldOf = (scope: string | undefined): string | undefined => /^#\/properties\/([^/]+)$/.exec(scope ?? '')?.[1]

export type Path = (string | number)[]

const unescape = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~')
const escape = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1')

/** `#/properties/a/properties/b` → `['a', 'b']`; не scope свойства — undefined. */
export function scopePath(scope: string | undefined): string[] | undefined {
  const m = /^#((?:\/properties\/[^/]+)+)$/.exec(scope ?? '')
  if (m === null) return undefined
  return m[1]!.split('/properties/').slice(1).map(unescape)
}

/** Ключ значения и ошибки: сегменты пути через `/` (имя поля верхнего уровня — как есть). */
export const pathKey = (path: Path): string => path.map(s => escape(String(s))).join('/')
/** JSON Pointer ошибки ядра (`/limits/0/amount`) → ключ (`limits/0/amount`). */
export const pointerKey = (pointer: string): string => pointer.replace(/^\//, '')

/** Схема поля по пути: свойства объекта и элементы массива (номер). */
export function fieldAt(schema: FormSchema | FieldSchema, path: Path): FieldSchema | undefined {
  let cur: FieldSchema | undefined = schema as FieldSchema
  for (const seg of path) {
    if (cur === undefined) return undefined
    cur = typeof seg === 'number' ? cur.items : cur.properties?.[seg]
  }
  return cur
}

export function getIn(values: unknown, path: Path): unknown {
  let cur = values
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[seg]
  }
  return cur
}

/** Новое значение с заменой по пути (исходное не меняется); недостающие узлы — объекты или массивы. */
export function setIn(target: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path as [string | number, ...Path]
  if (typeof head === 'number') {
    const arr = Array.isArray(target) ? [...target] : []
    arr[head] = setIn(arr[head], rest, value)
    return arr
  }
  const obj = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
  const next = setIn(obj[head], rest, value)
  if (next === undefined) delete obj[head]
  else obj[head] = next
  return obj
}

/** Значения по умолчанию объекта: `default` свойств (элемент нового списка). */
export function defaultsOf(field: FieldSchema | undefined): unknown {
  if (field === undefined) return undefined
  if (field.default !== undefined) return field.default
  if (typeOf(field) === 'object') return Object.fromEntries(Object.entries(field.properties ?? {}).flatMap(([k, f]) => { const d = defaultsOf(f); return d === undefined ? [] : [[k, d]] }))
  if (typeOf(field) === 'array') return []
  return undefined
}

/** Раскладка по умолчанию — поля схемы по порядку, одной колонкой. */
export function defaultUi(schema: FormSchema): UiElement {
  return { type: 'VerticalLayout', elements: Object.keys(schema.properties ?? {}).map(k => ({ type: 'Control', scope: `#/properties/${k}` })) }
}

function matches(value: unknown, cond: { const?: unknown, enum?: unknown[] }): boolean {
  if ('const' in cond) return value === cond.const
  if (Array.isArray(cond.enum)) return cond.enum.includes(value)
  return true
}

/** Видимо ли и доступно ли поле по правилу uischema. */
export function ruleState(rule: Rule | undefined, values: Values): { visible: boolean, enabled: boolean } {
  if (rule === undefined) return { visible: true, enabled: true }
  const path = scopePath(rule.condition?.scope)
  const hit = path !== undefined && matches(getIn(values, path), rule.condition.schema ?? {})
  switch (rule.effect) {
    case 'SHOW': return { visible: hit, enabled: true }
    case 'HIDE': return { visible: !hit, enabled: true }
    case 'ENABLE': return { visible: true, enabled: hit }
    case 'DISABLE': return { visible: true, enabled: !hit }
    default: return { visible: true, enabled: true }
  }
}

/** Поля, которые сейчас видны (скрытые правилом не проверяются и не отправляются). */
export function visibleFields(ui: UiElement, values: Values, out = new Set<string>()): Set<string> {
  if (!ruleState(ui.rule, values).visible) return out
  if (ui.type === 'Control') { const f = scopePath(ui.scope)?.[0]; if (f !== undefined) out.add(f) }
  for (const child of ui.elements ?? []) visibleFields(child, values, out)
  return out
}

/**
 * Подписи вариантов перечисления: `oneOf: [{const, title}]`; иначе — из описания поля вида
 * «ok — счёт верен; mismatch — отклонить» или через запятую перед следующим «значение —» (так
 * пишут пакеты); иначе — значение как есть.
 */
export function enumOptions(field: FieldSchema): { value: unknown, label: string, hint?: string }[] {
  if (Array.isArray(field.oneOf) && field.oneOf.length > 0) return field.oneOf.map(o => ({ value: o.const, label: o.title ?? String(o.const) }))
  const values = field.enum ?? []
  const fromDescription = new Map<string, string>()
  for (const part of (field.description ?? '').split(/[;\n]|,(?=\s*[\w.-]+\s+[—–-]\s)/)) {
    const m = /^\s*([\w.-]+)\s+[—–-]\s+(.+?)\s*$/.exec(part)
    if (m !== null) fromDescription.set(m[1]!, m[2]!)
  }
  return values.map((v) => {
    const text = fromDescription.get(String(v))
    return text !== undefined ? { value: v, label: text, hint: String(v) } : { value: v, label: String(v) }
  })
}

/** Описание поля без перечня вариантов, если подписи взяты из него. */
export function describe(field: FieldSchema): string | undefined {
  const d = field.description
  if (d === undefined || field.enum === undefined) return d
  return enumOptions(field).every(o => o.hint !== undefined) ? undefined : d
}

const typeOf = (f: FieldSchema): string => Array.isArray(f.type) ? f.type.find(t => t !== 'null') ?? 'string'
  : f.type ?? (f.properties !== undefined ? 'object' : f.items !== undefined ? 'array' : 'string')

export type ErrorCode = 'required' | 'type' | 'minimum' | 'maximum' | 'minLength' | 'maxLength' | 'pattern' | 'enum' | 'minItems' | 'maxItems'
export type Errors = Record<string, ErrorCode>

/** Проверка одного значения и его вложенных — ошибки под ключами путей. */
function check(field: FieldSchema, v: unknown, path: Path, required: boolean, errors: Errors): void {
  const key = pathKey(path)
  const empty = v === undefined || v === null || v === ''
  if (empty) { if (required) errors[key] = 'required'; return }
  const type = typeOf(field)
  if (type === 'object') {
    if (typeof v !== 'object' || Array.isArray(v)) { errors[key] = 'type'; return }
    const req = new Set(field.required ?? [])
    for (const [k, f] of Object.entries(field.properties ?? {})) check(f, (v as Record<string, unknown>)[k], [...path, k], req.has(k), errors)
    return
  }
  if (type === 'array') {
    if (!Array.isArray(v)) { errors[key] = 'type'; return }
    if (field.minItems !== undefined && v.length < field.minItems) errors[key] = 'minItems'
    if (field.maxItems !== undefined && v.length > field.maxItems) errors[key] = 'maxItems'
    if (field.items !== undefined) v.forEach((item, i) => check(field.items!, item, [...path, i], true, errors))
    return
  }
  if ((type === 'number' || type === 'integer') && (typeof v !== 'number' || Number.isNaN(v) || (type === 'integer' && !Number.isInteger(v)))) { errors[key] = 'type'; return }
  if (typeof v === 'number' && field.minimum !== undefined && v < field.minimum) errors[key] = 'minimum'
  if (typeof v === 'number' && field.maximum !== undefined && v > field.maximum) errors[key] = 'maximum'
  if (typeof v === 'string' && field.minLength !== undefined && v.length < field.minLength) errors[key] = 'minLength'
  if (typeof v === 'string' && field.maxLength !== undefined && v.length > field.maxLength) errors[key] = 'maxLength'
  if (typeof v === 'string' && field.pattern !== undefined) { try { if (!new RegExp(field.pattern, 'u').test(v)) errors[key] = 'pattern' } catch { /* шаблон проверит ядро */ } }
  if (field.enum !== undefined && !field.enum.includes(v)) errors[key] = 'enum'
}

/** Проверка видимых полей до отправки — подсказка человеку; окончательно проверяет ядро. */
export function validate(schema: FormSchema, ui: UiElement, values: Values): Errors {
  const errors: Errors = {}
  const visible = visibleFields(ui, values)
  const required = new Set(schema.required ?? [])
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    if (visible.has(key)) check(field, values[key], [key], required.has(key), errors)
  }
  return errors
}

/** Что отправить: только видимые поля с заполненными значениями. */
export function payload(ui: UiElement, values: Values): Values {
  const visible = visibleFields(ui, values)
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => visible.has(k) && v !== undefined && v !== ''))
}

/** Начальные значения: уже записанные в работу, затем `default` схемы. */
export function initialValues(schema: FormSchema, current: Values): Values {
  const out: Values = {}
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    if (current[key] !== undefined) out[key] = current[key]
    else if (field.default !== undefined) out[key] = field.default
  }
  return out
}

export { typeOf }
