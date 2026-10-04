/**
 * Мир стенда разработки: организация «Полярис» из сценариев макета (docs/screens/). Формы
 * объектов — как у ядра (TaskOut, ApprovalOut, RunOut, ClaimOut, PrincipalOut, EventOut,
 * `GET /me/attention`, `GET /harness/context`); значения выдуманы. Время считается от
 * запуска стенда: «сегодня» всегда сегодня.
 */
import { randomUUID } from 'node:crypto'
import { sampleDocx, samplePptx, sampleXlsx } from './office.ts'

export const TENANT = 'a1000000-0000-4000-8000-0000000000a1'
export const WORKSPACE = 'b2000000-0000-4000-8000-0000000000b2'
/** Пространства внутри организации: работы счетов — в «Финансах», заявки — в «Тендерах». */
export const FINANCE = 'b2000000-0000-4000-8000-0000000000f1'
export const TENDERS = 'b2000000-0000-4000-8000-0000000000f2'
export const spaceOf = (typeKey: string): string => typeKey === 'tender-bid' ? TENDERS : typeKey.startsWith('invoice') ? FINANCE : WORKSPACE
/** Пространство и его потомки (как `includeDescendants` ядра). */
export const subtree = (id: string): Set<string> => id === WORKSPACE ? new Set([WORKSPACE, FINANCE, TENDERS]) : new Set([id])

export interface Principal { id: string, tenantId: string, kind: 'human' | 'agent' | 'service', displayName: string, status: 'active' | 'disabled', metadata: Record<string, unknown>, createdAt: string, updatedAt: string }
export interface Task {
  id: string, tenantId: string, publicId: string, workspaceId: string, projectId: string | null, typeId: string, typeKey: string, typeVersion: number,
  title: string, description: string | null, status: string, systemStatusCategory: string, priority: string | null, ownerId: string | null, assigneeId: string | null,
  customFields: Record<string, unknown>, startDate: string | null, dueDate: string | null, goalId: string | null, origin: Record<string, unknown>,
  acceptance: Record<string, unknown>[], evidence: Record<string, unknown>[], version: number, claimEpoch: number, activeClaimId: string | null, createdBy: string,
  createdAt: string, updatedAt: string, completedAt: string | null, verification: Record<string, unknown> | null
}
export interface Approval {
  id: string, tenantId: string, workspaceId: string, taskId: string | null, artifactId: string | null, requestedByPrincipalId: string,
  status: 'pending' | 'approved' | 'rejected' | 'cancelled', gate: boolean, requiredRoleId: string | null, assignedPrincipalId: string | null,
  decisionByPrincipalId: string | null, decisionAt: string | null, comment: string | null, version: number, outcomeStatus: string | null,
  excludedPrincipals: string[], createdAt: string, updatedAt: string
}
export interface Run { id: string, tenantId: string, taskId: string, claimId: string, principalId: string, attempt: number, status: string, startedAt: string, finishedAt: string | null, failureReason: unknown, createdAt: string, updatedAt: string }
export interface Claim { id: string, tenantId: string, taskId: string, sessionId: string | null, holderId: string, status: string, fencingToken: number, intent: string, acquiredAt: string, heartbeatAt: string, expiresAt: string, releasedAt: string | null, releaseReason: string | null }
export interface JournalEvent {
  sequence: number, id: string, tenantId: string, type: string, entityType: string, entityId: string, actorId: string | null, sessionId: null,
  correlationId: string, causationId: null, requestId: string, traceRunId: null, iamActorId: null, workspaceId: string, schemaVersion: number,
  payload: Record<string, unknown>, occurredAt: string, cursor: string
}

const START = Date.now()
const startOfDay = (): number => { const d = new Date(START); d.setHours(0, 0, 0, 0); return d.getTime() }
const DAY_FROM = 8 * 60
const DAY_TO = 14 * 60 + 5
/**
 * Время дня сценария (08:00–14:05) по местному времени стенда. Если стенд запущен раньше
 * 14:05, день сценария сжимается в промежуток от полуночи до запуска: события всегда
 * «сегодня» и всегда в прошлом.
 */
export function today(hh: number, mm: number): string {
  const minute = hh * 60 + mm
  const day = startOfDay()
  if (START >= day + DAY_TO * 60_000) return new Date(day + minute * 60_000).toISOString()
  const share = Math.min(1, Math.max(0, (minute - DAY_FROM) / (DAY_TO - DAY_FROM)))
  return new Date(day + 60_000 + share * Math.max(0, START - day - 120_000)).toISOString()
}
/**
 * Срок «сегодня в hh:mm» по настоящим часам: события дня стенд сжимает до момента запуска
 * (`today`), а сроки — в будущем; прошедший час сценария — через столько же часов от запуска,
 * сколько он отстоит от конца сценарного дня, чтобы срок не выглядел просроченным.
 */
export function deadline(hh: number, mm = 0): string {
  const d = new Date(START)
  d.setHours(hh, mm, 0, 0)
  if (d.getTime() > START) return d.toISOString()
  return new Date(START + Math.max(1, hh * 60 + mm - DAY_TO) * 60_000 + 60 * 60_000).toISOString()
}
export const daysAgo = (n: number, hh = 10): string => new Date(startOfDay() - n * 86_400_000 + hh * 3_600_000).toISOString()

const person = (id: string, kind: Principal['kind'], displayName: string, metadata: Record<string, unknown> = {}): Principal =>
  ({ id, tenantId: TENANT, kind, displayName, status: 'active', metadata, createdAt: daysAgo(90), updatedAt: daysAgo(90) })

