import { describe, expect, it } from 'vitest'
import { parseEntrySearch } from '../src/screens/knowledge/Entry.tsx'
import { entryHref } from '../src/screens/knowledge/format.tsx'
import { columnsOf, daysLeft, enumTitle, expiring, kindsOf, matchesText, sourcesOf, type Entity, type Pack } from '../src/screens/knowledge/model.ts'

const date = { type: 'string', format: 'date' }
const agreement = {
  kind: 'agreement', title: 'Договор',
  attributes: { properties: { name: { type: 'string' }, number: { type: 'string', title: 'Номер' }, subject: { type: 'string', title: 'Предмет' }, status: { type: 'string', title: 'Статус' }, amount: { type: 'number', title: 'Сумма' }, limits: { type: 'object' }, validFrom: date, validUntil: { ...date, title: 'Действует до' } } },
}

describe('виды знаний', () => {
  it('из включённых пакетов; при совпадении имени — пакет, включённый раньше', () => {
    const packs: Pack[] = [
      { name: 'default', version: '1', kinds: [{ kind: 'legal_entity', title: 'Организация' }, { kind: 'agreement', title: 'из default' }] },
      { name: 'company', version: '1', kinds: [agreement, { kind: 'asset', title: 'Актив' }] },
    ]
    expect(kindsOf(packs).map(k => [k.kind, k.title])).toEqual([['legal_entity', 'Организация'], ['agreement', 'из default'], ['asset', 'Актив']])
  })

  it('колонки — по схеме: важные поля вперёд, без названия, объектов и начала срока; срок — отдельно', () => {
    const { columns, validity } = columnsOf(agreement)
    expect(columns.map(c => c.title)).toEqual(['Номер', 'Предмет', 'Статус'])
    expect(validity).toBe(true)
    expect(columnsOf({ kind: 'x' })).toEqual({ columns: [], validity: false })
  })

  it('подпись значения перечисления — из oneOf схемы, иначе нет', () => {
    expect(enumTitle({ oneOf: [{ const: 'license', title: 'Лицензия' }] }, 'license')).toBe('Лицензия')
    expect(enumTitle({ enum: ['license'] }, 'license')).toBeUndefined()
  })
})

describe('сроки действия', () => {
  const now = new Date(2026, 9, 3, 15, 0)
  const e = (key: string, validUntil?: string): Entity => ({ kind: 'credential', key, title: key, attributes: validUntil !== undefined ? { validUntil } : {} })

  it('дни — календарные, по часам браузера', () => {
    expect(daysLeft('2026-10-03', now)).toBe(0)
    expect(daysLeft('2026-10-13', now)).toBe(10)
    expect(daysLeft('2026-10-01', now)).toBe(-2)
    expect(daysLeft('13.10.2026', now)).toBeUndefined()
  })

  it('«Требует внимания» — как правило knowledge-expiry: 30 дней вперёд, 7 назад, ближайшее первым', () => {
    const list = expiring([e('later', '2026-12-01'), e('soon', '2026-10-13'), e('gone', '2026-09-20'), e('late', '2026-09-30'), e('none')], now)
    expect(list.map(x => [x.entity.key, x.days])).toEqual([['late', -3], ['soon', 10]])
  })
})

describe('поиск в базе знаний', () => {
  const entity: Entity = { kind: 'credential', key: 'credential:license:77-Б/00123', title: 'Лицензия МЧС на монтаж', attributes: { issuer: 'ГУ МЧС России', number: '77-Б/00123', okpd2: ['43.21'] } }
  it('каждое слово — в названии, ключе или текстовых атрибутах', () => {
    expect(matchesText(entity, 'мчс 00123')).toBe(true)
    expect(matchesText(entity, '43.21')).toBe(true)
    expect(matchesText(entity, 'мчс договор')).toBe(false)
    expect(matchesText(entity, '  ')).toBe(true)
  })
})

describe('адрес страницы документа', () => {
  it('ключ с «/» и «:» переживает адрес; неверный вид отбрасывается', () => {
    const href = entryHref({ kind: 'credential', key: 'credential:license:77-Б/00123' })
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams)
    expect(parseEntrySearch(params)).toEqual({ kind: 'credential', key: 'credential:license:77-Б/00123' })
    expect(parseEntrySearch({ kind: '../x', key: '' })).toEqual({})
    // Организация переживает переход: без неё страница искала бы запись в первом корне дерева.
    const ws = 'd4000000-0000-4000-8000-0000000000a1'
    const withWs = Object.fromEntries(new URL(entryHref({ kind: 'component', key: 'control-plane' }, ws), 'http://x').searchParams)
    expect(parseEntrySearch(withWs)).toEqual({ kind: 'component', key: 'control-plane', ws })
  })
})

describe('источник записи', () => {
  it('из полей памяти, без повторов', () => {
    const e: Entity = { kind: 'component', key: 'control-plane', title: 'control-plane', attributes: {}, source: 'git:control-plane', sources: [{ source: 'git:control-plane' }, { source: '1c' }] }
    expect(sourcesOf(e)).toEqual(['git:control-plane', '1c'])
    expect(sourcesOf({ kind: 'x', key: 'y', title: '', attributes: {} })).toEqual([])
  })
})

describe('сводка сверки', () => {
  it('по счётчикам версий ядра: изменение — заменённая версия, а не «открыто + закрыто»', async () => {
    const { reconcileSummary } = await import('../src/screens/knowledge/Knowledge.tsx')
    // Счётчики живой сверки git-источника (63 сущности заменены, одна без изменений).
    expect(reconcileSummary({ 'entities.opened': 63, 'entities.superseded': 63, 'entities.closed': 63, 'entities.unchanged': 1, opened: 63, closed: 63 })).toEqual({ added: 0, changed: 63, removed: 0 })
    expect(reconcileSummary({ 'entities.opened': 5, 'entities.superseded': 2, 'entities.closed': 3 })).toEqual({ added: 3, changed: 2, removed: 1 })
    expect(reconcileSummary({ created: 4 })).toEqual({ added: 4, changed: 0, removed: 0 })
  })
})

describe('связи и источник записи (CP-ADR-0060, амендмент 2026-10-03)', () => {
  it('связи — группами: подпись из пакета, прямые раньше обратных', async () => {
    const { relationGroups } = await import('../src/screens/knowledge/model.ts')
    const groups = relationGroups([
      { relation: 'counterparty', direction: 'in', kind: 'agreement', key: 'a:1', title: 'Д1' },
      { relation: 'held_by', direction: 'out', kind: 'legal_entity', key: 'inn:1', title: 'Альфа' },
      { relation: 'counterparty', direction: 'in', kind: 'agreement', key: 'a:2', title: 'Д2' },
    ], [{ relation: 'counterparty', title: 'Контрагент' }])
    expect(groups.map(g => [g.direction, g.title, g.items.map(i => i.title)])).toEqual([['out', 'held_by', ['Альфа']], ['in', 'Контрагент', ['Д1', 'Д2']]])
  })

  it('«известно с» — поле контракта, иначе переходное', async () => {
    const { knownSince } = await import('../src/screens/knowledge/model.ts')
    expect(knownSince({ kind: 'k', key: 'x', title: '', attributes: {}, validFrom: '2026-10-01', valid_from: '2026-01-01' })).toBe('2026-10-01')
    expect(knownSince({ kind: 'k', key: 'x', title: '', attributes: {}, valid_from: '2026-01-01' })).toBe('2026-01-01')
    expect(knownSince({ kind: 'k', key: 'x', title: '', attributes: {} })).toBeUndefined()
  })
})
