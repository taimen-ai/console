import { DegradedBanner, FilterChip } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { consoleFetch } from '../../api/client.ts'

/**
 * Офисные документы на странице документа: DOCX — текстом с заголовками, списками и таблицами
 * (mammoth → HTML → DOMPurify со строгим белым списком: ни скриптов, ни стилей, ни атрибутов
 * событий; ссылки — внешние в новую вкладку, прочие — текстом; картинки — только встроенные
 * `data:`); XLSX — таблицей по листам (read-excel-file), до `MAX_ROWS` строк; PPTX — текстом
 * слайдов по порядку (fflate + DOMParser, `pptxSlides`). Библиотеки подгружаются только здесь. Сам файл — «Скачать» и «Открыть в новой вкладке».
 */

export const MAX_OFFICE_BYTES = 15 * 1024 * 1024
export const MAX_ROWS = 500

const TAGS = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'img', 'blockquote']
const ATTRS = ['href', 'src', 'alt', 'colspan', 'rowspan']

async function bytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  return await (await consoleFetch(url, { signal })).arrayBuffer()
}

/** HTML документа Word после очистки: заголовки на уровень ниже (h1 страницы — имя документа). */
export async function docxHtml(data: ArrayBuffer): Promise<string> {
  const [mammoth, { default: createDOMPurify }] = await Promise.all([import('mammoth'), import('dompurify')])
  const result = await mammoth.convertToHtml({ arrayBuffer: data })
  const purify = createDOMPurify(window)
  const root = purify.sanitize(result.value, {
    ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTRS, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    // Картинки — только встроенные в документ; ссылки — http(s)
    ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/(?:png|jpeg|gif|webp);)/i,
    RETURN_DOM_FRAGMENT: true,
  })
  for (const a of [...root.querySelectorAll('a')]) {
    const href = a.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer') } else a.replaceWith(...a.childNodes)
  }
  for (const img of [...root.querySelectorAll('img')]) if (!/^data:image\//i.test(img.getAttribute('src') ?? '')) img.remove()
  for (const level of [5, 4, 3, 2, 1]) {
    for (const h of [...root.querySelectorAll(`h${level}`)]) {
      const next = root.ownerDocument.createElement(`h${level + 1}`)
      next.append(...h.childNodes)
      h.replaceWith(next)
    }
  }
  const box = root.ownerDocument.createElement('div')
  box.append(root)
  return box.innerHTML
}

export function DocxPreview({ id, url }: { id: string, url: string }) {
  const html = useQuery({ queryKey: ['artifacts', id, 'docx'], staleTime: Infinity, retry: false, queryFn: async ({ signal }) => docxHtml(await bytes(url, signal)) })
  if (html.isPending) return <p className="tc-muted">{t`Opening the document…`}</p>
  if (html.isError) return <DegradedBanner.Section text={t`Could not show the document — download it or open it in a new tab.`} />
  if (html.data.trim() === '') return <p className="tc-muted">{t`The document has no text.`}</p>
  // HTML прошёл DOMPurify со строгим белым списком (docxHtml)
  return <div className="doc-docx" dangerouslySetInnerHTML={{ __html: html.data }} />
}

type Cell = string | number | boolean | Date | null
interface Sheet { sheet: string, data: Cell[][] }

/** Значение ячейки для показа: дата — днём, число — с разрядами, пусто — «». */
export function cellText(value: Cell, locale: string): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toLocaleDateString(locale)
  if (typeof value === 'number') return value.toLocaleString(locale, { maximumFractionDigits: 10 })
  if (typeof value === 'boolean') return value ? '✓' : '—'
  return String(value)
}

