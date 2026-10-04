import { describe, expect, it } from 'vitest'
import type { JournalEvent } from '../src/api/types.ts'
import { csvCell, eventParams, matches, parseJournalSearch, toCsv, toJsonl } from '../src/screens/journal/journal.ts'

const WHO = 'c3000000-0000-4000-8000-0000000000c3'
const WS = 'b2000000-0000-4000-8000-0000000000f1'

function event(fields: Partial<JournalEvent> = {}): JournalEvent {
  return {
    id: 'e1', sequence: 7, type: 'task.created', entityType: 'task', entityId: 'f0000000-0000-4000-8000-000000000001', actorId: WHO, workspaceId: WS,
    payload: { publicId: 'TASK-000840', title: 'Счёт №417, «Альфа»' }, occurredAt: new Date(2026, 9, 3, 12, 0).toISOString(), cursor: 'c7', ...fields,
  }
}

describe('журнал: адрес и фильтры', () => {
  it('неверное отбрасывается; группа — префиксы типов в ядро, объект — тоже', () => {
    expect(parseJournalSearch({ family: 'access', who: 'x', from: '2026-10-01', to: '01.10.2026', entityType: 'task', entityId: WHO, extra: 1 }))
      .toEqual({ family: 'access', from: '2026-10-01', entityType: 'task', entityId: WHO })
    expect(parseJournalSearch({ family: 'toString' })).toEqual({})
    const params = eventParams({ family: 'decisions', entityType: 'task', entityId: WHO })
    expect(params.getAll('types')).toEqual(['approval.'])
    expect(params.get('entityId')).toBe(WHO)
  })

  it('автор, период (по-дневно, включительно) и область — на стороне консоли', () => {
    const all = (): boolean => true
    expect(matches(event(), { who: WHO }, all)).toBe(true)
    expect(matches(event({ actorId: null }), { who: WHO }, all)).toBe(false)
    expect(matches(event(), { from: '2026-10-03', to: '2026-10-03' }, all)).toBe(true)
    expect(matches(event(), { from: '2026-10-04' }, all)).toBe(false)
    expect(matches(event(), { to: '2026-10-02' }, all)).toBe(false)
    expect(matches(event(), {}, ws => ws !== WS)).toBe(false)
    expect(matches(event({ type: 'approval.approved' }), { family: 'work' }, all)).toBe(false)
  })
})

describe('журнал: выгрузка', () => {
  it('CSV: кавычки, запятые и переводы строк — в кавычках; формулы обезврежены; нагрузка — JSON', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell(null)).toBe('')
    const csv = toCsv([event()], id => (id === WHO ? 'Антон' : 'Система'))
    const [head, row] = csv.trim().split('\r\n')
    expect(head).toBe('sequence,occurredAt,type,actorId,actor,entityType,entityId,workspaceId,payload,id')
    expect(row).toContain(',task.created,')
    expect(row).toContain('Антон')
    expect(row).toContain('"{""publicId"":""TASK-000840"",""title"":""Счёт №417, «Альфа»""}"')
  })

  it('JSON Lines — записи как есть, по одной на строку', () => {
    const lines = toJsonl([event(), event({ id: 'e2' })]).trim().split('\n').map(l => JSON.parse(l) as JournalEvent)
    expect(lines.map(e => e.id)).toEqual(['e1', 'e2'])
    expect(toJsonl([])).toBe('')
  })
})
