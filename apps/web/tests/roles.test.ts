import { describe, expect, it } from 'vitest'
import { holderCounts, missingRoles, slugOf, vacantRoles, withoutRoles } from '../src/api/roles.ts'

describe('роли работы', () => {
  const lawyer = { id: 'r-law', slug: 'lawyer', name: 'Юрист' }
  const accountant = { id: 'r-acc', slug: 'accountant', name: 'Бухгалтер' }
  const holders = new Map([['r-law', new Set<string>()], ['r-acc', new Set(['ivan'])]])

  it('недостающие роли — только среди тех, чьи владельцы известны', () => {
    expect(missingRoles('ivan', [lawyer, accountant], holders)).toEqual([lawyer])
    expect(missingRoles('irina', [lawyer, accountant], holders)).toEqual([lawyer, accountant])
    expect(missingRoles('irina', [{ id: 'r-x', slug: 'x', name: 'X' }], holders)).toEqual([])
  })

  it('роль никто не занимает — пустой набор владельцев', () => {
    expect(vacantRoles([lawyer, accountant], holders)).toEqual([lawyer])
  })

  it('«без роли» снимает только эту роль, прочие требования остаются', () => {
    const req = { roles: [{ id: 'r-law', slug: 'lawyer' }, { id: 'r-acc', slug: 'accountant' }], capabilities: [{ id: 'c', name: 'sign' }], skills: [{ id: 's', name: 'ocr', version: '2' }] }
    expect(withoutRoles(req, ['lawyer'])).toEqual({ roles: ['accountant'], capabilities: ['sign'], skills: ['ocr@2'] })
  })
})

describe('люди и роли', () => {
  it('ключ роли из названия — транслитом, только латиница, цифры и дефисы', () => {
    expect(slugOf('Юрист')).toBe('yurist')
    expect(slugOf('Финансовый директор')).toBe('finansovyy-direktor')
    expect(slugOf('  QA / Lead 2 ')).toBe('qa-lead-2')
  })

  it('сколько людей занимает роль — без повторов одного человека в разных пространствах', () => {
    const role = (id: string) => ({ id, slug: id, name: id, workspaceId: null, version: 1 })
    const a = (id: string, ws: string | null) => ({ id: `${id}-${ws}`, principalId: 'p', workspaceId: ws, createdAt: '', role: role(id) })
    const counts = holderCounts(new Map([['p1', [a('acc', null), a('acc', 'ws1')]], ['p2', [a('acc', null), a('law', null)]]]))
    expect(counts.get('acc')).toBe(2)
    expect(counts.get('law')).toBe(1)
  })
})
