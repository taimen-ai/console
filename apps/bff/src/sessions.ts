/**
 * Сессии консоли — в памяти процесса (plan «Исследование» п.3). Перезапуск BFF теряет их,
 * и человек проходит тихий повторный вход через IdP; внешнего хранилища нет.
 *
 * Жизненный цикл токенов:
 * - id token IdP живёт минуты; истёк — тихий refresh у IdP по его refresh token;
 * - токен audience IAM живёт ~300 с без refresh: истёк (с запасом SKEW) — повторный
 *   `federation:exchange` свежим id token. Один обмен на сессию и audience за раз
 *   (одиночный полёт), параллельные запросы ждут его;
 * - отказ IAM 403 (нет scope, audience) — `NoPermission`, запоминается на DENY_TTL, чтобы
 *   не долбить IAM; 401 или провал refresh IdP — `ReauthRequired`.
 * Токены никогда не покидают процесс: в браузер уходит только cookie с sid.
 */
import type { Audience } from './config.ts'
import type { SessionStore } from './session-store.ts'
import { randomToken } from './crypto.ts'
import { FederationError, type Exchange, type IdpTokens, type Issued, type Oidc } from './identity.ts'

/** Запас до истечения: токен перевыпускается заранее, чтобы не умереть в полёте. */
export const SKEW_MS = 30_000
const DENY_TTL_MS = 5 * 60_000
/** Сессий на одного principal: новый вход сверх лимита вытесняет самую старую. */
export const MAX_SESSIONS_PER_PRINCIPAL = 10
/** WS-туннелей на сессию (вкладки консоли): сверх лимита рукопожатие получает 429. */
export const MAX_TUNNELS_PER_SESSION = 5

export class ReauthRequired extends Error {}

export class NoPermission extends Error {
  readonly audience: Audience
  readonly code: string
  constructor(audience: Audience, code: string) {
    super(`нет прав на ${audience}: ${code}`)
    this.audience = audience
    this.code = code
  }
}

/** IAM или IdP недоступны — это не повод выкидывать человека из сессии. */
export class Unavailable extends Error {}

export interface Session {
  /** Id сессии консоли (в cookie). Не путать с `idpSid` — сессией IdP. */
  sid: string
  principalId: string
  /** Claim `sid` id token IdP: сессия IdP, к которой привязан refresh token. */
  idpSid: string | null
  expiresAt: number
  idToken: string
  idTokenExp: number
  idpRefresh: string | null
  tokens: Map<Audience, Issued>
  denied: Map<Audience, { code: string, until: number }>
  pending: Map<Audience, Promise<Issued>>
  idpPending: Promise<void> | null
  /** Открытые WS-туннели сессии: закрываются вместе с ней (выход, перевход, истечение). */
  tunnels: Set<{ destroy(): void }>
}

export interface SessionDeps {
  ttlMs: number
  oidc: Pick<Oidc, 'refresh'>
  exchange: Exchange
  scopes: Record<Audience, string[]>
  now?: () => number
  /**
   * Сессия удалена — любым путём: выход, перевход, вытеснение сверх лимита, истечение,
   * sweep, отказ IdP или IAM. Зовётся синхронно и не ждётся (fire-and-forget); ошибка
   * колбэка удаление не останавливает. `live(idpSid)` — жива ли другая сессия консоли с той
   * же сессией IdP. В BFF это отзыв refresh token у IdP (`revokeRefresh`).
   */
  onDelete?: (session: Session, live: LiveIdpSession) => void
  /** Где сессии переживают перезапуск (`session-store.ts`); нет — только память процесса. */
  store?: SessionStore
}

/** Есть ли живая (не истёкшая) сессия консоли, привязанная к этой сессии IdP. */
export type LiveIdpSession = (idpSid: string) => boolean

/** Одновременных отзывов у IdP: sweep сотни сессий не открывает сотню соединений. */
export const REVOKE_CONCURRENCY = 4
/** Потолок очереди отзывов: сверх него отзыв пропускается, refresh доживёт до срока у IdP. */
export const REVOKE_QUEUE_LIMIT = 1_000

