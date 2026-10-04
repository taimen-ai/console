import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'
import { numeric } from '../src/screens/view/Chart.tsx'
import { moneyText, statusMark } from '../src/screens/view/values.tsx'
import { SUPPORTED_BLOCKS, viewHref } from '../src/screens/view/ViewScreen.tsx'

i18n.loadAndActivate({ locale: 'ru', messages: {} })

describe('значения экрана пакета', () => {
  it('деньги: строка десятичной записи или число, в валюте записи', () => {
    expect(moneyText({ amount: '184500.00', currency: 'RUB' })).toMatch(/184\s500\s₽/)
    expect(moneyText({ amount: 42750.5, currency: 'RUB' })).toMatch(/42\s750,5/)
    expect(moneyText({ amount: 'не число', currency: 'RUB' })).toBeUndefined()
    expect(moneyText({ amount: '10', currency: 'XYZ1' })).toBe('10')
  })

  it('категория экземпляра или работы → знак статуса', () => {
    expect(statusMark('completed')).toBe('verified')
    expect(statusMark('failed')).toBe('failed')
    expect(statusMark('suspended')).toBe('blocked')
    expect(statusMark('waiting_human')).toBe('waiting_human')
    expect(statusMark('blocked')).toBe('blocked')
    expect(statusMark(undefined)).toBe('running')
  })
})

describe('отрисовщик видов', () => {
  it('рисует блоки набора версии 1; invoke, component и незнакомое — заглушкой', () => {
    for (const b of ['header', 'metrics', 'board', 'chart', 'table', 'list', 'fields', 'steps', 'timeline', 'artifacts', 'related']) expect(SUPPORTED_BLOCKS.has(b)).toBe(true)
    for (const b of ['invoke', 'component', 'custom']) expect(SUPPORTED_BLOCKS.has(b)).toBe(false)
  })

  it('адрес вида и экземпляра', () => {
    expect(viewHref('invoices')).toBe('/console/v/invoices')
    expect(viewHref('invoice', 'e5/1')).toBe('/console/v/invoice/e5%2F1')
  })
})

describe('график экрана пакета', () => {
  it('значение для фигуры: деньги и числа, прочее — 0', () => {
    expect(numeric({ amount: '411600.00', currency: 'RUB' })).toBe(411600)
    expect(numeric(3)).toBe(3)
    expect(numeric('7')).toBe(7)
    expect(numeric({ title: 'x' })).toBe(0)
    expect(numeric(null)).toBe(0)
  })
})

describe('длительность экрана пакета — ISO 8601', () => {
  it('разбирается в миллисекунды; не ISO — null', async () => {
    const { parseIsoDuration } = await import('../src/screens/view/values.tsx')
    expect(parseIsoDuration('PT5400S')).toBe(5_400_000)
    expect(parseIsoDuration('P1DT2H30M')).toBe((26 * 60 + 30) * 60_000)
    expect(parseIsoDuration('PT0.5S')).toBe(500)
    expect(parseIsoDuration('P')).toBeNull()
    expect(parseIsoDuration('PT')).toBeNull()
    expect(parseIsoDuration('5400')).toBeNull()
  })
})
