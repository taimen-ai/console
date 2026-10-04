import { describe, expect, it } from 'vitest'
import { agentTakes, allowedTypes, type TaskTypeLite } from '../src/api/executors.ts'
import { flattenTree, resolveScope, subtreeOf, workspaceOptions } from '../src/api/scope.tsx'

const tree = [
  { id: 'org', name: 'Полярис', children: [{ id: 'fin', name: 'Финансы', children: [{ id: 'pay', name: 'Оплата счетов' }] }, { id: 'tnd', name: 'Тендеры' }] },
  { id: 'org2', name: 'Север' },
]
const nodes = flattenTree(tree)

describe('область консоли', () => {
  it('дерево плоско: глубина, путь, корень', () => {
    expect(nodes.map(n => [n.id, n.depth, n.path.join(' / '), n.rootId])).toEqual([
      ['org', 0, 'Полярис', 'org'], ['fin', 1, 'Полярис / Финансы', 'org'], ['pay', 2, 'Полярис / Финансы / Оплата счетов', 'org'],
      ['tnd', 1, 'Полярис / Тендеры', 'org'], ['org2', 0, 'Север', 'org2'],
    ])
  })

  it('поддерево — само пространство и все потомки', () => {
    expect([...subtreeOf(nodes, 'org')].sort()).toEqual(['fin', 'org', 'pay', 'tnd'])
    expect([...subtreeOf(nodes, 'fin')].sort()).toEqual(['fin', 'pay'])
    expect([...subtreeOf(nodes, 'tnd')]).toEqual(['tnd'])
  })

  it('выбор: «все», известное, иначе первый корень', () => {
    expect(resolveScope(nodes, 'all')).toBeNull()
    expect(resolveScope(nodes, 'fin')).toBe('fin')
    expect(resolveScope(nodes, 'gone')).toBe('org')
    expect(resolveScope(nodes, null)).toBe('org')
  })

  it('варианты пространств: отступ, путь предков подписью, поиск по пути', () => {
    const opts = workspaceOptions(nodes, subtreeOf(nodes, 'fin'))
    expect(opts.map(o => [o.value, o.depth, o.meta])).toEqual([['fin', 1, 'Полярис'], ['pay', 2, 'Полярис / Финансы']])
    expect(opts[1]!.search).toBe('Полярис Финансы Оплата счетов')
  })
})

describe('что можно выбрать при поручении', () => {
  const type = (key: string, status = 'active'): TaskTypeLite => ({ id: key, key, version: 1, displayName: key, status })
  it('типы: только активные; разрешённые в пространстве, если ядро их назвало', () => {
    const all = [type('a'), type('b'), type('c', 'deprecated')]
    expect(allowedTypes(all, null).map(t => t.key)).toEqual(['a', 'b'])
    expect(allowedTypes(all, undefined).map(t => t.key)).toEqual(['a', 'b'])
    expect(allowedTypes(all, ['b', 'c']).map(t => t.key)).toEqual(['b'])
    expect(allowedTypes(all, [])).toEqual([])
  })

  it('агент берёт тип: берёт работу вообще, spec.work.taskTypes, пространство; исполнитель skills — только типы со скиллом', () => {
    const covers = (agentWs: string, ws: string) => subtreeOf(nodes, agentWs).has(ws)
    const agent = (taskTypes: string[] | undefined, workspaceId: string | null, more: Record<string, unknown> = {}, executor = 'claude-code') => ({ key: 'a', displayName: 'A', principalId: 'p', workspaceId, status: 'active', state: 'running', revision: { spec: { executor: { kind: executor }, work: { ...(taskTypes ? { taskTypes } : {}) } } }, ...more })
    const x = { key: 'x' }, y = { key: 'y' }, skill = { key: 'pub', execution: { skill: 'oss.publish' } }
    expect(agentTakes(agent(['x'], 'fin'), x, 'pay', covers)).toBe(true)
    expect(agentTakes(agent(['x'], 'fin'), y, 'pay', covers)).toBe(false)
    expect(agentTakes(agent(undefined, 'fin'), y, 'pay', covers)).toBe(true)
    expect(agentTakes(agent(['x'], 'fin'), x, 'tnd', covers)).toBe(false)
    expect(agentTakes(agent(['x'], null), x, 'tnd', covers)).toBe(true)
    expect(agentTakes(agent(['x'], 'fin'), undefined, null, covers)).toBe(true)
    expect(agentTakes(agent(['x'], 'fin', { state: 'stopped' }), x, 'fin', covers)).toBe(false)
    expect(agentTakes(agent(['x'], 'fin', { status: 'retired' }), x, 'fin', covers)).toBe(false)
    // наблюдатель и личность правила без исполнителя работу не берут
    expect(agentTakes(agent(undefined, 'fin', {}, 'observer'), x, 'fin', covers)).toBe(false)
    expect(agentTakes({ ...agent(undefined, 'fin'), revision: { spec: {} } }, x, 'fin', covers)).toBe(false)
    // исполнитель скиллов — только типы со скиллом, кодовый — только без
    expect(agentTakes(agent(undefined, 'fin', {}, 'skills'), skill, 'fin', covers)).toBe(true)
    expect(agentTakes(agent(undefined, 'fin', {}, 'skills'), x, 'fin', covers)).toBe(false)
    expect(agentTakes(agent(undefined, 'fin'), skill, 'fin', covers)).toBe(false)
  })
})

describe('умолчание области', () => {
  it('корень, где больше всего ждёт человека; без элементов — нет предпочтения', async () => {
    const { busiestRoot } = await import('../src/api/scope.tsx')
    expect(busiestRoot(nodes, ['pay', 'org2', 'tnd', null])).toBe('org')
    expect(busiestRoot(nodes, ['org2', 'org2', 'pay'])).toBe('org2')
    expect(busiestRoot(nodes, [])).toBeNull()
    expect(resolveScope(nodes, null, 'org2')).toBe('org2')
    expect(resolveScope(nodes, 'fin', 'org2')).toBe('fin')
  })
})

describe('ассистент знает область', () => {
  it('адрес экрана несёт ws области, если экран не задал свой', async () => {
    const { screenUrl } = await import('../src/routes.tsx')
    expect(screenUrl('/work', '?q=x', 'fin')).toBe('/console/work?q=x&ws=fin')
    expect(screenUrl('/knowledge', '?ws=org2', 'fin')).toBe('/console/knowledge?ws=org2')
    expect(screenUrl('/work', '', null)).toBe('/console/work')
  })
})
