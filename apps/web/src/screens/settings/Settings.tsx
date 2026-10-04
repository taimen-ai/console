import { DegradedBanner, Icon, PageHeader, Zone } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { ApiError, BASE_PATH } from '../../api/client.ts'
import { parseOAuthReturn, type OAuthReturn } from '../../api/connections.ts'
import { usePackageSettingsList } from '../../api/settings.ts'
import { ConnectionsSection } from './Connections.tsx'
import { PackageSettingsSection } from './PackageSettings.tsx'
import { PeopleSection } from './People.tsx'
import { RulesSection } from './Rules.tsx'
import { SecretsSection } from './Secrets.tsx'
import './settings.css'

/**
 * Экран «Настройки» (TAI-ADR-0067 п.6, docs/screens/settings.md): то, что меняет
 * администратор организации, — рычаги, перенесённые с главной (правила), настройки
 * установленных пакетов по разделу на пакет, люди и роли, подключения и секреты агентов. Раздел —
 * в адресе (`?section=`): `package:<ключ>`, `rules`, `people`, `connections`, `secrets`.
 */

export interface SettingsSearch extends OAuthReturn { section?: string }

/**
 * Раздел и, для «Подключений», открытое подключение (`connection`) и итог возврата из
 * OAuth-потока (`result`, `reason`): ядро возвращает браузер на `…/settings?section=connections`
 * (CP_CONNECTIONS_RETURN_URL) с этими параметрами.
 */
export function parseSettingsSearch(raw: Record<string, unknown>): SettingsSearch {
  const s = raw.section
  const section = typeof s === 'string' && /^(rules|people|connections|secrets|package:[a-z0-9][a-z0-9-]{0,62})$/.test(s) ? s : undefined
  if (section !== 'connections') return section !== undefined ? { section } : {}
  return { section, ...parseOAuthReturn(raw) }
}

const href = (section: string): string => `${BASE_PATH}/settings?section=${encodeURIComponent(section)}`

export function Settings({ search }: { search: SettingsSearch }) {
  useLingui()
  const packages = usePackageSettingsList()
  // Ядро без настроек пакетов (до TAI-ADR-0067) отвечает 404 — раздела пакетов нет, остальное живёт.
  const noPackageSettings = packages.isError && packages.error instanceof ApiError && packages.error.status === 404
  const list = packages.data ?? []
  const section = search.section ?? (list[0] !== undefined ? `package:${list[0].package}` : 'rules')
  const current = section.startsWith('package:') ? list.find(p => p.package === section.slice('package:'.length)) : undefined

  const title = section === 'rules' ? t`Rules` : section === 'people' ? t`People and roles` : section === 'connections' ? t`Connections` : section === 'secrets' ? t`Secrets of agents` : current?.title ?? section.slice('package:'.length)
  return (
    <div className="st">
      <PageHeader title={t`Settings`} lead={t`What the organization's administrator changes: rules that act by themselves, settings of installed packages, connections to other systems.`} />
      <div className="st-grid">
        <nav className="st-nav" aria-label={t`Sections of settings`}>
          <p className="st-nav-title">{t`Packages`}</p>
          {packages.isPending ? <p className="tc-muted st-nav-note">{t`Loading…`}</p> : null}
          {noPackageSettings ? <p className="tc-muted st-nav-note">{t`The core does not keep package settings yet.`}</p> : null}
          {packages.isError && !noPackageSettings ? <p className="tc-muted st-nav-note">{t`Could not load the packages.`}</p> : null}
          {packages.isSuccess && list.length === 0 ? <p className="tc-muted st-nav-note">{t`No installed package has settings.`}</p> : null}
          <ul>
            {list.map(p => (
              <li key={p.package}><a href={href(`package:${p.package}`)} aria-current={section === `package:${p.package}` ? 'page' : undefined}>{p.title}<span className="tc-muted">{p.packageVersion}</span></a></li>
            ))}
          </ul>
          <p className="st-nav-title">{t`Organization`}</p>
          <ul>
            <li><a href={href('rules')} aria-current={section === 'rules' ? 'page' : undefined}><Icon name="settings" />{t`Rules`}</a></li>
            <li><a href={href('people')} aria-current={section === 'people' ? 'page' : undefined}><Icon name="settings" />{t`People and roles`}</a></li>
            <li><a href={href('connections')} aria-current={section === 'connections' ? 'page' : undefined}><Icon name="settings" />{t`Connections`}</a></li>
            <li><a href={href('secrets')} aria-current={section === 'secrets' ? 'page' : undefined}><Icon name="settings" />{t`Secrets of agents`}</a></li>
          </ul>
        </nav>
        <div className="st-content">
          <Zone title={title}>
            {section === 'rules'
              ? <RulesSection />
              : section === 'people'
                ? <PeopleSection />
                : section === 'secrets'
                  ? <SecretsSection />
              : section === 'connections'
                ? <ConnectionsSection {...(search.connection !== undefined ? { open: search.connection } : {})} back={{ ...(search.connection !== undefined ? { connection: search.connection } : {}), ...(search.result !== undefined ? { result: search.result } : {}), ...(search.reason !== undefined ? { reason: search.reason } : {}) }} />
                : packages.isError && noPackageSettings
                  ? <DegradedBanner.Section text={t`The core does not keep package settings yet.`} />
                  : <PackageSettingsSection pkg={section.slice('package:'.length)} />}
          </Zone>
        </div>
      </div>
    </div>
  )
}
