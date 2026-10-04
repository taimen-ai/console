import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { IdpAdminError, keycloakAdmin, splitName, type IdpAdmin } from '../src/idp-admin.ts'
import { addPerson, type PersonInput } from '../src/org.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Поддельный Keycloak: токен по client_credentials, поиск пользователей по e-mail, создание. */
async function keycloak() {
  const users: { id: string, username: string, email: string, firstName: string, lastName: string, credentials?: unknown }[] = []
  const calls: string[] = []
  let tokens = 0
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const url = new URL(req.url ?? '/', 'http://kc')
      calls.push(`${req.method} ${url.pathname}`)
      const send = (status: number, value?: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(value === undefined ? '' : JSON.stringify(value)) }
      if (url.pathname === '/realms/platform/protocol/openid-connect/token') {
        const form = new URLSearchParams(body)
        if (form.get('client_secret') !== 'people-secret') return send(401, { error: 'unauthorized_client' })
        tokens++
        return send(200, { access_token: `admin-${tokens}`, expires_in: 300 })
      }
      if (!String(req.headers.authorization ?? '').startsWith('Bearer admin-')) return send(401)
      if (url.pathname === '/admin/realms/platform/users' && req.method === 'GET') return send(200, users.filter(u => u.email === url.searchParams.get('email')))
      if (url.pathname === '/admin/realms/platform/users' && req.method === 'POST') {
        const input = JSON.parse(body) as typeof users[number]
        if (users.some(u => u.username === input.username)) return send(409, { errorMessage: 'User exists with same username' })
        const id = `kc-${users.length + 1}`
        users.push({ ...input, id })
        return send(201, undefined, { location: `http://kc/admin/realms/platform/users/${id}` })
      }
      send(404)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, users, calls, tokens: () => tokens, close: () => new Promise(resolve => server.close(resolve)) }
}

let kc: Awaited<ReturnType<typeof keycloak>> | undefined
afterEach(async () => { await kc?.close(); kc = undefined })

describe('пользователь у провайдера входа (Keycloak Admin API)', () => {
  it('новый — с именем, фамилией и временным паролем; повтор по e-mail — тот же, без пароля; токен — один', async () => {
    kc = await keycloak()
    const admin = keycloakAdmin({ url: kc.url, realm: 'platform', clientId: 'console-people', secret: 'people-secret' })
    const first = await admin.ensureUser({ email: 'olga@example.test', displayName: 'Ольга Новикова' })
    expect(first).toMatchObject({ id: 'kc-1', created: true })
    expect(first.temporaryPassword).toMatch(/^[\w-]{16,}-7Kq$/)
    expect(kc.users[0]).toMatchObject({ username: 'olga@example.test', email: 'olga@example.test', firstName: 'Ольга', lastName: 'Новикова', credentials: [{ type: 'password', temporary: true }] })
    expect(await admin.ensureUser({ email: 'olga@example.test', displayName: 'Ольга Новикова' })).toEqual({ id: 'kc-1', created: false })
    expect(kc.tokens()).toBe(1)
    expect(splitName('Платон')).toEqual({ firstName: 'Платон', lastName: 'Платон' })
  })

  it('отказы: неверный секрет, занятое имя пользователя, недоступный Keycloak', async () => {
    kc = await keycloak()
    await expect(keycloakAdmin({ url: kc.url, realm: 'platform', clientId: 'x', secret: 'wrong' }).ensureUser({ email: 'a@example.test', displayName: 'A' }))
      .rejects.toMatchObject({ status: 502, code: 'idp_admin_unauthorized' })
    // Имя пользователя занято учёткой с другим адресом — не наша, не берём.
    kc.users.push({ id: 'kc-x', username: 'a@example.test', email: 'other@example.test', firstName: 'X', lastName: 'Y' })
    await expect(keycloakAdmin({ url: kc.url, realm: 'platform', clientId: 'x', secret: 'people-secret' }).ensureUser({ email: 'a@example.test', displayName: 'A' }))
      .rejects.toMatchObject({ status: 409, code: 'idp_user_exists' })
    await expect(keycloakAdmin({ url: 'http://127.0.0.1:1', realm: 'platform', clientId: 'x', secret: 's' }).ensureUser({ email: 'a@example.test', displayName: 'A' }))
      .rejects.toBeInstanceOf(IdpAdminError)
  })
})

