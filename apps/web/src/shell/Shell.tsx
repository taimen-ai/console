import { AppShell, Icon, IdentityBlock, LiveChip, NavDrawer, TopBar, type IconName, type NavGroup } from '@console/ui'
import { ScopePicker, useScopedAttention } from '../api/scope.tsx'
import { msg, t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BASE_PATH, cpGet, logout } from '../api/client.ts'
import { useLive } from '../api/live.tsx'
import { useViews } from '../api/views.ts'
import type { Attention, HarnessContext } from '../api/types.ts'
import { AssistantDock } from '../assistant/AssistantDock.tsx'
import { useAssistant } from '../assistant/AssistantProvider.tsx'
import { chooseLocale, type Locale } from '../i18n.ts'
import { clock, todayLabel } from '../lib/format.ts'

/**
 * Каркас консоли (компонент дизайн-системы `AppShell`; docs/screens/navigation.md,
 * assistant.md): строка состояния, меню слева, ассистент справа, чип связи над экраном.
 *
 * - Меню выезжает поверх с затемнением; от 1280 px его можно закрепить — тогда оно сдвигает
 *   экран. Закрепление помнится между экранами.
 * - В строке состояния — название организации (из ядра, `tenant.name`), а не продукта.
 * - Ссылки компонентов — обычные `<a href>`; переходы внутри консоли перехватываются здесь и
 *   идут роутером SPA без перезагрузки.
 * - ⌘J / Ctrl+J — ассистент; Esc закрывает меню (если не закреплено) или ассистента, если
 *   фокус в нём.
 */

const PIN_KEY = 'console.nav.pinned'
const read = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const store = (key: string, value: string): void => { try { localStorage.setItem(key, value) } catch { /* приватное окно */ } }

function useWide(): boolean {
  const query = '(min-width: 1280px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const on = (): void => setWide(list.matches)
    list.addEventListener('change', on)
    return () => list.removeEventListener('change', on)
  }, [])
  return wide
}

/** Клики по ссылкам консоли — роутером, без перезагрузки страницы. */
function useInternalLinks(): void {
  const router = useRouter()
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (!(a instanceof HTMLAnchorElement) || (a.target !== '' && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href)
      if (url.origin !== window.location.origin || !(`${url.pathname}/`).startsWith(`${BASE_PATH}/`)) return
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash !== '') return
      e.preventDefault()
      void router.navigate({ href: url.pathname.slice(BASE_PATH.length) + url.search + url.hash })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [router])
}

/** Группа меню вида: закрытый список ядра (`work` | `knowledge` | `packages`); прочее — «Пакеты». */
export const navGroupOf = (group: string | undefined): 'work' | 'knowledge' | 'packages' => group === 'work' || group === 'knowledge' ? group : 'packages'

/** Иконки, которые пакет может назвать в `nav.icon` (набор дизайн-системы). */
const ICONS = new Set<string>(['today', 'work', 'knowledge', 'settings', 'file', 'search', 'clock', 'info', 'warn', 'check'])

const PAGES = [
  { path: '/', label: msg`Today`, icon: 'today' as const },
  { path: '/work', label: msg`Work`, icon: 'work' as const },
  { path: '/knowledge', label: msg`Knowledge`, icon: 'knowledge' as const },
  { path: '/journal', label: msg`Journal`, icon: 'clock' as const },
]

/** Названия языков — на самих языках: человек узнаёт свой, даже если интерфейс чужой. */
const LANGUAGE_NAME: Record<Locale, string> = { en: 'English', ru: 'Русский' }

