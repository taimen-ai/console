/**
 * Сессии консоли переживают перезапуск BFF (выкатку): долговечная часть сессии пишется в один
 * файл, зашифрованный AES-256-GCM ключом из секрета cookie (`deriveKeys().store`), права 0600,
 * запись — во временный файл и rename. Токены audience не пишутся — после перезапуска они
 * обмениваются заново. Чужой ключ, порча или мусор — файл не читается, сессий нет (вход заново).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { seal, unseal } from './crypto.ts'

export interface PersistedSession {
  sid: string
  principalId: string
  idpSid: string | null
  expiresAt: number
  idToken: string
  idTokenExp: number
  idpRefresh: string | null
}

export interface SessionStore {
  load(): PersistedSession[]
  save(sessions: PersistedSession[]): void
}

const FILE = 'sessions.sealed'
const VERSION = 1

export class FileSessionStore implements SessionStore {
  private readonly path: string
  private readonly key: Buffer

  constructor(dir: string, key: Buffer) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.path = join(dir, FILE)
    this.key = key
  }

  load(): PersistedSession[] {
    let text: string
    try { text = readFileSync(this.path, 'utf8') } catch { return [] }
    const doc = unseal<{ v?: unknown, sessions?: unknown }>(this.key, text.trim())
    if (doc === null || doc.v !== VERSION || !Array.isArray(doc.sessions)) return []
    return doc.sessions.filter((s): s is PersistedSession =>
      typeof s === 'object' && s !== null && typeof (s as PersistedSession).sid === 'string' && typeof (s as PersistedSession).principalId === 'string'
      && typeof (s as PersistedSession).expiresAt === 'number' && typeof (s as PersistedSession).idToken === 'string')
  }

  save(sessions: PersistedSession[]): void {
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, seal(this.key, { v: VERSION, sessions }), { mode: 0o600 })
    renameSync(tmp, this.path)
  }
}