/**
 * Колбэк `onDelete`: отозвать refresh token IdP удалённой сессии, не дожидаясь ответа.
 *
 * Refresh **не** отзывается, пока жива другая сессия консоли с тем же `idpSid`. Keycloak
 * (26.x, `TokenRevocationEndpoint`) по отзыву refresh находит user session по `sid` и снимает
 * с неё клиент, а если других клиентов нет — удаляет user session целиком. Перевход поверх
 * живого SSO даёт тот же `sid`, поэтому отзыв refresh прежней сессии убил бы refresh новой, и
 * через несколько минут человек попал бы на форму пароля. Отзыв последней сессии с этим `sid`
 * гасит сессию IdP — это и нужно при выходе.
 *
 * Отзывы идут очередью: не больше `concurrency` одновременно (по умолчанию 4), в очереди не
 * больше `queueLimit`. Живость `sid` проверяется и при постановке, и при отправке: пока отзыв
 * ждал, мог случиться перевход с тем же `sid`.
 */
export function revokeRefresh(
  oidc: Pick<Oidc, 'revoke'>,
  options: { concurrency?: number, queueLimit?: number } = {},
): (session: Session, live: LiveIdpSession) => void {
  const concurrency = options.concurrency ?? REVOKE_CONCURRENCY
  const queueLimit = options.queueLimit ?? REVOKE_QUEUE_LIMIT
  const queue: { refresh: string, idpSid: string | null, live: LiveIdpSession }[] = []
  let active = 0
  const pump = (): void => {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift()!
      if (job.idpSid !== null && job.live(job.idpSid)) continue
      active++
      oidc.revoke(job.refresh).catch(() => false).finally(() => {
        active--
        pump()
      })
    }
  }
  return (session, live) => {
    if (session.idpRefresh === null) return
    if (session.idpSid !== null && live(session.idpSid)) return
    if (queue.length >= queueLimit) return
    queue.push({ refresh: session.idpRefresh, idpSid: session.idpSid, live })
    pump()
  }
}

export class Sessions {
  private readonly map = new Map<string, Session>()
  private readonly deps: SessionDeps
  private readonly now: () => number
  private saving: ReturnType<typeof setTimeout> | null = null

  constructor(deps: SessionDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    // Сессии прошлого процесса: истёкшие не поднимаются; токены audience обменяются заново.
    const now = this.now()
    for (const p of deps.store?.load() ?? []) {
      if (p.expiresAt <= now) continue
      this.map.set(p.sid, { ...p, tokens: new Map(), denied: new Map(), pending: new Map(), idpPending: null, tunnels: new Set() })
    }
  }

  /** Записать долговечную часть сессий — с задержкой, одной записью на пачку изменений. */
  private persist(): void {
    if (this.deps.store === undefined || this.saving !== null) return
    this.saving = setTimeout(() => this.flush(), 100)
    this.saving.unref?.()
  }

  /** Записать сейчас (остановка процесса). Ошибка записи сессии не роняет: живут в памяти. */
  flush(): void {
    if (this.saving !== null) { clearTimeout(this.saving); this.saving = null }
    if (this.deps.store === undefined) return
    const now = this.now()
    const list = [...this.map.values()].filter(s => s.expiresAt > now).map(s => ({
      sid: s.sid, principalId: s.principalId, idpSid: s.idpSid, expiresAt: s.expiresAt, idToken: s.idToken, idTokenExp: s.idTokenExp, idpRefresh: s.idpRefresh,
    }))
    try { this.deps.store.save(list) } catch { /* диск недоступен — сессии остаются в памяти */ }
  }

  get size(): number { return this.map.size }

  create(principalId: string, idp: IdpTokens, first?: { audience: Audience, issued: Issued }): Session {
    // Map хранит порядок вставки: первые — старейшие.
    const own = [...this.map.values()].filter(s => s.principalId === principalId)
    const evicted = own.slice(0, Math.max(0, own.length - MAX_SESSIONS_PER_PRINCIPAL + 1))
    const session: Session = {
      sid: randomToken(32),
      principalId,
      idpSid: idp.sid,
      expiresAt: this.now() + this.deps.ttlMs,
      idToken: idp.idToken,
      idTokenExp: idp.idTokenExp,
      idpRefresh: idp.refreshToken,
      tokens: new Map(),
      denied: new Map(),
      pending: new Map(),
      idpPending: null,
      tunnels: new Set(),
    }
    if (first !== undefined) session.tokens.set(first.audience, first.issued)
    // Сначала новая сессия, потом вытеснение: вытесненная с тем же `idpSid` видит живую
    // соседку и не отзывает общий refresh.
    this.map.set(session.sid, session)
    for (const old of evicted) this.delete(old.sid)
    this.persist()
    return session
  }

  get(sid: string | null): Session | null {
    if (sid === null) return null
    const session = this.map.get(sid)
    if (session === undefined) return null
    if (session.expiresAt <= this.now()) {
      this.delete(sid)
      return null
    }
    return session
  }

