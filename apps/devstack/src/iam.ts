/**
 * Заглушка IAM стенда: обмен входа на токен audience (`federation:exchange`) и управление людьми
 * по scope `iam:people` (IAM ADR-0002, TASK-000908) — то, что зовёт поток BFF «Люди»
 * (`apps/bff/src/org.ts`): principal людей, их внешние identity у IdP, `:disable`/`:enable`.
 * Люди стенда заведены по связкам ядра (`people.iamSeed`); «Ольга Новикова» есть только в IAM —
 * её консоль показывает в «Не доведены» (e-mail потока — olga@polaris.example).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { TENANT } from './data.ts'
import { iamSeed } from './people.ts'

type Row = Record<string, unknown>

export function iamService(options: { port: number, idpIssuer: string, jwt: (claims: Row) => string, me: string }) {
  /** Issuer токенов IAM — первая половина пары связки ядра (как `ISSUER` в people.ts). */
  const issuer = `http://127.0.0.1:${options.port}/iam`
  const principals = new Map<string, Row>()
  const identities: Row[] = []
  const keys = new Map<string, Row>()
  for (const p of iamSeed()) principals.set(p.iamPrincipalId, { id: p.iamPrincipalId, kind: 'human', display_name: p.displayName, status: p.status })
  // Вход владельца стенда — `sub` его токена у IdP.
  const owner = iamSeed()[0]
  if (owner !== undefined) identities.push({ principal_id: owner.iamPrincipalId, issuer: options.idpIssuer, subject: 'owner', status: 'active' })
  // Ольгу начали добавлять консолью и остановились после первого шага: её учётка заведена с
  // ключом потока (`flowIdOf` в bff/src/org.ts) — «Довести» с тем же e-mail возьмёт её же.
  const olga = { id: randomUUID(), kind: 'human', display_name: 'Ольга Новикова', status: 'active' }
  principals.set(olga.id, olga)
  const flow = createHash('sha256').update(`${TENANT}|olga@polaris.example`).digest('hex').slice(0, 32)
  keys.set(`console-person-${flow}-iam`, olga)

  const send = (res: ServerResponse, status: number, value: unknown): void => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)) }

  return (req: IncomingMessage, res: ServerResponse, body: string): void => {
    const url = new URL(req.url ?? '/', issuer)
    const prefix = `/api/v1/tenants/${TENANT}`
    if (!url.pathname.startsWith(prefix)) return send(res, 404, { detail: 'Not Found' })
    const path = url.pathname.slice(prefix.length)
    const method = req.method ?? 'GET'
    if (path === '/federation:exchange' && method === 'POST') {
      const input = JSON.parse(body) as { audience: string, scopes: string[] }
      const accessToken = options.jwt({ iss: issuer, sub: options.me, aud: input.audience, scope: input.scopes.join(' '), n: randomBytes(4).toString('hex') })
      return send(res, 200, { accessToken, expiresIn: 300, audience: input.audience, scope: input.scopes, principalId: options.me })
    }
    if (path === '/external-identities' && method === 'GET') {
      const items = identities.filter(i => i.issuer === url.searchParams.get('issuer') && i.subject === url.searchParams.get('subject'))
      return send(res, 200, { items })
    }
    if (path === '/principals' && method === 'GET') {
      const kind = url.searchParams.get('kind')
      return send(res, 200, { items: [...principals.values()].filter(p => kind === null || p.kind === kind), next_after: null })
    }
    if (path === '/principals' && method === 'POST') {
      const key = String(req.headers['idempotency-key'] ?? '')
      if (key !== '' && keys.has(key)) return send(res, 201, keys.get(key))
      const input = JSON.parse(body || '{}') as { kind?: string, displayName?: string }
      if (input.kind !== 'human') return send(res, 422, { detail: 'human_principal_required' })
      const p = { id: randomUUID(), kind: 'human', display_name: input.displayName ?? '', status: 'active' }
      principals.set(p.id, p)
      if (key !== '') keys.set(key, p)
      return send(res, 201, p)
    }
    let m: RegExpExecArray | null
    if ((m = /^\/principals\/([^/:]+)\/external-identities$/.exec(path)) !== null && method === 'POST') {
      const input = JSON.parse(body || '{}') as { issuer?: string, subject?: string }
      if (!principals.has(m[1]!)) return send(res, 404, { detail: 'principal_not_found' })
      if (identities.some(i => i.principal_id === m![1])) return send(res, 409, { detail: 'principal_has_identity' })
      if (identities.some(i => i.issuer === input.issuer && i.subject === input.subject)) return send(res, 409, { detail: 'external_identity_exists' })
      const identity = { principal_id: m[1], issuer: input.issuer, subject: input.subject, status: 'active' }
      identities.push(identity)
      return send(res, 201, identity)
    }
    if ((m = /^\/principals\/([^/:]+):(disable|enable)$/.exec(path)) !== null && method === 'POST') {
      const p = principals.get(m[1]!)
      if (p === undefined) return send(res, 404, { detail: 'principal_not_found' })
      p.status = m[2] === 'disable' ? 'disabled' : 'active'
      return send(res, 200, p)
    }
    if ((m = /^\/principals\/([^/:]+)$/.exec(path)) !== null && method === 'GET') {
      const p = principals.get(m[1]!)
      return p !== undefined ? send(res, 200, p) : send(res, 404, { detail: 'principal_not_found' })
    }
    send(res, 404, { detail: 'Not Found' })
  }
}
