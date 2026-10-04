import { describe, expect, it } from 'vitest'
import { findStep } from '../src/forms/StepForm.tsx'
import { defaultUi, enumOptions, initialValues, payload, ruleState, validate, type FormSchema, type UiElement } from '../src/forms/schema.ts'

const schema: FormSchema = {
  type: 'object', required: ['verdict'],
  properties: {
    verdict: { type: 'string', enum: ['ok', 'mismatch'], description: 'ok — счёт верен; mismatch — отклонить' },
    note: { type: 'string', maxLength: 5 },
    amount: { type: 'integer', minimum: 1 },
  },
}
const ui: UiElement = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Control', scope: '#/properties/verdict' },
    { type: 'Control', scope: '#/properties/note', rule: { effect: 'SHOW', condition: { scope: '#/properties/verdict', schema: { const: 'mismatch' } } } },
    { type: 'Control', scope: '#/properties/amount' },
  ],
}

describe('формы шагов', () => {
  it('правила uischema: SHOW/HIDE/ENABLE/DISABLE по const и enum', () => {
    const rule = (effect: 'SHOW' | 'HIDE' | 'ENABLE' | 'DISABLE') => ({ effect, condition: { scope: '#/properties/v', schema: { enum: ['a', 'b'] } } })
    expect(ruleState(rule('SHOW'), { v: 'a' })).toEqual({ visible: true, enabled: true })
    expect(ruleState(rule('SHOW'), { v: 'c' }).visible).toBe(false)
    expect(ruleState(rule('HIDE'), { v: 'b' }).visible).toBe(false)
    expect(ruleState(rule('ENABLE'), {}).enabled).toBe(false)
    expect(ruleState(rule('DISABLE'), { v: 'a' }).enabled).toBe(false)
    expect(ruleState(undefined, {})).toEqual({ visible: true, enabled: true })
  })

  it('подписи вариантов: oneOf, иначе из описания, иначе значение', () => {
    expect(enumOptions({ oneOf: [{ const: 1, title: 'Один' }] })).toEqual([{ value: 1, label: 'Один' }])
    expect(enumOptions(schema.properties!.verdict!).map(o => o.label)).toEqual(['счёт верен', 'отклонить'])
    // Через запятую, как в описаниях пакетов; запятая внутри подписи — не граница
    expect(enumOptions({ enum: ['sale', 'purchase', 'other'], description: 'sale — компания исполнитель, purchase — заказчик, по договору' }).map(o => o.label))
      .toEqual(['компания исполнитель', 'заказчик, по договору', 'other'])
    expect(enumOptions({ enum: ['x'] })).toEqual([{ value: 'x', label: 'x' }])
  })

  it('проверка: обязательные, границы, скрытые поля не проверяются', () => {
    expect(validate(schema, ui, {})).toEqual({ verdict: 'required' })
    expect(validate(schema, ui, { verdict: 'ok', note: 'слишком длинно', amount: 0 })).toEqual({ amount: 'minimum' })
    expect(validate(schema, ui, { verdict: 'mismatch', note: 'слишком длинно', amount: 1.5 })).toEqual({ note: 'maxLength', amount: 'type' })
    expect(validate(schema, ui, { verdict: 'nope' })).toEqual({ verdict: 'enum' })
  })

  it('отправляются только видимые заполненные поля', () => {
    expect(payload(ui, { verdict: 'ok', note: 'x', amount: undefined })).toEqual({ verdict: 'ok' })
    expect(payload(ui, { verdict: 'mismatch', note: 'x', amount: 3 })).toEqual({ verdict: 'mismatch', note: 'x', amount: 3 })
  })

  it('начальные значения: записанные в работу, затем default', () => {
    expect(initialValues({ properties: { a: { default: 1 }, b: { default: 2 } } }, { b: 5, c: 9 })).toEqual({ a: 1, b: 5 })
    expect(defaultUi({ properties: { a: {}, b: {} } }).elements?.map(e => e.scope)).toEqual(['#/properties/a', '#/properties/b'])
  })

  it('шаг ищется по всему описанию процесса, только шаг с участием человека', () => {
    const spec = { stages: [{ steps: [{ id: 'a', agent: {} }, { id: 'b', branches: [{ steps: [{ id: 'c', human: { form: {} } }] }] }] }] }
    expect(findStep(spec, 'c')?.id).toBe('c')
    expect(findStep(spec, 'a')).toBeUndefined()
  })
})

describe('вложенные объекты и списки', () => {
  it('путь scope, чтение и запись по пути без изменения исходного', async () => {
    const { scopePath, getIn, setIn, pathKey, pointerKey } = await import('../src/forms/schema.ts')
    expect(scopePath('#/properties/a/properties/b')).toEqual(['a', 'b'])
    expect(scopePath('#/properties/a~1b')).toEqual(['a/b'])
    expect(scopePath('#/definitions/x')).toBeUndefined()
    const src = { list: [{ x: 1 }], o: { a: 1 } }
    expect(getIn(src, ['list', 0, 'x'])).toBe(1)
    const next = setIn(src.list, [0, 'x'], 2)
    expect(next).toEqual([{ x: 2 }])
    expect(src.list[0]!.x).toBe(1)
    expect(setIn({ a: 1, b: 2 }, ['a'], undefined)).toEqual({ b: 2 })
    expect(pathKey(['limits', 0, 'inn'])).toBe('limits/0/inn')
    expect(pathKey(['a/b'])).toBe('a~1b')
    expect(pointerKey('/limits/0/inn')).toBe('limits/0/inn')
  })

  it('проверка вглубь: обязательные поля объекта, границы списка, элементы', async () => {
    const { validate } = await import('../src/forms/schema.ts')
    const schema: FormSchema = { type: 'object', properties: {
      limits: { type: 'array', maxItems: 1, items: { type: 'object', required: ['inn'], properties: { inn: { type: 'string', pattern: '^\\d{10}$' }, amount: { type: 'number', minimum: 0 } } } },
      channels: { type: 'array', minItems: 1, items: { type: 'string', enum: ['a', 'b'] } },
    } }
    const ui = defaultUi(schema)
    expect(validate(schema, ui, { limits: [{ inn: '1', amount: -1 }, {}], channels: [] })).toEqual({
      'limits': 'maxItems', 'limits/0/inn': 'pattern', 'limits/0/amount': 'minimum', 'limits/1/inn': 'required', 'channels': 'minItems',
    })
    expect(validate(schema, ui, { limits: [{ inn: '1234567890' }], channels: ['a'] })).toEqual({})
  })

  it('правило по вложенному полю', () => {
    expect(ruleState({ effect: 'SHOW', condition: { scope: '#/properties/o/properties/on', schema: { const: true } } }, { o: { on: true } }).visible).toBe(true)
    expect(ruleState({ effect: 'SHOW', condition: { scope: '#/properties/o/properties/on', schema: { const: true } } }, { o: {} }).visible).toBe(false)
  })

  it('значения по умолчанию нового элемента — из default свойств', async () => {
    const { defaultsOf } = await import('../src/forms/schema.ts')
    expect(defaultsOf({ type: 'object', properties: { a: { default: 1 }, b: {} } })).toEqual({ a: 1 })
    expect(defaultsOf({ type: 'array', items: { type: 'string' } })).toEqual([])
    expect(defaultsOf({ type: 'string' })).toBeUndefined()
  })
})
