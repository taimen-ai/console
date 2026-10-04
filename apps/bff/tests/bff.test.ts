import { request } from 'node:http'
import type { Socket } from 'node:net'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { AllowList, compile, CONTROL_PLANE_MUTATIONS } from '../src/allowlist.ts'
import { DISCOVERY_RETRY_MS, IDP_TIMEOUT_MS, Oidc, type IdpTokens } from '../src/identity.ts'
import { MESSAGE_REPLAY_TTL_MS } from '../src/server.ts'
import { deriveKeys } from '../src/crypto.ts'
import { FileSessionStore } from '../src/session-store.ts'
import { MAX_TUNNELS_PER_SESSION, REVOKE_CONCURRENCY, revokeRefresh, Sessions, type Session } from '../src/sessions.ts'
import { JWT, PRINCIPAL, TENANT, world } from './world.ts'

type World = Awaited<ReturnType<typeof world>>
let w: World | null = null
afterEach(async () => {
  // FR-007: close() проверяет ответы и журнал на токены (world.assertNoLeaks).
  await w?.close()
  w = null
})
const start = async (options: Parameters<typeof world>[0] = {}): Promise<World> => (w = await world(options))
const bearer = (value: string | string[] | undefined): string => String(value).replace(/^Bearer /, '')
/** Дать долететь fire-and-forget вызовам (отзыв у IdP), чтобы проверить, что их не было. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 50))

/** Меняет символ в середине значения cookie `name=value`: все 6 бит такого символа — данные. */
function tamper(cookie: string): string {
  const at = cookie.indexOf('=') + 1 + Math.floor((cookie.length - cookie.indexOf('=') - 1) / 2)
  return cookie.slice(0, at) + (cookie[at] === 'A' ? 'B' : 'A') + cookie.slice(at + 1)
}

