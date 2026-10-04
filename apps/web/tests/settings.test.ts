import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { fieldOfPath } from '../src/api/settings.ts'
import { fieldErrors, settingsPayload } from '../src/screens/settings/PackageSettings.tsx'
import { parseSettingsSearch } from '../src/screens/settings/Settings.tsx'

i18n.loadAndActivate({ locale: 'en', messages: {} })

describe('настройки пакетов (docs/settings.md)', () => {
  it('отправляются явно заданные видимые значения; прочее — по умолчанию', () => {
    const visible = new Set(['a', 'b', 'c'])
    expect(settingsPayload(new Set(['a', 'c', 'hidden']), { a: 1, b: 2, c: '', hidden: true }, visible)).toEqual({ a: 1 })
    expect(settingsPayload(new Set(), { a: 1 }, visible)).toEqual({})
  })

  it('путь ошибки ядра (JSON Pointer) → поле формы', () => {
    expect(fieldOfPath('/approvalThreshold')).toBe('approvalThreshold')
    expect(fieldOfPath('/limits/0/amount')).toBe('limits')
    expect(fieldOfPath('/a~1b')).toBe('a/b')
  })

  it('ошибки ядра у полей: сообщение, иначе смысл кода', () => {
    expect(fieldErrors(new ApiError(422, 'settings_invalid', 'x', { errors: [{ path: '/approvalThreshold', code: 'minimum', message: 'не меньше 0' }] }))).toEqual({ approvalThreshold: 'не меньше 0' })
    expect(fieldErrors(new ApiError(422, 'secret_material_rejected', 'x', { errors: [{ path: '/note' }] }))).toEqual({ note: 'looks like a secret' })
    expect(fieldErrors(new ApiError(422, 'unknown_ref', 'x', { errors: [{ path: '/approver', ref: 'principal' }] }))).toEqual({ approver: 'no such object in the organization' })
    expect(fieldErrors(new ApiError(409, 'version_conflict'))).toEqual({})
  })

  it('раздел в адресе: пакет, правила, подключения; прочее — по умолчанию', () => {
    expect(parseSettingsSearch({ section: 'package:invoice-approval' })).toEqual({ section: 'package:invoice-approval' })
    expect(parseSettingsSearch({ section: 'rules' })).toEqual({ section: 'rules' })
    expect(parseSettingsSearch({ section: 'package:../x' })).toEqual({})
    expect(parseSettingsSearch({})).toEqual({})
  })
})

describe('ошибки по полям — одна форма на платформу', () => {
  it('errors[] и прежний details.path; префикс профиля срезается', async () => {
    const { pathErrors } = await import('../src/api/fieldErrors.ts')
    expect(pathErrors(new ApiError(422, 'secret_material_rejected', 'x', { errors: [{ path: '/profile/note' }] }), 'profile/')).toEqual({ note: 'looks like a secret' })
    expect(pathErrors(new ApiError(422, 'validation_error', 'x', { errors: [{ path: '/displayName', message: 'от 1 до 200 символов' }] }), 'profile/')).toEqual({ displayName: 'от 1 до 200 символов' })
    expect(pathErrors(new ApiError(422, 'secret_material_rejected', 'x', { field: 'settings', path: '/fields/inn' }))).toEqual({ 'fields/inn': 'looks like a secret' })
    expect(pathErrors(new ApiError(409, 'version_conflict', 'x', { currentVersion: 3 }))).toEqual({})
  })
})