export const ME = 'c3000000-0000-4000-8000-0000000000c3'
export const P = {
  me: person(ME, 'human', 'Антон Белов'),
  ivan: person('c3000000-0000-4000-8000-000000000001', 'human', 'Иван Сорокин'),
  irina: person('c3000000-0000-4000-8000-000000000002', 'human', 'Ирина Котова'),
  maria: person('c3000000-0000-4000-8000-000000000003', 'human', 'Мария Лебедева'),
  reconciler: person('c3000000-0000-4000-8000-000000000011', 'agent', 'Сверщик счетов', { agentKey: 'reconciler' }),
  checker: person('c3000000-0000-4000-8000-000000000012', 'agent', 'Проверяющий заявки', { agentKey: 'bid-checker' }),
  preparer: person('c3000000-0000-4000-8000-000000000013', 'agent', 'Подготовщик заявок', { agentKey: 'bid-preparer' }),
  crmObserver: person('c3000000-0000-4000-8000-000000000014', 'agent', 'Наблюдатель CRM', { agentKey: 'crm-observer' }),
  payments: person('c3000000-0000-4000-8000-000000000021', 'service', 'Оплата счетов', { agentKey: 'invoice-process' }),
  invoiceRule: person('c3000000-0000-4000-8000-000000000022', 'service', 'Правило «Счёт получен»', { agentKey: 'invoice-rules' }),
}
export const principals: Principal[] = Object.values(P)

let taskSeq = 900
/** Типы, у которых приёмка — решение человека (критерий kind: human). */
const HUMAN_CHECK = new Set(['tender-bid', 'contract-sign'])

function task(fields: Partial<Task> & { title: string, typeKey: string }, publicId?: string): Task {
  const at = fields.createdAt ?? today(9, 0)
  return {
    id: randomUUID(), tenantId: TENANT, publicId: publicId ?? `TASK-000${++taskSeq}`, workspaceId: spaceOf(fields.typeKey), projectId: null,
    typeId: randomUUID(), typeVersion: 1, description: null, status: 'todo', systemStatusCategory: 'active', priority: null,
    ownerId: ME, assigneeId: null, customFields: {}, startDate: null, dueDate: null, goalId: null, origin: { kind: 'human' },
    acceptance: HUMAN_CHECK.has(fields.typeKey) ? [{ key: 'signed-off', kind: 'human', description: 'Принято человеком', spec: {} }] : [], evidence: [], version: 1, claimEpoch: 0, activeClaimId: null, createdBy: ME, createdAt: at, updatedAt: at,
    completedAt: null, verification: null, ...fields,
  }
}

export const tasks: Task[] = [
  task({ title: 'Согласовать оплату счёта №417 «Альфа-Снаб», 184 500 ₽', typeKey: 'invoice-approval', status: 'approval', systemStatusCategory: 'active', assigneeId: ME, createdBy: P.invoiceRule.id, origin: { kind: 'rule', ref: 'invoice-received' }, createdAt: today(12, 36), dueDate: deadline(18, 0) }, 'TASK-000840'),
  task({ title: 'Сверить счёт №421 «Вектор»', typeKey: 'invoice-reconcile', status: 'in_progress', systemStatusCategory: 'active', assigneeId: P.reconciler.id, createdBy: P.payments.id, origin: { kind: 'process', ref: 'process/e5000000-0000-4000-8000-000000000421/reconcile' }, createdAt: today(11, 40), verification: { id: randomUUID(), status: 'failed', attempt: 2, updatedAt: today(13, 12) } }, 'TASK-000421'),
  task({ title: 'Принять заявку на тендер №0373200041', typeKey: 'tender-bid', status: 'review', systemStatusCategory: 'active', assigneeId: P.preparer.id, ownerId: ME, createdAt: daysAgo(1), dueDate: deadline(23, 0) }, 'TASK-000836'),
  task({ title: 'Подать заявку на тендер №0373200057', typeKey: 'tender-bid', status: 'in_progress', systemStatusCategory: 'active', assigneeId: P.irina.id, createdAt: today(9, 15), dueDate: deadline(16, 0) }, 'TASK-000845'),
  task({ title: 'Подписать договор поставки №88', typeKey: 'contract-sign', status: 'in_progress', systemStatusCategory: 'active', assigneeId: P.ivan.id, createdAt: daysAgo(2), dueDate: deadline(18, 0) }, 'TASK-000838'),
  task({ title: 'Сверить счёт №424 «Северсталь-Трейд»', typeKey: 'invoice-reconcile', status: 'in_progress', systemStatusCategory: 'active', assigneeId: P.reconciler.id, createdBy: P.payments.id, origin: { kind: 'process', ref: 'process/e5000000-0000-4000-8000-000000000424/reconcile' }, createdAt: today(13, 30) }, 'TASK-000847'),
  task({ title: 'Подготовить заявку на тендер №0373200063', typeKey: 'tender-bid', status: 'todo', systemStatusCategory: 'active', assigneeId: P.preparer.id, createdAt: today(12, 50), dueDate: daysAgo(-1, 10) }, 'TASK-000848'),
  task({ title: 'Подготовить заявку на тендер №0373200064', typeKey: 'tender-bid', status: 'backlog', systemStatusCategory: 'backlog', assigneeId: P.preparer.id, createdAt: today(12, 52) }, 'TASK-000849'),
  task({ title: 'Обновить реквизиты «Альфа-Снаб» в 1С', typeKey: 'free', status: 'blocked', systemStatusCategory: 'blocked', assigneeId: P.ivan.id, createdAt: daysAgo(2), dueDate: daysAgo(-2, 12) }, 'TASK-000851'),
  task({ title: 'Проверить счёт №430: ООО «Альфа-Снаб»', typeKey: 'invoice-review', status: 'todo', systemStatusCategory: 'active', assigneeId: ME, createdBy: P.payments.id, origin: { kind: 'process', ref: 'process/e5000000-0000-4000-8000-000000000430/check-invoice' }, createdAt: today(13, 50), dueDate: deadline(18, 0) }, 'TASK-000852'),
  task({ title: 'Сверить счёт №426 «Полюс»', typeKey: 'invoice-reconcile', status: 'blocked', systemStatusCategory: 'blocked', assigneeId: P.reconciler.id, createdBy: P.payments.id, createdAt: today(9, 5), verification: { id: randomUUID(), status: 'failed', attempt: 3, updatedAt: today(10, 40) } }, 'TASK-000853'),
  task({ title: 'Проверить договор с «Вектор»', typeKey: 'free', status: 'todo', systemStatusCategory: 'active', assigneeId: null, createdAt: today(9, 50), dueDate: deadline(18, 0) }, 'TASK-000855'),
  task({ title: 'Запросить у «Вектора» акт сверки за сентябрь', typeKey: 'free', status: 'todo', systemStatusCategory: 'active', assigneeId: null, createdAt: today(10, 5) }, 'TASK-000850'),
  task({ title: 'Оплатить счёт №412 «Вектор», 96 000 ₽', typeKey: 'invoice-approval', status: 'paid', systemStatusCategory: 'terminal_success', assigneeId: P.payments.id, createdAt: daysAgo(1), completedAt: today(12, 45), verification: { id: randomUUID(), status: 'passed', attempt: 1, updatedAt: today(12, 50) } }, 'TASK-000832'),
  task({ title: 'Сверить счёт №415', typeKey: 'invoice-reconcile', status: 'done', systemStatusCategory: 'terminal_success', assigneeId: P.reconciler.id, createdAt: today(9, 40), completedAt: today(12, 20), verification: { id: randomUUID(), status: 'passed', attempt: 1, updatedAt: today(12, 50) } }, 'TASK-000839'),
  task({ title: 'Подать заявку №0373200038', typeKey: 'tender-bid', status: 'done', systemStatusCategory: 'terminal_success', assigneeId: P.irina.id, createdAt: daysAgo(3), completedAt: today(11, 10), verification: { id: randomUUID(), status: 'passed', attempt: 1, updatedAt: today(12, 50) } }, 'TASK-000820'),
]
/** Типы работы (`TaskTypeOut`, только поля, которые читает консоль). */
/** Критерии приёмки типов (`acceptance` типа работы, форма ядра). */
const ACCEPTANCE: Record<string, { key: string, kind: string, description: string, spec: Record<string, unknown> }[]> = {
  'invoice-reconcile': [
    { key: 'amount-matches-act', kind: 'deterministic', description: 'Сумма в счёте совпадает с актом сверки из 1С', spec: {} },
    { key: 'requisites-match', kind: 'deterministic', description: 'Реквизиты поставщика совпадают с договором', spec: {} },
  ],
  'invoice-approval': [
    { key: 'paid', kind: 'external_state', description: 'Платёж прошёл по выписке банка', spec: {} },
    { key: 'signed-off', kind: 'human', description: 'Оплату согласовал руководитель', spec: {} },
  ],
  'tender-bid': [{ key: 'signed-off', kind: 'human', description: 'Заявку принял руководитель тендерного отдела', spec: {} }],
  'contract-sign': [{ key: 'signed-off', kind: 'human', description: 'Договор подписан', spec: {} }],
  'knowledge-document': [{ key: 'apply', kind: 'human', description: 'Владелец проверил поля и одобрил запись', spec: {} }],
}

