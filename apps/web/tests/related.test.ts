import { describe, expect, it } from 'vitest'
import { groupRelated } from '../src/screens/view/ViewScreen.tsx'
import { navGroupOf } from '../src/shell/Shell.tsx'

describe('экраны пакетов: контракт видов (TASK-001298/1299)', () => {
  it('связанные записи — группами по связи, подпись связи из ядра или её имя', () => {
    const groups = groupRelated([
      { relation: 'supplier', title: 'Поставщик', kind: 'legal_entity', key: 'inn:1', entityTitle: 'А' },
      { relation: 'governed_by', kind: 'agreement', key: 'a:1', entityTitle: 'Д1' },
      { relation: 'governed_by', kind: 'agreement', key: 'a:2', entityTitle: 'Д2' },
    ])
    expect(groups.map(g => [g.title, g.items.map(i => i.entityTitle)])).toEqual([['Поставщик', ['А']], ['governed_by', ['Д1', 'Д2']]])
  })

  it('группа меню — закрытый список, прочее и пусто — «Пакеты»', () => {
    expect(navGroupOf('work')).toBe('work')
    expect(navGroupOf('knowledge')).toBe('knowledge')
    expect(navGroupOf('packages')).toBe('packages')
    expect(navGroupOf('finance')).toBe('packages')
    expect(navGroupOf(undefined)).toBe('packages')
  })
})
