import { useQuery } from '@tanstack/react-query'
import type { FormSchema, Values } from '../forms/schema.ts'
import { API, consoleFetch, cpGet, cpPost } from './client.ts'
import type { Page } from './types.ts'

/**
 * Подключения организации (CP-ADR-0079, контракт консоли `docs/connections.md`): типы
 * подключений пакетов, подключения со статусом и настройками, приложения OAuth типов, секреты
 * агентов по имени. Значения секретов уходят только запросом записи: ни один ответ их не
 * несёт, консоль их не кэширует и не показывает после ввода.
 */

export type ConnectionAuth = 'oauth2' | 'token'
export type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

export interface ConnectionTypeSpec {
  displayName: string
  description?: string | null
  auth: ConnectionAuth[]
  oauth2?: { authorizeUrl: string, scopes: string[] } | null
  accountField?: { title: string, description?: string | null, pattern: string } | null
  settingsSchema: FormSchema
  defaultKey: string
}

export interface ConnectionType { id: string, key: string, version: number, status: 'active' | 'deprecated' | 'disabled', spec: ConnectionTypeSpec, package: { key: string, version: string } | null }

export interface Connection {
  id: string
  key: string
  type: string
  typeVersion: number
  displayName: string
  account: string | null
  auth: ConnectionAuth | null
  status: ConnectionStatus
  statusReason: string | null
  statusMessage: string | null
  settings: Values
  expiresAt: string | null
  connectedBy: string | null
  connectedAt: string | null
  lastCheckedAt: string | null
  /** Только в карточке: ключи агентов, чья ревизия называет подключение. */
  agents?: string[]
  createdAt: string
  updatedAt: string
  version: number
}

export interface OAuthApp { type: string, configured: boolean, clientId: string | null, updatedAt: string | null }
export interface AgentSecret { name: string, updatedAt: string, updatedBy: string }

/** Ключ подключения и имя секрета — та же форма, что у ядра. */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/

const enc = encodeURIComponent

export function useConnectionTypes() {
  return useQuery({
    queryKey: ['connections', 'types'], staleTime: 5 * 60_000, retry: false,
    queryFn: ({ signal }) => cpGet<Page<ConnectionType>>('/connection-types?limit=200', signal).then(r => r.items),
  })
}

export function useConnections() {
  return useQuery({
    queryKey: ['connections', 'list'], staleTime: 30_000, retry: false,
    queryFn: ({ signal }) => cpGet<Page<Connection>>('/connections?limit=200', signal).then(r => r.items),
  })
}

export function useConnection(key: string | undefined) {
  return useQuery({
    queryKey: ['connections', 'card', key], enabled: key !== undefined, retry: false,
    queryFn: ({ signal }) => cpGet<Connection>(`/connections/${enc(key!)}`, signal),
  })
}

export function useOAuthApp(type: string) {
  return useQuery({
    queryKey: ['connections', 'oauth-app', type], retry: false,
    queryFn: ({ signal }) => cpGet<OAuthApp>(`/connection-types/${enc(type)}/oauth-app`, signal),
  })
}

export function useAgentSecrets(agentKey: string | null) {
  return useQuery({
    queryKey: ['agent-secrets', agentKey], enabled: agentKey !== null, retry: false,
    queryFn: ({ signal }) => cpGet<{ items: AgentSecret[] }>(`/agents/${enc(agentKey!)}/secrets`, signal).then(r => r.items),
  })
}

/** Тип подключения по закреплённой версии; нет такой — свежая активная того же ключа. */
export function typeOf(types: ConnectionType[] | undefined, c: Pick<Connection, 'type' | 'typeVersion'>): ConnectionType | undefined {
  return types?.find(t => t.key === c.type && t.version === c.typeVersion) ?? types?.find(t => t.key === c.type && t.status === 'active')
}

async function send<T>(method: 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await consoleFetch(`${API}/cp${path}`, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return response.status === 204 ? undefined as T : await response.json() as T
}

export const createConnection = (input: { type: string, key?: string, displayName?: string }): Promise<Connection> => cpPost<Connection>('/connections', input)

export const updateConnection = (key: string, version: number, body: { displayName?: string, settings?: Values }): Promise<Connection> =>
  send<Connection>('PATCH', `/connections/${enc(key)}`, body, { 'if-match': `"connection-${version}"` })

/** Начать OAuth: адрес согласия провайдера. Ключ идемпотентности не передаётся — повтор выпускает новый state. */
export const authorizeConnection = (key: string): Promise<{ authorizeUrl: string | null, expiresAt: string }> => cpPost(`/connections/${enc(key)}:authorize`, {})

export const setConnectionToken = (key: string, input: { account: string, token: string, expiresAt?: string }): Promise<Connection> =>
  send<Connection>('PUT', `/connections/${enc(key)}/token`, input)

export const revokeConnection = (key: string, reason: string): Promise<Connection> => cpPost<Connection>(`/connections/${enc(key)}:revoke`, reason.trim() !== '' ? { reason: reason.trim() } : {})

export const setOAuthApp = (type: string, input: { clientId: string, clientSecret: string }): Promise<OAuthApp> =>
  send<OAuthApp>('PUT', `/connection-types/${enc(type)}/oauth-app`, input)

export const setAgentSecret = (agentKey: string, name: string, value: string): Promise<AgentSecret> =>
  send<AgentSecret>('PUT', `/agents/${enc(agentKey)}/secrets/${enc(name)}`, { value })

export async function deleteAgentSecret(agentKey: string, name: string): Promise<void> {
  await send<unknown>('DELETE', `/agents/${enc(agentKey)}/secrets/${enc(name)}`)
}

/**
 * Возврат из OAuth-потока: ядро отправляет браузер на `…/settings?section=connections` с
 * `connection`, `result` (`active` | `failed` | `invalid_state`) и `reason`.
 */
export interface OAuthReturn { connection?: string, result?: 'active' | 'failed' | 'invalid_state', reason?: string }

export function parseOAuthReturn(raw: Record<string, unknown>): OAuthReturn {
  const out: OAuthReturn = {}
  if (typeof raw.connection === 'string' && KEY_PATTERN.test(raw.connection)) out.connection = raw.connection
  if (raw.result === 'active' || raw.result === 'failed' || raw.result === 'invalid_state') out.result = raw.result
  if (typeof raw.reason === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(raw.reason)) out.reason = raw.reason
  return out
}
