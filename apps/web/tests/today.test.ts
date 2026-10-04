import { describe, expect, it } from 'vitest'
import { failedRunState } from '../src/screens/today/Today.tsx'

describe('«Сломано / застряло»: упавшие попытки — пока работа стоит', () => {
  // Случаи со staging 2026-10-03.
  it('снятая работа — решение принято, строки нет (TASK-001294)', () => {
    expect(failedRunState({ systemStatusCategory: 'terminal_cancelled', status: 'cancelled' }, false)).toBe('skip')
    expect(failedRunState({ systemStatusCategory: 'terminal_success', status: 'done' }, false)).toBe('skip')
  })
  it('идёт новая попытка — её повторяют, это «Сейчас в работе» (TASK-001009)', () => {
    expect(failedRunState({ systemStatusCategory: 'active', status: 'in_progress' }, true)).toBe('skip')
  })
  it('после упавших попыток сдана и проверяется — не поломка (TASK-001009)', () => {
    const v = (status: string) => ({ systemStatusCategory: 'active', status: 'in_progress', verification: { id: 'v', status, attempt: 3, updatedAt: '' } }) as never
    expect(failedRunState(v('running'), false)).toBe('skip')
    expect(failedRunState(v('waiting_human'), false)).toBe('skip')
    expect(failedRunState(v('failed'), false)).toBe('failed')
  })
  it('заблокирована — так и сказано (TASK-001277, TASK-001234)', () => {
    expect(failedRunState({ systemStatusCategory: 'blocked', status: 'blocked', verification: { id: 'v', status: 'failed', attempt: 1, updatedAt: '' } } as never, false)).toBe('blocked')
  })
  it('работа стоит и никто её не двигает — сломано (TASK-001014)', () => {
    expect(failedRunState({ systemStatusCategory: 'active', status: 'todo' }, false)).toBe('failed')
  })
  it('работа ещё не загружена — не показывать раньше времени', () => {
    expect(failedRunState(undefined, false)).toBe('skip')
  })
})