export function Shell({ suggestions, locales, children }: { suggestions: string[], locales: readonly Locale[], children: ReactNode }) {
  const { i18n } = useLingui()
  useInternalLinks()
  const live = useLive()
  const assistant = useAssistant()
  const location = useLocation()
  const wide = useWide()
  const [pinned, setPinned] = useState(() => read(PIN_KEY) === '1')
  const [navOpenRaw, setNavOpen] = useState(false)
  const pinnedEff = pinned && wide
  const navOpen = pinnedEff || navOpenRaw
  const navRef = useRef<HTMLDivElement>(null)
  const menuOpener = useRef<HTMLElement | null>(null)
  const assistantOpener = useRef<HTMLElement | null>(null)

  const views = useViews()
  const me = useQuery({ queryKey: ['harness-context'], queryFn: ({ signal }) => cpGet<HarnessContext>('/harness/context', signal), staleTime: 5 * 60_000 })
  // Счётчик «Работы»: сколько ждёт меня — тот же список, что «Ждёт вас» ядра.
  const attention = useScopedAttention<Attention>()
  const waiting = attention.data?.items.filter(i => i.entity.type === 'approval').length ?? 0
  const org = me.data?.tenant.name ?? ''
  const user = me.data?.principal.displayName ?? ''

  const openNav = (): void => {
    menuOpener.current = document.activeElement as HTMLElement | null
    setNavOpen(true)
    setTimeout(() => navRef.current?.querySelector<HTMLElement>('a,button')?.focus(), 210)
  }
  const closeNav = useCallback((): void => {
    setNavOpen(false)
    if (pinned && wide) { setPinned(false); store(PIN_KEY, '0') }
    menuOpener.current?.focus?.()
  }, [pinned, wide])
  const togglePin = (): void => {
    const next = !pinned
    setPinned(next)
    store(PIN_KEY, next ? '1' : '0')
    if (!next) setNavOpen(false)
  }
  const toggleAssistant = useCallback((next?: boolean): void => {
    const opening = next ?? !assistant.open
    if (opening) assistantOpener.current = document.activeElement as HTMLElement | null
    assistant.toggle(opening)
    if (!opening) {
      setTimeout(() => {
        const back = assistantOpener.current
        const el = back !== null && back.isConnected && back !== document.body ? back : document.querySelector<HTMLElement>('[aria-controls="assistant"]')
        el?.focus()
      }, 0)
    }
  }, [assistant])

  // Переход на другой экран закрывает незакреплённое меню (сравнение с прошлым путём при отрисовке).
  const [navPath, setNavPath] = useState(location.pathname)
  if (navPath !== location.pathname) {
    setNavPath(location.pathname)
    setNavOpen(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggleAssistant()
      } else if (e.key === 'Escape' && navOpen && !pinnedEff) closeNav()
      else if (e.key === 'Escape' && assistant.open && document.getElementById('assistant')?.contains(document.activeElement)) toggleAssistant(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen, pinnedEff, closeNav, assistant.open, toggleAssistant])

  const active = (path: string): boolean => path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`)
  // Экраны пакетов (TAI-ADR-0066): виды с `nav` по `order`; `group` — закрытый список: `work` и
  // `knowledge` — сразу после своего экрана консоли, `packages` (и прочее) — группой «Пакеты».
  const viewItems = (group: string) => (views.data ?? [])
    .filter(v => v.nav !== undefined && v.source.instance !== true && navGroupOf(v.nav.group) === group)
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
    .map(v => ({
      label: v.title, icon: <Icon name={ICONS.has(v.nav?.icon ?? '') ? v.nav!.icon as IconName : 'work'} />,
      href: `${BASE_PATH}/v/${encodeURIComponent(v.key)}`, active: active(`/v/${v.key}`),
    }))
  const packageItems = viewItems('packages')
  const groups: NavGroup[] = [
    { items: PAGES.flatMap(p => [{
      label: i18n._(p.label), icon: <Icon name={p.icon} />, href: `${BASE_PATH}${p.path === '/' ? '/' : p.path}`, active: active(p.path),
      ...(p.path === '/work' && waiting > 0 ? { count: waiting, human: true } : {}),
    }, ...(p.path === '/work' ? viewItems('work') : p.path === '/knowledge' ? viewItems('knowledge') : [])]) },
    ...(packageItems.length > 0 ? [{ title: t`Packages`, items: packageItems }] : []),
  ]
  const at = live.at !== null ? clock(live.at) : ''

  return (
    <AppShell
      navOpen={navOpen}
      navPinned={pinnedEff}
      onScrim={closeNav}
      navId="nav"
      assistantOpen={assistant.open}
      assistantId="assistant"
      nav={
        <div ref={navRef} style={{ height: '100%' }}>
          <NavDrawer
            org={org}
            groups={groups}
            pinned={pinnedEff}
            {...(wide ? { onPin: togglePin } : {})}
            onClose={closeNav}
            footer={
              <>
                {locales.length > 1
                  ? (
                    <div className="shell-langs" role="group" aria-label={t`Language`}>
                      {locales.map(l => (
                        <button key={l} type="button" lang={l} aria-pressed={i18n.locale === l} onClick={() => void chooseLocale(l)}>{LANGUAGE_NAME[l]}</button>
                      ))}
                    </div>
                  )
                  : null}
                <a className={`tc-nav-item${active('/settings') ? ' tc-nav-active' : ''}`} href={`${BASE_PATH}/settings`} aria-current={active('/settings') ? 'page' : undefined}>
                  <span className="tc-nav-ico" aria-hidden="true"><Icon name="settings" /></span>
                  <span className="tc-nav-label">{t`Settings`}</span>
                </a>
                <button type="button" className="tc-nav-item" onClick={() => void logout()}>
                  <span className="tc-nav-ico" aria-hidden="true"><Icon name="arrowLeft" /></span>
                  <span className="tc-nav-label">{t`Sign out`}</span>
                </button>
                {user !== '' ? <div style={{ padding: '8px 12px' }}><IdentityBlock kind="human" name={user} size="sm" /></div> : null}
              </>
            }
          />
        </div>
      }
      topbar={
        <TopBar
          brand={{ mark: org.slice(0, 1) }}
          showLive={false}
          org={org}
          scope={<ScopePicker />}
          date={todayLabel()}
          at={at}
          live={live.connected}
          user={user}
          onMenu={() => (navOpen ? closeNav() : openNav())}
          menuOpen={navOpen}
          menuId="nav"
          onAssistant={() => toggleAssistant()}
          assistantOpen={assistant.open}
          assistantId="assistant"
          assistantUnread={assistant.open ? 0 : assistant.unread}
          assistantUrgent={assistant.urgent}
        />
      }
      status={<LiveChip live={live.connected} at={at} />}
      assistant={<AssistantDock suggestions={suggestions} />}
    >
      {children}
    </AppShell>
  )
}