  /** Удалить сессию, закрыть её WS-туннели и сообщить `onDelete` (отзыв refresh у IdP). */
  delete(sid: string): Session | null {
    const session = this.map.get(sid)
    if (session === undefined) return null
    this.map.delete(sid)
    this.persist()
    for (const tunnel of session.tunnels) tunnel.destroy()
    session.tunnels.clear()
    this.notify(session)
    return session
  }

  /** Жива ли сессия консоли с этой сессией IdP (истёкшая, но не убранная — не считается). */
  hasLiveIdpSession(idpSid: string): boolean {
    const now = this.now()
    for (const session of this.map.values()) if (session.idpSid === idpSid && session.expiresAt > now) return true
    return false
  }

  private notify(session: Session): void {
    try {
      this.deps.onDelete?.(session, idpSid => this.hasLiveIdpSession(idpSid))
    } catch {
      // Колбэк — лучшее усилие: сессия уже удалена.
    }
  }

  /** Убрать истёкшие сессии (зовётся таймером). */
  sweep(): void {
    const now = this.now()
    for (const [sid, session] of this.map) if (session.expiresAt <= now) this.delete(sid)
  }

  /** Сбросить токен audience (ресурс ответил 401) — следующий запрос обменяет заново. */
  invalidate(session: Session, audience: Audience): void {
    session.tokens.delete(audience)
  }

  async token(session: Session, audience: Audience): Promise<string> {
    const cached = session.tokens.get(audience)
    if (cached !== undefined && cached.exp - SKEW_MS > this.now()) return cached.token
    let flight = session.pending.get(audience)
    if (flight === undefined) {
      flight = this.issue(session, audience).finally(() => session.pending.delete(audience))
      session.pending.set(audience, flight)
    }
    return (await flight).token
  }

  private async issue(session: Session, audience: Audience): Promise<Issued> {
    const denied = session.denied.get(audience)
    if (denied !== undefined && denied.until > this.now()) throw new NoPermission(audience, denied.code)
    const idToken = await this.idToken(session)
    let issued: Issued
    try {
      issued = await this.deps.exchange(idToken, audience, this.deps.scopes[audience])
    } catch (error) {
      if (!(error instanceof FederationError)) throw new Unavailable('IAM недоступен')
      if (error.status === 403) {
        session.denied.set(audience, { code: error.code, until: this.now() + DENY_TTL_MS })
        throw new NoPermission(audience, error.code)
      }
      if (error.status === 401 || error.status === 404 || error.status === 422) throw this.end(session)
      throw new Unavailable(`IAM: ${error.status}`)
    }
    // Тот же вход обязан давать того же principal; иное — повод начать с чистого листа.
    if (issued.principalId !== session.principalId) throw this.end(session)
    session.denied.delete(audience)
    session.tokens.set(audience, issued)
    return issued
  }

  private async idToken(session: Session): Promise<string> {
    if (session.idTokenExp - SKEW_MS > this.now()) return session.idToken
    const refresh = session.idpRefresh
    if (refresh === null) throw this.end(session)
    session.idpPending ??= this.deps.oidc.refresh(refresh).then((tokens) => {
      session.idToken = tokens.idToken
      session.idTokenExp = tokens.idTokenExp
      session.idpRefresh = tokens.refreshToken
      session.idpSid = tokens.sid ?? session.idpSid
      // Refresh ротирован — перезапуск не должен поднять сессию с отозванным токеном.
      this.persist()
      // Сессию удалили, пока шёл refresh: отозван был прежний токен, ротированный — тоже.
      if (this.map.get(session.sid) !== session && tokens.refreshToken !== refresh) this.notify(session)
    }).finally(() => { session.idpPending = null })
    try {
      await session.idpPending
    } catch (error) {
      // Отказ IdP (refresh отозван, сессия IdP кончилась) — только новый вход; сеть — временно.
      const status = (error as { status?: unknown }).status
      if (typeof status === 'number' && status >= 400 && status < 500) {
        // Этот refresh IdP только что отверг: отзывать его незачем, а у Keycloak отзыв по
        // `sid` задел бы сессию IdP, которой может пользоваться другая вкладка или перевход.
        if (session.idpRefresh === refresh) session.idpRefresh = null
        throw this.end(session)
      }
      throw new Unavailable('IdP недоступен')
    }
    return session.idToken
  }

  private end(session: Session): ReauthRequired {
    this.delete(session.sid)
    return new ReauthRequired('нужен повторный вход')
  }
}
