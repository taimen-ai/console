import { DegradedBanner, EmptyState, Icon, IdentityBlock, PageHeader, Zone } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { API, ApiError, consoleFetch, cpGet } from '../../api/client.ts'
import { executorKind, taskQuery, usePrincipals } from '../../api/directory.ts'
import type { Artifact } from '../../api/types.ts'
import { Markdown } from '../../assistant/Markdown.tsx'
import { when } from '../task/history.ts'
import { initials, workHref } from '../work/rows.ts'
import { DocxPreview, MAX_OFFICE_BYTES, PptxPreview, XlsxPreview } from './OfficePreview.tsx'
import { MAX_PDF_BYTES, PdfPreview } from './PdfPreview.tsx'
import './document.css'

/**
 * Страница документа (docs/screens/task.md, «Документы»): сам документ, откуда он, когда и
 * кем добавлен, какую работу доказывает; «Скачать», «Открыть в новой вкладке».
 *
 * Безопасность показа. Содержимое — байты из хранилища ядра (`GET /artifacts/{id}/content`).
 * На странице консоли оно не исполняется: текст и Markdown — через тот же очищающий
 * отрисовщик (DOMPurify), что у ассистента; JSON — моноширинным текстом; картинки (кроме SVG)
 * — `<img>`; PDF — страницами на canvas через pdf.js (`PdfPreview.tsx`, скрипты документа не
 * исполняются); DOCX и XLSX — текстом и таблицей, PPTX — текстом слайдов (`OfficePreview.tsx`, HTML — через DOMPurify).
 * Остальное — открыть или скачать: ответ BFF несёт
 * `Content-Security-Policy: sandbox` и `nosniff`, а ядро отдаёт HTML, SVG и XML как
 * `attachment` — в новой вкладке документ без скриптов и без доступа к сессии.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isArtifactId = (value: string): boolean => UUID.test(value)

/** Больше не показываем на странице — дальше «Скачать». */
const MAX_TEXT_BYTES = 1024 * 1024
const EXTERNAL = /^https?:\/\//i

type Preview = 'markdown' | 'text' | 'json' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'none'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export function previewOf(mediaType: string | null | undefined, name = ''): Preview {
  const base = (mediaType ?? '').split(';')[0]!.trim().toLowerCase()
  if (base === 'text/markdown' || /\.md$/i.test(name)) return 'markdown'
  if (base === 'application/json' || base.endsWith('+json')) return 'json'
  if (base === 'text/plain' || base === 'text/csv') return 'text'
  if (base.startsWith('image/') && base !== 'image/svg+xml') return 'image'
  const unknown = base === '' || base === 'application/octet-stream' || base === 'application/zip'
  if (base === 'application/pdf' || (unknown && /\.pdf$/i.test(name))) return 'pdf'
  if (base === DOCX || (unknown && /\.docx$/i.test(name))) return 'docx'
  if (base === XLSX || (unknown && /\.xlsx$/i.test(name))) return 'xlsx'
  if (base === PPTX || (unknown && /\.pptx$/i.test(name))) return 'pptx'
  return 'none'
}

function size(bytes: number | null | undefined): string | undefined {
  if (typeof bytes !== 'number') return undefined
  if (bytes < 1024) return t`${bytes} B`
  const kb = Math.round(bytes / 1024)
  if (kb < 1024) return t`${kb} KB`
  const mb = (bytes / 1024 / 1024).toFixed(1)
  return t`${mb} MB`
}