export const taskTypes = ([
  ['invoice-approval', 'Оплата счёта'], ['invoice-reconcile', 'Сверка счёта'], ['tender-bid', 'Заявка на тендер'],
  ['contract-sign', 'Подписание договора'], ['free', 'Свободная работа'], ['invoice-review', 'Проверка счёта'], ['knowledge-import', 'Загрузка в базу знаний'],
  ['knowledge-document', 'Документ в базу знаний'],
] as const).map(([key, displayName]) => ({ id: randomUUID(), tenantId: TENANT, key, version: 1, displayName, description: '', status: 'active', package: null, createdBy: ME, createdAt: daysAgo(30), updatedAt: daysAgo(30), acceptance: ACCEPTANCE[key] ?? [] }))

export const byRef = (ref: string): Task | undefined => tasks.find(t => t.publicId === ref || t.id === ref)
const T = (ref: string): Task => byRef(ref)!

export const approvals: Approval[] = [
  {
    id: 'd4000000-0000-4000-8000-000000000417', tenantId: TENANT, workspaceId: WORKSPACE, taskId: T('TASK-000840').id, artifactId: null,
    requestedByPrincipalId: P.payments.id, status: 'pending', gate: false, requiredRoleId: null, assignedPrincipalId: ME, decisionByPrincipalId: null,
    decisionAt: null, comment: null, version: 1, outcomeStatus: null, excludedPrincipals: [], createdAt: today(12, 37), updatedAt: today(12, 37),
  },
  {
    id: 'd4000000-0000-4000-8000-000000000041', tenantId: TENANT, workspaceId: WORKSPACE, taskId: T('TASK-000836').id, artifactId: null,
    requestedByPrincipalId: P.preparer.id, status: 'pending', gate: true, requiredRoleId: null, assignedPrincipalId: ME, decisionByPrincipalId: null,
    decisionAt: null, comment: null, version: 1, outcomeStatus: null, excludedPrincipals: [], createdAt: today(11, 2), updatedAt: today(11, 2),
  },
]

const claim = (ref: string, holder: Principal, at: string): Claim => ({
  id: randomUUID(), tenantId: TENANT, taskId: T(ref).id, sessionId: null, holderId: holder.id, status: 'active', fencingToken: 1, intent: 'execute',
  acquiredAt: at, heartbeatAt: new Date(START).toISOString(), expiresAt: new Date(START + 300_000).toISOString(), releasedAt: null, releaseReason: null,
})
export const claims: Claim[] = [
  claim('TASK-000845', P.irina, today(14, 0)),
  claim('TASK-000838', P.ivan, daysAgo(1)),
  claim('TASK-000847', P.reconciler, today(13, 56)),
  claim('TASK-000421', P.reconciler, today(11, 42)),
]
for (const c of claims) { const t = T(tasks.find(t => t.id === c.taskId)!.publicId); t.activeClaimId = c.id; t.claimEpoch = 1 }

