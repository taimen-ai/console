import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEvent } from '../src/api/types.ts'
import { initialConversation, reduce, timeline, type Action } from '../src/assistant/conversation.ts'
import type { StreamEvent } from '../src/assistant/surface.ts'
import { pickLocale } from '../src/i18n.ts'
import { readDay } from '../src/screens/today/day.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('язык интерфейса', () => {
  it('сохранённый выбор → языки браузера → язык развёртывания; предлагается только то, что разрешено', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    expect(pickLocale(['en', 'ru'], 'en', ['ru-RU', 'en'])).toBe('ru')
    expect(pickLocale(['en', 'ru'], 'en', ['de-DE'])).toBe('en')
    expect(pickLocale(['en'], 'en', ['ru-RU'])).toBe('en')
    store.set('console.locale', 'en')
    expect(pickLocale(['en', 'ru'], 'ru', ['ru-RU'])).toBe('en')
    store.set('console.locale', 'ru')
    expect(pickLocale(['en'], 'en', [])).toBe('en')
  })
})

describe('журнал дня', () => {
  const event = (seq: number, at: Date, type = 'task.created'): JournalEvent => ({
    id: `e${seq}`, sequence: seq, type, entityType: 'task', entityId: `t${seq}`, actorId: null, workspaceId: null, payload: {}, occurredAt: at.toISOString(), cursor: `c${seq}`,
  })

  it('читает назад от хвоста страницами до полуночи и не берёт вчерашнее', async () => {
    const now = new Date(2026, 9, 2, 14, 0)
    const midnight = new Date(2026, 9, 2)
    const all = [
      event(1, new Date(midnight.getTime() - 3_600_000)),
      ...Array.from({ length: 450 }, (_, i) => event(i + 2, new Date(midnight.getTime() + (i + 1) * 60_000))),
    ]
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(input, 'http://console.test')
      calls.push(url.search)
      const types = url.searchParams.getAll('types')
      expect(types).toEqual(['task.', 'work.', 'approval.', 'run.'])
      const before = url.searchParams.get('before')
      const limit = Number(url.searchParams.get('limit'))
      const older = before === null ? all : all.filter(e => e.sequence < Number(before.slice(1)))
      const items = older.slice(-limit)
      const prevCursor = older.length > items.length ? items[0]!.cursor : null
      return new Response(JSON.stringify({ items, nextCursor: 'x', prevCursor, hasMore: prevCursor !== null }), { status: 200 })
    })
    const day = await readDay(new AbortController().signal, now)
    expect(day.partial).toBe(false)
    expect(day.events).toHaveLength(450)
    expect(day.events[0]!.sequence).toBe(2)
    expect(day.events.at(-1)!.sequence).toBe(451)
    // tail, затем дважды before — третья страница дошла до вчерашнего события.
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('tail=200')
    expect(calls[1]).toContain('before=')
  })
})

describe('беседа ассистента', () => {
  const at = (s: number): string => new Date(Date.UTC(2026, 9, 2, 8, 0, s)).toISOString()
  const ev = (event: Record<string, unknown>): Action => ({ type: 'event', event: { cursor: `c${String(event.at)}`, ...event } as StreamEvent })

  it('своё сообщение уходит из «отправляю», когда беседа вернула его; ответ по кускам заменяется итоговым', () => {
    let s = reduce(initialConversation, { type: 'send', message: { requestId: 'r1', text: 'вопрос', at: at(1), state: 'sending' } })
    s = reduce(s, { type: 'sent', requestId: 'r1', queued: false })
    s = reduce(s, ev({ type: 'message', at: at(2), message: { id: 'u1', role: 'user', text: 'вопрос', at: at(2), requestId: 'r1' } }))
    expect(s.outgoing).toHaveLength(0)
    s = reduce(s, ev({ type: 'turn.started', at: at(3), turnId: 't1', requestId: 'r1' }))
    s = reduce(s, ev({ type: 'delta', at: at(4), messageId: 'a1', text: 'Отв' }))
    s = reduce(s, ev({ type: 'delta', at: at(5), messageId: 'a1', text: 'ет' }))
    expect(s.deltas).toEqual({ a1: 'Ответ' })
    s = reduce(s, ev({ type: 'message', at: at(6), message: { id: 'a1', role: 'assistant', text: 'Ответ', at: at(6) } }))
    s = reduce(s, ev({ type: 'turn.ended', at: at(7), turnId: 't1', status: 'completed' }))
    expect(s.deltas).toEqual({})
    expect(s.turn).toBeNull()
    expect(timeline(s).map(e => e.kind)).toEqual(['message', 'message'])
    expect(s.cursor).toBe(`c${at(7)}`)
  })
})
