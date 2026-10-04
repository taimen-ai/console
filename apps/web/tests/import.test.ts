import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'
import { targetOf } from '../src/screens/knowledge/ImportDialog.tsx'
import { mediaTypeOf, planLine, XLSX, type Plan } from '../src/screens/knowledge/importFlow.ts'
import type { Pack } from '../src/screens/knowledge/model.ts'

i18n.loadAndActivate({ locale: 'en', messages: {} })

const pack = (name: string, kinds: string[]): Pack => ({ name, version: '1', ref: `${name}@1`, kinds: kinds.map(kind => ({ kind, title: kind.toUpperCase() })) })
const plan = (status: string, counts = {}, errors = 0): Plan => ({ status, templateVersion: 'x@1', source: 's', rows: 3, counts, summary: '', rowErrors: Array.from({ length: errors }, (_, i) => ({ row: i + 2, code: 'required', message: 'm' })) })

describe('загрузка таблицы в базу знаний', () => {
  it('тип содержимого: по расширению, иначе как сказал браузер', () => {
    expect(mediaTypeOf({ name: 'Orgs.XLSX', type: '' })).toBe(XLSX)
    expect(mediaTypeOf({ name: 'orgs.csv', type: '' })).toBe('text/csv')
    expect(mediaTypeOf({ name: 'a.bin', type: '' })).toBe('application/octet-stream')
    expect(mediaTypeOf({ name: 'a.txt', type: 'text/plain' })).toBe('text/plain')
  })

  it('пакет вида — первый включённый, где вид объявлен; прочие включённые — связями и профилями', () => {
    const refs = [{ ref: 'default@1', pack: pack('default', ['legal_entity']) }, { ref: 'company@1', pack: pack('company', ['agreement', 'legal_entity']) }]
    expect(targetOf(refs, { kind: 'agreement', title: 'Договор' }, 'ws')).toEqual({ workspaceId: 'ws', pack: 'company@1', kind: 'agreement', packs: ['default@1'], definitions: [refs[1]!.pack, refs[0]!.pack], kindTitle: 'Договор' })
    expect(targetOf(refs, { kind: 'legal_entity' }, 'ws')?.pack).toBe('default@1')
    expect(targetOf(refs, { kind: 'asset' }, 'ws')).toBeUndefined()
  })

  it('итог плана одной строкой: счёт, ошибки строк или пустая таблица', () => {
    expect(planLine(plan('ok', { opened: 2, changed: 1 }))).toContain('2')
    expect(planLine(plan('invalid', {}, 3))).toContain('3')
    expect(planLine(plan('empty'))).not.toContain('{')
  })
})
