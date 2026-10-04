import { t } from '@lingui/core/macro'
import { API, ApiError, consoleFetch, cpGet, cpPatch, cpPost } from '../../api/client.ts'
import type { Artifact, Task } from '../../api/types.ts'

/**
 * Загрузка таблицы в базу знаний (пакет базы знаний: тип `knowledge-import`, скиллы `knowledge.import_*`) — тот
 * же поток, что у команды пакета и агента, из примитивов ядра:
 *
 * 1. работа `knowledge-import` в корне организации: пакет, вид, другие включённые пакеты;
 * 2. файл — содержимое артефакта `knowledge-file` работы (`PUT /artifact-contents`);
 * 3. план — `knowledge.import_plan@1` (без записи), артефакт `knowledge-import-plan` с ним,
 *    сводка — в описании работы, `stateToken` плана — в поле `stateRef`;
 * 4. решение — согласование-ворота работы на того, кто загружает; одобрение по типу работы
 *    вызывает `knowledge.import_apply@1` и закрывает работу. Таблица с ошибками решения не
 *    получает — работа остаётся открытой со списком ошибок.
 *
 * Консоль ничего не пишет в базу знаний сама: запись делает исход решения в ядре.
 */

export const IMPORT_TYPE = 'knowledge-import'
export const FILE_TYPE = 'knowledge-file'
export const PLAN_TYPE = 'knowledge-import-plan'
export const PLAN_SKILL = 'knowledge.import_plan@1'
export const TEMPLATE_SKILL = 'knowledge.template@1'
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** Сколько ждать скилла: план большой таблицы строится минуты (`timeoutSeconds` скилла — 600). */
const WAIT_MS = 10 * 60_000

/**
 * `definitions` — описания включённых пакетов из ядра (`GET /knowledge/packs/{ref}`): исполнитель
 * скиллов знает только пакеты каталога, а `default@1` и пакеты арендатора — нет
 * (`kind_not_found: пакет 'default' не встроен`). Не больше 5 — предел поля.
 */
export interface ImportTarget { workspaceId: string, pack: string, kind: string, packs: string[], definitions: Record<string, unknown>[], kindTitle: string }

export interface PlanCounts { opened?: number, changed?: number, closed?: number, unchanged?: number }
export interface Plan {
  status: 'ok' | 'invalid' | 'empty' | (string & {})
  templateVersion: string
  source: string
  rows: number
  counts: PlanCounts
  stateToken?: string | null
  truncated?: boolean
  conflicts?: Record<string, unknown>[]
  rowErrors?: { row: number, code: string, message: string, column?: string | null }[]
  summary: string
}

export interface Invocation { id: string, status: string, output?: Record<string, unknown> | null, error?: { code?: string, message?: string } | null }

/** Тип содержимого по имени файла: ядро требует `Content-Type`, браузер для CSV его часто не знает. */
export function mediaTypeOf(file: { name: string, type?: string }): string {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) return XLSX
  if (name.endsWith('.csv')) return 'text/csv'
  return file.type !== undefined && file.type !== '' ? file.type : 'application/octet-stream'
}

/** Байты файла в хранилище ядра → `contentRef` для артефакта. */
export async function uploadContent(body: Blob, mediaType: string): Promise<{ contentRef: string }> {
  const response = await consoleFetch(`${API}/cp/artifact-contents`, { method: 'PUT', headers: { 'content-type': mediaType, accept: 'application/json' }, body })
  return await response.json() as { contentRef: string }
}

/** Ждать вызов скилла до конца; `onQueued` — пока его не взял исполнитель. */
export async function waitInvocation(id: string, { signal, onQueued, timeoutMs = WAIT_MS }: { signal?: AbortSignal, onQueued?: () => void, timeoutMs?: number } = {}): Promise<Invocation> {
  const until = Date.now() + timeoutMs
  let told = false
  for (let delay = 1000; ; delay = Math.min(delay * 1.5, 5000)) {
    const inv = await cpGet<Invocation>(`/skill-invocations/${id}`, signal)
    if (['succeeded', 'failed', 'cancelled'].includes(inv.status)) return inv
    if (inv.status === 'pending' && !told) { told = true; onQueued?.() }
    if (Date.now() > until) throw new ApiError(504, 'skill_timeout', t`the skill did not answer in time — the work stays open, build the plan again later`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    })
  }
}

async function runSkill<T>(skill: string, inputs: Record<string, unknown>, taskId: string | undefined, onQueued: () => void): Promise<T> {
  const inv = await cpPost<Invocation>(`/skills/${skill}:invoke`, { inputs, ...(taskId !== undefined ? { taskId } : {}) })
  const done = await waitInvocation(inv.id, { onQueued })
  if (done.status !== 'succeeded' || done.output === null || done.output === undefined) {
    throw new ApiError(422, done.error?.code ?? done.status, done.error?.message ?? done.status)
  }
  return done.output as T
}