const run = (ref: string, who: Principal, attempt: number, status: string, at: string, failureReason: unknown = null): Run => {
  const t = T(ref)
  return {
    id: randomUUID(), tenantId: TENANT, taskId: t.id, claimId: t.activeClaimId ?? randomUUID(), principalId: who.id, attempt, status, startedAt: at,
    finishedAt: status === 'running' ? null : at, failureReason, createdAt: at, updatedAt: at,
  }
}
export const runs: Run[] = [
  run('TASK-000847', P.reconciler, 2, 'running', today(13, 56)),
  run('TASK-000421', P.reconciler, 1, 'failed', today(13, 2), { code: 'verification_failed', message: 'сумма не совпадает с актом' }),
  run('TASK-000421', P.reconciler, 2, 'failed', today(13, 12), { code: 'verification_failed', message: 'сумма не совпадает с актом' }),
  run('TASK-000848', P.preparer, 1, 'failed', today(12, 50), { code: 'agent_start_failed', message: 'агент не запустился' }),
]

// ------------------------------------------------------------------ одна работа: проверки, материалы, обсуждение, связи

/** Попытки проверки (`TaskVerificationOut`): критерии — как были при открытии, результаты — по пройденным. */
export const verifications: Record<string, unknown>[] = [
  {
    id: randomUUID(), tenantId: TENANT, taskId: T('TASK-000840').id, attempt: 1, status: 'waiting_human', trigger: 'complete', triggerRef: null, authorityPrincipalId: P.payments.id,
    checks: [
      { key: 'amount-matches-act', kind: 'deterministic', description: 'Сумма в счёте совпадает с актом сверки', spec: {} },
      { key: 'requisites-match', kind: 'deterministic', description: 'Реквизиты поставщика совпадают с договором', spec: {} },
      { key: 'contract-active', kind: 'external_state', description: 'Договор №АС-12 действует', spec: {} },
      { key: 'signed-off', kind: 'human', description: 'Оплату согласовал руководитель', spec: {} },
    ],
    results: [
      { key: 'amount-matches-act', kind: 'deterministic', status: 'passed', evidence: [] },
      { key: 'requisites-match', kind: 'deterministic', status: 'passed', evidence: [] },
      { key: 'contract-active', kind: 'external_state', status: 'passed', evidence: [] },
    ],
    cursor: 3, skillInvocationId: null, approvalId: 'd4000000-0000-4000-8000-000000000417', nextCheckAt: null, startedAt: today(12, 37), finishedAt: null, updatedAt: today(12, 37),
  },
  ...[1, 2].map(attempt => ({
    id: randomUUID(), tenantId: TENANT, taskId: T('TASK-000421').id, attempt, status: 'failed', trigger: 'complete', triggerRef: null, authorityPrincipalId: P.payments.id,
    checks: [
      { key: 'amount-matches-act', kind: 'deterministic', description: 'Сумма в счёте совпадает с актом сверки из 1С', spec: {} },
      { key: 'requisites-match', kind: 'deterministic', description: 'Реквизиты поставщика совпадают с договором', spec: {} },
    ],
    results: [{ key: 'amount-matches-act', kind: 'deterministic', status: 'failed', evidence: [], reason: 'mismatch', message: 'сумма 99 600 ₽ не совпадает с актом сверки 96 000 ₽' }],
    cursor: 0, skillInvocationId: null, approvalId: null, nextCheckAt: null, startedAt: today(13, attempt === 1 ? 2 : 12), finishedAt: today(13, attempt === 1 ? 2 : 12), updatedAt: today(13, attempt === 1 ? 2 : 12),
  })).reverse(),
  // Три провала подряд — ядро остановило работу (CP-ADR-0067 §5).
  ...[1, 2, 3].map(attempt => ({
    id: randomUUID(), tenantId: TENANT, taskId: T('TASK-000853').id, attempt, status: 'failed', trigger: 'complete', triggerRef: null, authorityPrincipalId: P.payments.id,
    checks: [{ key: 'act-attached', kind: 'deterministic', description: 'К сверке приложен акт сверки из 1С', spec: {} }],
    results: [{ key: 'act-attached', kind: 'deterministic', status: 'failed', evidence: [], reason: 'missing', message: 'в 1С нет акта сверки с «Полюсом» за сентябрь' }],
    cursor: 0, skillInvocationId: null, approvalId: null, nextCheckAt: null, startedAt: today(10, attempt * 10), finishedAt: today(10, attempt * 10 + 10), updatedAt: today(10, attempt * 10 + 10),
  })).reverse(),
]

const PROTOCOL = (name: string): string => `# ${name}

Агент «Сверщик счетов» сверил счёт с актом сверки из 1С.

| Что | Счёт | Акт сверки | Итог |
|---|---|---|---|
| Сумма | 99 600 ₽ | 96 000 ₽ | **не совпадает** |
| Контрагент | АО «Вектор» | АО «Вектор» | совпадает |
| Договор | В-7 | В-7 | совпадает |

Разница 3 600 ₽ — вероятно, доставка, которой нет в акте. Нужен исправленный счёт.

<script>alert('этот скрипт не должен исполниться')</script>
`

/**
 * Маленький корректный PDF (ASCII, шрифт Helvetica): страницы — строки текста. Смещения xref
 * считаются по байтам — pdf.js читает файл как настоящий.
 */
