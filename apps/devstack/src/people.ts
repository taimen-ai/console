/**
 * Человек в организации на стенде — по контракту консоли `docs/people.md` (TAI-ADR-0068,
 * CP-ADR фичи `people-access`): профиль участника (`PATCH /principals/{id}`, версия),
 * связки IAM с правами и режимом видимости (`GET|POST /principals/{id}/iam-bindings`),
 * участие в пространствах (`GET|POST /workspaces/{id}/members`, `…:remove`). Права
 * связки владельца — потолок: выдать шире ядро не даёт.
 */
import { randomUUID } from 'node:crypto'
import { FINANCE, ME, P, TENANT, TENDERS, WORKSPACE, daysAgo, principals } from './data.ts'

type Reply = { status: number, body: unknown }
const err = (status: number, code: string, message: string, details?: Record<string, unknown>): Reply => ({ status, body: { error: { code, message, ...(details !== undefined ? { details } : {}) } } })

type Profile = { jobTitle?: string, email?: string, phone?: string, note?: string }
const extra = new Map<string, { version: number, profile: Profile }>()
const profileOf = (id: string) => extra.get(id) ?? { version: 1, profile: {} }
extra.set(ME, { version: 1, profile: { jobTitle: 'Финансовый директор', email: 'ap@polaris.example' } })
extra.set(P.ivan.id, { version: 1, profile: { jobTitle: 'Бухгалтер', email: 'ivan@polaris.example', phone: '+7 900 000-00-01' } })

/** Участник ядра с профилем и версией (как `PrincipalOut` после T002). */
export const withProfile = <T extends { id: string }>(p: T): T & { version: number, profile: Profile } => ({ ...p, ...profileOf(p.id) })

const READ = ['principals.read', 'tasks.read', 'events.read', 'workspaces.read', 'org.read', 'artifacts.read', 'approvals.read', 'projects.read', 'task_types.read', 'goals.read', 'rules.read', 'agents.read', 'processes.read', 'sessions.open']
const WORK = [...READ, 'tasks.write', 'tasks.claim', 'approvals.decide', 'artifacts.write', 'observations.write', 'skills.invoke', 'goals.write', 'processes.write']
const MANAGE = [...WORK, 'org.manage', 'rules.write', 'principals.write', 'workspaces.manage', 'approvals.manage', 'claims.manage', 'task_types.manage', 'processes.operate']

interface Binding { id: string, tenantId: string, principalId: string, issuer: string, iamTenantId: string, iamPrincipalId: string, permissions: string[], status: string, visibility: 'tenant' | 'members', revokedAt: null, lastUsedAt: string | null, createdAt: string, updatedAt: string }
const ISSUER = 'http://127.0.0.1:8092/iam'
const binding = (principalId: string, permissions: string[], visibility: Binding['visibility'] = 'tenant'): Binding => ({
  id: randomUUID(), tenantId: TENANT, principalId, issuer: ISSUER, iamTenantId: TENANT, iamPrincipalId: randomUUID(), permissions: [...new Set(permissions)].sort(), status: 'active', visibility,
  revokedAt: null, lastUsedAt: daysAgo(0), createdAt: daysAgo(60), updatedAt: daysAgo(60),
})
const bindings = new Map<string, Binding>([
  [ME, binding(ME, ['admin', ...MANAGE])],
  [P.ivan.id, binding(P.ivan.id, WORK)],
  [P.irina.id, binding(P.irina.id, WORK)],
  [P.maria.id, binding(P.maria.id, READ, 'members')],
])

const members = new Map<string, Set<string>>([
  [WORKSPACE, new Set([ME, P.ivan.id])],
  [FINANCE, new Set([ME, P.ivan.id])],
  [TENDERS, new Set([ME, P.irina.id, P.maria.id])],
])

