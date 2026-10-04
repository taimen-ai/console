import { Button, DegradedBanner, SearchField } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { consoleFetch } from '../../api/client.ts'

/**
 * PDF на странице документа: pdf.js рисует страницы на canvas в самой консоли — содержимое
 * документа не исполняется (скрипты PDF, формы XFA выключены), байты читаются тем же путём, что
 * «Скачать». Библиотека и её воркер подгружаются только здесь (отдельный кусок сборки), воркер —
 * свой файл консоли (`worker-src` = `script-src 'self'`). Страницы — по `PAGE_STEP` за раз.
 *
 * Поверх рисунка — прозрачный текстовый слой pdf.js (`TextLayer`): текст выделяется и
 * копируется, экранный диктор читает его, а не «страница N из M». Поиск по документу —
 * по тексту всех страниц: на каких страницах найдено, переход к странице, совпадения
 * подсвечены — и разорванные переносом строки (кусками в обеих строках). Через границу
 * страниц совпадение не ищется. У скана текста нет — остаётся рисунок с подписью.
 */

export const MAX_PDF_BYTES = 30 * 1024 * 1024
const PAGE_STEP = 5
/** Сколько страниц читать для поиска: дальше — «первые N страниц». */
const SEARCH_PAGES = 300

interface TextItem { str?: string }
interface TextContent { items: TextItem[] }
type Viewport = { width: number, height: number, scale: number }
type Doc = { numPages: number, getPage: (n: number) => Promise<Page>, destroy: () => Promise<void> }
type Page = {
  getViewport: (o: { scale: number }) => Viewport
  render: (o: { canvas: HTMLCanvasElement, viewport: Viewport }) => { promise: Promise<void>, cancel: () => void }
  getTextContent: () => Promise<TextContent>
}
interface TextLayerLike { render: () => Promise<unknown>, cancel: () => void, textDivs: HTMLElement[] }
type TextLayerClass = new (o: { textContentSource: TextContent, container: HTMLElement, viewport: Viewport }) => TextLayerLike
interface Loaded { doc: Doc, TextLayer: TextLayerClass }

async function load(url: string, signal: AbortSignal): Promise<Loaded> {
  const [pdfjs, worker, bytes] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    consoleFetch(url, { signal }).then(r => r.arrayBuffer()),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), enableXfa: false, disableAutoFetch: true, stopAtErrors: false })
  signal.addEventListener('abort', () => { void task.destroy() }, { once: true })
  return { doc: await task.promise as unknown as Doc, TextLayer: pdfjs.TextLayer as unknown as TextLayerClass }
}

/** Строка для сравнения: регистр и пробелы не важны, «ё» = «е». */
export function fold(text: string): string {
  return text.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

/** Сколько раз запрос встречается в тексте страницы (без пересечений). */
export function countMatches(text: string, query: string): number {
  const q = fold(query)
  if (q === '') return 0
  const hay = fold(text)
  let n = 0
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length)) n++
  return n
}

/** Свёртка без изменения длины (регистр, «ё»): позиции совпадений совпадают с исходной строкой. */
const foldSame = (text: string): string => text.toLocaleLowerCase('ru').replace(/ё/g, 'е')

/**
 * Совпадения на странице по строкам текстового слоя: строки склеиваются через пробел, пробелы
 * схлопываются (как в `fold`), поэтому запрос, разорванный переносом строки, тоже находится.
 * Ответ — по каждой строке её куски `[начало, конец, номер совпадения]` в исходном тексте строки.
 */
export function lineMatches(lines: string[], query: string): [number, number, number][][] {
  const out: [number, number, number][][] = lines.map(() => [])
  const q = foldSame(query).replace(/\s+/g, ' ').trim()
  if (q === '') return out
  // Нормализованный текст и откуда каждый его знак: [строка, позиция] или null — вставленный пробел.
  let hay = ''
  const from: ([number, number] | null)[] = []
  lines.forEach((line, li) => {
    const folded = foldSame(line)
    for (let i = 0; i < folded.length; i++) {
      const ch = folded[i]!
      if (/\s/.test(ch)) {
        if (hay.endsWith(' ') || hay === '') continue
        hay += ' '
        from.push([li, i])
      } else {
        hay += ch
        from.push([li, i])
      }
    }
    if (hay !== '' && !hay.endsWith(' ')) { hay += ' '; from.push(null) }
  })
  let k = 0
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length), k++) {
    const spans = new Map<number, [number, number]>()
    for (let j = i; j < i + q.length; j++) {
      const at = from[j]
      // Пробелы не подсвечиваются: кусок строки — от первого до последнего знака совпадения.
      if (at === null || at === undefined || hay[j] === ' ') continue
      const [li, pos] = at
      const cur = spans.get(li)
      spans.set(li, cur === undefined ? [pos, pos + 1] : [Math.min(cur[0], pos), Math.max(cur[1], pos + 1)])
    }
    for (const [li, [a, b]] of spans) out[li]!.push([a, b, k])
  }
  return out
}