export function samplePdf(pages: string[][]): string {
  const objs: string[] = []
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  const font = 3 + pages.length * 2
  pages.forEach((lines, i) => {
    const stream = ['BT', '/F1 14 Tf', '72 770 Td', '18 TL', ...lines.map(l => `(${l.replace(/[()\\]/g, '')}) Tj T*`), 'ET'].join('\n')
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let out = '%PDF-1.4\n'
  const offsets = objs.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

const INVOICE_430 = samplePdf([
  ['Invoice No. 430', 'Supplier: Alfa-Snab LLC, TIN 7701234567', 'Agreement AS-12', 'Amount: 42 750.00 RUB', 'Due: within 5 working days'],
  ['Page 2: specification', '1. Consumables - 30 pcs - 42 750.00 RUB'],
])

/** Материалы (`ArtifactOut`): счёт и акт — ссылки на внешнюю систему, протокол — содержимое в ядре. */
export const artifacts: Record<string, unknown>[] = [
  ['TASK-000840', 'document', 'Счёт №417.pdf', 'https://example.org/1c/invoices/417.pdf', P.invoiceRule, 225_280, 'application/pdf', today(12, 36)],
  ['TASK-000840', 'document', 'Акт сверки с «Альфа-Снаб»', 'https://example.org/1c/acts/417', P.reconciler, null, null, today(12, 36)],
  ['TASK-000840', 'report', 'Протокол сверки', null, P.reconciler, 4_096, 'text/markdown', today(12, 37)],
  ['TASK-000421', 'report', 'Протокол сверки, попытка 2', null, P.reconciler, 3_120, 'text/markdown', today(13, 12)],
  ['TASK-000852', 'document', 'Счёт №430.pdf', null, P.payments, INVOICE_430.length, 'application/pdf', today(13, 50)],
].map(([ref, type, name, uri, who, sizeBytes, mediaType, at]) => ({
  id: randomUUID(), tenantId: TENANT, workspaceId: WORKSPACE, taskId: T(ref as string).id, runId: null, createdByPrincipalId: (who as Principal).id, type, name, uri,
  content: null, supersedesArtifactId: null, metadata: {}, contentState: uri === null ? 'stored' : 'external', sizeBytes, mediaType, sha256: uri === null ? 'c0ffee'.repeat(10) + 'abcd' : null, typeVersion: 1, createdAt: at,
  // Содержимое в хранилище стенда (отдаёт GET /artifacts/{id}/content).
  ...(uri === null ? { body: mediaType === 'application/pdf' ? INVOICE_430 : PROTOCOL(String(name)) } : {}),
}))

/** Офисные документы — двоичное содержимое (DOCX, XLSX), собранное на лету (office.ts). */
const office = (ref: string, name: string, mediaType: string, body: Buffer, who: Principal, at: string): Record<string, unknown> => ({
  id: randomUUID(), tenantId: TENANT, workspaceId: WORKSPACE, taskId: T(ref).id, runId: null, createdByPrincipalId: who.id, type: 'document', name, uri: null,
  content: null, supersedesArtifactId: null, metadata: {}, contentState: 'stored', sizeBytes: body.length, mediaType, sha256: null, typeVersion: 1, createdAt: at, body,
})
artifacts.push(
  office('TASK-000421', 'Акт сверки с «Вектором».docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sampleDocx([
    '# Акт сверки взаимных расчётов', 'ООО «Полярис» и АО «Вектор» за сентябрь 2026 года.', 'По данным ООО «Полярис»:',
    [['Дата', 'Документ', 'Дебет', 'Кредит'], ['01.09', 'Счёт №412', '96 000,00', ''], ['15.09', 'Оплата', '', '96 000,00'], ['28.09', 'Счёт №421', '99 600,00', '']],
    'Сальдо на 30.09: 99 600,00 руб. в пользу АО «Вектор».',
  ]), P.reconciler, today(13, 5)),
  office('TASK-000840', 'Реестр счетов сентября.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sampleXlsx([
    { name: 'Счета', rows: [['№', 'Поставщик', 'Сумма, ₽', 'Срок'], ['412', 'АО «Вектор»', 96000, '02.10'], ['417', 'ООО «Альфа-Снаб»', 184500, '03.10'], ['421', 'АО «Вектор»', 99600, '05.10']] },
    { name: 'Итого', rows: [['Всего к оплате', 380100]] },
  ]), P.payments, today(12, 30)),
  office('TASK-000836', 'Заявка на тендер — защита.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', samplePptx([
    { title: 'Заявка на тендер №0373200041', lines: ['ООО «Полярис»', 'Монтаж систем пожарной безопасности'] },
    { title: 'Почему мы', lines: ['Лицензия МЧС на монтаж', '12 объектов за 2026 год', 'Срок — 45 рабочих дней'] },
    { title: 'Цена', lines: ['2 480 000 ₽ с НДС'] },
  ]), P.preparer, today(11, 50)),
)

/** Протокол второй попытки сверки №421 (`agent-transcript/1`, содержимое — в самом артефакте). */
{
  const attempt = runs.find(r => r.taskId === T('TASK-000421').id && r.attempt === 2)!
  artifacts.push({
    id: randomUUID(), tenantId: TENANT, workspaceId: WORKSPACE, taskId: T('TASK-000421').id, runId: attempt.id, createdByPrincipalId: P.reconciler.id,
    type: 'transcript', name: 'transcript', uri: null, supersedesArtifactId: null, metadata: {}, contentState: 'inline', sizeBytes: 2_310, mediaType: 'application/json', sha256: null, typeVersion: 1, createdAt: today(13, 12),
    content: {
      schema: 'agent-transcript/1', harnessType: 'claude-code', model: 'sonnet-5', tools: ['onec.read', 'docs.compare'],
      entries: [
        { kind: 'assistant', text: 'Беру счёт №421 и акт сверки за сентябрь из 1С, сравню суммы и реквизиты.' },
        { kind: 'tool_call', call: 1, callId: 'c1', tool: 'onec.read', input: { document: 'invoice', number: '421' } },
        { kind: 'tool_result', call: 1, callId: 'c1', isError: false, output: '{"amount":"99600.00","counterparty":"АО «Вектор»"}' },
        { kind: 'tool_call', call: 2, callId: 'c2', tool: 'onec.read', input: { document: 'reconciliation-act', counterparty: '7802345678', period: '2026-09' } },
        { kind: 'tool_result', call: 2, callId: 'c2', isError: false, output: '{"balance":"96000.00"}' },
        { kind: 'assistant', text: 'Сумма счёта 99 600 ₽ не совпадает с актом сверки 96 000 ₽. Разница 3 600 ₽ — похоже на доставку, которой нет в акте. Исправить это сам не могу: нужен исправленный счёт от «Вектора».' },
      ],
      final: { text: 'Сверка не сошлась: 99 600 ₽ в счёте против 96 000 ₽ в акте. Нужен исправленный счёт.', truncated: false },
      usage: { inputTokens: 4120, outputTokens: 610 },
      stats: { assistantMessages: 2, userMessages: 0, toolCalls: 2, toolErrors: 0, hiddenReasoningBlocks: 3, truncatedEntries: 0, droppedEntries: 0 },
      truncated: false,
    },
  })
}

