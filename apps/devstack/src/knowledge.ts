/**
 * База знаний стенда: пакеты `default@1` и `company@1` (подмножество видов в форме ядра —
 * `KnowledgePackOut`), сущности организации «Полярис» со сроками действия и ответ
 * `POST /knowledge/entities:query`. Сроки считаются от запуска стенда: что-то истекает
 * через 10 и 28 дней, что-то — через полгода.
 */
import { crmEntities } from './connections.ts'
import { WORKSPACE } from './data.ts'

const day = (offset: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

const date = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

export const packs: Record<string, Record<string, unknown>> = {
  'default@1': {
    name: 'default', version: '1', scope: 'common', ref: 'default@1', relations: [],
    kinds: [
      {
        kind: 'legal_entity', title: 'Организация', description: 'Юридическое лицо: контрагент, заказчик, поставщик',
        attributes: { type: 'object', properties: { name: { type: 'string', title: 'Название' }, inn: { type: 'string', title: 'ИНН' }, kpp: { type: 'string', title: 'КПП' }, address: { type: 'string', title: 'Адрес' } } },
      },
    ],
  },
  'company@1': {
    name: 'company', version: '1', scope: 'common', ref: 'company@1',
    relations: [
      { relation: 'counterparty', title: 'Контрагент', fromKinds: ['agreement'], toKinds: ['legal_entity'] },
    ],
    kinds: [
      {
        kind: 'agreement', title: 'Договор', description: 'Договор с контрагентом: предмет, сумма, сроки',
        attributes: {
          type: 'object', required: ['number', 'subject'], properties: {
            number: { type: 'string', title: 'Номер' }, date: { ...date, title: 'Дата' }, subject: { type: 'string', title: 'Предмет' },
            direction: { type: 'string', enum: ['sale', 'purchase', 'other'], title: 'Направление' }, amount: { type: 'number', title: 'Сумма' },
            currency: { type: 'string', title: 'Валюта' }, status: { type: 'string', enum: ['draft', 'active', 'completed', 'terminated'], title: 'Статус' },
            validFrom: { ...date, title: 'Действует с' }, validUntil: { ...date, title: 'Действует до' },
          },
        },
      },
      {
        kind: 'credential', title: 'Удостоверяющий документ', description: 'Лицензия, сертификат, аккредитация, членство, допуск или разрешение',
        attributes: {
          type: 'object', required: ['type', 'number'], properties: {
            type: { type: 'string', enum: ['license', 'certificate', 'accreditation', 'membership', 'permit', 'other'], title: 'Тип' },
            issuer: { type: 'string', title: 'Кем выдан' }, number: { type: 'string', title: 'Номер' }, coverage: { type: 'string', title: 'Область действия' },
            validFrom: { ...date, title: 'Действует с' }, validUntil: { ...date, title: 'Действует до' },
          },
        },
      },
      {
        kind: 'asset', title: 'Актив', attributes: {
          type: 'object', properties: {
            name: { type: 'string', title: 'Наименование' }, type: { type: 'string', title: 'Тип актива' }, model: { type: 'string', title: 'Модель' },
            quantity: { type: 'number', title: 'Количество' }, validUntil: { ...date, title: 'Действует до', description: 'Например, срок поверки или гарантии' },
          },
        },
      },
      {
        kind: 'offering', title: 'Предложение компании', attributes: {
          type: 'object', properties: {
            name: { type: 'string', title: 'Наименование' }, type: { type: 'string', enum: ['product', 'work', 'service'], title: 'Тип' },
            unitName: { type: 'string', title: 'Единица' }, costPrice: { type: 'number', title: 'Себестоимость за единицу' }, currency: { type: 'string', title: 'Валюта' },
          },
        },
      },
      {
        kind: 'org_unit', title: 'Подразделение', attributes: {
          type: 'object', properties: { name: { type: 'string', title: 'Название' }, code: { type: 'string', title: 'Код подразделения' }, description: { type: 'string', title: 'Чем занимается' } },
        },
      },
    ],
  },
}

export const effective = ['default@1', 'company@1']

export interface Entity { kind: string, key: string, title: string, attributes: Record<string, unknown> }

export const entities: Entity[] = [
  { kind: 'legal_entity', key: 'inn:7701234567', title: 'ООО «Альфа-Снаб»', attributes: { name: 'ООО «Альфа-Снаб»', inn: '7701234567', kpp: '770101001', address: 'Москва, ул. Складская, 4' } },
  { kind: 'legal_entity', key: 'inn:7802345678', title: 'АО «Вектор»', attributes: { name: 'АО «Вектор»', inn: '7802345678', kpp: '780201001', address: 'Санкт-Петербург, пр. Обуховской Обороны, 70' } },
  { kind: 'legal_entity', key: 'inn:3528000597', title: 'ООО «Северсталь-Трейд»', attributes: { name: 'ООО «Северсталь-Трейд»', inn: '3528000597', kpp: '352801001' } },
  { kind: 'agreement', key: 'agreement:1c:АС-12', title: 'Договор поставки № АС-12', attributes: { number: 'АС-12', date: day(-300), subject: 'Поставка расходных материалов', direction: 'purchase', amount: 2_400_000, currency: 'RUB', status: 'active', validFrom: day(-300), validUntil: day(65) } },
  { kind: 'agreement', key: 'agreement:1c:В-7', title: 'Договор с «Вектором» № В-7', attributes: { number: 'В-7', date: day(-200), subject: 'Монтаж систем пожарной сигнализации', direction: 'sale', amount: 5_800_000, currency: 'RUB', status: 'active', validFrom: day(-200), validUntil: day(160) } },
  { kind: 'agreement', key: 'agreement:manual:аренда-3', title: 'Аренда склада № 3', attributes: { number: '3', date: day(-337), subject: 'Аренда складского помещения, 420 м²', direction: 'purchase', amount: 1_260_000, currency: 'RUB', status: 'active', validFrom: day(-337), validUntil: day(28) } },
  { kind: 'credential', key: 'credential:license:МЧС-77-123', title: 'Лицензия МЧС на монтаж', attributes: { type: 'license', issuer: 'ГУ МЧС России по г. Москве', number: '77-Б/00123', coverage: 'Монтаж, техническое обслуживание и ремонт средств обеспечения пожарной безопасности', validFrom: day(-1815), validUntil: day(10) } },
  { kind: 'credential', key: 'credential:membership:СРО-С-123', title: 'Членство в СРО «Строители Москвы»', attributes: { type: 'membership', issuer: 'Ассоциация «Строители Москвы»', number: 'С-123-77', coverage: 'Строительство, реконструкция, капитальный ремонт', validFrom: day(-400) } },
  { kind: 'credential', key: 'credential:certificate:ISO-9001', title: 'Сертификат ISO 9001', attributes: { type: 'certificate', issuer: 'Русский Регистр', number: 'RU-9001-2231', validFrom: day(-700), validUntil: day(395) } },
  { kind: 'asset', key: 'asset:inventory:ТП-4', title: 'Тепловизор Testo 868', attributes: { name: 'Тепловизор Testo 868', type: 'Измерительный прибор', model: 'Testo 868', quantity: 2, validUntil: day(21) } },
  { kind: 'asset', key: 'asset:inventory:ГАЗ-1', title: 'Газель Next', attributes: { name: 'Газель Next', type: 'Автомобиль', model: 'ГАЗ A21R32', quantity: 3 } },
  { kind: 'offering', key: 'offering:1c:ОПС-монтаж', title: 'Монтаж охранно-пожарной сигнализации', attributes: { name: 'Монтаж охранно-пожарной сигнализации', type: 'work', unitName: 'м²', costPrice: 420, currency: 'RUB' } },
  { kind: 'offering', key: 'offering:1c:ТО-ПБ', title: 'Техническое обслуживание систем пожарной безопасности', attributes: { name: 'Техническое обслуживание систем пожарной безопасности', type: 'service', unitName: 'мес', costPrice: 18_000, currency: 'RUB' } },
  { kind: 'org_unit', key: 'org_unit:ФИН', title: 'Финансовая служба', attributes: { name: 'Финансовая служба', code: 'ФИН', description: 'Оплата счетов, сверки, отчётность' } },
  { kind: 'org_unit', key: 'org_unit:МОНТ', title: 'Монтажный участок', attributes: { name: 'Монтажный участок', code: 'МОНТ', description: 'Монтаж и обслуживание систем безопасности' } },
]

/** `POST /knowledge/entities:query`: виды, условия `eq`/`exists`, страница по смещению в курсоре. */
/** Связи базы (субъект → объект), как их отдаёт `include.relations` ядра (TASK-001300). */
const RELATIONS: { from: [string, string], relation: string, to: [string, string] }[] = [
  { from: ['agreement', 'agreement:1c:АС-12'], relation: 'counterparty', to: ['legal_entity', 'inn:7701234567'] },
  { from: ['agreement', 'agreement:1c:В-7'], relation: 'counterparty', to: ['legal_entity', 'inn:7802345678'] },
]

function relationsOf(e: { kind: string, key: string }, direction: string): Record<string, unknown>[] {
  const title = (kind: string, key: string): string => entities.find(x => x.kind === kind && x.key === key)?.title ?? ''
  const out = direction === 'in' ? [] : RELATIONS.filter(r => r.from[0] === e.kind && r.from[1] === e.key).map(r => ({ relation: r.relation, direction: 'out', kind: r.to[0], key: r.to[1], title: title(r.to[0], r.to[1]) }))
  const inn = direction === 'out' ? [] : RELATIONS.filter(r => r.to[0] === e.kind && r.to[1] === e.key).map(r => ({ relation: r.relation, direction: 'in', kind: r.from[0], key: r.from[1], title: title(r.from[0], r.from[1]) }))
  return [...out, ...inn]
}

export function query(body: { workspaceId?: string, kinds?: string[], where?: { attr: string, op: string, value: unknown }[], limit?: number, cursor?: string | null, include?: { relations?: unknown, direction?: string, limit?: number } }): { status: number, body: unknown } {
  if (body.include !== undefined && (body.limit ?? 100) > 100) return { status: 400, body: { error: { code: 'invalid_request', message: 'limit is at most 100 when include is given' } } }
  if (body.workspaceId !== WORKSPACE) return { status: 404, body: { error: { code: 'workspace_not_found' } } }
  if (!Array.isArray(body.kinds) || body.kinds.length === 0) return { status: 422, body: { error: { code: 'validation_error', message: 'kinds is required' } } }
  let out = [...entities, ...crmEntities].filter(e => body.kinds!.includes(e.kind))
  for (const w of body.where ?? []) {
    if (w.op === 'eq') out = out.filter(e => e.attributes[w.attr] === w.value)
    if (w.op === 'exists') out = out.filter(e => (e.attributes[w.attr] !== undefined) === Boolean(w.value))
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))
  const limit = Math.min(body.limit ?? 100, 500)
  const offset = body.cursor ? Number(Buffer.from(body.cursor, 'base64url').toString()) || 0 : 0
  const items = out.slice(offset, offset + limit).map(e => body.include !== undefined ? { ...e, relations: relationsOf(e, body.include.direction ?? 'both') } : e)
  return { status: 200, body: { items, nextCursor: offset + limit < out.length ? Buffer.from(String(offset + limit)).toString('base64url') : null, asOf: new Date().toISOString() } }
}
