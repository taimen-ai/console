/**
 * Markdown в ответах ассистента (TASK-001130). Разметку строит `marked` (GFM, переносы строк как
 * в чате), на экран она попадает только после DOMPurify со строгим allowlist: без `style`,
 * `on*`, картинок, форм и фреймов; ссылки — только http(s) и адреса консоли. После очистки
 * текст (вне `a`, `code`, `pre`) связывается: `TASK-NNNNNN`, адреса консоли,
 * голые адреса. Внутренние ссылки помечаются `data-console` — панель открывает их роутером SPA.
 *
 * Библиотеки грузятся лениво, отдельным чанком (как в просмотрщике артефактов): до загрузки
 * панель показывает текст как есть.
 */
import type { DOMPurify } from 'dompurify'
import { BASE_PATH } from '../api/client.ts'

/** Адрес консоли из ссылки: относительный `/console/…` или абсолютный своего origin. */
export function consolePath(url: string, origin = window.location.origin): string | null {
  const root = `${BASE_PATH}/`
  if (url.startsWith(root) || url === BASE_PATH) return url
  try {
    const parsed = new URL(url)
    if (parsed.origin === origin && (`${parsed.pathname}/`).startsWith(root)) return parsed.pathname + parsed.search + parsed.hash
  } catch { /* не адрес */ }
  return null
}

const TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a',
]
const ATTRS = ['href', 'title', 'align', 'start']
/** http(s) и адреса консоли; `javascript:`, `data:`, `vbscript:`, `mailto:` и прочее — нет. */
const URI = new RegExp(`^(?:https?://|${BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$))`, 'i')

/** Текстовые ссылки внутри разметки: голый адрес, путь консоли, публичный id работы. */
const BARE = new RegExp(`(https?://[^\\s<>()]+)|(${BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^\\s<>()]*)|\\b(TASK-\\d{6})\\b`, 'g')
const TRAILING = /[.,;:!?»"')\]]+$/
/** Внутри этих элементов текст не связывается. */
const NO_LINKS = 'a, code, pre'

export type RenderMarkdown = (text: string) => string

function engine(marked: typeof import('marked').marked, purify: DOMPurify): RenderMarkdown {
  const anchor = (doc: Document, href: string, text: string): HTMLAnchorElement => {
    const a = doc.createElement('a')
    a.setAttribute('href', href)
    a.textContent = text
    return a
  }

  /** Связать текстовые узлы: TASK-id, `/console/…`, голые http(s), кроме `a`/`code`/`pre`. */
  const autolink = (root: DocumentFragment) => {
    const doc = root.ownerDocument
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (n.parentElement?.closest(NO_LINKS) == null) texts.push(n as Text)
    }
    for (const node of texts) {
      const value = node.data
      const parts: (string | Node)[] = []
      let last = 0
      for (const m of value.matchAll(BARE)) {
        let raw = m[0]
        let href: string
        if (m[3] !== undefined) href = `${BASE_PATH}/work/${m[3]}`
        else { raw = raw.replace(TRAILING, ''); href = raw }
        if (raw === '') continue
        if (m.index > last) parts.push(value.slice(last, m.index))
        parts.push(anchor(doc, href, raw))
        last = m.index + raw.length
      }
      if (parts.length === 0) continue
      if (last < value.length) parts.push(value.slice(last))
      node.replaceWith(...parts)
    }
  }

  /** Ссылки: консоль — без target (открывает роутер), внешние — новая вкладка без opener, прочее — текст. */
  const links = (root: DocumentFragment) => {
    for (const a of [...root.querySelectorAll('a')]) {
      const href = a.getAttribute('href') ?? ''
      const internal = consolePath(href)
      if (internal !== null) {
        a.setAttribute('href', internal)
        a.setAttribute('data-console', '')
      } else if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener noreferrer')
      } else {
        a.replaceWith(...a.childNodes)
      }
    }
  }

  /** Таблица прокручивается по горизонтали в своей обёртке, а не вся панель. */
  const tables = (root: DocumentFragment) => {
    for (const table of [...root.querySelectorAll('table')]) {
      const box = root.ownerDocument.createElement('div')
      box.className = 'asst-md-table'
      table.replaceWith(box)
      box.append(table)
    }
  }

  return (text: string) => {
    const html = marked.parse(text, { gfm: true, breaks: true, async: false })
    const root = purify.sanitize(html, {
      ALLOWED_TAGS: TAGS,
      ALLOWED_ATTR: ATTRS,
      ALLOWED_URI_REGEXP: URI,
      // DOMPurify сверяет с URI-регуляркой любые атрибуты вне этого списка — выравнивание и номер
      // списка не адреса.
      ADD_URI_SAFE_ATTR: ['align', 'start'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    })
    autolink(root)
    links(root)
    tables(root)
    const box = root.ownerDocument.createElement('div')
    box.append(root)
    return box.innerHTML
  }
}

let ready: RenderMarkdown | null = null
let pending: Promise<RenderMarkdown> | null = null

/** Рендер, если библиотеки уже загружены. */
export const loadedMarkdown = (): RenderMarkdown | null => ready

/** Загрузить библиотеки (один раз) и вернуть рендер. */
export function loadMarkdown(): Promise<RenderMarkdown> {
  pending ??= Promise.all([import('marked'), import('dompurify')]).then(([{ marked }, { default: createDOMPurify }]) => {
    // Свой экземпляр: хуки просмотрщика артефактов (target=_blank на всех ссылках) сюда не попадают.
    ready = engine(marked, createDOMPurify(window))
    return ready
  }).catch((e: unknown) => { pending = null; throw e })
  return pending
}
