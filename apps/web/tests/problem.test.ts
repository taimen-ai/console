import { describe, expect, it } from 'vitest'
import type { Artifact, TaskComment, Verification } from '../src/api/types.ts'
import { changedAfter, failuresInRow } from '../src/screens/task/Problem.tsx'
import { retryTargetOf } from '../src/screens/task/TaskActions.tsx'

const v = (status: string): Verification => ({ id: status, taskId: 't', attempt: 1, status, trigger: 'complete', checks: [], results: [], approvalId: null, startedAt: '', finishedAt: null })
const target = (status: string, systemStatusCategory: string, route = 'update') => ({ status, displayName: status, systemStatusCategory, route })

describe('проблема работы', () => {
  it('провалы подряд: от последней непроваленной попытки, отменённые серию не прерывают', () => {
    expect(failuresInRow([v('failed'), v('cancelled'), v('failed'), v('passed'), v('failed')])).toBe(2)
    expect(failuresInRow([v('running'), v('failed')])).toBe(0)
    expect(failuresInRow([])).toBe(0)
  })

  it('после провала изменилось: комментарий или материал, но не протокол попытки', () => {
    const at = '2026-10-03T10:40:00Z'
    const comment = { createdAt: '2026-10-03T11:00:00Z' } as TaskComment
    const transcript = { type: 'transcript', createdAt: '2026-10-03T11:00:00Z' } as Artifact
    const act = { type: 'document', createdAt: '2026-10-03T11:00:00Z' } as Artifact
    expect(changedAfter(at, [], [transcript])).toBe(false)
    expect(changedAfter(at, [comment], [])).toBe(true)
    expect(changedAfter(at, [], [act])).toBe(true)
    expect(changedAfter(null, [comment], [act])).toBe(false)
  })

  it('куда повторить: статус возврата типа, иначе начальный; не блокирующий и не конечный', () => {
    const targets = [target('backlog', 'backlog'), target('todo', 'active'), target('done', 'terminal_success', 'complete'), target('blocked', 'blocked')]
    expect(retryTargetOf(targets, { releaseStatus: 'todo', initialStatus: 'backlog' })?.status).toBe('todo')
    expect(retryTargetOf(targets, { releaseStatus: 'missing', initialStatus: 'backlog' })?.status).toBe('backlog')
    expect(retryTargetOf(targets, { releaseStatus: 'blocked' })).toBeUndefined()
    expect(retryTargetOf(targets, undefined)).toBeUndefined()
  })
})
