import { useLingui } from '@lingui/react'
import { useQuery } from '@tanstack/react-query'
import type { FormSchema, UiElement, Values } from '../forms/schema.ts'
import { API, consoleFetch, cpGet } from './client.ts'
import type { Page } from './types.ts'

/**
 * Настройки пакетов (TAI-ADR-0067) — по контракту `docs/settings.md`: перечень пакетов с
 * настройками, форма пакета (схема и `uischema` со строками на языке запроса), сохранённые и
 * действующие значения, история версий. Сохранение — `PUT` значений целиком с `If-Match`.
 */

export interface PackageSettingsSummary { package: string, title: string, packageVersion: string, version: number, updatedBy: string | null, updatedAt: string | null }

export interface PackageSettings {
  package: string
  title: string
  packageVersion: string
  schema: FormSchema
  uischema: UiElement | null
  values: Values
  effective: Values
  version: number
  schemaHash: string
  updatedBy: string | null
  updatedAt: string | null
  canManage: boolean
}

export interface SettingsVersion { version: number, values: Values, changedPaths: string[], updatedBy: string | null, updatedAt: string }

export function usePackageSettingsList() {
  const { i18n } = useLingui()
  return useQuery({
    queryKey: ['package-settings', i18n.locale], staleTime: 60_000, retry: false,
    queryFn: ({ signal }) => cpGet<{ items: PackageSettingsSummary[] }>(`/package-settings?locale=${i18n.locale}`, signal).then(r => r.items),
  })
}

export function usePackageSettings(key: string | undefined) {
  const { i18n } = useLingui()
  return useQuery({
    queryKey: ['package-settings', key, i18n.locale], enabled: key !== undefined,
    queryFn: ({ signal }) => cpGet<PackageSettings>(`/packages/${encodeURIComponent(key!)}/settings?locale=${i18n.locale}`, signal),
  })
}

export function useSettingsVersions(key: string | undefined) {
  return useQuery({
    queryKey: ['package-settings', key, 'versions'], enabled: key !== undefined,
    queryFn: ({ signal }) => cpGet<Page<SettingsVersion>>(`/packages/${encodeURIComponent(key!)}/settings/versions?limit=20`, signal).then(r => r.items),
  })
}

/** Записать значения целиком; `version` — версия, на которой человек их правил. */
export async function saveSettings(key: string, values: Values, version: number): Promise<PackageSettings> {
  const response = await consoleFetch(`${API}/cp/packages/${encodeURIComponent(key)}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'if-match': `"package-settings-${version}"` },
    body: JSON.stringify({ values }),
  })
  return await response.json() as PackageSettings
}

/** JSON Pointer пути ошибки ядра → поле формы (`/approvalThreshold` → `approvalThreshold`). */
export const fieldOfPath = (path: string): string => decodeURIComponent(path.replace(/^\//, '').split('/')[0]!.replace(/~1/g, '/').replace(/~0/g, '~'))
