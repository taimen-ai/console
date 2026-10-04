import { msg, t } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { useLingui } from '@lingui/react'
import { createRootRoute, createRoute, createRouter, Outlet, useLocation, useMatches } from '@tanstack/react-router'
import { BASE_PATH } from './api/client.ts'
import { LiveProvider } from './api/live.tsx'
import { ScopeProvider, useScope } from './api/scope.tsx'
import { AssistantProvider } from './assistant/AssistantProvider.tsx'
import type { Locale } from './i18n.ts'
import { Today } from './screens/today/Today.tsx'
import { Document, isArtifactId } from './screens/document/Document.tsx'
import { NotFound } from './shell/Failure.tsx'
import { Entry, parseEntrySearch, type EntrySearch } from './screens/knowledge/Entry.tsx'
import { Knowledge, parseKnowledgeSearch, type KnowledgeSearch } from './screens/knowledge/Knowledge.tsx'
import { parseSettingsSearch, Settings, type SettingsSearch } from './screens/settings/Settings.tsx'
import { PersonPage } from './screens/settings/PersonPage.tsx'
import { Task } from './screens/task/Task.tsx'
import { ViewScreen } from './screens/view/ViewScreen.tsx'
import { Work } from './screens/work/Work.tsx'
import { parseWorkSearch, type WorkSearch } from './screens/work/search.ts'
import { parseProposal } from './screens/work/proposal.ts'
import { Journal } from './screens/journal/Journal.tsx'
import { parseJournalSearch, type JournalSearch } from './screens/journal/journal.ts'
import { Shell } from './shell/Shell.tsx'

/**
 * Маршруты консоли. Адреса — те же, что разбирает BFF для контекста ассистента
 * (apps/bff/src/screen-context.ts): `/`, `/work`, `/work/$ref`, `/knowledge`. У каждого экрана —
 * название (контекст ассистента и заголовок вкладки) и подсказки ассистенту; это описания
 * сообщений Lingui, переводятся при показе.
 */
declare module '@tanstack/react-router' {
  interface StaticDataRouteOption { title?: MessageDescriptor, suggestions?: MessageDescriptor[] }
  interface Register { router: typeof router }
}

/** Языки, которые предлагает развёртывание: из `GET {base}/api/config`, задаются при запуске. */
export const launch: { locales: readonly Locale[] } = { locales: ['en'] }

function Root() {
  return (
    <LiveProvider>
      <ScopeProvider>
        <Screen />
      </ScopeProvider>
    </LiveProvider>
  )
}

/** Адрес экрана для ассистента: с областью из шапки (`ws`), если экран не задал свою. */
export function screenUrl(pathname: string, search: string, ws: string | null): string {
  const params = new URLSearchParams(search)
  if (ws !== null && !params.has('ws')) params.set('ws', ws)
  const query = params.toString()
  return `${BASE_PATH}${pathname}${query !== '' ? `?${query}` : ''}`
}

function Screen() {
  const { i18n } = useLingui()
  const location = useLocation()
  const matches = useMatches()
  const scope = useScope()
  const leaf = matches.at(-1)
  const title = leaf?.staticData.title !== undefined ? i18n._(leaf.staticData.title) : t`Console`
  const ref = (leaf?.params as { ref?: string } | undefined)?.ref
  return (
    <AssistantProvider screen={{ url: screenUrl(location.pathname, location.searchStr ?? '', scope.ws), label: ref ?? title }}>
      <Shell suggestions={(leaf?.staticData.suggestions ?? []).map(s => i18n._(s))} locales={launch.locales}>
        <Outlet />
      </Shell>
    </AssistantProvider>
  )
}

const root = createRootRoute({ component: Root })

