import { describe, expect, it } from 'vitest'
import { KNOWN, PRESETS, diff, nextPermissions, presetOf } from '../src/api/people.ts'

describe('права человека наборами', () => {
  it('наборы вложены: наблюдает ⊂ работает ⊂ управляет; все права наборов — из каталога', () => {
    for (const p of PRESETS.observe) expect(PRESETS.work).toContain(p)
    for (const p of PRESETS.work) expect(PRESETS.manage).toContain(p)
    for (const p of PRESETS.manage) expect(KNOWN.has(p)).toBe(true)
    expect(KNOWN.has('admin')).toBe(false)
  })

  it('набор узнаётся по известным правам; admin и неизвестные не мешают', () => {
    expect(presetOf(PRESETS.work)).toBe('work')
    expect(presetOf(['admin', ...PRESETS.manage])).toBe('manage')
    expect(presetOf([...PRESETS.observe, 'future.right'])).toBe('observe')
    expect(presetOf(['tasks.read'])).toBe('custom')
  })

  it('смена набора не трогает admin и права, которых консоль не знает', () => {
    expect(nextPermissions(['admin', 'future.right', ...PRESETS.manage], PRESETS.observe)).toEqual(['admin', 'future.right', ...PRESETS.observe].sort())
  })

  it('что появится и что пропадёт', () => {
    expect(diff(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
  })
})