export type Step = (text: string, state?: 'wait' | 'done') => void

/** Поля работы `knowledge-import` (тип объявляет их строго, `additionalProperties: false`). */
export function importFields(target: ImportTarget): Record<string, unknown> {
  return { pack: target.pack, kind: target.kind, packs: target.packs, ...(target.definitions.length > 0 ? { definitions: target.definitions } : {}) }
}

/** Работа, файл и план; решение — если таблица прошла проверку. */
export async function startImport(target: ImportTarget, file: File, me: string, step: Step, onTask: (task: Task) => void = () => {}): Promise<{ task: Task, plan: Plan }> {
  step(t`Raising the work…`)
  const filename = file.name
  const task = await cpPost<Task>('/tasks', {
    title: t`Load into the knowledge base: ${target.kindTitle} from ${filename}`,
    description: t`Building the load plan…`,
    typeKey: IMPORT_TYPE, workspaceId: target.workspaceId, customFields: importFields(target), origin: { kind: 'human' },
  }, crypto.randomUUID())
  onTask(task)
  step(t`Work raised: ${task.publicId}`, 'done')
  step(t`Uploading the file…`)
  const content = await uploadContent(file, mediaTypeOf(file))
  const artifact = await cpPost<Artifact>('/artifacts', {
    type: FILE_TYPE, name: filename, task: task.publicId, contentRef: content.contentRef,
    metadata: { filename, pack: target.pack, kind: target.kind },
  })
  step(t`File attached to the work`, 'done')
  const plan = await planImport(task, artifact.id, filename, me, step)
  return { task, plan }
}

/** План по файлу работы — и первый, и заново (база изменилась с плана или поток прервался). */
export async function planImport(task: Task, fileArtifactId: string, filename: string, me: string, step: Step): Promise<Plan> {
  const fields = (task.customFields ?? {}) as Record<string, unknown>
  step(t`Checking the table and building the plan…`)
  const inputs: Record<string, unknown> = {
    fileArtifactId, workspaceId: task.workspaceId, pack: fields.pack, kind: fields.kind,
    packs: fields.packs ?? [], filename,
  }
  for (const name of ['profile', 'source', 'definitions']) if (fields[name] !== undefined && fields[name] !== '') inputs[name] = fields[name]
  const plan = await runSkill<Plan>(PLAN_SKILL, inputs, task.id, () => step(t`Waiting for the skill executor to pick the plan up…`))
  step(planLine(plan), 'done')

  const stored = await uploadContent(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), 'application/json')
  const version = plan.templateVersion
  await cpPost<Artifact>('/artifacts', {
    type: PLAN_TYPE, name: t`Load plan ${version}`, task: task.publicId, contentRef: stored.contentRef,
    metadata: { templateVersion: plan.templateVersion, status: plan.status, counts: plan.counts, fileArtifactId },
  })
  const current = await cpGet<Task>(`/tasks/${task.id}`)
  await cpPatch<Task>(`/tasks/${task.id}`, {
    description: plan.summary,
    // не stateToken: ключ поля со словом token ядро отвергает как секрет
    customFields: { ...(current.customFields ?? {}), fileArtifactId, filename, planStatus: plan.status, stateRef: plan.stateToken ?? '' },
  }, current.version)
  if (plan.status === 'ok') {
    step(t`Asking for your decision…`)
    await cpPost('/approvals', { task: task.publicId, assignedPrincipalId: me, gate: true, comment: t`Apply the load plan to the knowledge base` }, crypto.randomUUID())
    step(t`Plan ready — nothing is written until you approve it`, 'done')
  }
  return plan
}

/** Итог плана одной строкой. */
export function planLine(plan: Plan): string {
  const { opened = 0, changed = 0, closed = 0, unchanged = 0 } = plan.counts ?? {}
  const errors = plan.rowErrors?.length ?? 0
  if (plan.status === 'invalid') return t`The table has errors: ${errors} — fix the file and load it again`
  if (plan.status === 'empty') return t`The table has no rows`
  return t`Plan: ${opened} new, ${changed} changed, ${closed} closed, ${unchanged} unchanged`
}

/** Шаблон загрузки вида: файл приходит в ответе скилла (`contentBase64`), сохраняется в браузере. */
export async function downloadTemplate(target: Omit<ImportTarget, 'workspaceId' | 'kindTitle'>, format: 'xlsx' | 'csv', onQueued: () => void): Promise<string> {
  const out = await runSkill<{ filename: string, mediaType: string, contentBase64: string }>(TEMPLATE_SKILL, { pack: target.pack, kind: target.kind, packs: target.packs, ...(target.definitions.length > 0 ? { definitions: target.definitions } : {}), format }, undefined, onQueued)
  const bytes = Uint8Array.from(atob(out.contentBase64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: out.mediaType }))
  const a = document.createElement('a')
  a.href = url
  a.download = out.filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return out.filename
}
