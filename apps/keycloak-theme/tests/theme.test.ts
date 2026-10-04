import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src', 'login')

describe('тема входа', () => {
  it('ключевые классы Keycloak переведены в классы дизайн-системы', async () => {
    const { CLASSES } = await import('../src/login/classes.ts')
    expect(CLASSES).toMatchObject({ kcInputClass: 'tc-input', kcButtonClass: 'tc-btn', kcButtonPrimaryClass: 'tc-btn-brand', kcLabelClass: 'kt-label', kcFormGroupClass: 'kt-group', kcInputErrorMessageClass: 'kt-error', kcSrOnlyClass: 'tc-sr' })
  })

  it('подписи каркаса — на обоих языках', () => {
    const text = readFileSync(join(SRC, 'i18n.ts'), 'utf8')
    for (const key of ['ktLanguage', 'ktSignedInAs', 'ktSecure', 'showPassword', 'hidePassword', 'restartLoginTooltip']) {
      expect(text.match(new RegExp(`\\b${key}:`, 'g'))?.length, key).toBe(2)
    }
  })

  it('стили — только токены: ни одного цвета в стилях темы', () => {
    const css = readFileSync(join(SRC, 'theme.css'), 'utf8').replace(/url\("data:[^"]+"\)/g, '')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})
