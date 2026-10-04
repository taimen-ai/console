/**
 * Роли организации стенда — в форме ядра: `GET /roles`, `GET /roles/{id}`, владельцы роли
 * `GET /roles/{id}/principals`, роли участника `GET|POST /principals/{id}/roles`, требования
 * работы `GET /tasks/{ref}/requirements` (роли — slug'ами) и их замена в `PATCH /tasks/{ref}`.
 * Роли стенда — на всю организацию (`workspaceId: null`). «Юрист» никто не занимает:
 * работа «Проверить договор с «Вектор»» ждёт его без исполнителя.
 */
import { randomUUID } from 'node:crypto'
import { P, TENANT, daysAgo } from './data.ts'

type Reply = { status: number, body: unknown }
const err = (status: number, code: string, message: string): Reply => ({ status, body: { error: { code, message } } })

const role = (slug: string, name: string, description: string) => ({
  id: randomUUID(), tenantId: TENANT, workspaceId: null as string | null, slug, name, description, version: 1, createdAt: daysAgo(30), updatedAt: daysAgo(30),
})
export const roles = [
  role('accountant', 'Бухгалтер', 'Проверка и сверка счетов'),
  role('finance-director', 'Финансовый директор', 'Согласование оплат выше порога'),
  role('tender-lead', 'Руководитель тендеров', 'Подача заявок на тендеры'),
  role('buyer', 'Специалист по закупкам', 'Закупки и поставщики'),
  role('lawyer', 'Юрист', 'Проверка договоров'),
]
const R = (slug: string) => roles.find(r => r.slug === slug)!

interface Assignment { id: string, principalId: string, roleId: string, workspaceId: string | null, createdAt: string }
const assignments: Assignment[] = [
  [P.ivan.id, 'accountant'], [P.me.id, 'finance-director'], [P.irina.id, 'tender-lead'], [P.maria.id, 'buyer'], [P.reconciler.id, 'accountant'],
].map(([principalId, slug]) => ({ id: randomUUID(), principalId: principalId!, roleId: R(slug!).id, workspaceId: null, createdAt: daysAgo(20) }))

/** Требования работ (publicId → slug'и ролей). */
const requirements = new Map<string, string[]>([
  ['TASK-000421', ['accountant']],
  ['TASK-000853', ['accountant']],
  ['TASK-000855', ['lawyer']],
])

export function list(): Reply { return { status: 200, body: { items: roles, nextCursor: null } } }

export function get(id: string): Reply {
  const r = roles.find(x => x.id === id)
  return r === undefined ? err(404, 'not_found', 'Role not found') : { status: 200, body: r }
}

export function holders(id: string, principals: { id: string }[]): Reply {
  if (!roles.some(x => x.id === id)) return err(404, 'not_found', 'Role not found')
  const ids = new Set(assignments.filter(a => a.roleId === id).map(a => a.principalId))
  return { status: 200, body: { items: principals.filter(p => ids.has(p.id)), nextCursor: null } }
}

export function ofPrincipal(principalId: string): Reply {
  return { status: 200, body: { items: assignments.filter(a => a.principalId === principalId).map(a => ({ id: a.id, principalId, createdAt: a.createdAt, workspaceId: a.workspaceId, role: roles.find(r => r.id === a.roleId) })) } }
}

export function assign(principalId: string, body: string, known: boolean): Reply {
  if (!known) return err(404, 'not_found', 'Principal not found')
  const input = JSON.parse(body || '{}') as { roleId?: string, workspaceId?: string | null }
  const r = roles.find(x => x.id === input.roleId)
  if (r === undefined) return err(404, 'not_found', 'Role not found')
  if (assignments.some(a => a.principalId === principalId && a.roleId === r.id && a.workspaceId === (input.workspaceId ?? null))) return err(409, 'role_already_assigned', 'The principal already holds the role here')
  const a = { id: randomUUID(), principalId, roleId: r.id, workspaceId: input.workspaceId ?? null, createdAt: new Date().toISOString() }
  assignments.push(a)
  return { status: 201, body: { id: a.id, principalId, createdAt: a.createdAt, workspaceId: a.workspaceId, role: r } }
}

export function requirementsOf(publicId: string): Reply {
  const slugs = requirements.get(publicId) ?? []
  return { status: 200, body: { roles: slugs.map(s => ({ id: R(s).id, slug: s })), capabilities: [], skills: [] } }
}

/** `PATCH` с `requirements`: набор заменяется целиком; неизвестная роль — 422, как у ядра. */
export function setRequirements(publicId: string, spec: { roles?: unknown }): Reply | null {
  const slugs = Array.isArray(spec.roles) ? spec.roles.map(String) : []
  const unknown = slugs.find(s => !roles.some(r => r.slug === s))
  if (unknown !== undefined) return err(422, 'unknown_requirement', `Role '${unknown}' not found in task scope`)
  requirements.set(publicId, slugs)
  return null
}


// ------------------------------------------------------------------ управление ролями (`org.manage`)

const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function create(body: string): Reply {
  const input = JSON.parse(body || '{}') as { slug?: string, name?: string, description?: string, workspaceId?: string | null }
  if (typeof input.slug !== 'string' || input.slug.length < 2 || input.slug.length > 63 || !SLUG.test(input.slug)) return err(422, 'validation_error', 'slug: 2–63 lower-case letters, digits and dashes')
  if (typeof input.name !== 'string' || input.name.trim() === '') return err(422, 'validation_error', 'name is required')
  if (roles.some(r => r.slug === input.slug && r.workspaceId === (input.workspaceId ?? null))) return err(409, 'role_slug_taken', 'A role with this slug exists in this scope')
  const at = new Date().toISOString()
  const r = { id: randomUUID(), tenantId: TENANT, workspaceId: input.workspaceId ?? null, slug: input.slug, name: input.name.trim(), description: input.description ?? '', version: 1, createdAt: at, updatedAt: at }
  roles.push(r)
  return { status: 201, body: r }
}

export function patch(id: string, ifMatch: string | undefined, body: string): Reply & { etag?: string } {
  const r = roles.find(x => x.id === id)
  if (r === undefined) return err(404, 'not_found', 'Role not found')
  const m = /"?role-(\d+)"?/.exec(ifMatch ?? '')
  if (m === null) return err(428, 'precondition_required', 'If-Match is required')
  if (Number(m[1]) !== r.version) return err(409, 'version_conflict', 'the role changed')
  const input = JSON.parse(body || '{}') as { name?: string | null, description?: string | null }
  if (typeof input.name === 'string') { if (input.name.trim() === '') return err(422, 'validation_error', 'name is required'); r.name = input.name.trim() }
  if (typeof input.description === 'string') r.description = input.description
  r.version += 1
  r.updatedAt = new Date().toISOString()
  return { status: 200, body: r }
}

export function revoke(principalId: string, roleId: string, body: string): Reply {
  const workspaceId = (JSON.parse(body || '{}') as { workspaceId?: string | null }).workspaceId ?? null
  const i = assignments.findIndex(a => a.principalId === principalId && a.roleId === roleId && a.workspaceId === workspaceId)
  if (i < 0) return err(404, 'not_found', 'The principal does not hold the role in this scope')
  assignments.splice(i, 1)
  return { status: 204, body: null }
}
