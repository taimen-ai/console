/**
 * Настройки пакетов и правила стенда — по контракту консоли `docs/settings.md` (TAI-ADR-0067)
 * и `GET /rules` ядра. Пакет `invoice-approval` объявляет порог согласования, срок проверки,
 * флаг уведомления, ответственного (ссылка на участника) и комментарий для бухгалтерии,
 * который показывается правилом при включённом уведомлении. Строки — на языке запроса.
 */
import { randomUUID } from 'node:crypto'
import { ME, P, TENANT, WORKSPACE, daysAgo } from './data.ts'

type Reply = { status: number, body: unknown, etag?: string }
type Values = Record<string, unknown>
const L = (en: string, ru: string) => (locale: string): string => (locale === 'ru' ? ru : en)

function schema(locale: string) {
  return {
    type: 'object',
    properties: {
      approvalThreshold: { type: 'number', minimum: 0, default: 100000, title: L('Approval threshold, ₽', 'Порог согласования, ₽')(locale), description: L('Invoices from this amount go to the finance director.', 'Счета от этой суммы идут на согласование финансовому директору.')(locale) },
      reviewDueWorkdays: { type: 'integer', minimum: 1, maximum: 20, default: 2, title: L('Invoice check, working days', 'Срок проверки счёта, рабочих дней')(locale) },
      notifyAccounting: { type: 'boolean', default: true, title: L('Notify accounting about each payment', 'Уведомлять бухгалтерию о каждой оплате')(locale) },
      accountingNote: { type: 'string', maxLength: 200, default: '', title: L('Note for accounting', 'Комментарий для бухгалтерии')(locale) },
      approver: { type: 'string', 'x-ref': 'principal', default: P.irina.id, title: L('Who approves above the threshold', 'Кто согласует выше порога')(locale) },
      channels: { type: 'array', items: { type: 'string', enum: ['telegram', 'email', 'console'] }, default: ['console'], title: L('Notification channels', 'Каналы уведомлений')(locale), description: 'telegram — Telegram; email — почта; console — консоль' },
      limits: {
        type: 'array', maxItems: 5, default: [], title: L('Limits by supplier', 'Лимиты по поставщикам')(locale),
        items: { type: 'object', required: ['inn', 'amount'], properties: {
          inn: { type: 'string', pattern: '^\\d{10}(\\d{2})?$', title: L('Supplier TIN', 'ИНН поставщика')(locale) },
          amount: { type: 'number', minimum: 0, title: L('Limit, ₽', 'Лимит, ₽')(locale) },
        } },
      },
    },
  }
}

function uischema(locale: string) {
  return {
    type: 'VerticalLayout',
    elements: [
      { type: 'Group', label: L('Approval', 'Согласование')(locale), elements: [
        { type: 'HorizontalLayout', elements: [{ type: 'Control', scope: '#/properties/approvalThreshold' }, { type: 'Control', scope: '#/properties/reviewDueWorkdays' }] },
        { type: 'Control', scope: '#/properties/approver' },
      ] },
      { type: 'Group', label: L('Notifications', 'Уведомления')(locale), elements: [
        { type: 'Control', scope: '#/properties/notifyAccounting' },
        { type: 'Control', scope: '#/properties/accountingNote', rule: { effect: 'SHOW', condition: { scope: '#/properties/notifyAccounting', schema: { const: true } } } },
        { type: 'Control', scope: '#/properties/channels' },
      ] },
      { type: 'Control', scope: '#/properties/limits' },
    ],
  }
}

interface Version { version: number, values: Values, changedPaths: string[], updatedBy: string, updatedAt: string }
const store = { values: { approvalThreshold: 150000 } as Values, version: 1, history: [{ version: 1, values: { approvalThreshold: 150000 }, changedPaths: ['/approvalThreshold'], updatedBy: P.irina.id, updatedAt: daysAgo(3, 15) }] as Version[] }

const defaults = (locale = 'ru'): Values => Object.fromEntries(Object.entries(schema(locale).properties).map(([k, p]) => [k, p.default]))
const title = (locale: string): string => L('Invoice payment', 'Оплата счетов')(locale)

function out(locale: string): Record<string, unknown> {
  const last = store.history[0]
  return {
    package: 'invoice-approval', title: title(locale), packageVersion: '0.8.0', schema: schema(locale), uischema: uischema(locale),
    values: store.values, effective: { ...defaults(locale), ...store.values }, version: store.version, schemaHash: 'sha256:devstack',
    updatedBy: last?.updatedBy ?? null, updatedAt: last?.updatedAt ?? null, canManage: true,
  }
}

export function list(locale: string): Reply {
  const last = store.history[0]
  return { status: 200, body: { items: [{ package: 'invoice-approval', title: title(locale), packageVersion: '0.8.0', version: store.version, updatedBy: last?.updatedBy ?? null, updatedAt: last?.updatedAt ?? null }] } }
}

export function get(key: string, locale: string): Reply {
  if (key !== 'invoice-approval') return { status: 404, body: { error: { code: 'not_found', message: 'package has no settings' } } }
  return { status: 200, body: out(locale), etag: `"package-settings-${store.version}"` }
}

