import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'
import type { Approval, Run, Task, TaskComment, Verification } from '../src/api/types.ts'
import { buildHistory, duration } from '../src/screens/task/history.ts'

// Исходный язык без каталога: строки — как в коде.
i18n.loadAndActivate({ locale: 'en', messages: {} })

const ME = 'c3000000-0000-4000-8000-0000000000c3'
const AGENT = 'c3000000-0000-4000-8000-0000000000a9'

const task = {
  id: 't1', publicId: 'TASK-000421', title: 'Сверить счёт №421', description: '', createdBy: ME, origin: { kind: 'process', ref: 'invoice-approval' },
  createdAt: '2026-10-03T07:30:00Z', completedAt: null,
} as unknown as Task

const people = new Map([
  [ME, { id: ME, kind: 'human', displayName: 'Антон Белов' }],
  [AGENT, { id: AGENT, kind: 'agent', displayName: 'Сверщик счетов' }],
]) as never

const run = (attempt: number, at: string): Run => ({ id: `r${attempt}`, taskId: 't1', principalId: AGENT, attempt, status: 'failed', startedAt: at, finishedAt: at, createdAt: at, failureReason: { message: 'сумма не совпадает' } }) as unknown as Run
const verification: Verification = {
  id: 'v1', taskId: 't1', attempt: 1, status: 'failed', trigger: 'complete', approvalId: null, startedAt: '2026-10-03T10:18:00Z', finishedAt: '2026-10-03T10:18:00Z',
  checks: [{ key: 'amount', kind: 'deterministic', description: 'Сумма совпадает с актом' }, { key: 'requisites', kind: 'deterministic', description: 'Реквизиты совпадают' }],
  results: [{ key: 'amount', kind: 'deterministic', status: 'failed', message: '99 600 ≠ 96 000' }],
}
const approval = { id: 'a1', taskId: 't1', status: 'pending', assignedPrincipalId: ME, decisionByPrincipalId: null, decisionAt: null, createdAt: '2026-10-03T11:00:00Z', comment: null } as unknown as Approval
const comment = { id: 'c1', taskId: 't1', authorPrincipalId: ME, body: 'Запросил исправленный счёт', createdAt: '2026-10-03T11:30:00Z' } as unknown as TaskComment

describe('история работы', () => {
  const now = new Date('2026-10-03T12:00:00Z')
  const history = buildHistory({ task, people, me: ME, events: [], runs: [run(1, '2026-10-03T10:17:00Z')], verifications: [verification], approvals: [approval], comments: [comment], boxes: new Map([['r1', 'протокол']]) }, now)

  it('группы по времени: основание → попытка → проверка → подпись → обсуждение', () => {
    expect(history.groups.map(g => g.kind)).toEqual(['origin', 'attempt', 'verify', 'signature', 'discussion'])
    expect(history.groups[1]!.actor?.kind).toBe('agent')
    expect(history.groups[1]!.status).toBe('failed')
    expect(history.groups[1]!.box).toBe('протокол')
    expect(history.groups[3]!.human).toBe(true)
    expect(history.groups[3]!.done).toBe(false)
  })

  it('непроверенный критерий не выдаётся за проваленный', () => {
    const criteria = history.groups[2]!.criteria!
    expect(criteria[0]).toEqual({ ok: false, text: 'Сумма совпадает с актом — 99 600 ≠ 96 000' })
    expect(criteria[1]!.ok).toBe(false)
    expect(criteria[1]!.text).toMatch(/^Реквизиты совпадают — /)
    expect(criteria[1]!.text).not.toBe('Реквизиты совпадают')
  })

  it('«По времени»: отрезки покрывают срок работы до сейчас, ожидание подписи — человеческое', () => {
    expect(history.spans.length).toBe(4)
    expect(history.spans[0]!.from).toBe(0)
    expect(history.spans.at(-1)!.to).toBe(100)
    expect(history.spans.at(-1)!.human).toBe(true)
  })

  it('«Полный журнал» — по времени, с машинными типами', () => {
    expect(history.events.map(e => e.type)).toEqual(['run.started', 'run.failed', 'approval.requested', 'task.comment_added'])
  })

  it('длительность словами', () => {
    expect(duration(20_000)).toBe('< 1 min')
    expect(duration(12 * 60_000)).toBe('12 min')
    expect(duration(85 * 60_000)).toBe('1 h 25 min')
    expect(duration(3 * 86_400_000)).toBe('3 d')
  })
})
