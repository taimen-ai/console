import { describe, expect, it } from 'vitest'
import { declaredSecrets, secretRows } from '../src/screens/settings/Secrets.tsx'

describe('секреты агентов', () => {
  it('объявленные имена — строками или {name}, без повторов', () => {
    expect(declaredSecrets({ key: 'a', displayName: 'A', status: 'active', revision: { spec: { placement: { secrets: ['x', { name: 'y' }, 'x'] } } } })).toEqual(['x', 'y'])
    expect(declaredSecrets({ key: 'a', displayName: 'A', status: 'active', revision: null })).toEqual([])
  })

  it('строки: объявленные (заданы или нет), затем заданные без объявления', () => {
    const s = (name: string) => ({ name, updatedAt: '2026-10-03T10:00:00Z', updatedBy: 'p' })
    const rows = secretRows(['a', 'b'], [s('b'), s('old')])
    expect(rows.map(r => [r.name, r.declared, r.secret !== undefined])).toEqual([['a', true, false], ['b', true, true], ['old', false, true]])
  })
})