export function XlsxPreview({ id, url, locale }: { id: string, url: string, locale: string }) {
  const sheets = useQuery({
    queryKey: ['artifacts', id, 'xlsx'], staleTime: Infinity, retry: false,
    queryFn: async ({ signal }) => {
      const [{ default: readXlsxFile }, data] = await Promise.all([import('read-excel-file/browser'), bytes(url, signal)])
      return await readXlsxFile(new Blob([data])) as unknown as Sheet[]
    },
  })
  const [current, setCurrent] = useState(0)
  if (sheets.isPending) return <p className="tc-muted">{t`Opening the spreadsheet…`}</p>
  if (sheets.isError) return <DegradedBanner.Section text={t`Could not show the spreadsheet — download it or open it in a new tab.`} />
  const list = sheets.data
  const sheet = list[Math.min(current, list.length - 1)]
  if (sheet === undefined) return <p className="tc-muted">{t`The spreadsheet has no sheets.`}</p>
  const rows = sheet.data.slice(0, MAX_ROWS)
  const width = Math.max(0, ...rows.map(r => r.length))
  const more = sheet.data.length - rows.length
  return (
    <div className="doc-xlsx">
      {list.length > 1
        ? <div className="doc-xlsx-sheets" role="group" aria-label={t`Sheets`}>{list.map((s, i) => <FilterChip key={s.sheet} label={s.sheet} pressed={i === current} onClick={() => setCurrent(i)} />)}</div>
        : null}
      {rows.length === 0 ? <p className="tc-muted">{t`The sheet is empty.`}</p> : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- прокручиваемая таблица должна получать фокус с клавиатуры (axe scrollable-region-focusable)
        <div className="doc-xlsx-box" tabIndex={0} role="region" aria-label={sheet.sheet}>
          <table className="doc-xlsx-table">
            <caption className="tc-sr">{sheet.sheet}</caption>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  {Array.from({ length: width }, (_, j) => <td key={j}>{cellText(r[j] ?? null, locale)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more > 0 ? <p className="tc-muted">{t`And ${more} more rows — download the file to see all.`}</p> : null}
    </div>
  )
}

/** Слайдов в просмотре не больше; распакованная часть презентации — не больше `MAX_PART_BYTES`. */
export const MAX_SLIDES = 300
const MAX_PART_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 60 * 1024 * 1024

export interface Slide { title: string | null, lines: string[] }

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * Текст слайдов презентации PPTX по порядку показа: `ppt/presentation.xml` (`sldIdLst`) → связи
 * → файлы слайдов. Заголовок — фигура с плейсхолдером `title`/`ctrTitle`, прочее — абзацы по
 * порядку. Картинки, заметки и оформление не показываются. XML разбирает `DOMParser` браузера:
 * это данные, в документ страницы они не вставляются. Распаковываются только XML-части, каждая
 * не больше `MAX_PART_BYTES` и всего не больше `MAX_TOTAL_BYTES` — от zip-бомбы.
 */
export async function pptxSlides(data: ArrayBuffer): Promise<Slide[]> {
  const { unzipSync, strFromU8 } = await import('fflate')
  let total = 0
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => {
      if (!/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/.test(f.name)) return false
      if (f.originalSize > MAX_PART_BYTES) throw new Error('part_too_large')
      total += f.originalSize
      if (total > MAX_TOTAL_BYTES) throw new Error('too_large')
      return true
    },
  })
  const parse = (name: string): Document | null => {
    const raw = files[name]
    if (raw === undefined) return null
    const doc = new DOMParser().parseFromString(strFromU8(raw), 'application/xml')
    return doc.getElementsByTagName('parsererror').length > 0 ? null : doc
  }
  const presentation = parse('ppt/presentation.xml')
  const rels = parse('ppt/_rels/presentation.xml.rels')
  if (presentation === null || rels === null) throw new Error('not_a_presentation')
  const targets = new Map([...rels.getElementsByTagName('Relationship')].map(r => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']))
  const order = [...presentation.getElementsByTagNameNS(NS_P, 'sldId')].map(s => targets.get(s.getAttributeNS(NS_R, 'id') ?? '') ?? '')
  const slides: Slide[] = []
  for (const target of order.slice(0, MAX_SLIDES)) {
    const doc = parse(`ppt/${target.replace(/^\/?(ppt\/)?/, '')}`)
    if (doc === null) { slides.push({ title: null, lines: [] }); continue }
    let title: string | null = null
    const lines: string[] = []
    for (const shape of doc.getElementsByTagNameNS(NS_P, 'sp')) {
      const ph = shape.getElementsByTagNameNS(NS_P, 'ph')[0]?.getAttribute('type')
      const paragraphs = [...shape.getElementsByTagNameNS(NS_A, 'p')]
        .map(p => [...p.getElementsByTagNameNS(NS_A, 't')].map(t => t.textContent ?? '').join('').trim())
        .filter(Boolean)
      if ((ph === 'title' || ph === 'ctrTitle') && title === null) title = paragraphs.join(' ') || null
      else lines.push(...paragraphs)
    }
    slides.push({ title, lines })
  }
  return slides
}

export function PptxPreview({ id, url }: { id: string, url: string }) {
  const slides = useQuery({ queryKey: ['artifacts', id, 'pptx'], staleTime: Infinity, retry: false, queryFn: async ({ signal }) => pptxSlides(await bytes(url, signal)) })
  if (slides.isPending) return <p className="tc-muted">{t`Opening the presentation…`}</p>
  if (slides.isError) return <DegradedBanner.Section text={t`Could not show the presentation — download it or open it in a new tab.`} />
  if (slides.data.length === 0) return <p className="tc-muted">{t`The presentation has no slides.`}</p>
  return (
    <div className="doc-pptx">
      <p className="tc-muted">{t`The text of the slides; pictures and design are in the file itself.`}</p>
      <ol className="doc-pptx-slides">
        {slides.data.map((s, i) => (
          <li key={i} className="doc-pptx-slide">
            <h2 className="doc-pptx-title"><span className="tc-muted doc-pptx-n">{t`Slide ${i + 1}`}</span> {s.title ?? t`untitled`}</h2>
            {s.lines.length > 0 ? <ul>{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul> : null}
          </li>
        ))}
      </ol>
      {slides.data.length === MAX_SLIDES ? <p className="tc-muted">{t`Only the first ${MAX_SLIDES} slides are shown.`}</p> : null}
    </div>
  )
}