/** Обсуждение (`TaskCommentOut`). */
export const comments: Record<string, unknown>[] = [
  { id: randomUUID(), tenantId: TENANT, taskId: T('TASK-000840').id, authorPrincipalId: P.irina.id, body: 'Поставка принята на складе вчера, акт приёмки подписан — можно платить.', runId: null, artifactId: null, version: 1, createdAt: today(13, 20), updatedAt: today(13, 20), editedAt: null },
]

/** Связи (`TaskRelationOut`): сверка №421 — часть оплаты №417 не по смыслу, а для показа связи. */
export const relations: Record<string, unknown>[] = [
  { id: randomUUID(), fromTaskId: T('TASK-000840').id, toTaskId: T('TASK-000839').id, type: 'depends_on', createdByPrincipalId: P.payments.id, createdAt: today(12, 36) },
]

// ------------------------------------------------------------------ журнал

export const events: JournalEvent[] = []
let sequence = 1000
export function emit(type: string, entity: { type: string, id: string }, actorId: string | null, payload: Record<string, unknown>, occurredAt = new Date().toISOString()): JournalEvent {
  const seq = ++sequence
  // Пространство записи — пространство работы, о которой событие (как в ядре).
  const taskId = entity.type === 'task' ? entity.id : typeof payload.taskId === 'string' ? payload.taskId : null
  const workspaceId = (taskId !== null ? tasks.find(t => t.id === taskId)?.workspaceId : undefined) ?? WORKSPACE
  const event: JournalEvent = {
    sequence: seq, id: randomUUID(), tenantId: TENANT, type, entityType: entity.type, entityId: entity.id, actorId, sessionId: null,
    correlationId: randomUUID(), causationId: null, requestId: randomUUID(), traceRunId: null, iamActorId: null, workspaceId,
    schemaVersion: 1, payload, occurredAt, cursor: Buffer.from(`e:${seq}`).toString('base64url'),
  }
  events.push(event)
  return event
}

const TITLES = [
  'Сверить счёт №{n}', 'Оплатить счёт №{n}', 'Проверить акт сверки №{n}', 'Подготовить заявку на тендер №03732000{n}',
  'Согласовать договор поставки №{n}', 'Внести платёж №{n} в 1С', 'Запросить закрывающие документы по счёту №{n}',
]