describe('вход и сессия', () => {
  it('healthz публичен, API без сессии — 401, страница — на вход', async () => {
    const t = await start()
    expect((await t.call('GET', '/console/healthz')).status).toBe(200)
    expect((await t.call('GET', '/console/api/cp/tasks')).status).toBe(401)
    const html = await t.call('GET', '/console/work/TASK-1?tab=runs')
    expect(html.status).toBe(302)
    expect(html.headers.location).toBe('/console/_auth/login?next=%2Fconsole%2Fwork%2FTASK-1%3Ftab%3Druns')
    expect(t.app.isPublic('GET', '/console/api/cp/tasks')).toBe(false)
    expect(t.app.isPublic('POST', '/console/_auth/logout')).toBe(true)
    expect(t.app.isPublic('GET', '/console/api/config')).toBe(true)
    expect(JSON.parse((await t.call('GET', '/console/api/config')).body)).toEqual({ basePath: '/console', brand: { productName: 'Console', orgName: null }, locales: ['en', 'ru'], defaultLocale: 'en' })
  })

  it('OIDC: PKCE S256, confidential client, возврат на next; в cookie только подписанный sid', async () => {
    const t = await start()
    const { cookie, setCookie, reply } = await t.login('/console/processes/abc')
    expect(reply.status).toBe(302)
    expect(reply.headers.location).toBe('/console/processes/abc')
    const code = t.idp.tokenCalls[0]!
    expect(code.get('grant_type')).toBe('authorization_code')
    expect(code.get('code_verifier')).toBeTruthy()
    expect(t.idp.basic[0]).toBe(`Basic ${Buffer.from('runtime-console:client-secret-value').toString('base64')}`)
    // Первый обмен — control-plane: он же даёт principal сессии.
    expect(t.iam.calls[0]).toEqual({ audience: 'control-plane', scopes: ['control-plane:read', 'control-plane:write'] })
    expect(setCookie).toMatch(/Path=\/console;/)
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/SameSite=Lax/)
    expect(setCookie).toMatch(/Max-Age=43200/)
    expect(setCookie).not.toMatch(/Secure/)
    const value = decodeURIComponent(cookie.slice('console_session='.length))
    expect(value).toMatch(/^[\w-]{43}\.[\w-]{43}$/)
    expect(value).not.toMatch(JWT)
    for (const token of t.issuedTokens) expect(setCookie).not.toContain(token)
    expect(setCookie).not.toContain(PRINCIPAL)
    const me = await t.call('GET', '/console/api/session', { headers: { cookie } })
    expect(JSON.parse(me.body)).toMatchObject({ principalId: PRINCIPAL })
    expect(me.body).not.toMatch(JWT)
  })

  it('публичный https-адрес даёт Secure cookie', async () => {
    const t = await start({ publicOrigin: 'https://console.test' })
    expect((await t.login()).setCookie).toMatch(/; Secure/)
  })

  it('callback отклоняет вход без cookie входа, чужой state, подделку и вытесненный вход', async () => {
    const t = await start()
    const first = await t.call('GET', '/console/_auth/login')
    const firstUrl = new URL(String(first.headers.location))
    const state = firstUrl.searchParams.get('state')!
    const loginCookie = String(first.headers['set-cookie']?.[0]).split(';')[0]!
    // Незавершённый вход — в зашифрованной cookie: state, verifier и nonce в ней не видны.
    for (const secret of [state, firstUrl.searchParams.get('nonce')!, 'TASK-1']) expect(loginCookie).not.toContain(secret)
    // Без cookie входа (login CSRF) — отказ, до IdP дело не доходит.
    expect((await t.call('GET', `/console/_auth/callback?code=x&state=${state}`)).status).toBe(400)
    // Подменённый state при своей cookie.
    expect((await t.call('GET', '/console/_auth/callback?code=x&state=forged', { headers: { cookie: loginCookie } })).status).toBe(400)
    // Подделанная cookie: символ из середины значения. Последний символ base64url не годится —
    // часть его битов только выравнивание, декодер их отбрасывает, и «подделка» давала те же байты.
    const tampered = tamper(loginCookie)
    expect((await t.call('GET', `/console/_auth/callback?code=x&state=${state}`, { headers: { cookie: tampered } })).status).toBe(400)
    // Новый вход в том же браузере вытесняет прежний: старый state с новой cookie не проходит.
    const second = await t.call('GET', '/console/_auth/login')
    const cookie2 = String(second.headers['set-cookie']?.[0]).split(';')[0]!
    expect((await t.call('GET', `/console/_auth/callback?code=x&state=${state}`, { headers: { cookie: cookie2 } })).status).toBe(400)
    // Истёкшая cookie входа (10 мин).
    t.advance(11 * 60_000)
    const state2 = new URL(String(second.headers.location)).searchParams.get('state')!
    expect((await t.call('GET', `/console/_auth/callback?code=x&state=${state2}`, { headers: { cookie: cookie2 } })).status).toBe(400)
    expect(t.idp.tokenCalls).toHaveLength(0)
    expect(t.sessions.size).toBe(0)
  })

  it('next — только путь консоли своего origin; не-Latin-1 и \\0 не роняют callback', async () => {
    const t = await start()
    expect((await t.login('https://evil.test/console/x')).reply.headers.location).toBe('/console/')
    expect((await t.login('//evil.test/console/x')).reply.headers.location).toBe('/console/')
    expect((await t.login('/console/../admin')).reply.headers.location).toBe('/console/')
    const odd = await t.login('/console/работа\0?q=ё')
    expect(odd.reply.status).toBe(302)
    expect(odd.reply.headers.location).toBe('/console/%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%B0%00?q=%D1%91')
  })

  it('discovery с чужим issuer — вход не начинается', async () => {
    const t = await start({ wrongIssuer: true })
    expect((await t.call('GET', '/console/_auth/login')).status).toBe(503)
  })

  it('discovery: зависший IdP обрывается таймаутом, отказ помнится несколько секунд, удача — навсегда', async () => {
    expect(IDP_TIMEOUT_MS).toBe(10_000)
    const issuer = 'https://idp.test'
    const document = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` }
    const plan: ('hang' | 'fail' | 'ok')[] = ['hang', 'fail', 'ok']
    let calls = 0
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      const step = plan[calls++]
      if (step === 'hang') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
      }
      if (step === 'fail') return Promise.resolve(new Response('{}', { status: 503 }))
      return Promise.resolve(new Response(JSON.stringify(document), { status: 200 }))
    }) as typeof fetch
    let clock = 0
    const oidc = new Oidc({ issuer, clientId: 'c', clientSecret: 's', scopes: 'openid', redirectUri: 'x', postLogoutRedirectUri: 'y' }, fetchImpl, { timeoutMs: 20, now: () => clock })
    expect(DISCOVERY_RETRY_MS).toBeGreaterThanOrEqual(5_000)
    expect(DISCOVERY_RETRY_MS).toBeLessThanOrEqual(10_000)
    await expect(oidc.discover()).rejects.toThrow()
    // Отказ помнится: в окно DISCOVERY_RETRY_MS лежащий IdP не спрашивается.
    await expect(oidc.discover()).rejects.toThrow()
    clock += DISCOVERY_RETRY_MS - 1
    await expect(oidc.discover()).rejects.toThrow()
    expect(calls).toBe(1)
    clock += 1
    await expect(oidc.discover()).rejects.toThrow(/HTTP 503/)
    expect(calls).toBe(2)
    clock += DISCOVERY_RETRY_MS
    await expect(oidc.discover()).resolves.toMatchObject({ issuer })
    // Удачный документ кэшируется: четвёртого вызова IdP нет.
    await oidc.discover()
    expect(calls).toBe(3)
  })

  it('перевход поверх живого SSO (тот же sid IdP) закрывает прежнюю сессию, но refresh не отзывает: новая тихо обновляется', async () => {
    const t = await start()
    const first = await t.login('/console/', undefined, 'sso-browser')
    const second = await t.login('/console/', first.cookie, 'sso-browser')
    expect((await t.call('GET', '/console/api/session', { headers: { cookie: first.cookie } })).status).toBe(401)
    expect((await t.call('GET', '/console/api/session', { headers: { cookie: second.cookie } })).status).toBe(200)
    // Keycloak погасил бы по отзыву refresh прежней сессии всю сессию IdP — а с ней refresh новой.
    await settle()
    expect(t.idp.revoked).toEqual([])
    // id token и токен IAM истекли: новая сессия обновляется refresh'ем той же сессии IdP.
    t.advance(301_000)
    expect((await t.call('GET', '/console/api/cp/tasks', { headers: { cookie: second.cookie } })).status).toBe(200)
    expect(t.idp.tokenCalls.at(-1)!.get('grant_type')).toBe('refresh_token')
    expect(t.idp.passwordPrompts).toBe(0)
    // Выход последней сессии с этим sid гасит и сессию IdP.
    expect((await t.call('POST', '/console/_auth/logout', { headers: { cookie: second.cookie, ...t.origin, accept: 'application/json' } })).status).toBe(204)
    await expect.poll(() => t.idp.killed.has('sso-browser')).toBe(true)
    expect(t.idp.revoked).toHaveLength(1)
  })

  it('сессий на principal не больше 10: вытесненная отзывает refresh, только если её сессия IdP больше не нужна', async () => {
    const t = await start()
    const a = await t.login('/console/', undefined, 'sso-a')
    const cookies = [a.cookie]
    for (let i = 0; i < 9; i++) cookies.push((await t.login()).cookie)
    // Одиннадцатая с тем же sid, что у самой старой, вытесняет её без отзыва.
    const again = await t.login('/console/', undefined, 'sso-a')
    expect(t.sessions.size).toBe(10)
    expect((await t.call('GET', '/console/api/session', { headers: { cookie: a.cookie } })).status).toBe(401)
    expect((await t.call('GET', '/console/api/session', { headers: { cookie: again.cookie } })).status).toBe(200)
    // Следующая вытесняет вторую — у той своя сессия IdP, её refresh отзывается.
    const b = await t.login()
    expect((await t.call('GET', '/console/api/session', { headers: { cookie: cookies[1]! } })).status).toBe(401)
    expect((await t.call('GET', '/console/api/session', { headers: { cookie: b.cookie } })).status).toBe(200)
    await expect.poll(() => t.idp.revoked).toEqual([t.idp.refreshIssued[1]])
  })

  it('истечение и sweep отзывают refresh у IdP', async () => {
    const t = await start()
    const a = await t.login()
    await t.login()
    t.advance(t.config.sessionTtlMs + 1)
    // Истёкшая сессия, найденная по cookie, удаляется при обращении.
    expect((await t.call('GET', '/console/api/session', { headers: { cookie: a.cookie } })).status).toBe(401)
    await expect.poll(() => t.idp.revoked).toEqual([t.idp.refreshIssued[0]])
    // Вторую никто не спрашивал — её убирает sweep по таймеру.
    t.sessions.sweep()
    expect(t.sessions.size).toBe(0)
    await expect.poll(() => [...t.idp.revoked].sort()).toEqual([...t.idp.refreshIssued].sort())
  })

  it('sweep: истёкшая сессия не отзывает refresh, пока жива сессия консоли с тем же sid IdP', async () => {
    const t = await start()
    // Срок сессии консоли короче жизни SSO: прежняя сессия браузера (cookie потеряна) истекает,
    // а новая, открытая поверх того же SSO, живёт дальше.
    await t.login('/console/', undefined, 'sso-long')
    t.advance(t.config.sessionTtlMs - 60_000)
    const fresh = await t.login('/console/', undefined, 'sso-long')
    t.advance(120_000)
    t.sessions.sweep()
    expect(t.sessions.size).toBe(1)
    await settle()
    expect(t.idp.revoked).toEqual([])
    t.advance(301_000)
    expect((await t.call('GET', '/console/api/cp/tasks', { headers: { cookie: fresh.cookie } })).status).toBe(200)
    expect(t.idp.tokenCalls.at(-1)!.get('grant_type')).toBe('refresh_token')
  })

  it(`отзывы у IdP идут очередью: не больше ${REVOKE_CONCURRENCY} сразу; живой sid проверяется и при отправке`, async () => {
    const started: string[] = []
    const pending: (() => void)[] = []
    const revoke = revokeRefresh({ revoke: (token) => { started.push(token); return new Promise<boolean>((resolve) => { pending.push(() => resolve(true)) }) } })
    const alive = new Set<string>()
    const live = (sid: string): boolean => alive.has(sid)
    const session = (refresh: string, idpSid: string | null): Session => ({ idpRefresh: refresh, idpSid }) as Session
    for (let i = 0; i < 8; i++) revoke(session(`r${i}`, `s${i}`), live)
    expect(REVOKE_CONCURRENCY).toBe(4)
    expect(started).toEqual(['r0', 'r1', 'r2', 'r3'])
    // Пока r4 ждал очереди, случился перевход с его sid — отзыв пропускается.
    alive.add('s4')
    pending.shift()!()
    await expect.poll(() => started).toEqual(['r0', 'r1', 'r2', 'r3', 'r5'])
    // Живой sid при постановке — отзыва нет; без sid (IdP claim не выдаёт) — отзыв всегда.
    revoke(session('r-live', 's4'), live)
    revoke(session('r-nosid', null), live)
    while (pending.length > 0) pending.shift()!()
    await expect.poll(() => started).toEqual(['r0', 'r1', 'r2', 'r3', 'r5', 'r6', 'r7', 'r-nosid'])
    while (pending.length > 0) pending.shift()!()
  })

  it('callback с неверным PKCE verifier и с чужим nonce не создаёт сессию', async () => {
    const t = await start({ wrongNonce: true })
    const { reply } = await t.login()
    expect(reply.status).toBe(400)
    expect(t.sessions.size).toBe(0)
    // Verifier: IdP сверяет S256 с challenge — подмена кода ломает обмен.
    const start2 = await t.call('GET', '/console/_auth/login')
    const url = new URL(String(start2.headers.location))
    t.codes.set('bad', { challenge: 'not-the-challenge', nonce: url.searchParams.get('nonce')! })
    const cookie = String(start2.headers['set-cookie']?.[0]).split(';')[0]!
    expect((await t.call('GET', `/console/_auth/callback?code=bad&state=${url.searchParams.get('state')}`, { headers: { cookie } })).status).toBe(502)
    expect(t.sessions.size).toBe(0)
  })

  it('подделанная cookie сессии — 401', async () => {
    const t = await start()
    const { cookie } = await t.login()
    const forged = cookie.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))
    expect((await t.call('GET', '/console/api/cp/tasks', { headers: { cookie: forged } })).status).toBe(401)
  })

  it('logout: без id_token_hint, отзыв refresh у IdP; форма — 303, fetch — 204, GET сессию не трогает', async () => {
    const t = await start()
    const { cookie } = await t.login()
    // GET (навигация SPA после fetch-выхода, или чужая ссылка) — только на выход из IdP.
    const nav = await t.call('GET', '/console/_auth/logout', { headers: { cookie } })
    expect(nav.status).toBe(303)
    expect((await t.call('GET', '/console/api/session', { headers: { cookie } })).status).toBe(200)
    const out = await t.call('POST', '/console/_auth/logout', { headers: { cookie, ...t.origin, 'sec-fetch-mode': 'navigate', accept: 'text/html' } })
    expect(out.status).toBe(303)
    const location = new URL(String(out.headers.location))
    expect(location.pathname).toBe('/logout')
    expect(location.searchParams.get('post_logout_redirect_uri')).toBe('http://console.test/console/')
    expect(location.searchParams.get('client_id')).toBe('runtime-console')
    expect(location.searchParams.has('id_token_hint')).toBe(false)
    await expect.poll(() => t.idp.revoked).toEqual([t.idp.refreshIssued[0]])
    expect((await t.call('GET', '/console/api/cp/tasks', { headers: { cookie } })).status).toBe(401)
    const again = await t.login()
    const fetched = await t.call('POST', '/console/_auth/logout', { headers: { cookie: again.cookie, ...t.origin, accept: 'application/json' } })
    expect(fetched.status).toBe(204)
    expect(fetched.body).toBe('')
    expect(String(fetched.headers['set-cookie'])).toMatch(/console_session=;.*Max-Age=0/)
    expect((await t.call('POST', '/console/_auth/logout', { headers: { cookie: again.cookie, origin: 'https://evil.test' } })).status).toBe(403)
  })

  it('сессию удалили, пока шёл refresh IdP: ротированный refresh тоже уходит в onDelete', async () => {
    let release: (tokens: IdpTokens) => void = () => {}
    const deleted: (string | null)[] = []
    const sessions = new Sessions({
      ttlMs: 60_000, now: () => 0, scopes: { 'control-plane': [], 'human-harness': [], iam: [] },
      oidc: { refresh: () => new Promise<IdpTokens>((resolve) => { release = resolve }) },
      exchange: () => Promise.reject(new Error('iam down')),
      onDelete: (session) => { deleted.push(session.idpRefresh) },
    })
    const session = sessions.create(PRINCIPAL, { idToken: 'id-1', idTokenExp: 0, refreshToken: 'r-1', nonce: null, sid: null })
    const pending = sessions.token(session, 'control-plane').catch(() => null)
    sessions.delete(session.sid)
    release({ idToken: 'id-2', idTokenExp: 3_600_000, refreshToken: 'r-2', nonce: null, sid: null })
    await pending
    expect(deleted).toEqual(['r-1', 'r-2'])
  })

  it('logout не ждёт отзыва refresh: IdP завис, а cookie гасится сразу', async () => {
    const t = await start()
    const { cookie } = await t.login()
    t.idp.revokeHangs = true
    const started = Date.now()
    const out = await t.call('POST', '/console/_auth/logout', { headers: { cookie, ...t.origin, accept: 'application/json' } })
    expect(out.status).toBe(204)
    expect(String(out.headers['set-cookie'])).toMatch(/console_session=;.*Max-Age=0/)
    expect(Date.now() - started).toBeLessThan(1_000)
    // Отзыв ушёл к IdP (ответа он не получит), сессии уже нет.
    await expect.poll(() => t.idp.revoked).toHaveLength(1)
    expect((await t.call('GET', '/console/api/session', { headers: { cookie } })).status).toBe(401)
  })
})

describe('прокси ядра: allow-list и Origin', () => {
  it('GET идёт наверх с Bearer audience control-plane и query; вне allow-list — 404', async () => {
    const t = await start()
    const { cookie } = await t.login()
    const ok = await t.call('GET', '/console/api/cp/tasks?status=todo', { headers: { cookie } })
    expect(ok.status).toBe(200)
    // Ответ ресурса не исполняется браузером как документ.
    expect(ok.headers['x-content-type-options']).toBe('nosniff')
    expect(ok.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    const seen = t.cp.requests.at(-1)!
    expect(seen.url).toBe('/api/v1/tasks?status=todo')
    expect(t.issuedTokens).toContain(bearer(seen.headers.authorization))
    expect(seen.headers.cookie).toBeUndefined()
    const before = t.cp.requests.length
    for (const [method, path] of [
      ['POST', '/console/api/cp/tasks/TASK-1:claim'], // брать работу — не действие консоли
      ['DELETE', '/console/api/cp/rules/r1'],
      ['DELETE', '/console/api/cp/tasks/TASK-1/relations/r1'],
      ['GET', '/console/api/cp/no-such-thing'],
      ['GET', '/console/api/cp/tasks/..%2F..%2Fbootstrap'],
      ['GET', '/console/api/cp/tasks/%2e%2e'],
      ['POST', '/console/api/cp/rules/r1%3Aenable'], // закодированное «:» не обходит шаблон
      ['POST', '/console/api/cp/rules/r1%3adisable'],
    ] as const) {
      const reply = await t.call(method, path, { headers: { cookie, ...t.origin }, ...(method === 'POST' ? { body: '{}' } : {}) })
      expect(reply.status, `${method} ${path}`).toBe(404)
    }
    expect(t.cp.requests.length).toBe(before)
  })

  it('мутация без своего Origin — 403; со своим — наверх с Idempotency-Key', async () => {
    const t = await start()
    const { cookie } = await t.login()
    const path = '/console/api/cp/approvals/a1:approve'
    expect((await t.call('POST', path, { headers: { cookie, origin: 'https://evil.test' }, body: '{}' })).status).toBe(403)
    expect((await t.call('POST', path, { headers: { cookie }, body: '{}' })).status).toBe(403)
    expect((await t.call('POST', path, { headers: { cookie, 'sec-fetch-site': 'cross-site', ...t.origin }, body: '{}' })).status).toBe(403)
    const ok = await t.call('POST', path, { headers: { cookie, ...t.origin, 'sec-fetch-site': 'same-origin', 'idempotency-key': 'k-1', 'content-type': 'application/json' }, body: '{"comment":"ok"}' })
    expect(ok.status).toBe(200)
    const seen = t.cp.requests.at(-1)!
    expect(seen.url).toBe('/api/v1/approvals/a1:approve')
    expect(seen.headers['idempotency-key']).toBe('k-1')
    expect(seen.body).toBe('{"comment":"ok"}')
    const route = t.logs.filter(l => l.event === 'access').at(-1)!
    expect(route.route).toBe('/console/api/cp/approvals/{approval_id}:approve')
  })

})

describe('токены audience', () => {
  it('истёкший токен тихо перевыпускается: refresh IdP и новый federation:exchange', async () => {
    const t = await start()
    const { cookie } = await t.login()
    await t.call('GET', '/console/api/cp/tasks', { headers: { cookie } })
    const first = bearer(t.cp.requests.at(-1)!.headers.authorization)
    await t.call('GET', '/console/api/cp/tasks', { headers: { cookie } })
    expect(bearer(t.cp.requests.at(-1)!.headers.authorization)).toBe(first) // кэш
    const exchanges = t.iam.calls.length
    t.advance(301_000) // и токен IAM (300 с), и id token IdP истекли
    const again = await t.call('GET', '/console/api/cp/tasks', { headers: { cookie } })
    expect(again.status).toBe(200)
    expect(bearer(t.cp.requests.at(-1)!.headers.authorization)).not.toBe(first)
    expect(t.iam.calls.length).toBe(exchanges + 1)
    expect(t.idp.tokenCalls.at(-1)!.get('grant_type')).toBe('refresh_token')
  })

  it('провал refresh IdP — 401 reauth_required для API и перевход для страницы', async () => {
    const t = await start()
    const { cookie } = await t.login()
    t.idp.refreshFails = true
    t.advance(301_000)
    const api = await t.call('GET', '/console/api/cp/tasks', { headers: { cookie } })
    expect(api.status).toBe(401)
    expect(JSON.parse(api.body)).toEqual({ error: { code: 'reauth_required' } })
    expect((await t.call('GET', '/console/', { headers: { cookie } })).headers.location).toMatch(/^\/console\/_auth\/login/)
    // Refresh, который IdP только что отверг, обратно к IdP на отзыв не уходит.
    await settle()
    expect(t.idp.revoked).toEqual([])
  })

  it('ресурс ответил 401 — токен сбрасывается и запрос повторяется один раз; второй 401 — upstream_unauthorized', async () => {
    const t = await start()
    const { cookie } = await t.login()
    t.cp.reject401 = 1
    expect((await t.call('GET', '/console/api/cp/tasks', { headers: { cookie } })).status).toBe(200)
    const [a, b] = t.cp.requests.slice(-2)
    expect(bearer(a!.headers.authorization)).not.toBe(bearer(b!.headers.authorization))
    t.cp.reject401 = 2
    const twice = await t.call('GET', '/console/api/cp/tasks', { headers: { cookie } })
    expect(twice.status).toBe(502)
    expect(JSON.parse(twice.body)).toEqual({ error: { code: 'upstream_unauthorized', audience: 'control-plane' } })
    // Сессия жива: это не повод для перевхода.
    expect((await t.call('GET', '/console/api/session', { headers: { cookie } })).status).toBe(200)
  })

})

describe('живые каналы', () => {
  it('WebSocket проксируется в ядро с серверным Bearer; чужой origin и не-websocket отклонены; выход закрывает туннель', async () => {
    const t = await start({ wsHandshakeTimeoutMs: 200 })
    const { cookie } = await t.login()
    const handshake = (origin: string, path = '/console/api/ws?after=0', upgrade = 'websocket'): Promise<{ status: number, socket?: Socket, head?: Buffer }> => new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1', port: t.port, path,
        headers: { cookie, origin, connection: 'Upgrade', upgrade, 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      })
      req.on('upgrade', (res, socket, head) => resolve({ status: res.statusCode ?? 0, socket, head }))
      req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }) })
      req.on('error', reject)
      req.end()
    })
    expect((await handshake('https://evil.test')).status).toBe(403)
    expect((await handshake('http://console.test', '/console/api/ws', 'h2c')).status).toBe(400)
    expect(t.cp.wsAuth).toHaveLength(0)
    // Ядро молчит на рукопожатие — 504 по таймауту (здесь 200 мс).
    expect((await handshake('http://console.test', '/console/api/ws?hang=1')).status).toBe(504)
    t.cp.wsAuth.length = 0
    const { status, socket, head } = await handshake('http://console.test')
    expect(status).toBe(101)
    expect(t.issuedTokens).toContain(bearer(t.cp.wsAuth[0]))
    const received: string[] = [head!.toString()]
    socket!.on('data', (c: Buffer) => received.push(c.toString()))
    socket!.write('ping')
    await expect.poll(() => received.join('')).toContain('echo:ping')
    expect(received.join('')).toContain('from-core')
    expect(received.join('')).not.toMatch(JWT)
    let closed = false
    socket!.on('close', () => { closed = true })
    expect((await t.call('POST', '/console/_auth/logout', { headers: { cookie, ...t.origin, accept: 'application/json' } })).status).toBe(204)
    await expect.poll(() => closed).toBe(true)
  })

  it(`WS-туннелей на сессию не больше ${MAX_TUNNELS_PER_SESSION}: сверх — 429, закрытый освобождает место`, async () => {
    const t = await start()
    const { cookie } = await t.login()
    const handshake = (): Promise<{ status: number, socket?: Socket }> => new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1', port: t.port, path: '/console/api/ws',
        headers: { cookie, origin: 'http://console.test', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      })
      req.on('upgrade', (res, socket) => resolve({ status: res.statusCode ?? 0, socket }))
      req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }) })
      req.on('error', reject)
      req.end()
    })
    // Одновременные рукопожатия: место занимается до ответа ядра, лимит не обходится.
    const opened = await Promise.all(Array.from({ length: MAX_TUNNELS_PER_SESSION + 2 }, handshake))
    expect(opened.filter(o => o.status === 101)).toHaveLength(MAX_TUNNELS_PER_SESSION)
    expect(opened.filter(o => o.status === 429)).toHaveLength(2)
    expect(t.cp.wsAuth).toHaveLength(MAX_TUNNELS_PER_SESSION)
    const live = opened.filter(o => o.socket !== undefined)
    live[0]!.socket!.destroy()
    // Закрытие сокета доходит до BFF не мгновенно: под нагрузкой — дольше секунды по умолчанию.
    await expect.poll(async () => {
      const again = await handshake()
      if (again.socket !== undefined) live.push(again)
      return again.status
    }, { timeout: 5000 }).toBe(101)
    // Выход закрывает все туннели сессии: BFF закрыл свою сторону — клиент дочитал конец
    // потока или уже уничтожил сокет (что раньше — зависит от нагрузки, не от BFF).
    for (const o of live) o.socket!.resume()
    expect((await t.call('POST', '/console/_auth/logout', { headers: { cookie, ...t.origin, accept: 'application/json' } })).status).toBe(204)
    await expect.poll(() => live.every(o => o.socket!.destroyed || o.socket!.readableEnded), { timeout: 5000 }).toBe(true)
  }, 15_000)

  it('SSE ассистента идёт без буферизации с Bearer human-harness и закрывается вместе с upstream', async () => {
    const t = await start()
    const { cookie } = await t.login()
    const chunks: string[] = []
    let ended = false
    const res = await new Promise<import('node:http').IncomingMessage>((resolve) => {
      request({ host: '127.0.0.1', port: t.port, path: '/console/api/assistant/stream?after=c0&x=1', headers: { cookie, accept: 'text/event-stream', 'last-event-id': 'c0' } }, resolve).end()
    })
    res.on('data', (c: Buffer) => chunks.push(c.toString())).on('end', () => { ended = true })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    // Первое событие дошло, пока upstream ещё держит поток открытым.
    await expect.poll(() => chunks.join('')).toContain('event: ready')
    expect(ended).toBe(false)
    const seen = t.launcher.requests.at(-1)!
    expect(seen.url).toBe(`/harness/_launcher/internal/principals/${PRINCIPAL}/surface/stream?after=c0`)
    expect(seen.headers['last-event-id']).toBe('c0')
    expect(seen.headers['x-harness-surface']).toBe('console')
    expect(t.iam.calls.at(-1)).toEqual({ audience: 'human-harness', scopes: ['harness:use'] })
    expect(t.issuedTokens).toContain(bearer(seen.headers.authorization))
    t.launcher.release()
    await expect.poll(() => ended).toBe(true)
    expect(chunks.join('')).toContain('second')
  })

  it('сообщение ассистента: BFF собирает screenContext по адресу экрана из ядра и шлёт в свой контейнер', async () => {
    const t = await start()
    const { cookie } = await t.login()
    const task = { id: '11111111-1111-4111-8111-111111111111', publicId: 'TASK-000840', title: 'Оплатить счёт', typeKey: 'invoice', typeVersion: 1, status: 'todo', systemStatusCategory: 'todo', workspaceId: '22222222-2222-4222-8222-222222222222', origin: { kind: 'human' }, createdBy: 'p1', createdAt: '2026-09-29T09:00:00Z', customFields: { password: 'hunter2' } }
    t.cp.fixtures['/tasks/TASK-000840'] = task
    const requestId = '0b6c1d2e-3f40-4152-8637-48595a6b7c8d'
    const send = (body: unknown) => t.call('POST', '/console/api/assistant/message', { headers: { cookie, ...t.origin, 'content-type': 'text/plain' }, body: JSON.stringify(body) })
    // Браузер прислал свой screenContext и лишнее поле — не доверяем, контекст собирает BFF.
    const reply = await send({ requestId, text: 'Почему стоит?', screenUrl: '/console/work/TASK-000840?tab=runs', screenContext: { kind: 'rule', id: 'forged', projection: { note: 'из браузера' } }, extra: 1 })
    expect(reply.status).toBe(202)
    expect(JSON.parse(reply.body)).toMatchObject({ requestId, messageId: 'm_1' })
    const seen = t.launcher.requests.at(-1)!
    // Только свой контейнер: principal пути — из сессии.
    expect(seen.url).toBe(`/harness/_launcher/internal/principals/${PRINCIPAL}/surface/message`)
    expect(seen.headers['content-type']).toBe('application/json')
    expect(seen.headers['x-harness-surface']).toBe('console')
    expect(t.iam.calls.some(c => c.audience === 'human-harness' && c.scopes.join() === 'harness:use')).toBe(true)
    expect(t.issuedTokens).toContain(bearer(seen.headers.authorization))
    const sent = JSON.parse(seen.body) as { requestId: string, text: string, screenContext: Record<string, unknown> }
    expect(Object.keys(sent).sort()).toEqual(['requestId', 'screenContext', 'text'])
    expect(sent.screenContext).toMatchObject({
      kind: 'work', id: 'TASK-000840', label: 'Оплатить счёт', url: '/console/work/TASK-000840?tab=runs',
      workspaceId: '22222222-2222-4222-8222-222222222222', projection: { publicId: 'TASK-000840', title: 'Оплатить счёт', type: 'invoice', status: 'todo', statusCategory: 'todo' },
    })
    expect(seen.body).not.toContain('из браузера')
    expect(seen.body).not.toContain('hunter2')
    expect(Buffer.byteLength(JSON.stringify(sent.screenContext))).toBeLessThanOrEqual(8 * 1024)
    // Проекция читает ядро токеном человека и через allow-list.
    const read = t.cp.requests.find(r => r.url === '/api/v1/tasks/TASK-000840')!
    expect(t.issuedTokens).toContain(bearer(read.headers.authorization))

    // Плашка снята — контекста нет вовсе.
    const bare = '1c7d2e3f-4051-4263-9748-5a6b7c8d9e0f'
    expect((await send({ requestId: bare, text: 'Без контекста', screenUrl: null })).status).toBe(202)
    expect(JSON.parse(t.launcher.requests.at(-1)!.body)).toEqual({ requestId: bare, text: 'Без контекста' })
    // Плохой ввод — 400 до launcher'а.
    const before = t.launcher.requests.length
    for (const [body, code] of [
      [{ requestId, text: 'x', screenUrl: 'https://evil.test/console/work/X' }, 'invalid_screen_url'],
      [{ requestId, text: 'x', screenUrl: 42 }, 'invalid_screen_url'],
      [{ requestId: 'not-a-uuid', text: 'x' }, 'invalid_request_id'],
      [{ requestId, text: '' }, 'invalid_text'],
      [[1, 2], 'invalid_body'],
    ] as const) {
      const bad = await send(body)
      expect(bad.status, JSON.stringify(body)).toBe(400)
      expect(JSON.parse(bad.body)).toEqual({ error: { code } })
    }
    expect((await t.call('POST', '/console/api/assistant/message', { headers: { cookie, ...t.origin }, body: '{not json' })).status).toBe(400)
    expect(t.launcher.requests.length).toBe(before)
  })

  it('повтор сообщения с тем же requestId уходит наверх байт в байт прежним: харнесс отвечает исходным ответом, а не 409', async () => {
    const t = await start()
    const { cookie } = await t.login()
    // Контекст экрана зависит от времени (capturedAt) и живых данных ядра.
    t.cp.fixtures['/tasks/TASK-000841'] = { id: '11111111-1111-4111-8111-111111111112', publicId: 'TASK-000841', title: 'Сверить счёт', typeKey: 'invoice', status: 'todo', systemStatusCategory: 'todo' }
    const requestId = '2d8e3f40-5162-4374-a859-6b7c8d9e0f1a'
    const message = { requestId, text: 'Что с оплатой?', screenUrl: '/console/work/TASK-000841?view=journal&q=личное' }
    const send = (body: unknown) => t.call('POST', '/console/api/assistant/message', { headers: { cookie, ...t.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const first = await send(message)
    expect(first.status).toBe(202)
    const reads = t.cp.requests.length
    // 504 harness_timeout или потерянный ответ: SPA повторяет позже, ядро за это время изменилось.
    t.advance(90_000)
    t.cp.fixtures['/tasks/TASK-000841'] = { ...(t.cp.fixtures['/tasks/TASK-000841'] as object), status: 'blocked' }
    const retry = await send(message)
    expect(retry.status).toBe(202)
    expect(JSON.parse(retry.body)).toEqual(JSON.parse(first.body))
    const [a, b] = t.launcher.requests.filter(r => r.url.endsWith('/surface/message')).map(r => r.body)
    expect(b).toBe(a)
    // Повтор не пересобирает контекст — ядро не читается заново.
    expect(t.cp.requests.length).toBe(reads)
    const context = (JSON.parse(a!) as { screenContext: { url: string, capturedAt: string } }).screenContext
    expect(context.url).toBe('/console/work/TASK-000841?view=journal')
    expect(context.capturedAt).toBe('2026-09-29T10:00:00.000Z')

    // Тот же requestId с другим текстом — не повтор: тело собирается заново, харнесс отвечает 409.
    const reused = await send({ ...message, text: 'Другой вопрос' })
    expect(reused.status).toBe(409)
    expect(JSON.parse(reused.body)).toEqual({ error: { code: 'request_id_reused' } })
    expect(t.launcher.requests.at(-1)!.body).toContain('Другой вопрос')
    // Исходное сообщение по-прежнему повторяется байт в байт.
    expect((await send(message)).status).toBe(202)
    expect(t.launcher.requests.at(-1)!.body).toBe(a)
    // Через MESSAGE_REPLAY_TTL_MS тело забыто: собирается заново (и харнесс сам решит).
    t.advance(MESSAGE_REPLAY_TTL_MS)
    expect((await send(message)).status).toBe(409)
    expect(t.launcher.requests.at(-1)!.body).not.toBe(a)
  })

  it('клиент ушёл, пока собирался контекст: сборка отменяется, наверх ничего не идёт, повтор доходит', async () => {
    const t = await start()
    const { cookie } = await t.login()
    t.cp.hang.add('/tasks/TASK-000777')
    const requestId = '3e9f4051-6273-4485-b96a-7c8d9e0f1a2b'
    const payload = JSON.stringify({ requestId, text: 'Почему стоит?', screenUrl: '/console/work/TASK-000777' })
    const client = request({ host: '127.0.0.1', port: t.port, method: 'POST', path: '/console/api/assistant/message', headers: { cookie, ...t.origin, 'content-type': 'application/json' } })
    client.on('error', () => {})
    client.end(payload)
    await expect.poll(() => t.cp.requests.some(r => r.url === '/api/v1/tasks/TASK-000777')).toBe(true)
    client.destroy()
    // Чтение ядра оборвано, launcher не видел сообщения.
    await expect.poll(() => t.cp.aborted).toContain('/tasks/TASK-000777')
    expect(t.launcher.requests.filter(r => r.url.endsWith('/surface/message'))).toHaveLength(0)
    // Повтор с тем же requestId собирает заново и доходит — харнесс видит его впервые.
    t.cp.hang.clear()
    t.cp.fixtures['/tasks/TASK-000777'] = { id: '11111111-1111-4111-8111-111111111111', publicId: 'TASK-000777', title: 'Счёт', typeKey: 'invoice', typeVersion: 1, status: 'todo', systemStatusCategory: 'todo', origin: { kind: 'human' }, createdBy: 'p1', createdAt: '2026-09-29T09:00:00Z' }
    const retry = await t.call('POST', '/console/api/assistant/message', { headers: { cookie, ...t.origin, 'content-type': 'application/json' }, body: payload })
    expect(retry.status).toBe(202)
    const sent = t.launcher.requests.filter(r => r.url.endsWith('/surface/message'))
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ requestId, screenContext: { kind: 'work', id: 'TASK-000777', label: 'Счёт' } })
  })

  it('история, поток и решения: только свои параметры query, решение идёт как есть', async () => {
    const t = await start()
    const { cookie } = await t.login()
    expect((await t.call('GET', '/console/api/assistant/history?before=c9&limit=20&principal=other', { headers: { cookie } })).status).toBe(200)
    expect(t.launcher.requests.at(-1)!.url).toBe(`/harness/_launcher/internal/principals/${PRINCIPAL}/surface/history?before=c9&limit=20`)
    const decision = JSON.stringify({ approvalRequestId: 'ar-1', decision: 'allow' })
    expect((await t.call('POST', '/console/api/assistant/approval', { headers: { cookie, ...t.origin, 'content-type': 'application/json' }, body: decision })).status).toBe(200)
    const seen = t.launcher.requests.at(-1)!
    expect(seen.url).toBe(`/harness/_launcher/internal/principals/${PRINCIPAL}/surface/approval`)
    expect(seen.body).toBe(decision)
    // Решение — мутация: чужой origin не проходит; не тот метод — 404.
    expect((await t.call('POST', '/console/api/assistant/approval', { headers: { cookie, origin: 'https://evil.test' }, body: decision })).status).toBe(403)
    expect((await t.call('GET', '/console/api/assistant/approval', { headers: { cookie } })).status).toBe(404)
    expect((await t.call('POST', '/console/api/assistant/history', { headers: { cookie, ...t.origin } })).status).toBe(404)
    // Без сессии — 401, launcher не видит запроса.
    const count = t.launcher.requests.length
    expect((await t.call('GET', '/console/api/assistant/history')).status).toBe(401)
    expect(t.launcher.requests.length).toBe(count)
  })

  it('журнал доступа без токенов, тел и текста беседы', async () => {
    const t = await start()
    const { cookie } = await t.login()
    const requestId = '0b6c1d2e-3f40-4152-8637-48595a6b7c8d'
    const message = await t.call('POST', '/console/api/assistant/message', {
      headers: { cookie, ...t.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, text: 'секретный вопрос про счёт', screenUrl: '/console/work/TASK-1' }),
    })
    expect(message.status).toBe(202)
    expect(t.launcher.requests.at(-1)!.body).toContain('секретный вопрос')
    await t.call('GET', '/console/api/assistant/history?before=secret-cursor', { headers: { cookie } })
    await t.call('POST', '/console/api/cp/approvals/a1:reject', { headers: { cookie, ...t.origin, 'content-type': 'application/json' }, body: '{"reason":"тело мутации"}' })
    await t.call('GET', '/console/api/cp/tasks?assignee=secret-filter', { headers: { cookie } })
    const text = JSON.stringify(t.logs)
    expect(text).not.toMatch(JWT)
    for (const token of t.issuedTokens) expect(text).not.toContain(token)
    for (const fragment of ['секретный вопрос', 'тело мутации', 'secret-filter', 'secret-cursor', '/console/work/TASK-1', 'client-secret-value', cookie.slice(11)]) expect(text).not.toContain(fragment)
    const entry = t.logs.find(l => l.route === '/console/api/assistant/message')!
    expect(Object.keys(entry).sort()).toEqual(['event', 'messageRequestId', 'method', 'ms', 'requestId', 'route', 'status'])
    expect(entry.messageRequestId).toBe(requestId)
  })

  it('подключения: ключ, секрет приложения и секрет агента идут наверх, но не в журнал — только шаблон маршрута', async () => {
    const t = await start()
    const { cookie } = await t.login()
    const put = (path: string, body: unknown) => t.call('PUT', path, { headers: { cookie, ...t.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await put('/console/api/cp/connections/crm/token', { account: 'portal.example', token: 'tok-value-1f2e3d' })
    expect(t.cp.requests.at(-1)!.body).toContain('tok-value-1f2e3d')
    await put('/console/api/cp/connection-types/crm-demo/oauth-app', { clientId: 'app', clientSecret: 'app-secret-9a8b7c' })
    await put('/console/api/cp/agents/crm-observer/secrets/signing-key-name', { value: 'agent-secret-5d6e7f' })
    const del = await t.call('DELETE', '/console/api/cp/agents/crm-observer/secrets/signing-key-name', { headers: { cookie, ...t.origin } })
    expect(t.cp.requests.at(-1)!.url).toBe('/api/v1/agents/crm-observer/secrets/signing-key-name')
    expect(del.status).not.toBe(404)
    const text = JSON.stringify(t.logs)
    for (const fragment of ['tok-value-1f2e3d', 'app-secret-9a8b7c', 'agent-secret-5d6e7f', 'signing-key-name', 'portal.example']) expect(text).not.toContain(fragment)
    const routes = t.logs.filter(l => l.event === 'access').map(l => l.route)
    expect(routes).toContain('/console/api/cp/connections/{key}/token')
    expect(routes).toContain('/console/api/cp/agents/{key}/secrets/{name}')
  })
})

describe('конфигурация', () => {
  it('секрет cookie короче 32 байт — отказ старта', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bff-'))
    writeFileSync(join(dir, 'short'), 'short-secret')
    writeFileSync(join(dir, 'oidc'), 'client-secret')
    const env = {
      CONSOLE_PUBLIC_URL: 'https://console.test', CONSOLE_OIDC_ISSUER: 'https://idp.test',
      CONSOLE_IAM_TENANT: TENANT, CONSOLE_OIDC_SECRET_FILE: join(dir, 'oidc'),
      CONSOLE_COOKIE_SECRET_FILE: join(dir, 'short'),
    }
    expect(() => loadConfig(env)).toThrow(/короче 32/)
    writeFileSync(join(dir, 'long'), 'x'.repeat(48))
    const config = loadConfig({ ...env, CONSOLE_COOKIE_SECRET_FILE: join(dir, 'long') })
    expect(config.secureCookies).toBe(true)
    expect(config.oidc.scopes).toBe('openid profile email')
    expect(config.locales).toEqual(['en', 'ru'])
    expect(config.defaultLocale).toBe('en')
    expect(config.basePath).toBe('/console')
  })

  it('окружение проверяется схемой: неверное значение — отказ старта с именем переменной', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bff-'))
    writeFileSync(join(dir, 'cookie'), 'x'.repeat(48))
    writeFileSync(join(dir, 'oidc'), 'client-secret')
    const env = {
      CONSOLE_PUBLIC_URL: 'https://console.test', CONSOLE_OIDC_ISSUER: 'https://idp.test', CONSOLE_IAM_TENANT: TENANT,
      CONSOLE_OIDC_SECRET_FILE: join(dir, 'oidc'), CONSOLE_COOKIE_SECRET_FILE: join(dir, 'cookie'),
    }
    expect(() => loadConfig({ ...env, CONSOLE_PUBLIC_URL: 'not a url' })).toThrow(/CONSOLE_PUBLIC_URL/)
    expect(() => loadConfig({ ...env, CONSOLE_PORT: '70000' })).toThrow(/CONSOLE_PORT/)
    expect(() => loadConfig({ ...env, CONSOLE_BASE_PATH: '/con sole' })).toThrow(/CONSOLE_BASE_PATH/)
    expect(() => loadConfig({ ...env, CONSOLE_LOCALES: 'en,de' })).toThrow(/CONSOLE_LOCALES/)
    expect(() => loadConfig({ ...env, CONSOLE_LOCALES: 'ru', CONSOLE_DEFAULT_LOCALE: 'en' })).toThrow(/CONSOLE_DEFAULT_LOCALE/)
    expect(() => loadConfig({ ...env, CONSOLE_IAM_TENANT: undefined })).toThrow(/CONSOLE_IAM_TENANT/)
    expect(() => loadConfig({ ...env, CONSOLE_OIDC_SECRET_FILE: join(dir, 'missing') })).toThrow(/не читается/)
    expect(loadConfig({ ...env, CONSOLE_BASE_PATH: '/' }).basePath).toBe('')
  })
})

describe('готовность и CSRF', () => {
  it('readyz — готов, пока IdP отвечает на discovery; изменение вне API без своего origin — 403', async () => {
    const t = await start()
    const ready = await t.call('GET', '/console/readyz')
    expect(ready.status).toBe(200)
    expect(JSON.parse(ready.body)).toEqual({ status: 'ready' })
    expect((await t.call('POST', '/console/_auth/logout', { headers: { origin: 'https://evil.test' } })).status).toBe(403)
    expect((await t.call('POST', '/console/_auth/logout')).status).toBe(403)
    expect((await t.call('GET', '/console/api/cp/tasks')).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('allow-list из снимка openapi', () => {
  const snapshot = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'openapi', 'control-plane.json'), 'utf8')) as object
  const allow = AllowList.fromOpenApi(snapshot, { prefix: '/api/v1', mutations: CONTROL_PLANE_MUTATIONS })

  it('чтение открыто, из изменений — только список консоли', () => {
    expect(allow.match('GET', '/api/v1/tasks/TASK-000817')?.template).toBe('/api/v1/tasks/{task_ref}')
    expect(allow.match('GET', '/api/v1/rules/r1')?.template).toBe('/api/v1/rules/{rule_id}')
    expect(allow.match('POST', '/api/v1/approvals/a1:approve')?.template).toBe('/api/v1/approvals/{approval_id}:approve')
    // Правило — включить и выключить кнопкой «Настроек»; создать, править и удалить — нет
    expect(allow.match('POST', '/api/v1/rules/r1:enable')?.template).toBe('/api/v1/rules/{rule_id}:enable')
    expect(allow.match('PATCH', '/api/v1/rules/r1')).toBeNull()
    expect(allow.match('DELETE', '/api/v1/rules/r1')).toBeNull()
    expect(allow.match('POST', '/api/v1/rules/r1')).toBeNull()
    expect(allow.match('POST', '/api/v1/bootstrap')).toBeNull()
    const mutations = allow.routes.filter(r => r.method !== 'GET').map(r => `${r.method} ${r.template}`)
    expect(mutations.every(m => (CONTROL_PLANE_MUTATIONS as readonly string[]).includes(m))).toBe(true)
    // Операции списка, которых снимок ещё не знает, не открываются, а видны в missing.
    for (const m of allow.missing) expect(CONTROL_PLANE_MUTATIONS).toContain(m)
    expect(mutations.length + allow.missing.length).toBe(CONTROL_PLANE_MUTATIONS.length)
  })

  it('скиллы — только те, что консоль вызывает кнопками: план и шаблон загрузки базы знаний', () => {
    const route = '/api/v1/skills/{skill_ref}:invoke'
    expect(allow.match('POST', '/api/v1/skills/knowledge.import_plan@1:invoke')?.template).toBe(route)
    expect(allow.match('POST', '/api/v1/skills/knowledge.template@2:invoke')?.template).toBe(route)
    // запись в базу и прочие скиллы — через исход решения в ядре, не кнопкой консоли
    expect(allow.match('POST', '/api/v1/skills/knowledge.import_apply@1:invoke')).toBeNull()
    expect(allow.match('POST', '/api/v1/skills/knowledge.document_extract@1:invoke')).toBeNull()
    expect(allow.match('POST', '/api/v1/skills/git.merge@1:invoke')).toBeNull()
    expect(allow.match('POST', '/api/v1/skills/knowledge.import_planX@1:invoke')).toBeNull()
    expect(allow.match('PUT', '/api/v1/artifact-contents')?.template).toBe('/api/v1/artifact-contents')
  })

  it('отзыв на элемент «Ждёт вас»: ключ `<правило>:<uuid>` с сырым двоеточием, иной формы — 404 (R022)', () => {
    const key = 'approval.review:0b9f6f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
    expect(allow.match('POST', `/api/v1/me/attention/${key}:feedback`)?.template).toBe('/api/v1/me/attention/{item_key}:feedback')
    expect(allow.match('GET', '/api/v1/me/attention')?.template).toBe('/api/v1/me/attention')
    // закодированное двоеточие, лишний сегмент, ключ не той формы
    expect(allow.match('POST', `/api/v1/me/attention/${key.replace(':', '%3A')}:feedback`)).toBeNull()
    expect(allow.match('POST', `/api/v1/me/attention/x/${key}:feedback`)).toBeNull()
    expect(allow.match('POST', '/api/v1/me/attention/approval.review:not-a-uuid:feedback')).toBeNull()
    expect(allow.match('POST', `/api/v1/me/attention/${key}:other`)).toBeNull()
    // прочие параметры по-прежнему без двоеточия
    expect(allow.match('POST', '/api/v1/rules/a:b:enable')).toBeNull()
  })

  it('UUID в ключе — строго 8-4-4-4-12', () => {
    const route = '/api/v1/me/attention/{item_key}:feedback'
    const at = (uuid: string) => allow.match('POST', `/api/v1/me/attention/approval.review:${uuid}:feedback`)?.template ?? null
    expect(at('0B9F6F5E-1C2D-4E5F-8A9B-0C1D2E3F4A5B')).toBe(route)
    // 36 символов, но не та раскладка дефисов
    expect(at('0b9f6f5e1-c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBeNull()
    expect(at('------------------------------------')).toBeNull()
    expect(at('0b9f6f5e-1c2d-4e5f-8a9b0-c1d2e3f4a5b')).toBeNull()
    // не hex и не той длины
    expect(at('0b9f6f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5g')).toBeNull()
    expect(at('0b9f6f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5')).toBeNull()
  })

  it('форма ключа привязана к маршруту :feedback, а не к имени параметра', () => {
    // другой шаблон с тем же именем параметра получает форму по умолчанию: один сегмент без `:`
    const other = compile('GET', '/api/v1/me/attention/{item_key}')
    expect(other.regex.test('/api/v1/me/attention/approval.review')).toBe(true)
    expect(other.regex.test('/api/v1/me/attention/approval.review:0b9f6f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(false)
    const feedback = compile('POST', '/api/v1/me/attention/{item_key}:feedback')
    expect(feedback.regex.test('/api/v1/me/attention/approval.review:0b9f6f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b:feedback')).toBe(true)
  })
})

describe('SPA', () => {
  it('отдаёт index.html с <base> под префикс запуска и строгой CSP; ассеты — immutable; корень ведёт в консоль', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spa-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><head><base href="/console/"><script type="module" src="./assets/app.js"></script></head>')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
    writeFileSync(join(dir, 'assets', 'worker.mjs'), 'self.onmessage = () => {}')
    const t = await start()
    t.config.staticDir = dir
    const { cookie } = await t.login()
    const page = await t.call('GET', '/console/work/TASK-1', { headers: { cookie } })
    expect(page.status).toBe(200)
    expect(page.body).toContain('<base href="/console/">')
    expect(page.headers['content-security-policy']).toContain("script-src 'self'")
    expect(page.headers['content-security-policy']).not.toContain('unsafe-inline')
    expect(page.headers['cache-control']).toBe('no-cache')
    const asset = await t.call('GET', '/console/assets/app.js')
    expect(asset.status).toBe(200)
    expect(asset.headers['cache-control']).toContain('immutable')
    // Модуль .mjs (воркер pdf.js) — JavaScript: с nosniff octet-stream браузер не запустит
    expect((await t.call('GET', '/console/assets/worker.mjs')).headers['content-type']).toBe('text/javascript')
    const root = await t.call('GET', '/')
    expect(root.status).toBe(302)
    expect(root.headers.location).toBe('/console/')
    // Dot-сегменты нормализуются до маршрута: оболочка без входа не отдаётся, а ведёт на вход.
    const dotted = await t.call('GET', '/console/assets/../index.html')
    expect(dotted.status).toBe(302)
    expect(dotted.headers.location).toContain('/console/_auth/login')
    expect((await t.call('GET', '/console/assets/%2e%2e/index.html')).status).not.toBe(200)
  })
})

describe('контекст экрана документа', () => {
  it('ассистент получает описание документа, но не его содержимое', async () => {
    const { buildScreenContext } = await import('../src/screen-context.ts')
    const id = 'a1a2a3a4-0000-4000-8000-000000000001'
    const get = async (path: string): Promise<unknown> => {
      expect(path).toBe(`/artifacts/${id}`)
      return { id, name: 'Протокол сверки', type: 'report', mediaType: 'text/markdown', taskId: 't1', workspaceId: 'w1', content: { secret: 'не уходит' }, contentState: 'stored', createdAt: '2026-10-03T10:00:00Z' }
    }
    const context = await buildScreenContext(get as never, `/console/documents/${id}`, { origin: 'http://localhost', basePath: '/console', now: Date.parse('2026-10-03T12:00:00Z'), signal: new AbortController().signal })
    expect(context).toMatchObject({ kind: 'artifact', id, label: 'Протокол сверки', workspaceId: 'w1', projection: { name: 'Протокол сверки', type: 'report', mediaType: 'text/markdown', taskId: 't1' } })
    expect(JSON.stringify(context)).not.toContain('не уходит')
  })
})

describe('контекст экрана пакета', () => {
  it('ассистент знает вид и пакет экрана /v/{key}/{id}', async () => {
    const { buildScreenContext } = await import('../src/screen-context.ts')
    const get = async (path: string): Promise<unknown> => {
      expect(path).toBe('/views/invoice')
      return { key: 'invoice', title: 'Счёт', package: { key: 'invoice-approval', version: '0.7.0' }, source: { kind: 'process', process: 'invoice-approval', instance: true }, layout: [] }
    }
    const context = await buildScreenContext(get as never, '/console/v/invoice/e5000000-0000-4000-8000-000000000417', { origin: 'http://localhost', basePath: '/console', now: Date.parse('2026-10-03T12:00:00Z'), signal: new AbortController().signal })
    expect(context).toMatchObject({ kind: 'other', id: 'e5000000-0000-4000-8000-000000000417', label: 'Счёт', projection: { view: 'invoice', package: 'invoice-approval', process: 'invoice-approval' } })
  })
})

describe('контекст экрана документа базы знаний', () => {
  it('ключ записи и организация уходят ассистенту, свободный поиск — нет', async () => {
    const { parseScreen } = await import('../src/screen-context.ts')
    const ws = 'd4000000-0000-4000-8000-0000000000a1'
    const s = parseScreen(`/console/knowledge/entry?kind=credential&key=${encodeURIComponent('credential:license:77-Б/00123')}&ws=${ws}&q=секрет`, 'http://localhost', '/console')
    const url = new URL(s.url, 'http://localhost')
    expect(url.searchParams.get('key')).toBe('credential:license:77-Б/00123')
    expect(url.searchParams.get('ws')).toBe(ws)
    expect(url.searchParams.get('q')).toBeNull()
    expect(parseScreen('/console/knowledge/entry?key=<script>', 'http://localhost', '/console').url).not.toContain('script')
  })

  it('форма «Поручить работу» по ссылке — не номер работы; поля предложения не уходят', async () => {
    const { parseScreen } = await import('../src/screen-context.ts')
    const s = parseScreen('/console/work/new?title=Позвонить+в+банк&result=секрет', 'http://localhost', '/console')
    expect(s).toEqual({ kind: 'other', label: 'Поручить работу', url: '/console/work/new' })
  })
})

describe('сессии переживают перезапуск BFF', () => {
  const key = deriveKeys(Buffer.alloc(32, 7)).store
  const idp: IdpTokens = { idToken: 'id-token-secret-a1', idTokenExp: Date.now() + 300_000, refreshToken: 'refresh-secret-b2', nonce: null, sid: 'idp-sid' }
  const make = (store: FileSessionStore, now = Date.now) => new Sessions({
    ttlMs: 3_600_000, now, store,
    oidc: { refresh: () => Promise.reject(new Error('no')) }, exchange: () => Promise.reject(new Error('no')), scopes: { 'control-plane': [], 'human-harness': [], iam: [] },
  })

  it('сессия поднимается новым процессом; файл 0600 и без токенов открытым текстом', () => {
    const dir = mkdtempSync(join(tmpdir(), 'console-sessions-'))
    const first = make(new FileSessionStore(dir, key))
    const s = first.create('principal-1', idp)
    first.flush()
    const file = join(dir, 'sessions.sealed')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const raw = readFileSync(file, 'utf8')
    for (const secret of ['id-token-secret-a1', 'refresh-secret-b2', 'principal-1', s.sid]) expect(raw).not.toContain(secret)
    const second = make(new FileSessionStore(dir, key))
    const restored = second.get(s.sid)
    expect(restored?.principalId).toBe('principal-1')
    expect(restored?.idpRefresh).toBe('refresh-secret-b2')
    expect(restored?.tokens.size).toBe(0)
  })

  it('чужой ключ, порча, истёкшие и удалённые — не поднимаются', () => {
    const dir = mkdtempSync(join(tmpdir(), 'console-sessions-'))
    const first = make(new FileSessionStore(dir, key))
    const kept = first.create('p', idp)
    const gone = first.create('q', idp)
    first.delete(gone.sid)
    first.flush()
    expect(make(new FileSessionStore(dir, deriveKeys(Buffer.alloc(32, 9)).store)).size).toBe(0)
    expect(make(new FileSessionStore(dir, key), () => Date.now() + 2 * 3_600_000).size).toBe(0)
    const again = make(new FileSessionStore(dir, key))
    expect(again.get(kept.sid)).not.toBeNull()
    expect(again.get(gone.sid)).toBeNull()
    writeFileSync(join(dir, 'sessions.sealed'), 'garbage')
    expect(make(new FileSessionStore(dir, key)).size).toBe(0)
  })
})
