/**
 * Экраны пакетов на стенде (TAI-ADR-0066, контракт — docs/views.md): пакет `invoice-approval`
 * «Полярис» — процесс оплаты счетов, вид списка «Счета на оплату» и вид карточки «Счёт».
 * Строки — уже на языке запроса, как отдаст ядро после подстановки словаря пакета.
 */
import { artifacts, byRef, P, today } from './data.ts'

type Locale = 'en' | 'ru'
const L = (en: string, ru: string) => (locale: Locale): string => locale === 'ru' ? ru : en

const STAGES = [
  { key: 'received', title: L('Received', 'Получен') },
  { key: 'reconcile', title: L('Reconciliation', 'Сверка') },
  { key: 'agreements', title: L('Approval', 'Согласование') },
  { key: 'payment', title: L('Payment', 'Оплата') },
  { key: 'paid', title: L('Paid', 'Оплачен') },
] as const

interface Instance {
  id: string, number: string, supplier: string, inn: string, amount: string, due: string, contract: string, stage: typeof STAGES[number]['key'],
  /** `waiting` — внутреннее состояние стенда «ждёт решения человека»; ядро отдаёт его как `running`. */
  status: 'running' | 'waiting' | 'suspended' | 'completed' | 'failed', task?: string, owner: string, started: string,
}

const day = (offset: number): string => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(18, 0, 0, 0); return d.toISOString() }

const INSTANCES: Instance[] = [
  { id: 'e5000000-0000-4000-8000-000000000417', number: '417', supplier: 'ООО «Альфа-Снаб»', inn: '7701234567', amount: '184500.00', due: day(0), contract: 'АС-12', stage: 'agreements', status: 'waiting', task: 'TASK-000840', owner: P.irina.id, started: today(12, 36) },
  { id: 'e5000000-0000-4000-8000-000000000421', number: '421', supplier: 'АО «Вектор»', inn: '7802345678', amount: '99600.00', due: day(2), contract: 'В-7', stage: 'reconcile', status: 'failed', task: 'TASK-000421', owner: P.irina.id, started: today(11, 40) },
  { id: 'e5000000-0000-4000-8000-000000000424', number: '424', supplier: 'ООО «Северсталь-Трейд»', inn: '3528000597', amount: '312000.00', due: day(5), contract: 'СТ-3', stage: 'reconcile', status: 'running', task: 'TASK-000847', owner: P.irina.id, started: today(13, 30) },
  { id: 'e5000000-0000-4000-8000-000000000430', number: '430', supplier: 'ООО «Альфа-Снаб»', inn: '7701234567', amount: '42750.00', due: day(9), contract: 'АС-12', stage: 'received', status: 'waiting', task: 'TASK-000852', owner: P.irina.id, started: today(13, 50) },
  { id: 'e5000000-0000-4000-8000-000000000412', number: '412', supplier: 'АО «Вектор»', inn: '7802345678', amount: '96000.00', due: day(-1), contract: 'В-7', stage: 'paid', status: 'completed', owner: P.irina.id, started: today(9, 10) },
]

const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
const money = (amount: string) => ({ amount, currency: 'RUB' })
const stageTitle = (i: Instance, locale: Locale): string => STAGES.find(s => s.key === i.stage)!.title(locale)
const STATUS = { running: L('in progress', 'идёт'), waiting: L('waiting for a decision', 'ждёт решения'), completed: L('completed', 'завершён'), failed: L('stuck', 'застрял') }

function summary(key: string, locale: Locale): Record<string, unknown> {
  const base = { revision: 3, hash: 'sha256:stand', package: { key: 'invoice-approval', version: '0.7.0' } }
  if (key === 'invoices') return { ...base, key, title: L('Invoices to pay', 'Счета на оплату')(locale), nav: { group: 'work', icon: 'work', order: 20 }, source: { kind: 'process', process: 'invoice-approval', instance: false } }
  return { ...base, key: 'invoice', title: L('Invoice', 'Счёт')(locale), source: { kind: 'process', process: 'invoice-approval', instance: true } }
}

