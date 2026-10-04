/**
 * Чтение ядра для контекста экрана ассистента от имени вошедшего человека: Bearer его
 * audience, повтор на 401 один раз (отзыв или гонка срока), отказ источника — `UpstreamError`
 * с кодом, перевход (`ReauthRequired`) всплывает. Путь сверяется с allow-list снимка
 * openapi: проекция не ходит туда, чего нет в контракте.
 */
import type { AllowList } from './allowlist.ts'
import type { Config } from './config.ts'
import { NoPermission, Unavailable, type Session, type Sessions } from './sessions.ts'

/** GET JSON ядра по пути без `/api/v1`. Отказ источника — `UpstreamError`, остальное всплывает. */
export type CpGet = (path: string, signal: AbortSignal) => Promise<unknown>

export class UpstreamError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export interface UpstreamDeps { config: Config, sessions: Sessions, allow: AllowList }

export function upstreamReader(deps: UpstreamDeps, session: Session, requestId: string): CpGet {
  return async (path, signal) => {
    const bare = path.split('?')[0]!
    // Dot-сегменты `new URL()` нормализует после проверки — их не пускаем вовсе, иначе allow-list обходится.
    if (bare.split('/').some(s => /^(\.|%2e){1,2}$/i.test(s))) throw new UpstreamError('not_allowed')
    if (deps.allow.match('GET', `/api/v1${bare}`) === null) throw new UpstreamError('not_allowed')
    const url = `${deps.config.upstreams.controlPlane}/api/v1${path}`
    for (let attempt = 0; ; attempt++) {
      let token: string
      try {
        token = await deps.sessions.token(session, 'control-plane')
      } catch (error) {
        if (error instanceof NoPermission) throw new UpstreamError('no_permission')
        if (error instanceof Unavailable) throw new UpstreamError('upstream_unavailable')
        throw error
      }
      let response: Response
      let text: string
      try {
        response = await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'x-request-id': requestId }, signal })
        text = await response.text()
      } catch {
        throw new UpstreamError(signal.aborted ? 'timeout' : 'upstream_unavailable')
      }
      if (response.status === 401 && attempt === 0) {
        deps.sessions.invalidate(session, 'control-plane')
        continue
      }
      if (response.status !== 200) throw new UpstreamError(response.status === 403 ? 'no_permission' : `upstream_${response.status}`)
      try { return JSON.parse(text) as unknown } catch { throw new UpstreamError('bad_response') }
    }
  }
}