/** Подсветить куски совпадений в строке текстового слоя: `<mark data-match>` вокруг найденного. */
function markLine(el: HTMLElement, ranges: [number, number, number][]): void {
  const original = el.dataset.text ?? el.textContent ?? ''
  el.dataset.text = original
  if (ranges.length === 0) { if (el.childElementCount > 0) el.textContent = original; return }
  const parts: Node[] = []
  let at = 0
  for (const [from, to, k] of ranges) {
    if (from > at) parts.push(document.createTextNode(original.slice(at, from)))
    const mark = document.createElement('mark')
    mark.className = 'doc-pdf-mark'
    mark.dataset.match = String(k)
    mark.textContent = original.slice(from, to)
    parts.push(mark)
    at = to
  }
  if (at < original.length) parts.push(document.createTextNode(original.slice(at)))
  el.replaceChildren(...parts)
}

/** Совпадения в порядке документа: куски одного совпадения (через перенос строки) — вместе. */
function matchGroups(box: HTMLElement | null): HTMLElement[][] {
  const groups = new Map<string, HTMLElement[]>()
  for (const m of box?.querySelectorAll<HTMLElement>('mark.doc-pdf-mark') ?? []) {
    const key = `${m.closest('figure')?.id ?? ''}:${m.dataset.match ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), m])
  }
  return [...groups.values()]
}

/** Текст страницы из `getTextContent`: строки элементов через пробел. */
export const pageText = (content: TextContent): string => content.items.map(i => i.str ?? '').join(' ')

export function PdfPreview({ id, url, name }: { id: string, url: string, name: string }) {
  const loaded = useQuery({ queryKey: ['artifacts', id, 'pdf'], staleTime: Infinity, gcTime: 60_000, retry: false, queryFn: ({ signal }) => load(url, signal) })
  const [shown, setShown] = useState(PAGE_STEP)
  const [query, setQuery] = useState('')
  const [jump, setJump] = useState<number | null>(null)
  const [active, setActive] = useState(-1)
  const [pendingPage, setPendingPage] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const total = loaded.data?.doc.numPages ?? 0
  const searching = query.trim().length >= 2
  // Текст всех страниц — один раз, когда начали искать.
  const texts = useQuery({
    queryKey: ['artifacts', id, 'pdf-text'], enabled: loaded.isSuccess && searching, staleTime: Infinity, gcTime: 60_000,
    queryFn: async () => {
      const doc = loaded.data!.doc
      const out: string[] = []
      for (let n = 1; n <= Math.min(doc.numPages, SEARCH_PAGES); n++) out.push(pageText(await (await doc.getPage(n)).getTextContent()))
      return out
    },
  })
  // Активное совпадение — выделено и видно.
  useEffect(() => {
    const groups = matchGroups(boxRef.current)
    groups.forEach((g, i) => g.forEach(m => m.classList.toggle('doc-pdf-mark-on', i === active)))
    groups[active]?.[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [active])
  // Переход на ещё не показанную страницу: ждём, пока её слой нарисуется, и встаём на её первое совпадение.
  useEffect(() => {
    if (pendingPage === null) return
    const timer = window.setInterval(() => {
      const page = document.getElementById(`${id}-p${pendingPage}`)
      const first = page?.querySelector<HTMLElement>('mark.doc-pdf-mark')
      if (first === null || first === undefined) return
      setActive(matchGroups(boxRef.current).findIndex(g => g.includes(first)))
      setPendingPage(null)
    }, 150)
    const stop = window.setTimeout(() => setPendingPage(null), 5000)
    return () => { window.clearInterval(timer); window.clearTimeout(stop) }
  }, [pendingPage, id])
  useEffect(() => {
    if (jump === null) return
    document.getElementById(`${id}-p${jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [jump, id, shown])

  if (loaded.isPending) return <p className="tc-muted">{t`Opening the PDF…`}</p>
  if (loaded.isError) return <DegradedBanner.Section text={t`Could not show the PDF — download it or open it in a new tab.`} />
  const { doc, TextLayer } = loaded.data
  const pages = Array.from({ length: Math.min(shown, total) }, (_, i) => i + 1)
  const rest = total - pages.length
  const hits = searching && texts.isSuccess ? texts.data.map((text, i) => ({ page: i + 1, count: countMatches(text, query) })).filter(h => h.count > 0) : []
  const found = hits.reduce((s, h) => s + h.count, 0)
  const goTo = (n: number): void => { setShown(s => Math.max(s, n)); setJump(n) }
  /** Номер совпадения среди всех: по страницам с совпадениями (`hits`) — до активного. */
  const step = (dir: 1 | -1): void => {
    const marks = matchGroups(boxRef.current)
    const next = active + dir
    if (next >= 0 && next < marks.length) { setActive(next); return }
    if (dir === 1) {
      // Совпадения дальше показанных страниц — раскрыть страницу и встать на неё.
      const after = hits.find(h => h.page > pages.length)
      if (after !== undefined) { setShown(s => Math.max(s, after.page)); setPendingPage(after.page); return }
      if (marks.length > 0) setActive(0)
    } else if (marks.length > 0) setActive(marks.length - 1)
  }
  const position = active >= 0 ? active + 1 : 0
  return (
    <div className="doc-pdf" ref={boxRef}>
      <div className="doc-pdf-search" role="search">
        <SearchField label={t`Find in the document`} placeholder={t`Find in the document`} value={query} onChange={e => { setQuery(e.target.value); setActive(-1) }} />
        <p className="tc-muted doc-pdf-found" aria-live="polite">
          {!searching ? null
            : texts.isPending ? t`Searching…`
              : texts.isError ? t`Could not read the text of the document.`
                : found === 0 ? (texts.data.every(s => s.trim() === '') ? t`The document has no text layer — it is a scan.` : t`Nothing found.`)
                  : total > SEARCH_PAGES ? t`Found ${found} times on ${hits.length} of the first ${SEARCH_PAGES} pages:` : t`Found ${found} times on ${hits.length} pages:`}
          {hits.slice(0, 30).map(h => <button key={h.page} type="button" className="st-link-btn doc-pdf-hit-link" onClick={() => goTo(h.page)}>{t`p. ${h.page}`}</button>)}
        </p>
        {found > 0
          ? (
            <div className="doc-pdf-nav">
              <Button variant="ghost" size="sm" onClick={() => step(-1)}>{t`Previous`}</Button>
              <Button variant="ghost" size="sm" onClick={() => step(1)}>{t`Next`}</Button>
              <span className="tc-muted" aria-live="polite">{position > 0 ? t`${position} of ${found}` : t`${found} found`}</span>
            </div>
          )
          : null}
      </div>
      {pages.map(n => <PdfPage key={n} doc={doc} TextLayer={TextLayer} n={n} total={total} name={name} anchor={`${id}-p${n}`} query={searching ? query : ''} />)}
      {rest > 0 ? <div className="doc-pdf-more"><Button variant="secondary" size="sm" onClick={() => setShown(s => s + PAGE_STEP)}>{t`Show ${Math.min(rest, PAGE_STEP)} more pages of ${rest}`}</Button></div> : null}
    </div>
  )
}

function PdfPage({ doc, TextLayer, n, total, name, anchor, query }: { doc: Doc, TextLayer: TextLayerClass, n: number, total: number, name: string, anchor: string, query: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [divs, setDivs] = useState<HTMLElement[] | null>(null)
  useEffect(() => {
    let cancel: (() => void) | undefined
    let layer: TextLayerLike | undefined
    let alive = true
    void (async () => {
      try {
        const page = await doc.getPage(n)
        const canvas = canvasRef.current
        const text = textRef.current
        if (!alive || canvas === null || text === null) return
        // Ширина — по колонке, чёткость — по плотности экрана.
        // Ширина — колонки (figure): обёртка листа сжата по рисунку.
        const width = canvas.closest('figure')?.clientWidth || 800
        const base = page.getViewport({ scale: 1 })
        const ratio = window.devicePixelRatio || 1
        const css = page.getViewport({ scale: width / base.width })
        const viewport = page.getViewport({ scale: (width / base.width) * ratio })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(css.width)}px`
        const task = page.render({ canvas, viewport })
        cancel = () => task.cancel()
        // Текстовый слой — в CSS-пикселях поверх рисунка; размер шрифта — от `--total-scale-factor`.
        text.replaceChildren()
        text.parentElement?.style.setProperty('--total-scale-factor', String(css.scale))
        layer = new TextLayer({ textContentSource: await page.getTextContent(), container: text, viewport: css })
        await Promise.all([task.promise, layer.render()])
        if (alive) setDivs(layer.textDivs)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => { alive = false; cancel?.(); layer?.cancel() }
  }, [doc, TextLayer, n])
  // Подсветка совпадений — по тексту всей страницы, куски — в строках слоя.
  useEffect(() => {
    if (divs === null) return
    const ranges = lineMatches(divs.map(d => d.dataset.text ?? d.textContent ?? ''), query)
    divs.forEach((d, i) => markLine(d, ranges[i] ?? []))
  }, [divs, query])
  const hasText = divs !== null && divs.some(d => (d.dataset.text ?? d.textContent ?? '').trim() !== '')
  return (
    <figure className="doc-pdf-page" id={anchor} aria-label={t`${name}, page ${n} of ${total}`}>
      {failed ? <p className="tc-muted">{t`Page ${n} could not be drawn.`}</p> : (
        <div className="doc-pdf-sheet">
          {/* У страницы с текстом диктор читает текстовый слой; у скана — подпись рисунка. */}
          <canvas ref={canvasRef} {...(hasText ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t`${name}, page ${n} of ${total}` })} />
          <div ref={textRef} className="textLayer" />
        </div>
      )}
      <figcaption className="tc-muted">{t`Page ${n} of ${total}`}</figcaption>
    </figure>
  )
}