export function versions(key: string): Reply {
  if (key !== 'invoice-approval') return { status: 404, body: { error: { code: 'not_found' } } }
  return { status: 200, body: { items: store.history, nextCursor: null } }
}

/** Проверка значений по схеме — те же коды, что у ядра (`settings_invalid`, JSON Pointer пути). */
function check(values: Values): { path: string, code: string, message?: string }[] {
  const props = schema('ru').properties as Record<string, { type: string, minimum?: number, maximum?: number, maxLength?: number }>
  const errors: { path: string, code: string, message?: string }[] = []
  for (const [k, v] of Object.entries(values)) {
    const p = props[k]
    const path = `/${k}`
    if (p === undefined) { errors.push({ path, code: 'unknown_property' }); continue }
    if (k === 'limits' && Array.isArray(v)) {
      v.forEach((item: { inn?: unknown, amount?: unknown }, i) => {
        if (typeof item?.inn !== 'string' || !/^\d{10}(\d{2})?$/.test(item.inn)) errors.push({ path: `/limits/${i}/inn`, code: 'pattern', message: 'ИНН — 10 или 12 цифр' })
        if (typeof item?.amount !== 'number' || item.amount < 0) errors.push({ path: `/limits/${i}/amount`, code: 'minimum', message: 'не меньше 0' })
      })
      continue
    }
    if (p.type === 'array') continue
    if ((p.type === 'number' || p.type === 'integer') && typeof v !== 'number') errors.push({ path, code: 'type' })
    else if (p.type === 'integer' && !Number.isInteger(v)) errors.push({ path, code: 'type' })
    else if (typeof v === 'number' && p.minimum !== undefined && v < p.minimum) errors.push({ path, code: 'minimum', message: `не меньше ${p.minimum}` })
    else if (typeof v === 'number' && p.maximum !== undefined && v > p.maximum) errors.push({ path, code: 'maximum', message: `не больше ${p.maximum}` })
    else if (p.type === 'boolean' && typeof v !== 'boolean') errors.push({ path, code: 'type' })
    else if (p.type === 'string' && typeof v !== 'string') errors.push({ path, code: 'type' })
    else if (typeof v === 'string' && p.maxLength !== undefined && v.length > p.maxLength) errors.push({ path, code: 'maxLength' })
  }
  return errors
}

export function put(key: string, ifMatch: string | undefined, body: string, locale: string): Reply {
  if (key !== 'invoice-approval') return { status: 404, body: { error: { code: 'not_found' } } }
  const m = /"package-settings-(\d+)"/.exec(ifMatch ?? '')
  if (m === null) return { status: 428, body: { error: { code: 'precondition_required', message: 'If-Match is required' } } }
  if (Number(m[1]) !== store.version) return { status: 409, body: { error: { code: 'version_conflict', message: 'the settings changed', details: { currentVersion: store.version } } } }
  const values = ((JSON.parse(body || '{}') as { values?: Values }).values ?? {}) as Values
  const errors = check(values)
  if (errors.length > 0) return { status: 422, body: { error: { code: 'settings_invalid', message: 'values do not match the settings schema', details: { errors } } } }
  if (typeof values.accountingNote === 'string' && /(token|secret|password)\s*[:=]/i.test(values.accountingNote)) {
    return { status: 422, body: { error: { code: 'secret_material_rejected', message: 'a value looks like a secret', details: { errors: [{ path: '/accountingNote' }] } } } }
  }
  const before = { ...defaults(), ...store.values }
  const after = { ...defaults(), ...values }
  const changedPaths = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => `/${k}`)
  store.values = values
  store.version += 1
  store.history.unshift({ version: store.version, values, changedPaths, updatedBy: ME, updatedAt: new Date().toISOString() })
  return { status: 200, body: out(locale), etag: `"package-settings-${store.version}"` }
}

// ------------------------------------------------------------------ правила (`GET /rules`)

const rule = (key: string, description: string, kind: string, status: string, pkg: string) => ({
  id: randomUUID(), tenantId: TENANT, workspaceId: WORKSPACE, goalId: null, key, description, version: 1, status, trigger: { kind }, condition: {},
  interpretation: null, action: {}, identity: null, authorityPrincipalId: null, enabledAt: status === 'enabled' ? daysAgo(10) : null, nextRunAt: null,
  createdBy: ME, createdAt: daysAgo(20), updatedAt: daysAgo(10), package: { key: pkg, version: '0.8.0' },
})
export const rules = [
  rule('invoice-sla-escalation', 'Эскалация просроченного согласования счёта', 'schedule', 'enabled', 'invoice-approval'),
  rule('knowledge-expiry', 'Работа на продление документа за 30 дней до конца срока', 'schedule', 'enabled', 'demo-knowledge'),
  rule('regulation-drift', 'Процесс расходится с регламентом', 'event', 'disabled', 'demo-regulations'),
]

export function toggle(id: string, verb: 'enable' | 'disable'): Reply {
  const r = rules.find(x => x.id === id)
  if (r === undefined) return { status: 404, body: { error: { code: 'not_found' } } }
  r.status = verb === 'enable' ? 'enabled' : 'disabled'
  r.enabledAt = verb === 'enable' ? new Date().toISOString() : null
  r.updatedAt = new Date().toISOString()
  return { status: 200, body: r }
}
