import { t } from '@lingui/core/macro'
import { ApiError, cpGet, cpPatch, cpPost } from '../../api/client.ts'
import type { Artifact, Page, Task } from '../../api/types.ts'
import { FILE_TYPE, mediaTypeOf, uploadContent, type ImportTarget, type Step } from './importFlow.ts'

/**
 * Документ в базу знаний (пакет базы знаний: тип `knowledge-document`, скиллы `knowledge.document_*`) — тот же
 * поток, что у команды пакета, из примитивов ядра:
 *
 * 1. файл — артефакт `knowledge-file` пространства (без работы);
 * 2. работа `knowledge-document` сразу в начальном статусе с полным входом извлечения: пакет и
 *    вид, `fileArtifactId`, `filename`; владелец — тот, кто решает (загружающий). Ядро не
 *    заводит работу в `blocked` (только начальный статус или `backlog`) и не прячет `blocked`
 *    от исполнителей, поэтому «работа без файла» была бы гонкой — файл раньше работы;
 * 3. извлечение `knowledge.document_extract@1` — шаг исполнения типа: хост скиллов берёт работу,
 *    сохраняет документ в базе знаний и сдаёт прогон; выход — артефакт `skill_result`, сдача
 *    открывает проверку, и ядро запрашивает решение у владельца;
 * 4. консоль переносит выход в работу: сводку с цитатами — в описание, `documentKey`,
 *    `textStatus`, `attributes`, `key`, `title` — в поля (`syncExtraction`). Без этого критерий
 *    `apply` провалится на `documentKey`, поэтому перенос делает и страница работы, если поток
 *    прервался (вкладку закрыли);
 * 5. человек правит поля на странице работы и решает; одобрение по типу работы записывает
 *    сущность (`knowledge.document_apply@1`), отказ отменяет работу.
 *
 * Консоль ничего не пишет в базу знаний сама: запись делает исход решения в ядре.
 */

export const DOCUMENT_TYPE = 'knowledge-document'
export const EXTRACT_SKILL = 'knowledge.document_extract@1'
/** Извлечение большого документа (OCR) идёт минуты; дольше — страница работы доведёт сама. */
const WAIT_MS = 9 * 60_000

export interface Extraction {
  documentKey: string
  textStatus: 'text' | 'ocr' | 'needs_manual_input' | (string & {})
  attributes: Record<string, unknown>
  proposal?: { key?: string | null, title?: string | null } | null
  summary?: string
}

/** Поля работы до извлечения: `packs`, `links`, `definitions` — всегда массивы (вход скилла применения не принимает null). */
export function documentFields(target: ImportTarget): Record<string, unknown> {
  return { pack: target.pack, kind: target.kind, packs: target.packs, links: [], definitions: target.definitions }
}

/** Извлечение закончено: прогон сдан — открыта проверка (или работа уже закрыта). */
export const extracted = (task: Task): boolean => task.verification !== null && task.verification !== undefined

/**
 * Перенести выход извлечения в работу; уже перенесён (`documentKey` есть) — ничего не делать.
 * `null` — выхода ещё нет (исполнитель не сдал прогон).
 */
export async function syncExtraction(task: Task, signal?: AbortSignal): Promise<Extraction | null> {
  const fields = (task.customFields ?? {}) as Record<string, unknown>
  if (typeof fields.documentKey === 'string' && fields.documentKey !== '') return null
  const page = await cpGet<Page<Artifact>>(`/artifacts?taskId=${task.id}&type=skill_result&limit=50`, signal)
  const newest = page.items.filter(a => a.name === EXTRACT_SKILL).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (newest === undefined) return null
  const full = await cpGet<Artifact & { content?: { output?: Extraction } | null }>(`/artifacts/${newest.id}`, signal)
  const out = full.content?.output
  if (out === undefined || typeof out.documentKey !== 'string') throw new ApiError(422, 'extraction_unreadable', t`the result of the extraction has no document key`)
  const current = await cpGet<Task>(`/tasks/${task.id}`, signal)
  await cpPatch<Task>(`/tasks/${task.id}`, {
    ...(typeof out.summary === 'string' && out.summary !== '' ? { description: out.summary } : {}),
    customFields: {
      ...(current.customFields ?? {}),
      documentKey: out.documentKey, textStatus: out.textStatus, attributes: out.attributes ?? {},
      key: out.proposal?.key ?? '', title: out.proposal?.title ?? '',
    },
  }, current.version)
  return out
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
  })
}

/** Ждать сдачи прогона извлечения; работа остановилась (blocked, закрыта) — отказ словами. */
export async function waitExtraction(ref: string, { signal, onTaken }: { signal?: AbortSignal, onTaken?: () => void } = {}): Promise<Task> {
  const until = Date.now() + WAIT_MS
  let told = false
  for (let delay = 1500; ; delay = Math.min(delay * 1.4, 5000)) {
    const task = await cpGet<Task>(`/tasks/${encodeURIComponent(ref)}`, signal)
    if (extracted(task)) return task
    if (task.activeClaimId !== null && !told) { told = true; onTaken?.() }
    if (task.systemStatusCategory === 'blocked' || task.systemStatusCategory.startsWith('terminal')) {
      const status = task.status
      throw new ApiError(409, 'extraction_stopped', t`the work stopped (${status}) — see its page`)
    }
    if (Date.now() > until) throw new ApiError(504, 'extraction_timeout', t`the document is still being read — the work page finishes it when the executor hands in`)
    await sleep(delay, signal)
  }
}

/** Файл, работа, извлечение и перенос полей; решение запрашивает ядро. */
export async function startDocument(target: ImportTarget, file: File, me: string, step: Step, onTask: (task: Task) => void = () => {}): Promise<{ task: Task, extraction: Extraction | null }> {
  step(t`Uploading the file…`)
  const filename = file.name
  const content = await uploadContent(file, mediaTypeOf(file))
  const artifact = await cpPost<Artifact>('/artifacts', {
    type: FILE_TYPE, name: filename, workspaceId: target.workspaceId, contentRef: content.contentRef,
    metadata: { filename, pack: target.pack, kind: target.kind },
  })
  step(t`File uploaded`, 'done')
  step(t`Raising the work…`)
  const task = await cpPost<Task>('/tasks', {
    title: t`Document into the knowledge base: ${filename}`,
    description: t`Reading the text and the fields of the document…`,
    typeKey: DOCUMENT_TYPE, workspaceId: target.workspaceId, ownerId: me,
    customFields: { ...documentFields(target), fileArtifactId: artifact.id, filename }, origin: { kind: 'human' },
  }, crypto.randomUUID())
  onTask(task)
  const ref = task.publicId
  step(t`Work raised: ${ref} — queued for reading`, 'done')
  step(t`Waiting for the skill executor to read the document…`)
  const handed = await waitExtraction(task.publicId, { onTaken: () => step(t`The executor is reading the document…`) })
  step(t`Document read`, 'done')
  step(t`Putting the proposed fields into the work…`)
  const out = await syncExtraction(handed)
  step(t`Fields proposed — check them on the work page and decide`, 'done')
  return { task, extraction: out }
}
