import { useEffect, useState } from 'react'
import { loadedMarkdown, loadMarkdown } from './markdown.ts'

/**
 * Markdown через `markdown.ts` (marked + DOMPurify со строгим allowlist): ответы ассистента,
 * текстовые документы. До загрузки библиотек — текст как есть.
 *
 * Заголовки текста понижаются на уровень (`#` → `h2`): `h1` на странице один — название
 * экрана; иначе навигация по заголовкам экранного диктора путается.
 */
const demote = (html: string): string => html.replace(/<(\/?)h([1-5])(?=[\s>])/gi, (_, slash: string, level: string) => `<${slash}h${Number(level) + 1}`)

export function Markdown({ text }: { text: string }) {
  const [render, setRender] = useState(loadedMarkdown)
  useEffect(() => {
    if (render !== null) return
    let alive = true
    loadMarkdown().then(r => { if (alive) setRender(() => r) }, () => {})
    return () => { alive = false }
  }, [render])
  if (render === null) return <span className="asst-md asst-md-plain">{text}</span>
  return <span className="asst-md" dangerouslySetInnerHTML={{ __html: demote(render(text)) }} />
}
