import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'
import type { Task } from '../src/api/types.ts'
import { readinessOf, statusLabelOf, statusOf } from '../src/screens/work/rows.ts'
import { matches, mergeTasks, parseWorkSearch, taskParams, taskStreams } from '../src/screens/work/search.ts'

i18n.loadAndActivate({ locale: 'en', messages: {} })

const ME = 'c3000000-0000-4000-8000-0000000000c3'
const IVAN = 'c3000000-0000-4000-8000-000000000001'

function task(fields: Partial<Task> = {}): Task {
  return {
    id: 't1', tenantId: 'x', publicId: 'TASK-000840', workspaceId: null, projectId: null, typeId: 'y', typeKey: 'invoice-approval', typeVersion: 1,
    title: 'Согласовать оплату счёта №417', description: 'Альфа-Снаб', status: 'in_progress', systemStatusCategory: 'active', priority: 'normal',
    ownerId: ME, assigneeId: IVAN, customFields: {}, startDate: null, dueDate: null, goalId: null, origin: { kind: 'human' }, acceptance: [], evidence: [],
    version: 1, claimEpoch: 0, activeClaimId: null, createdBy: ME, createdAt: '2026-10-03T08:00:00Z', updatedAt: '2026-10-03T08:00:00Z', completedAt: null, verification: null,
    ...fields,
  } as Task
}

