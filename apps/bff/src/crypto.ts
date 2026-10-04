/**
 * Cookie и подписи BFF. В cookie сессии лежит только непрозрачный случайный sid с HMAC —
 * ни токенов, ни principal (FR-007). Незавершённый вход (state, PKCE verifier, nonce, next)
 * живёт в cookie `rc_login`, зашифрованной AES-256-GCM: на сервере состояния нет, и поток
 * входов не может вытеснить чужие. PKCE — S256.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/** Минимальная длина секрета cookie: меньше — отказ старта. */
export const MIN_COOKIE_SECRET_BYTES = 32

/** Отдельные ключи из одного секрета: подпись sid, шифрование cookie входа и файла сессий. */
export function deriveKeys(secret: Buffer): { sign: Buffer, seal: Buffer, store: Buffer } {
  const derive = (info: string): Buffer => Buffer.from(hkdfSync('sha256', secret, 'console', info, 32))
  return { sign: derive('session-cookie-hmac'), seal: derive('login-cookie-aes-gcm'), store: derive('session-store-aes-gcm') }
}

/** JSON → base64url(iv ‖ шифротекст ‖ тег), AES-256-GCM. */
export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url')
}

/** Обратное `seal`; подделка, чужой ключ или мусор — null. */
export function unseal<T>(key: Buffer, sealed: string | undefined): T | null {
  if (sealed === undefined) return null
  try {
    const raw = Buffer.from(sealed, 'base64url')
    if (raw.length < 29) return null
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(raw.length - 16))
    const text = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

const mac = (key: Buffer, value: string): string => createHmac('sha256', key).update(value).digest('base64url')

export function sign(key: Buffer, value: string): string {
  return `${value}.${mac(key, value)}`
}

/** Значение подписи или null, если подпись не сошлась. */
export function unsign(key: Buffer, signed: string | undefined): string | null {
  if (signed === undefined) return null
  const dot = signed.lastIndexOf('.')
  if (dot <= 0) return null
  const value = signed.slice(0, dot)
  const given = Buffer.from(signed.slice(dot + 1))
  const expected = Buffer.from(mac(key, value))
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null
}

export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    try {
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch { /* битое значение — как будто cookie нет */ }
  }
  return out
}

export interface CookieOptions { path: string, secure: boolean, maxAgeSeconds: number }

export function cookie(name: string, value: string, options: CookieOptions): string {
  return [
    `${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, 'HttpOnly', 'SameSite=Lax',
    ...(options.secure ? ['Secure'] : []), `Max-Age=${options.maxAgeSeconds}`,
  ].join('; ')
}

/**
 * Полезная нагрузка JWT без проверки подписи. Годится только для id token, полученного
 * самим BFF с token endpoint IdP по TLS (OIDC Core 3.1.3.7 п.6): подпись и audience
 * проверяет IAM в `federation:exchange`, BFF берёт отсюда лишь `exp` и `nonce`.
 */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (part === undefined) return null
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}