const today = createRoute({
  getParentRoute: () => root, path: '/', component: Today,
  staticData: { title: msg`Today`, suggestions: [msg`What broke today and why?`, msg`What happens if I approve the first decision?`, msg`Who is overloaded right now?`] },
})
const work = createRoute({
  getParentRoute: () => root, path: '/work',
  validateSearch: (raw: Record<string, unknown>): WorkSearch => parseWorkSearch(raw),
  component: function WorkRoute() {
    return <Work search={work.useSearch()} />
  },
  staticData: { title: msg`Work`, suggestions: [msg`What work is waiting for me?`, msg`Why is this work stuck?`] },
})
/** Предложение работы ссылкой (`proposal.ts`): «Работа» с открытой «Поручить работу». */
const workNew = createRoute({
  getParentRoute: () => root, path: '/work/new',
  validateSearch: (raw: Record<string, unknown>): Record<string, unknown> => raw,
  component: function WorkNew() {
    const proposal = parseProposal(workNew.useSearch()) ?? undefined
    // Новое предложение при уже открытом — заново, с его полями.
    return <Work key={JSON.stringify(proposal ?? null)} search={{}} {...(proposal !== undefined ? { proposal } : {})} />
  },
  staticData: { title: msg`Work`, suggestions: [msg`What work is waiting for me?`, msg`Who can take this work?`] },
})
const workItem = createRoute({
  getParentRoute: () => root, path: '/work/$ref',
  validateSearch: (raw: Record<string, unknown>): { act?: 'handoff' } => (raw.act === 'handoff' ? { act: 'handoff' } : {}),
  component: function WorkItem() {
    const { ref } = workItem.useParams()
    const { act } = workItem.useSearch()
    return <Task key={ref} taskRef={ref} {...(act !== undefined ? { act } : {})} />
  },
  staticData: { title: msg`Work`, suggestions: [msg`Why is this work stuck?`, msg`What happens next?`, msg`What happens if I decline?`] },
})
const journal = createRoute({
  getParentRoute: () => root, path: '/journal',
  validateSearch: (raw: Record<string, unknown>): JournalSearch => parseJournalSearch(raw),
  component: function JournalRoute() {
    return <Journal search={journal.useSearch()} />
  },
  staticData: { title: msg`Journal`, suggestions: [msg`Who changed rights this week?`, msg`What did this person do today?`, msg`Were there emergency keys?`] },
})
const knowledge = createRoute({
  getParentRoute: () => root, path: '/knowledge',
  validateSearch: (raw: Record<string, unknown>): KnowledgeSearch => parseKnowledgeSearch(raw),
  component: function KnowledgeRoute() {
    return <Knowledge search={knowledge.useSearch()} />
  },
  staticData: { title: msg`Knowledge`, suggestions: [msg`What will expire soon?`, msg`Which agreements are active?`, msg`Are we cleared for fire-safety installation work?`] },
})

const knowledgeEntry = createRoute({
  getParentRoute: () => root, path: '/knowledge/entry',
  validateSearch: (raw: Record<string, unknown>): EntrySearch => parseEntrySearch(raw),
  component: function KnowledgeEntryRoute() {
    const search = knowledgeEntry.useSearch()
    return <Entry key={`${search.kind ?? ''}:${search.key ?? ''}`} search={search} />
  },
  staticData: { title: msg`Knowledge document`, suggestions: [msg`What does this document cover?`, msg`What happens when it expires?`, msg`Which work depends on it?`] },
})

const documentRoute = createRoute({
  getParentRoute: () => root, path: '/documents/$id',
  component: function DocumentRoute() {
    const { id } = documentRoute.useParams()
    return isArtifactId(id) ? <Document key={id} id={id} /> : <NotFound />
  },
  staticData: { title: msg`Document`, suggestions: [msg`What does this document prove?`, msg`Is anything in it inconsistent with the work?`] },
})

const packageView = createRoute({
  getParentRoute: () => root, path: '/v/$key',
  component: function PackageViewRoute() {
    const { key } = packageView.useParams()
    return <ViewScreen key={key} viewKey={key} />
  },
  staticData: { title: msg`Screen`, suggestions: [msg`What needs attention here?`, msg`What changed today?`] },
})
const packageViewItem = createRoute({
  getParentRoute: () => root, path: '/v/$key/$id',
  component: function PackageViewItemRoute() {
    const { key, id } = packageViewItem.useParams()
    return <ViewScreen key={`${key}/${id}`} viewKey={key} id={id} />
  },
  staticData: { title: msg`Screen`, suggestions: [msg`What is this waiting for?`, msg`What happens next?`] },
})

const settings = createRoute({
  getParentRoute: () => root, path: '/settings',
  validateSearch: (raw: Record<string, unknown>): SettingsSearch => parseSettingsSearch(raw),
  component: function SettingsRoute() {
    return <Settings search={settings.useSearch()} />
  },
  staticData: { title: msg`Settings`, suggestions: [msg`Which rules raise work by themselves?`, msg`What does this setting change?`] },
})

const person = createRoute({
  getParentRoute: () => root, path: '/settings/people/$id',
  component: function PersonRoute() {
    const { id } = person.useParams()
    return <PersonPage key={id} id={id} />
  },
  staticData: { title: msg`Person`, suggestions: [msg`What can this person see and do?`, msg`What work is assigned to this person?`] },
})

export const router = createRouter({
  routeTree: root.addChildren([today, work, workNew, workItem, journal, knowledge, knowledgeEntry, documentRoute, packageView, packageViewItem, settings, person]),
  basepath: BASE_PATH === '' ? '/' : BASE_PATH,
  defaultPreload: false,
})