/** Фон дня: работы, которые прошли поток до запуска стенда (для «Итога» и «Потока работы»). */
function seedDay(): void {
  const actorsByKind = { human: [P.irina, P.ivan, P.maria], agent: [P.reconciler, P.checker, P.preparer], process: [P.payments] }
  const plan: { origin: 'human' | 'process' | 'rule', exec: keyof typeof actorsByKind, stage: number }[] = []
  // 36 работ от процессов и правил, 6 от людей; сколько дошло до какой стадии — как в макете.
  for (let i = 0; i < 42; i++) plan.push({ origin: i < 6 ? 'human' : i < 30 ? 'process' : 'rule', exec: i % 7 < 3 ? 'agent' : i % 7 < 5 ? 'human' : 'process', stage: i < 31 ? 4 : i < 35 ? 3 : i < 39 ? 1 : 0 })
  let minute = 8 * 60
  for (const [i, p] of plan.entries()) {
    const id = randomUUID()
    const publicId = `TASK-000${700 + i}`
    const at = (): string => { minute = Math.min(minute + 3, 13 * 60 + 55); return today(Math.floor(minute / 60), minute % 60) }
    const exec = actorsByKind[p.exec][i % actorsByKind[p.exec].length]!
    const title = TITLES[i % TITLES.length]!.replace('{n}', String(380 + i))
    emit('task.created', { type: 'task', id }, p.origin === 'human' ? P.me.id : p.origin === 'rule' ? P.invoiceRule.id : P.payments.id,
      { publicId, title, status: 'todo', systemStatusCategory: 'active', typeKey: 'invoice-reconcile', typeVersion: 1, origin: { kind: p.origin } }, at())
    if (p.stage >= 1) emit('task.claimed', { type: 'task', id }, exec.id, { publicId, holderId: exec.id, status: 'in_progress', systemStatusCategory: 'active' }, at())
    const created = events.at(-1)!.occurredAt
    if (p.stage >= 3) emit('task.completed', { type: 'task', id }, exec.id, { publicId, status: 'review', systemStatusCategory: 'active', attempt: 1 }, at())
    if (p.stage >= 4) emit('task.verified', { type: 'task', id }, null, { publicId, taskId: id, attempt: 1, checks: 3, results: [{ kind: 'deterministic', passed: true }] }, at())
    // Запись работы — как её отдаёт ядро после последнего события: экраны читают её по id из журнала.
    const last = events.at(-1)!.occurredAt
    tasks.push(task({
      id, title, typeKey: 'invoice-reconcile', createdAt: created, updatedAt: last,
      createdBy: p.origin === 'human' ? P.me.id : p.origin === 'rule' ? P.invoiceRule.id : P.payments.id,
      origin: p.origin === 'human' ? { kind: 'human' } : { kind: p.origin, ref: p.origin === 'rule' ? 'invoice-received' : 'invoice-approval' },
      assigneeId: p.stage >= 1 ? exec.id : null, claimEpoch: p.stage >= 1 ? 1 : 0,
      status: p.stage >= 4 ? 'done' : p.stage === 3 ? 'review' : p.stage >= 1 ? 'in_progress' : 'todo',
      systemStatusCategory: p.stage >= 4 ? 'terminal_success' : 'active',
      completedAt: p.stage >= 4 ? last : null,
      verification: p.stage >= 4 ? { id: randomUUID(), status: 'passed', attempt: 1, updatedAt: last } : p.stage === 3 ? { id: randomUUID(), status: 'running', attempt: 1, updatedAt: last } : null,
    }, publicId))
  }
  for (const n of [1, 2]) {
    const id = randomUUID()
    emit('work.reconciled', { type: 'task', id }, P.invoiceRule.id, { publicId: `TASK-00079${n}`, taskId: id, ruleKey: 'invoice-received', action: 'cancel' }, today(10, 10 + n))
  }
  // Последние записи — те, что видны в «Что произошло».
  emit('task.verified', { type: 'task', id: T('TASK-000839').id }, P.checker.id, { publicId: 'TASK-000839', taskId: T('TASK-000839').id, attempt: 1, checks: 3, results: [] }, today(12, 20))
  emit('task.created', { type: 'task', id: T('TASK-000840').id }, P.invoiceRule.id, { publicId: 'TASK-000840', title: T('TASK-000840').title, typeKey: 'invoice-approval', status: 'todo', systemStatusCategory: 'active', origin: { kind: 'rule' } }, today(12, 36))
  emit('approval.requested', { type: 'approval', id: approvals[0]!.id }, P.payments.id, { taskId: T('TASK-000840').id, taskPublicId: 'TASK-000840', assignedPrincipalId: ME, gate: false, workspaceId: WORKSPACE }, today(12, 37))
  emit('approval.approved', { type: 'approval', id: randomUUID() }, P.ivan.id, { taskId: T('TASK-000832').id, decisionBy: P.ivan.id, comment: null, channel: 'telegram' }, today(12, 41))
  emit('run.failed', { type: 'run', id: runs[3]!.id }, P.preparer.id, { taskId: T('TASK-000848').id, attempt: 1, reason: { code: 'agent_start_failed' } }, today(12, 50))
  emit('task.completed', { type: 'task', id: T('TASK-000421').id }, P.reconciler.id, { publicId: 'TASK-000421', status: 'review', systemStatusCategory: 'active', attempt: 2 }, today(13, 2))
  emit('task.verification_failed', { type: 'task', id: T('TASK-000421').id }, null, { publicId: 'TASK-000421', taskId: T('TASK-000421').id, attempt: 2, checks: 3, failedCheck: { key: 'amount-matches-act' }, reason: 'сумма 99 600 ₽ не совпадает с актом сверки 96 000 ₽', consecutiveFailures: 2, blocked: false }, today(13, 12))
  emit('task.claimed', { type: 'task', id: T('TASK-000845').id }, P.irina.id, { publicId: 'TASK-000845', holderId: P.irina.id, status: 'in_progress', systemStatusCategory: 'active' }, today(14, 0))
  events.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  events.forEach((e, i) => { e.sequence = 1000 + i; e.cursor = Buffer.from(`e:${e.sequence}`).toString('base64url') })
  sequence = 1000 + events.length
}
seedDay()

// База знаний: работа правила «Сроки документов» на лицензию, которая истекает через 10 дней, и сверки знаний.
{
  const until = new Date(START + 10 * 86_400_000).toISOString().slice(0, 10)
  tasks.push(task({
    title: `Истекает срок: Лицензия МЧС на монтаж — до ${until}`, typeKey: 'knowledge-expiry', status: 'todo', systemStatusCategory: 'active', priority: 'medium',
    assigneeId: P.irina.id, createdBy: P.invoiceRule.id, origin: { kind: 'rule', ref: 'knowledge-expiry' }, createdAt: daysAgo(1, 6),
    customFields: { pack: 'company@1', kind: 'credential', key: 'credential:license:МЧС-77-123', validUntil: until },
  }, 'TASK-000831'))
  const ws = { type: 'workspace', id: WORKSPACE }
  emit('knowledge.packs_configured', ws, P.me.id, { workspaceId: WORKSPACE, rootWorkspaceId: WORKSPACE, packs: ['default@1', 'company@1'], strict: false }, daysAgo(6, 11))
  emit('knowledge.snapshot_reconciled', ws, P.payments.id, { snapshotId: 'manual-2026-09', pack: 'company@1', source: 'manual', observedAt: daysAgo(5, 15), workspaceId: WORKSPACE, rootWorkspaceId: WORKSPACE, entityCount: 4, relationCount: 1, duplicate: false, counters: { created: 4 } }, daysAgo(5, 15))
  for (const [h, n, changed] of [[8, 214, 3], [11, 214, 0], [12, 215, 1]] as const) {
    emit('knowledge.snapshot_reconciled', ws, P.payments.id, { snapshotId: `1c-${h}`, pack: 'company@1', source: '1c', observedAt: today(h, 0), workspaceId: WORKSPACE, rootWorkspaceId: WORKSPACE, entityCount: n, relationCount: 40, duplicate: changed === 0, counters: { updated: changed } }, today(h, 0))
  }
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  events.forEach((e, i) => { e.sequence = 1000 + i; e.cursor = Buffer.from(`e:${e.sequence}`).toString('base64url') })
  sequence = 1000 + events.length
}