describe('фильтры «Работы» в адресе', () => {
  it('неверное и неизвестное отбрасывается, а не уходит в ядро', () => {
    expect(parseWorkSearch({ q: '  счёт 417 ', mine: 'true', exec: 'not-a-uuid', owner: IVAN, due: 'yesterday', sort: 'title', extra: 1 }))
      .toEqual({ q: 'счёт 417', mine: true, owner: IVAN })
    expect(parseWorkSearch({ q: 'x'.repeat(300), sort: 'dueDate', due: 'week' })).toEqual({ q: 'x'.repeat(200), sort: 'dueDate', due: 'week' })
  })

  it('«Только моё» — два потока: исполнитель я и отвечаю я; «Выполняет» в нём не действует', () => {
    const streams = taskStreams({ mine: true, exec: IVAN, type: 'tender-bid' }, ME)
    expect(streams.map(p => [p.get('assigneeId'), p.get('ownerId')])).toEqual([[ME, null], [null, ME]])
    expect(streams.every(p => p.get('typeKey') === 'tender-bid')).toBe(true)
    // «Отвечает» — другой человек: второй поток не нужен, первый сужен им.
    const narrowed = taskStreams({ mine: true, owner: IVAN }, ME)
    expect(narrowed.map(p => [p.get('assigneeId'), p.get('ownerId')])).toEqual([[ME, IVAN]])
    expect(taskStreams({ exec: IVAN }, ME).map(p => p.get('assigneeId'))).toEqual([IVAN])
    // Пока «я» неизвестен — без фильтра по людям, как раньше.
    expect(taskStreams({ mine: true }, undefined)).toHaveLength(1)
  })

  it('слияние потоков — без повторов и в порядке ядра', () => {
    const a = task({ id: 'a', createdAt: '2026-10-03T10:00:00Z', dueDate: '2026-10-09T00:00:00Z' })
    const b = task({ id: 'b', createdAt: '2026-10-03T09:00:00Z', dueDate: null })
    const c = task({ id: 'c', createdAt: '2026-10-03T11:00:00Z', dueDate: '2026-10-05T00:00:00Z' })
    expect(mergeTasks([[a, b], [c, a]], undefined).map(x => x.id)).toEqual(['c', 'a', 'b'])
    expect(mergeTasks([[a, b], [c, a]], 'dueDate').map(x => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('срок — окном по часам браузера', () => {
    const now = new Date(2026, 9, 3, 12, 0)
    const params = taskParams({ exec: IVAN, type: 'tender-bid', due: 'today', sort: 'dueDate' }, ME, now)
    expect(params.get('assigneeId')).toBe(IVAN)
    expect(params.get('typeKey')).toBe('tender-bid')
    expect(params.get('sort')).toBe('dueDate')
    expect(new Date(params.get('dueFrom')!)).toEqual(new Date(2026, 9, 3))
    expect(new Date(params.get('dueTo')!)).toEqual(new Date(2026, 9, 4))
    expect(taskParams({ due: 'overdue' }, ME, now).has('dueFrom')).toBe(false)
  })

  it('отбор на стороне консоли совпадает с ядром: каждое слово — подстрока названия, описания или номера', () => {
    const now = new Date(2026, 9, 3, 12, 0)
    expect(matches(task(), { q: 'счёт альфа' }, ME, now)).toBe(true)
    expect(matches(task(), { q: '840' }, ME, now)).toBe(true)
    expect(matches(task(), { q: 'счёт вектор' }, ME, now)).toBe(false)
    // Отвечаю я — значит «моё», даже если исполнитель другой.
    expect(matches(task(), { mine: true }, ME, now)).toBe(true)
    expect(matches(task({ ownerId: IVAN }), { mine: true }, ME, now)).toBe(false)
    expect(matches(task({ ownerId: IVAN, assigneeId: ME }), { mine: true }, ME, now)).toBe(true)
    expect(matches(task(), { exec: IVAN, owner: ME }, ME, now)).toBe(true)
    expect(matches(task(), { due: 'week' }, ME, now)).toBe(false)
    expect(matches(task({ dueDate: new Date(2026, 9, 5).toISOString() }), { due: 'week' }, ME, now)).toBe(true)
    expect(matches(task({ dueDate: new Date(2026, 9, 2).toISOString() }), { due: 'overdue' }, ME, now)).toBe(true)
  })
})

describe('статус строки работы', () => {
  it('из категории ядра, проверки и захвата', () => {
    // Категории задач ядра: backlog, active, blocked, terminal_* (planned/paused — у проектов).
    expect(statusOf(task({ systemStatusCategory: 'backlog' }))).toBe('queued')
    expect(statusOf(task({ systemStatusCategory: 'blocked' }))).toBe('blocked')
    expect(statusOf(task({ activeClaimId: 'c1', claimEpoch: 1 }), 'agent')).toBe('running')
    expect(statusOf(task({ claimEpoch: 1 }), 'human')).toBe('waiting_human')
    expect(statusOf(task({ claimEpoch: 0 }), 'human')).toBe('queued')
    expect(statusOf(task({ claimEpoch: 1 }), 'agent')).toBe('queued')
    expect(statusOf(task({ verification: { id: 'v', status: 'failed', attempt: 2, updatedAt: '' } }))).toBe('failed')
    expect(statusOf(task({ verification: { id: 'v', status: 'running', attempt: 1, updatedAt: '' } }))).toBe('completed')
    expect(statusOf(task({ systemStatusCategory: 'terminal_success', verification: { id: 'v', status: 'passed', attempt: 1, updatedAt: '' } }))).toBe('verified')
    expect(statusOf(task({ systemStatusCategory: 'terminal_success' }))).toBe('completed')
  })

  it('снятая работа подписана словом, а не «нет прогресса»', () => {
    expect(statusLabelOf(task({ systemStatusCategory: 'terminal_cancelled' }))).toBe('withdrawn')
    expect(statusLabelOf(task())).toBeUndefined()
  })
})

describe('«Не начата»', () => {
  it('в очереди или активная, которую ни разу не брали', async () => {
    const { notStarted } = await import('../src/screens/work/rows.ts')
    expect(notStarted(task({ systemStatusCategory: 'backlog' }))).toBe(true)
    expect(notStarted(task({ systemStatusCategory: 'active', claimEpoch: 0, activeClaimId: null }))).toBe(true)
    expect(notStarted(task({ systemStatusCategory: 'active', claimEpoch: 2, activeClaimId: null }))).toBe(false)
    expect(notStarted(task({ systemStatusCategory: 'active', claimEpoch: 1, activeClaimId: 'c' }))).toBe(false)
  })
})

describe('фраза готовности', () => {
  it('блокировка важнее итога прошлой проверки (TASK-001277 на staging)', () => {
    const failed = { verification: { id: 'v', status: 'failed', attempt: 1, updatedAt: '' } }
    expect(readinessOf(task({ systemStatusCategory: 'blocked', status: 'blocked', ...failed }))).toBe('Blocked')
    expect(readinessOf(task(failed))).toBe('Did not pass verification (attempt 1)')
  })
})

describe('предложение работы ссылкой (/work/new)', () => {
  const EXEC = 'c3000000-0000-4000-8000-000000000011'
  it('разбор: без «что сделать» — нет предложения; неверное отбрасывается', async () => {
    const { parseProposal } = await import('../src/screens/work/proposal.ts')
    expect(parseProposal({ type: 'invoice-reconcile' })).toBeNull()
    expect(parseProposal({ title: ' Сверить счёт №430 ', type: 'invoice reconcile!', exec: 'не-uuid', owner: ME, due: 'завтра', result: 'Акт' }))
      .toEqual({ title: 'Сверить счёт №430', owner: ME, result: 'Акт' })
    // Роутер отдаёт «123» числом — это всё равно текст.
    expect(parseProposal({ title: 123 })).toEqual({ title: '123' })
  })

  it('срок: дата — до 18:00 по часам браузера, дата-время — как есть', async () => {
    const { dueInput } = await import('../src/screens/work/proposal.ts')
    expect(dueInput('2026-10-10')).toBe('2026-10-10T18:00')
    const local = new Date(2026, 9, 10, 9, 30)
    expect(dueInput(local.toISOString())).toBe('2026-10-10T09:30')
    expect(dueInput('10.10.2026')).toBeUndefined()
  })

  it('в ответе ассистента: ссылки разметкой и голые, свои — да, чужой origin — нет, повтор — один раз', async () => {
    const { findProposals } = await import('../src/screens/work/proposal.ts')
    const q = new URLSearchParams({ title: 'Сверить счёт №430 «Полюс»', exec: EXEC, due: '2026-10-10' })
    const text = `Подготовил: [сверка](/console/work/new?${q}). Ещё раз: /console/work/new?${q}.\n`
      + `Чужая: https://evil.example/console/work/new?title=x и своя абсолютная http://localhost/console/work/new?title=Позвонить`
    expect(findProposals(text, 'http://localhost')).toEqual([
      { title: 'Сверить счёт №430 «Полюс»', exec: EXEC, due: '2026-10-10T18:00' },
      { title: 'Позвонить' },
    ])
  })

  it('ключ идемпотентности — из сообщения и номера ссылки, одинаковый после перезагрузки', async () => {
    const { proposalKey, proposalReady } = await import('../src/screens/work/proposal.ts')
    const a = await proposalKey('m-1', 0)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(await proposalKey('m-1', 0)).toBe(a)
    expect(await proposalKey('m-1', 1)).not.toBe(a)
    expect(proposalReady({ title: 'x', result: 'y' })).toBe(false)
    expect(proposalReady({ title: 'x', result: 'y', due: '2026-10-10T18:00' })).toBe(true)
  })
})
