import { i18n } from '@lingui/core'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { parseOAuthReturn, typeOf, type ConnectionType } from '../src/api/connections.ts'
import { accountFits, cleanSettings, localDay, reasonText, settingsFieldErrors } from '../src/screens/settings/Connections.tsx'
import { parseSettingsSearch } from '../src/screens/settings/Settings.tsx'
import { isStageRolesField, pipelinesOf, withRole } from '../src/screens/settings/StageRoles.tsx'

i18n.loadAndActivate({ locale: 'en', messages: {} })

describe('подключения (docs/connections.md)', () => {
  it('возврат из OAuth: только известные итоги, ключ и код причины по форме ядра', () => {
    expect(parseOAuthReturn({ connection: 'crm', result: 'active' })).toEqual({ connection: 'crm', result: 'active' })
    expect(parseOAuthReturn({ connection: 'crm', result: 'failed', reason: 'consent_denied' })).toEqual({ connection: 'crm', result: 'failed', reason: 'consent_denied' })
    expect(parseOAuthReturn({ result: 'invalid_state' })).toEqual({ result: 'invalid_state' })
    expect(parseOAuthReturn({ connection: 'CRM', result: 'ok', reason: 'a b', code: 'x' })).toEqual({})
  })

  it('параметры возврата живут только в разделе «Подключения»', () => {
    expect(parseSettingsSearch({ section: 'connections', connection: 'crm', result: 'active', state: 's' })).toEqual({ section: 'connections', connection: 'crm', result: 'active' })
    expect(parseSettingsSearch({ section: 'rules', connection: 'crm' })).toEqual({ section: 'rules' })
  })

  it('причины ядра — словами; неизвестный код — как есть', () => {
    expect(reasonText('consent_denied')).toMatch(/declined/)
    expect(reasonText('something_new')).toBe('something_new')
    expect(reasonText(null)).toBeUndefined()
  })

  it('учётка проверяется шаблоном типа целиком; шаблон, который не компилируется, — ядру', () => {
    expect(accountFits('[a-z]+\\.crm\\.example', 'polaris.crm.example')).toBe(true)
    expect(accountFits('[a-z]+\\.crm\\.example', 'polaris.crm.example.evil')).toBe(false)
    expect(accountFits('a|b', 'ab')).toBe(false)
    expect(accountFits('(', 'x')).toBe(true)
    expect(accountFits(undefined, '')).toBe(false)
  })

  it('настройки без пустых строк: «не задано» — отсутствие поля', () => {
    expect(cleanSettings({ fields: { inn: '' }, observerAgent: 'crm-observer', note: '', stageRoles: [{ pipelineId: '1', stageId: '2', role: 'draft' }] }))
      .toEqual({ fields: {}, observerAgent: 'crm-observer', stageRoles: [{ pipelineId: '1', stageId: '2', role: 'draft' }] })
  })

  it('ошибки настроек ядра — у полей; отказ из-за секрета — у пути без значения', () => {
    const invalid = new ApiError(422, 'invalid_connection_settings', 'x', { field: 'settings', errors: [{ path: '/rateBudget/observer', message: 'от 0 до 1' }] })
    expect(settingsFieldErrors(invalid)).toEqual({ 'rateBudget/observer': 'от 0 до 1' })
    const secret = new ApiError(422, 'secret_material_rejected', 'x', { field: 'settings', path: '/fields/inn' })
    expect(settingsFieldErrors(secret)).toEqual({ 'fields/inn': 'looks like a secret' })
    expect(settingsFieldErrors(new Error('x'))).toEqual({})
  })

  it('тип подключения — по закреплённой версии, иначе свежая активная', () => {
    const v = (version: number, status: ConnectionType['status']) => ({ id: String(version), key: 'crm', version, status, spec: { displayName: `v${version}`, auth: ['token'], settingsSchema: {}, defaultKey: 'crm' }, package: null }) as ConnectionType
    const types = [v(1, 'disabled'), v(2, 'active')]
    expect(typeOf(types, { type: 'crm', typeVersion: 1 })?.version).toBe(1)
    expect(typeOf(types, { type: 'crm', typeVersion: 7 })?.version).toBe(2)
  })

  it('день поля даты — по местному времени', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('роли этапов воронки (класс CRM)', () => {
  it('поле ролей узнаётся по форме элементов', () => {
    expect(isStageRolesField({ type: 'array', items: { type: 'object', properties: { pipelineId: {}, stageId: {}, role: {} } } })).toBe(true)
    expect(isStageRolesField({ type: 'array', items: { type: 'object', properties: { inn: {}, amount: {} } } })).toBe(false)
  })

  it('воронки — основная первой, архивные скрыты; этапы — в порядке CRM', () => {
    const e = (kind: string, attributes: Record<string, unknown>) => ({ kind, key: `${kind}:${String(attributes.externalId)}`, title: String(attributes.name), attributes })
    const out = pipelinesOf([
      e('crm_pipeline', { externalId: '2', name: 'Тендеры', sort: 1 }),
      e('crm_pipeline', { externalId: '1', name: 'Продажи', sort: 2, main: true }),
      e('crm_pipeline', { externalId: '3', name: 'Старая', archived: true }),
      e('crm_stage', { pipelineId: '1', externalId: '12', name: 'Б', sort: 20, outcome: 'open' }),
      e('crm_stage', { pipelineId: '1', externalId: '11', name: 'А', sort: 10, outcome: 'open' }),
      e('crm_stage', { pipelineId: '2', externalId: '21', name: 'В', sort: 10, outcome: 'won' }),
    ])
    expect(out.map(p => p.name)).toEqual(['Продажи', 'Тендеры'])
    expect(out[0]!.stages.map(s => s.id)).toEqual(['11', '12'])
  })

  it('роль этапа заменяется; пустая роль снимает пару', () => {
    const roles = [{ pipelineId: '1', stageId: '11', role: 'draft' }]
    expect(withRole(roles, '1', '12', 'draft')).toEqual([...roles, { pipelineId: '1', stageId: '12', role: 'draft' }])
    expect(withRole(roles, '1', '11', '')).toEqual([])
    expect(withRole(roles, '2', '11', 'draft')).toHaveLength(2)
  })
})
