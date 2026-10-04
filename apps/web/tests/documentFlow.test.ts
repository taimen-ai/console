import { i18n } from '@lingui/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../src/api/types.ts'
import { documentFields, EXTRACT_SKILL, extracted, startDocument, syncExtraction } from '../src/screens/knowledge/documentFlow.ts'
import type { ImportTarget } from '../src/screens/knowledge/importFlow.ts'

i18n.loadAndActivate({ locale: 'en', messages: {} })
afterEach(() => { vi.unstubAllGlobals() })

const target: ImportTarget = { workspaceId: 'ws', pack: 'company@1', kind: 'agreement', packs: ['default@1'], definitions: [], kindTitle: 'Договор' }
const output = { documentKey: 'document:1', textStatus: 'text', attributes: { number: 'АС-12' }, proposal: { key: 'agreement:manual:АС-12', title: 'Договор АС-12' }, summary: '> цитата' }

/** Ядро в памяти: работа, артефакты; исполнитель сдаёт прогон сразу после перевода в `todo`. */
function fakeCore() {
  const calls: { method: string, path: string, body: Record<string, unknown> | null, headers: Record<string, string> }[] = []
  let task = { id: 't1', publicId: 'TASK-1', version: 1, status: '', systemStatusCategory: '', customFields: {}, verification: null, activeClaimId: null } as unknown as Task & Record<string, unknown>
  const artifacts: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://console.test')
    const path = url.pathname.replace(/^.*\/api\/cp/, '')
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    calls.push({ method, path, body, headers: Object.fromEntries(new Headers(init.headers).entries()) })
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
    if (method === 'POST' && path === '/tasks') { task = { ...task, ...body, version: 1, systemStatusCategory: body!.status === 'blocked' ? 'blocked' : 'active' } as typeof task; return json(201, task) }
    if (method === 'PUT' && path === '/artifact-contents') return json(201, { contentRef: 'upload:1' })
    if (method === 'POST' && path === '/artifacts') { const a = { id: 'file1', ...body }; artifacts.push(a); return json(201, a) }
    if (method === 'PATCH' && path === '/tasks/t1') { task = { ...task, ...body, version: task.version + 1 } as typeof task; return json(200, task) }
    if (method === 'GET' && (path === '/tasks/t1' || path === '/tasks/TASK-1')) {
      // Исполнитель сдал прогон: результат извлечения и открытая проверка.
      if (task.verification === null && (task.customFields as Record<string, unknown>).fileArtifactId !== undefined) {
        artifacts.push({ id: 'res1', type: 'skill_result', name: EXTRACT_SKILL, taskId: 't1', createdAt: '2026-10-03T10:00:00Z', content: { output } })
        task = { ...task, verification: { id: 'v1', status: 'waiting_human' } } as typeof task
      }
      return json(200, task)
    }
    if (method === 'GET' && path === '/artifacts') return json(200, { items: artifacts.filter(a => a.type === url.searchParams.get('type')), nextCursor: null })
    if (method === 'GET' && path === '/artifacts/res1') return json(200, artifacts.find(a => a.id === 'res1'))
    return json(404, { error: { code: 'not_found', message: path } })
  })
  return { calls, current: () => task }
}

describe('документ в базу знаний', () => {
  it('поля работы до извлечения: пакет и вид, массивы — не null', () => {
    expect(documentFields(target)).toEqual({ pack: 'company@1', kind: 'agreement', packs: ['default@1'], links: [], definitions: [] })
  })

  it('извлечено — когда у работы открыта проверка', () => {
    expect(extracted({ verification: null } as unknown as Task)).toBe(false)
    expect(extracted({ verification: { id: 'v', status: 'waiting_human' } } as unknown as Task)).toBe(true)
  })

  it('файл раньше работы: артефакт пространства → работа в начальном статусе с полным входом → выход извлечения в поля', async () => {
    const core = fakeCore()
    const steps: string[] = []
    const file = new File(['%PDF'], 'АС-12.pdf', { type: 'application/pdf' })
    const { extraction } = await startDocument(target, file, 'me', text => steps.push(text))
    const order = core.calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`)
    expect(order.slice(0, 3)).toEqual(['PUT /artifact-contents', 'POST /artifacts', 'POST /tasks'])
    expect(core.calls.find(c => c.path === '/artifacts' && c.method === 'POST')!.body).toMatchObject({ type: 'knowledge-file', workspaceId: 'ws' })
    expect(core.calls.find(c => c.path === '/artifacts' && c.method === 'POST')!.body).not.toHaveProperty('task')
    const created = core.calls.find(c => c.method === 'POST' && c.path === '/tasks')!
    expect(created.body).toMatchObject({ typeKey: 'knowledge-document', ownerId: 'me', workspaceId: 'ws', customFields: { pack: 'company@1', kind: 'agreement', fileArtifactId: 'file1', filename: 'АС-12.pdf' } })
    expect(created.body).not.toHaveProperty('status')
    expect(created.headers['idempotency-key']).toBeTruthy()
    expect(extraction?.documentKey).toBe('document:1')
    expect(core.current().customFields).toMatchObject({ documentKey: 'document:1', textStatus: 'text', key: 'agreement:manual:АС-12', title: 'Договор АС-12', attributes: { number: 'АС-12' }, fileArtifactId: 'file1' })
    expect(core.current().description).toBe('> цитата')
    expect(steps.at(-1)).toContain('check them')
  })

  it('перенос не повторяется, если documentKey уже есть', async () => {
    const core = fakeCore()
    expect(await syncExtraction({ id: 't1', customFields: { documentKey: 'document:1' } } as unknown as Task)).toBeNull()
    expect(core.calls).toHaveLength(0)
  })
})