describe('шаг «Пользователь у провайдера» в потоке', () => {
  const INPUT: PersonInput = { displayName: 'Ольга Новикова', email: 'olga@example.test', subject: '', workspaceId: '11111111-1111-4111-8111-111111111111', roleIds: [], permissions: ['tasks.read'], createIdpUser: true }
  const calls: string[] = []
  // Ядро и IAM — минимально: вызывающий — admin, участников нет; первый шаг IAM отказывает,
  // чтобы видеть, какой `sub` поток понёс дальше.
  const ctx = (idpAdmin: IdpAdmin | null) => ({
    iamTenantId: 't', iamIssuer: 'https://iam', idpIssuer: 'https://idp', loginUrl: () => '', idpAdmin,
    call: async (service: string, method: string, path: string) => {
      calls.push(`${service} ${method} ${path}`)
      if (path === '/harness/context') return { status: 200, body: { permissions: ['admin'] } }
      if (path.startsWith('/principals?')) return { status: 200, body: { items: [], nextCursor: null } }
      return { status: 503, body: { detail: 'upstream_unavailable' } }
    },
  })

  it('id созданного пользователя — это `sub` для IAM; без настройки — отказ до IAM', async () => {
    calls.length = 0
    const report = await addPerson(ctx({ ensureUser: async () => ({ id: 'kc-42', created: true, temporaryPassword: 'tmp' }) }), INPUT)
    expect(report.steps.map(s => `${s.name}:${s.status}`).slice(0, 2)).toEqual(['idp_user:done', 'iam_principal:failed'])
    expect(report.idpUser).toEqual({ created: true, temporaryPassword: 'tmp' })
    expect(calls.some(c => c.includes('subject=kc-42'))).toBe(true)
    calls.length = 0
    const off = await addPerson(ctx(null), INPUT)
    expect(off.steps[0]).toMatchObject({ name: 'idp_user', status: 'failed', error: { status: 501, code: 'idp_admin_disabled' } })
    expect(calls.some(c => c.startsWith('iam '))).toBe(false)
    const refused = await addPerson(ctx({ ensureUser: async () => { throw new IdpAdminError(409, 'idp_user_exists') } }), INPUT)
    expect(refused.steps[0]).toMatchObject({ name: 'idp_user', status: 'failed', error: { code: 'idp_user_exists' } })
  })
})

describe('настройка', () => {
  it('адрес и realm Keycloak — из issuer; без файла секрета — отказ запуска', () => {
    const dir = mkdtempSync(join(tmpdir(), 'console-cfg-'))
    for (const f of ['cookie', 'oidc', 'people']) writeFileSync(join(dir, f), f === 'cookie' ? 'x'.repeat(48) : 'secret')
    const env = {
      CONSOLE_PUBLIC_URL: 'https://platform.example.com', CONSOLE_COOKIE_SECRET_FILE: join(dir, 'cookie'), CONSOLE_OIDC_SECRET_FILE: join(dir, 'oidc'),
      CONSOLE_OIDC_ISSUER: 'https://platform.example.com/auth/realms/platform', CONSOLE_IAM_TENANT: 't',
    }
    expect(loadConfig(env).idpAdmin).toBeNull()
    expect(loadConfig({ ...env, CONSOLE_IDP_ADMIN: 'keycloak', CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE: join(dir, 'people') }).idpAdmin)
      .toEqual({ kind: 'keycloak', url: 'https://platform.example.com/auth', realm: 'platform', clientId: 'console-people', secret: 'secret' })
    expect(loadConfig({ ...env, CONSOLE_IDP_ADMIN: 'keycloak', CONSOLE_KEYCLOAK_URL: 'http://keycloak:8080/auth', CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE: join(dir, 'people') }).idpAdmin?.url).toBe('http://keycloak:8080/auth')
    expect(() => loadConfig({ ...env, CONSOLE_IDP_ADMIN: 'keycloak' })).toThrow(/CONSOLE_KEYCLOAK_ADMIN_SECRET_FILE/)
  })
})