const views = (locale: Locale): Record<string, Record<string, unknown>> => ({
  invoices: {
    ...summary('invoices', locale),
    layout: [
      { block: 'metrics', items: [{ title: L('In progress', 'В работе')(locale), format: 'number' }, { title: L('To pay', 'К оплате')(locale), format: 'money' }, { title: L('Due this week', 'Срок на этой неделе')(locale), format: 'number' }] },
      { block: 'board', card: { fields: [{ key: 'amount', format: 'money' }, { key: 'due', format: 'due' }] }, open: { view: 'invoice' } },
      { block: 'chart', type: 'bar', title: L('Amount by stage', 'Сумма по этапам')(locale), format: 'money' },
      {
        block: 'table', open: { view: 'invoice' },
        columns: [
          { key: 'supplier', title: L('Supplier', 'Поставщик')(locale) },
          { key: 'amount', title: L('Amount', 'Сумма')(locale), format: 'money' },
          { key: 'due', title: L('Pay by', 'Оплатить до')(locale), format: 'date' },
          { key: 'stage', title: L('Stage', 'Этап')(locale), format: 'status' },
        ],
        filters: [
          { field: 'supplier', title: L('Supplier', 'Поставщик')(locale), type: 'enum', options: [...new Set(INSTANCES.map(i => i.supplier))].map(v => ({ value: v, title: v })) },
          { field: 'stage', title: L('Stage', 'Этап')(locale), type: 'enum', options: STAGES.map(s => ({ value: s.key, title: s.title(locale) })) },
          { field: 'number', title: L('Invoice No.', 'Номер счёта')(locale), type: 'text' },
          { field: 'amount', title: L('Amount', 'Сумма')(locale), type: 'number' },
          { field: 'due', title: L('Pay by', 'Оплатить до')(locale), type: 'date' },
        ],
        sort: [{ field: 'due', title: L('By due date', 'По сроку')(locale) }, { field: 'amount', title: L('By amount', 'По сумме')(locale) }],
      },
    ],
  },
  invoice: {
    ...summary('invoice', locale),
    layout: [
      { block: 'header' },
      { block: 'steps' },
      {
        block: 'fields', section: L('Invoice', 'Счёт')(locale),
        items: [
          { key: 'supplier', label: L('Supplier', 'Поставщик')(locale) },
          { key: 'inn', label: L('Tax ID', 'ИНН')(locale) },
          { key: 'amount', label: L('Amount', 'Сумма')(locale), format: 'money' },
          { key: 'due', label: L('Pay by', 'Оплатить до')(locale), format: 'due' },
          { key: 'contract', label: L('Contract', 'Договор')(locale) },
          { key: 'owner', label: L('Owner', 'Отвечает')(locale), format: 'principal' },
        ],
      },
      { block: 'artifacts' },
      { block: 'timeline' },
      // Блок версии 1, которого консоль пока не рисует (ждёт связей в entities:query): заглушка.
      { block: 'related', title: L('Related', 'Связано')(locale) },
      // Блок, которого консоль не рисует (TAI-ADR-0066: компонент описанием) — заглушка «нужна более новая консоль».
      { block: 'component', component: 'payment-calendar' },
    ],
  },
})

const localeOf = (q: URLSearchParams): Locale => q.get('locale') === 'ru' ? 'ru' : 'en'

/** Описание процесса (`ProcessDefinitionOut.spec`, подмножество): шаг проверки с формой — как на staging. */
export const DEFINITION = {
  key: 'invoice-approval', version: 3, displayName: 'Оплата счетов',
  spec: {
    displayName: 'Оплата счетов',
    stages: [{
      id: 'intake',
      steps: [
        {
          id: 'check-invoice',
          human: {
            taskType: 'invoice-review',
            form: {
              schema: {
                type: 'object', required: ['verdict'],
                properties: {
                  verdict: { type: 'string', enum: ['ok', 'mismatch', 'fix'], title: 'Итог проверки', description: 'ok — счёт верен; mismatch — отклонить; fix — вернуть поставщику на исправление' },
                  note: { type: 'string', title: 'Комментарий', maxLength: 2000 },
                },
              },
              uischema: {
                type: 'VerticalLayout',
                elements: [
                  { type: 'Control', scope: '#/properties/verdict' },
                  { type: 'Control', scope: '#/properties/note', options: { multi: true }, rule: { effect: 'SHOW', condition: { scope: '#/properties/verdict', schema: { enum: ['mismatch', 'fix'] } } } },
                ],
              },
            },
          },
        },
        { id: 'reconcile', agent: { skill: 'invoice.reconcile@1' } },
      ],
    }],
  },
}

