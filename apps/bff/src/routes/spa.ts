/**
 * Собранная SPA: `{base}/assets/*` — без входа, неизменяемые (имена с хэшем); остальные
 * адреса под `{base}/` — `index.html` с `<base href>` под префикс запуска и строгой CSP,
 * только с сессией (без неё — вход с возвратом на тот же адрес).
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { Hono } from 'hono'
import { fail, page, SECURITY_HEADERS, sessionOf, type AppDeps, type Env, type Keys } from '../context.ts'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.map': 'application/json',
}
/**
 * Политика документа SPA: свои скрипты и стили, без inline-скриптов. Атрибуты `style`
 * React ставит через CSSOM — CSP их не касается.
 */
export const DOCUMENT_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

const isFile = async (path: string): Promise<boolean> => (await stat(path).catch(() => null))?.isFile() ?? false

export function spaRoutes(app: Hono<Env>, deps: AppDeps, keys: Keys): void {
  const { config } = deps
  const b = config.basePath

  /** Файл сборки по адресу; выход за каталог (`..`, `\0`) — null. */
  const fileOf = (pathname: string): string | null => {
    if (config.staticDir === null) return null
    let relative: string
    try { relative = normalize(decodeURIComponent(pathname.slice(`${b}/`.length))) } catch { return null }
    if (relative.startsWith('..') || relative.includes(`${sep}..`) || relative.includes('\0')) return null
    return join(config.staticDir, relative)
  }
  const send = async (file: string, cache: string): Promise<Response> => new Response(await readFile(file), {
    headers: { ...SECURITY_HEADERS, 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache, 'x-frame-options': 'DENY' },
  })

  app.get(`${b}/assets/*`, async (c) => {
    c.set('route', `${b}/assets/*`)
    const file = fileOf(new URL(c.req.url).pathname)
    // Без входа — только каталог assets/ после нормализации: `assets/../index.html` не проходит.
    if (file === null || !file.startsWith(join(config.staticDir ?? '', 'assets') + sep) || !(await isFile(file))) return fail(404, 'not_found')
    return await send(file, 'public, max-age=31536000, immutable')
  })

  app.get(`${b}/*`, async (c) => {
    c.set('route', `${b}/*`)
    const url = new URL(c.req.url)
    if (sessionOf(deps, keys, c.req.header('cookie')) === null) {
      return new Response(null, { status: 302, headers: { location: `${b}/_auth/login?next=${encodeURIComponent(url.pathname + url.search)}`, 'cache-control': 'no-store' } })
    }
    if (config.staticDir === null) return page(config, 404, { en: 'The console UI is not built.', ru: 'Интерфейс консоли не собран.' }, c.req.header('accept-language') ?? null)
    const file = fileOf(url.pathname)
    if (file !== null && !file.endsWith('index.html') && await isFile(file)) return await send(file, 'no-cache')
    // Адреса экранов SPA файлов не имеют — отдаётся index.html с базой под префикс запуска.
    const html = (await readFile(join(config.staticDir, 'index.html'), 'utf8')).replace(/<base href="[^"]*">/, `<base href="${b}/">`)
    return new Response(html, {
      headers: { ...SECURITY_HEADERS, 'content-type': CONTENT_TYPES['.html']!, 'cache-control': 'no-cache', 'x-frame-options': 'DENY', 'content-security-policy': DOCUMENT_CSP },
    })
  })
}