export function Document({ id }: { id: string }) {
  useLingui()
  const people = usePrincipals().data
  const artifact = useQuery({ queryKey: ['artifacts', id], queryFn: ({ signal }) => cpGet<Artifact>(`/artifacts/${id}`, signal) })
  const task = useQuery({ ...taskQuery(artifact.data?.taskId ?? ''), enabled: typeof artifact.data?.taskId === 'string' })

  if (artifact.isPending) return <div className="doc" aria-busy="true"><p className="tc-muted">{t`Loading the document…`}</p></div>
  if (artifact.isError) {
    const missing = artifact.error instanceof ApiError && artifact.error.status === 404
    return (
      <div className="doc">
        <PageHeader title={t`Document`} />
        {missing ? <EmptyState title={t`Document not found`} body={t`It may have been removed, or you have no access to it.`} /> : <DegradedBanner.Section text={t`Could not load the document: no connection to the core.`} />}
      </div>
    )
  }

  const a = artifact.data
  const name = a.name || a.type
  const stored = a.contentState === 'stored'
  const contentUrl = `${API}/cp/artifacts/${a.id}/content${a.taskId ? `?forTask=${encodeURIComponent(a.taskId)}` : ''}`
  const external = typeof a.uri === 'string' && EXTERNAL.test(a.uri) ? a.uri : undefined
  const who = people?.get(a.createdByPrincipalId)
  const crumbs = task.data !== undefined ? [{ label: t`← Work`, href: workHref(task.data.publicId) }, { label: task.data.publicId }] : []

  const actions: ReactNode = (
    <div className="doc-tools">
      {stored ? <a className="tc-btn tc-btn-secondary tc-btn-sm" href={contentUrl} download={name}>{t`Download`}</a> : null}
      {stored ? <a className="tc-btn tc-btn-ghost tc-btn-sm" href={contentUrl} target="_blank" rel="noopener noreferrer">{t`Open in a new tab`}</a> : null}
      {external !== undefined ? <a className="tc-btn tc-btn-ghost tc-btn-sm" href={external} target="_blank" rel="noopener noreferrer">{t`Open at the source`}</a> : null}
    </div>
  )

  return (
    <div className="doc">
      <PageHeader crumbs={crumbs} title={name} lead={[a.type, a.mediaType, size(a.sizeBytes)].filter(Boolean).join(' · ')} actions={actions} />
      <div className="doc-grid">
        <Zone label={t`Document`} className="doc-z-body">
          {stored ? <Body artifact={a} url={contentUrl} /> : external !== undefined ? <p className="tc-muted">{t`The document lives in the source system; the core keeps only a link to it.`}</p> : a.content !== null && a.content !== undefined ? <pre className="doc-pre">{JSON.stringify(a.content, null, 2)}</pre> : <p className="tc-muted">{t`The core keeps no content for this document.`}</p>}
        </Zone>
        <Zone title={t`About the document`}>
          <dl className="tc-props">
            <dt>{t`Added`}</dt><dd>{when(a.createdAt)}</dd>
            <dt>{t`By`}</dt><dd>{who !== undefined ? <IdentityBlock kind={executorKind(who)} name={who.displayName} label={initials(who.displayName)} inline size="sm" /> : t`Participant`}</dd>
            <dt>{t`Source`}</dt><dd>{external !== undefined ? <a href={external} target="_blank" rel="noopener noreferrer">{external.replace(/^https?:\/\//, '').slice(0, 60)}</a> : a.runId ? t`result of an executor's attempt` : stored ? t`uploaded to the core` : '—'}</dd>
            {task.data !== undefined ? <><dt>{t`Proves`}</dt><dd><a href={workHref(task.data.publicId)}>{task.data.title}</a></dd></> : null}
            {a.sha256 ? <><dt>{t`Checksum`}</dt><dd className="tc-mono doc-hash" title={a.sha256}>{a.sha256.slice(0, 16)}…</dd></> : null}
          </dl>
        </Zone>
      </div>
    </div>
  )
}

function Body({ artifact, url }: { artifact: Artifact, url: string }) {
  const { i18n } = useLingui()
  const kind = previewOf(artifact.mediaType, artifact.name)
  const limit = kind === 'pdf' ? MAX_PDF_BYTES : kind === 'docx' || kind === 'xlsx' || kind === 'pptx' ? MAX_OFFICE_BYTES : MAX_TEXT_BYTES
  const tooLarge = typeof artifact.sizeBytes === 'number' && artifact.sizeBytes > limit
  const text = useQuery({
    queryKey: ['artifacts', artifact.id, 'text'],
    enabled: (kind === 'markdown' || kind === 'text' || kind === 'json') && !tooLarge,
    staleTime: Infinity,
    queryFn: async ({ signal }) => (await consoleFetch(url, { signal })).text(),
  })
  if (kind === 'image') return <img className="doc-image" src={url} alt={artifact.name} />
  if (kind === 'pdf' && !tooLarge) return <PdfPreview id={artifact.id} url={url} name={artifact.name || artifact.type} />
  if (kind === 'docx' && !tooLarge) return <DocxPreview id={artifact.id} url={url} />
  if (kind === 'xlsx' && !tooLarge) return <XlsxPreview id={artifact.id} url={url} locale={i18n.locale} />
  if (kind === 'pptx' && !tooLarge) return <PptxPreview id={artifact.id} url={url} />
  if (kind === 'none' || tooLarge) {
    return (
      <div className="doc-none">
        <Icon name="file" />
        <p>{tooLarge ? t`The document is too large to show here — download it or open it in a new tab.` : t`This type of document is not shown in the console — download it or open it in a new tab.`}</p>
      </div>
    )
  }
  if (text.isPending) return <p className="tc-muted">{t`Loading…`}</p>
  if (text.isError) return <DegradedBanner.Section text={t`Could not load the content of the document.`} />
  if (kind === 'markdown') return <div className="doc-md"><Markdown text={text.data} /></div>
  if (kind === 'json') {
    let pretty = text.data
    try { pretty = JSON.stringify(JSON.parse(text.data), null, 2) } catch { /* как есть */ }
    return <pre className="doc-pre">{pretty}</pre>
  }
  return <pre className="doc-pre">{text.data}</pre>
}