/** Завершение работы шага: дело переходит на следующий этап (сверка), шаг закрыт. */
export function stepCompleted(taskRef: string): void {
  const i = INSTANCES.find(x => x.task === taskRef)
  if (i === undefined || i.stage !== 'received') return
  i.stage = 'reconcile'
  i.status = 'running'
  delete i.task
}

/** `GET /process-instances/{id}` (`ProcessInstanceOut`, только поля, которые читает консоль). */
export function instance(id: string): Record<string, unknown> | undefined {
  const i = INSTANCES.find(x => x.id === id)
  if (i === undefined) return undefined
  const status = i.status === 'waiting' ? 'running' : i.status
  return {
    id: i.id, definitionKey: 'invoice-approval', definitionVersion: DEFINITION.version, instanceKey: `invoice:${i.number}`, status, outcome: null, data: {},
    stages: STAGES.map(s => ({ key: s.key, title: s.title('ru'), state: s.key === i.stage ? 'active' : 'pending' })), openElements: [], startedAt: i.started,
  }
}

export function list(q: URLSearchParams): Record<string, unknown> {
  return { items: ['invoices', 'invoice'].map(k => summary(k, localeOf(q))) }
}

export function one(key: string, q: URLSearchParams): Record<string, unknown> | undefined {
  return views(localeOf(q))[key]
}

interface QueryBody { block?: number, params?: { id?: string }, filter?: { field: string, op: string, value: unknown }[], sort?: { field: string, dir?: 'asc' | 'desc' }[], limit?: number, cursor?: string | null, locale?: string }

const valuesOf = (i: Instance, locale: Locale): Record<string, unknown> => ({
  supplier: i.supplier, inn: i.inn, amount: money(i.amount), due: i.due, contract: i.contract, owner: i.owner,
  // Категория — статус экземпляра ядра: «ждёт решения» стенда — `running` (TASK-001298, ProcessInstanceStatus).
  stage: { title: stageTitle(i, locale), category: i.status === 'waiting' ? 'running' : i.status }, stageKey: i.stage,
})