/** `GET /me/attention`: что нужно мне сейчас — из своих сущностей по правилам CP-ADR-0071. */
export function attention(): Record<string, unknown> {
  const items: Record<string, unknown>[] = []
  for (const a of approvals) {
    if (a.status !== 'pending' || a.assignedPrincipalId !== ME) continue
    const t = tasks.find(x => x.id === a.taskId)
    const kind = a.gate ? 'approval.review' : 'approval.decide'
    items.push({
      itemKey: `${kind}:${a.id}`, kind, reasonCode: a.gate ? 'review_waiting' : 'decision_waiting', rule: `${kind}@1`, score: a.gate ? 60 : 80,
      entity: { type: 'approval', id: a.id }, title: t?.title ?? 'Решение', workspaceId: t?.workspaceId ?? a.workspaceId, taskId: a.taskId, taskPublicId: t?.publicId ?? null,
      dueDate: t?.dueDate ?? null, since: a.createdAt, details: { requestedBy: a.requestedByPrincipalId, gate: a.gate },
      actions: [
        { action: 'approve', method: 'POST', href: `/api/v1/approvals/${a.id}:approve` },
        { action: 'reject', method: 'POST', href: `/api/v1/approvals/${a.id}:reject` },
        { action: 'open', method: 'GET', href: `/api/v1/approvals/${a.id}` },
      ],
      feedback: null,
    })
  }
  const failing = T('TASK-000421')
  if (failing.systemStatusCategory !== 'terminal_success') {
    items.push({
      itemKey: `task.delegated_failing:${failing.id}`, kind: 'task.delegated_failing', reasonCode: 'runs_failing', rule: 'task.delegated_failing@1', score: 70,
      entity: { type: 'task', id: failing.id }, title: failing.title, workspaceId: failing.workspaceId, taskId: failing.id, taskPublicId: failing.publicId,
      dueDate: failing.dueDate, since: today(13, 12), details: { failedRuns: 3 }, actions: [{ action: 'open', method: 'GET', href: `/api/v1/tasks/${failing.id}` }], feedback: null,
    })
  }
  return { items: items.sort((a, b) => Number(b.score) - Number(a.score)), degraded: [], generatedAt: new Date().toISOString() }
}

export function harnessContext(): Record<string, unknown> {
  return {
    tenant: { id: TENANT, slug: 'polaris', name: 'Полярис' },
    principal: { id: ME, kind: 'human', displayName: P.me.displayName },
    roles: [{ key: 'owner', name: 'Владелец', workspaceId: WORKSPACE }],
    permissions: ['approvals.decide', 'approvals.read', 'events.read', 'tasks.read', 'tasks.write', 'workspaces.read'],
  }
}

/** `GET /workspaces/tree` в форме ядра: `{roots: [...]}`, узел — id, parentId, slug, name, тип, дети. */
export function workspaceTree(): Record<string, unknown> {
  const child = (id: string, slug: string, name: string) => ({ id, parentId: WORKSPACE, depth: 1, slug, name, status: 'active', version: 1, typeId: TENANT, typeKey: 'team', children: [], project: null })
  return { roots: [{ id: WORKSPACE, parentId: null, depth: 0, slug: 'polaris', name: 'Полярис', status: 'active', version: 1, typeId: TENANT, typeKey: 'organization', children: [child(FINANCE, 'finance', 'Финансы'), child(TENDERS, 'tenders', 'Тендеры')], project: null }] }
}

/** Реестр агентов (`GET /agents`): какие типы работ берёт каждый и в каком пространстве. */
export function agents(): Record<string, unknown>[] {
  const agent = (p: Principal, key: string, workspaceId: string, taskTypes: string[], secrets: string[] = []) => ({
    id: randomUUID(), tenantId: TENANT, key, displayName: p.displayName, status: 'active', state: 'running', replicas: 1, currentRevision: 1,
    revision: { id: randomUUID(), agentId: randomUUID(), agentKey: key, revision: 1, spec: { executor: { kind: 'claude-code' }, work: { workspace: workspaceId, taskTypes }, ...(secrets.length > 0 ? { placement: { secrets } } : {}) }, specHash: 'x', createdBy: ME, createdAt: daysAgo(10) },
    principalId: p.id, workspaceId, retiredAt: null, retiredBy: null, version: 1, createdAt: daysAgo(10), updatedAt: daysAgo(10), package: null,
  })
  return [agent(P.reconciler, 'reconciler', FINANCE, ['invoice-reconcile'], ['onec-password']), agent(P.checker, 'bid-checker', TENDERS, ['tender-bid']), agent(P.preparer, 'bid-preparer', TENDERS, ['tender-bid']), agent(P.crmObserver, 'crm-observer', WORKSPACE, [], ['crm-webhook-signing', 'crm-api-password'])]
}

/** Участники пространства (`GET /workspaces/{id}/participants`): люди с ролями. */
export function participants(workspaceId: string): Record<string, unknown>[] {
  const who = (p: Principal, roles: string[]) => ({ principalId: p.id, kind: p.kind, displayName: p.displayName, status: 'active', member: true, roles: roles.map(r => ({ displayName: r })) })
  const all = [who(P.me, ['Финансовый директор']), who(P.irina, ['Руководитель тендеров']), who(P.ivan, ['Бухгалтер']), who(P.maria, ['Специалист по закупкам'])]
  if (workspaceId === FINANCE) return [all[0]!, all[2]!]
  if (workspaceId === TENDERS) return [all[0]!, all[1]!, all[3]!]
  // Корень: только его участники; люди дочерних пространств — в их участниках.
  if (workspaceId === WORKSPACE) return [all[0]!, all[2]!]
  return all
}

/** Типы, разрешённые в пространстве (`effectiveTaskTypes`, TASK-001306): null — все. */
export function effectiveTaskTypes(workspaceId: string): string[] | null {
  if (workspaceId === FINANCE) return ['invoice-approval', 'invoice-reconcile', 'invoice-review', 'knowledge-import', 'free']
  if (workspaceId === TENDERS) return ['tender-bid', 'contract-sign', 'free']
  return null
}