const SECRET = /\b(ghp_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{10,}|Bearer\s+\S{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/

export function get(id: string): Reply {
  const p = principals.find(x => x.id === id)
  return p === undefined ? err(404, 'not_found', 'Principal not found') : { status: 200, body: withProfile(p) }
}

export function patch(id: string, ifMatch: string | undefined, body: string): Reply {
  const p = principals.find(x => x.id === id)
  if (p === undefined) return err(404, 'not_found', 'Principal not found')
  if (typeof p.metadata.agentKey === 'string') return err(409, 'principal_managed_by_registry', 'The agent is described by its package')
  const cur = profileOf(id)
  const m = /"?principal-(\d+)"?/.exec(ifMatch ?? '')
  if (ifMatch === undefined) return err(428, 'if_match_required', 'If-Match is required')
  if (m === null) return err(400, 'invalid_if_match', 'If-Match must be "principal-<version>"')
  if (Number(m[1]) !== cur.version) return err(409, 'version_conflict', 'the principal changed', { currentVersion: cur.version })
  const input = JSON.parse(body || '{}') as { displayName?: unknown, profile?: Profile }
  const errors: { path: string, message: string }[] = []
  if (input.displayName !== undefined && (typeof input.displayName !== 'string' || input.displayName.trim() === '' || input.displayName.length > 200)) errors.push({ path: '/displayName', message: 'от 1 до 200 символов' })
  const prof = input.profile ?? {}
  if (prof.email !== undefined && prof.email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(prof.email)) errors.push({ path: '/profile/email', message: 'не похоже на адрес почты' })
  if ((prof.jobTitle ?? '').length > 200) errors.push({ path: '/profile/jobTitle', message: 'не длиннее 200' })
  if ((prof.phone ?? '').length > 50) errors.push({ path: '/profile/phone', message: 'не длиннее 50' })
  if ((prof.note ?? '').length > 2000) errors.push({ path: '/profile/note', message: 'не длиннее 2000' })
  const secretAt = Object.entries(prof).find(([, v]) => typeof v === 'string' && SECRET.test(v))
  if (secretAt !== undefined) return err(422, 'secret_material_rejected', 'a value looks like a secret', { errors: [{ path: `/profile/${secretAt[0]}` }] })
  if (errors.length > 0) return err(422, 'validation_error', 'the profile does not fit', { errors })
  if (typeof input.displayName === 'string') p.displayName = input.displayName.trim()
  if (input.profile !== undefined) cur.profile = Object.fromEntries(Object.entries(input.profile).filter(([, v]) => typeof v === 'string' && v !== '')) as Profile
  cur.version += 1
  extra.set(id, cur)
  p.updatedAt = new Date().toISOString()
  return { status: 200, body: withProfile(p) }
}

export function listBindings(principalId: string): Reply {
  if (!principals.some(p => p.id === principalId)) return err(404, 'not_found', 'Principal not found')
  const b = bindings.get(principalId)
  return { status: 200, body: { items: b !== undefined ? [b] : [] } }
}

export function upsertBinding(principalId: string, body: string): Reply {
  const p = principals.find(x => x.id === principalId)
  if (p === undefined) return err(404, 'not_found', 'Principal not found')
  if (p.status !== 'active') return err(422, 'principal_not_active', 'Cannot bind an identity to a non-active principal')
  const input = JSON.parse(body || '{}') as { issuer?: string, iamTenantId?: string, iamPrincipalId?: string, permissions?: string[], visibility?: string }
  if (!Array.isArray(input.permissions) || input.permissions.length === 0) return err(422, 'validation_error', 'permissions: at least one')
  if (input.visibility !== undefined && input.visibility !== 'tenant' && input.visibility !== 'members') return err(422, 'validation_error', 'visibility: tenant | members')
  // Выдать шире своего нельзя: потолок — права связки того, кто вызывает (владелец стенда).
  const mine = new Set(bindings.get(ME)?.permissions ?? [])
  const beyond = input.permissions.filter(x => !mine.has(x) && !mine.has('admin'))
  if (beyond.length > 0) return err(403, 'forbidden', 'cannot grant permissions you do not hold', { missing: beyond })
  const existing = bindings.get(principalId)
  const at = new Date().toISOString()
  const b: Binding = existing !== undefined
    ? { ...existing, permissions: [...new Set(input.permissions)].sort(), ...(input.visibility !== undefined ? { visibility: input.visibility as Binding['visibility'] } : {}), status: 'active', updatedAt: at }
    : {
        ...binding(principalId, input.permissions, (input.visibility as Binding['visibility'] | undefined) ?? 'tenant'),
        issuer: input.issuer ?? ISSUER, ...(input.iamTenantId !== undefined ? { iamTenantId: input.iamTenantId } : {}), ...(input.iamPrincipalId !== undefined ? { iamPrincipalId: input.iamPrincipalId } : {}), createdAt: at, updatedAt: at,
      }
  bindings.set(principalId, b)
  return { status: existing !== undefined ? 200 : 201, body: b }
}

export function listMembers(workspaceId: string): Reply {
  const set = members.get(workspaceId)
  if (set === undefined) return err(404, 'not_found', 'Workspace not found')
  return { status: 200, body: { items: [...set].map(principalId => ({ id: `${workspaceId}:${principalId}`, workspaceId, principalId, createdAt: daysAgo(30) })), nextCursor: null } }
}

export function addMember(workspaceId: string, body: string): Reply {
  const set = members.get(workspaceId)
  if (set === undefined) return err(404, 'not_found', 'Workspace not found')
  const principalId = (JSON.parse(body || '{}') as { principalId?: string }).principalId ?? ''
  if (!principals.some(p => p.id === principalId)) return err(404, 'not_found', 'Principal not found')
  if (set.has(principalId)) return err(409, 'member_exists', 'Already a member')
  set.add(principalId)
  return { status: 201, body: { id: `${workspaceId}:${principalId}`, workspaceId, principalId, createdAt: new Date().toISOString() } }
}

export function removeMember(workspaceId: string, principalId: string): Reply {
  const set = members.get(workspaceId)
  if (set === undefined || !set.has(principalId)) return err(404, 'not_found', 'Not a member')
  set.delete(principalId)
  return { status: 204, body: null }
}

/** `:disable` — статус, связка отозвана (CP-ADR-0077); себя нельзя. */
export function disable(id: string): Reply {
  const p = principals.find(x => x.id === id)
  if (p === undefined) return err(404, 'not_found', 'Principal not found')
  if (id === ME) return err(409, 'cannot_disable_self', 'You cannot disable yourself')
  if ((bindings.get(id)?.permissions ?? []).includes('admin')) return err(403, 'permission_escalation', 'admin is required to disable an admin', { missing: ['admin'] })
  if (p.status === 'disabled') return { status: 200, body: withProfile(p) }
  p.status = 'disabled'
  const b = bindings.get(id)
  if (b !== undefined) bindings.set(id, { ...b, status: 'revoked', updatedAt: new Date().toISOString() })
  return { status: 200, body: withProfile(p) }
}

/** Права связки участника (у владельца стенда — `harness/context`). */
export const permissionsOf = (id: string): string[] => bindings.get(id)?.status === 'active' ? bindings.get(id)!.permissions : []

/** IAM principal людей стенда — по их связкам (поддельный IAM заводит их у себя). */
export function iamSeed(): { iamPrincipalId: string, displayName: string, status: string }[] {
  return [...bindings.entries()].map(([id, b]) => ({ iamPrincipalId: b.iamPrincipalId, displayName: principals.find(p => p.id === id)?.displayName ?? id, status: 'active' }))
}

const created = new Map<string, string>()
/** `POST /principals`: участник ядра; повтор по ключу идемпотентности — тот же. */
export function create(body: string, key: string | undefined): Reply {
  if (key !== undefined && created.has(key)) return get(created.get(key)!)
  const input = JSON.parse(body || '{}') as { kind?: string, displayName?: string, metadata?: Record<string, unknown> }
  if (input.kind !== 'human' || typeof input.displayName !== 'string' || input.displayName.trim() === '') return err(422, 'validation_error', 'kind human and displayName are required')
  const at = new Date().toISOString()
  const p = { ...principals.find(x => x.kind === 'human')!, id: randomUUID(), displayName: input.displayName.trim(), status: 'active', metadata: input.metadata ?? {}, createdAt: at, updatedAt: at }
  principals.push(p as typeof principals[number])
  if (key !== undefined) created.set(key, p.id)
  return { status: 201, body: withProfile(p) }
}

/** `POST /authz:check` для `principal enable|disable` — те же правила, что у эндпоинтов. */
export function authzCheck(body: string): Reply {
  const input = JSON.parse(body || '{}') as { checks?: { action?: string, resourceType?: string, resourceId?: string }[] }
  const results = (input.checks ?? []).map((c) => {
    const target = principals.find(p => p.id === c.resourceId)
    if (target === undefined) return { allowed: false, reason: { code: 'not_found', message: 'not found' } }
    if (c.action === 'disable' && target.id === ME) return { allowed: false, reason: { code: 'cannot_disable_self', message: 'self' } }
    if (typeof target.metadata.agentKey === 'string') return { allowed: false, reason: { code: c.action === 'disable' ? 'use_agent_retire' : 'use_agent_publish', message: 'agent' } }
    return { allowed: true, reason: null }
  })
  return { status: 200, body: { results } }
}

/** `:enable` — статус; связки, отозванные `:disable`, остаются отозванными. */
export function enable(id: string): Reply {
  const p = principals.find(x => x.id === id)
  if (p === undefined) return err(404, 'not_found', 'Principal not found')
  p.status = 'active'
  return { status: 200, body: { ...withProfile(p), liveApiKeys: 0 } }
}