export function query(key: string, body: QueryBody, q: URLSearchParams): { status: number, body: unknown } {
  const locale: Locale = body.locale === 'ru' || q.get('locale') === 'ru' ? 'ru' : 'en'
  const view = views(locale)[key]
  if (view === undefined) return { status: 404, body: { error: { code: 'not_found' } } }
  const block = (view.layout as { block: string, filters?: { field: string }[], sort?: { field: string }[] }[])[body.block ?? -1]
  if (block === undefined) return { status: 422, body: { error: { code: 'invalid_block', message: 'unknown block index' } } }
  const title = (i: Instance): string => L(`Invoice No. ${i.number}`, `Счёт №${i.number}`)(locale)

  if (key === 'invoice') {
    const i = INSTANCES.find(x => x.id === body.params?.id)
    if (i === undefined) return { status: 404, body: { error: { code: 'not_found' } } }
    const v = valuesOf(i, locale)
    switch (block.block) {
      case 'header': return { status: 200, body: { title: `${title(i)} · ${i.supplier}`, status: v.stage, lead: L(`Process “Invoice payment”, started ${hhmm(i.started)}`, `Процесс «Оплата счетов», начат в ${hhmm(i.started)}`)(locale) } }
      case 'fields': return { status: 200, body: { values: v } }
      case 'steps': {
        const task = i.task !== undefined ? byRef(i.task) : undefined
        return { status: 200, body: { items: task !== undefined && i.status !== 'completed' ? [{ key: i.stage, title: stageTitle(i, locale), task: { ref: task.publicId, title: task.title }, assignee: task.assigneeId, since: task.createdAt }] : [] } }
      }
      case 'timeline': {
        const reached = STAGES.slice(0, STAGES.findIndex(s => s.key === i.stage) + 1)
        return { status: 200, body: { items: reached.map((s, n) => ({ at: new Date(Date.parse(i.started) + n * 7 * 60_000).toISOString(), title: L(`Stage “${s.title('en')}” started`, `Начат этап «${s.title('ru')}»`)(locale), actor: P.payments.id })) } }
      }
      case 'artifacts': {
        const task = i.task !== undefined ? byRef(i.task) : undefined
        return { status: 200, body: { items: artifacts.filter(a => task !== undefined && a.taskId === task.id && a.type !== 'transcript').map(a => ({ id: a.id, name: a.name, type: a.type, createdAt: a.createdAt })) } }
      }
      case 'related': {
        const agreements: Record<string, string> = { 'АС-12': 'Договор поставки № АС-12', 'В-7': 'Договор с «Вектором» № В-7' }
        const items = [
          { relation: 'supplier', title: L('Supplier', 'Поставщик')(locale), kind: 'legal_entity', key: `inn:${i.inn}`, entityTitle: i.supplier, direction: 'out' },
          ...(agreements[i.contract] !== undefined ? [{ relation: 'governed_by', title: L('Agreement', 'Договор')(locale), kind: 'agreement', key: `agreement:1c:${i.contract}`, entityTitle: agreements[i.contract]!, direction: 'out' }] : []),
        ]
        return { status: 200, body: { items } }
      }
      default: return { status: 200, body: {} }
    }
  }

  let rows = INSTANCES.map(i => ({ i, v: valuesOf(i, locale) }))
  const allowed = new Set((block.filters ?? []).map(f => f.field))
  for (const f of body.filter ?? []) {
    if (!allowed.has(f.field)) return { status: 422, body: { error: { code: 'filter_not_declared', message: `field ${f.field} is not filterable in this block` } } }
    const pick = (r: typeof rows[number]): unknown => f.field === 'stage' ? r.i.stage : f.field === 'number' ? r.i.number : f.field === 'amount' ? Number(r.i.amount) : f.field === 'due' ? r.i.due.slice(0, 10) : r.v[f.field]
    const cmp = (a: unknown, b: unknown): number => typeof a === 'number' ? a - Number(b) : String(a).localeCompare(String(b))
    if (f.op === 'eq') rows = rows.filter(r => pick(r) === f.value)
    if (f.op === 'in' && Array.isArray(f.value)) rows = rows.filter(r => (f.value as unknown[]).includes(pick(r)))
    if (f.op === 'prefix') rows = rows.filter(r => String(pick(r)).toLowerCase().startsWith(String(f.value).toLowerCase()))
    if (f.op === 'gte') rows = rows.filter(r => cmp(pick(r), f.value) >= 0)
    if (f.op === 'lte') rows = rows.filter(r => cmp(pick(r), f.value) <= 0)
  }
  const active = rows.filter(r => r.i.status !== 'completed')
  switch (block.block) {
    case 'metrics': {
      const week = Date.now() + 7 * 86_400_000
      return { status: 200, body: { values: [active.length, money(active.reduce((s, r) => s + Number(r.i.amount), 0).toFixed(2)), active.filter(r => Date.parse(r.i.due) <= week).length] } }
    }
    case 'chart':
      return { status: 200, body: { points: STAGES.map(s => ({ label: s.title(locale), value: money(rows.filter(r => r.i.stage === s.key).reduce((sum, r) => sum + Number(r.i.amount), 0).toFixed(2)) })) } }
    case 'board':
      return {
        status: 200,
        body: { columns: STAGES.map(s => ({ key: s.key, title: s.title(locale), items: rows.filter(r => r.i.stage === s.key).map(r => ({ id: r.i.id, title: title(r.i), subtitle: r.i.supplier, values: r.v, badge: r.i.status === 'failed' ? { title: STATUS.failed(locale), category: 'failed' } : r.i.status === 'waiting' ? { title: STATUS.waiting(locale), category: 'running' } : undefined })) })) },
      }
    case 'table': {
      const sort = body.sort?.[0]
      if (sort !== undefined) {
        if (!(block.sort ?? []).some(x => x.field === sort.field)) return { status: 422, body: { error: { code: 'sort_not_declared', message: `field ${sort.field} is not sortable in this block` } } }
        const k = (r: typeof rows[number]): number => sort.field === 'amount' ? Number(r.i.amount) : Date.parse(r.i.due)
        rows = [...rows].sort((a, b) => (k(a) - k(b)) * (sort.dir === 'desc' ? -1 : 1))
      }
      const limit = Math.min(body.limit ?? 50, 200)
      const offset = body.cursor ? Number(body.cursor) || 0 : 0
      return { status: 200, body: { items: rows.slice(offset, offset + limit).map(r => ({ id: r.i.id, title: title(r.i), values: r.v })), nextCursor: offset + limit < rows.length ? String(offset + limit) : null } }
    }
    default: return { status: 200, body: {} }
  }
}

