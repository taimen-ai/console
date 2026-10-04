// Taimen Console — типы компонентов (документация пропсов; не проверяются компилятором).
// Все тексты приходят данными: подписи шагов, фразы последствий и причин — из ядра и пакетов, а не из UI.
// Встроенные строки компонентов (кнопки, aria-label, слова статусов) — из словаря STRINGS на двух языках,
// язык выбирает LocaleProvider (см. конец файла); данные из пропсов компоненты не переводят.
import type { ReactNode } from "react";

/** Вид исполнителя: человек ○, агент ▢, процесс или правило ⬡. */
export type ExecutorKind = "human" | "agent" | "process";

/** Операционные состояния работы и попытки. Форма знака различает их без цвета. */
export type Status =
  | "queued" | "running" | "waiting_human" | "waiting_external" | "blocked"
  | "paused" | "stale" | "failed" | "completed" | "verified";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** human — одно главное действие «нужен человек» (accent); brand — главное действие настройки; danger — аварийное. */
  variant?: "human" | "brand" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  /** Клавиша-подсказка, например "E" или "⌘J". */
  kbd?: string;
  icon?: ReactNode;
}

export interface ExecutorGlyphProps {
  kind: ExecutorKind;
  /** Полное имя — для инициалов и aria-label. */
  name?: string;
  /** Явная метка внутри глифа (2 знака), иначе инициалы name. Пустая строка — без метки. */
  label?: string;
  size?: "sm" | "md" | "lg";
  /** Ожидание человека — пунктирный контур. */
  waiting?: boolean;
  /** Пустой пост роли. */
  vacant?: boolean;
}

export interface IdentityBlockProps {
  kind: ExecutorKind;
  name: string;
  label?: string;
  /** Роль человека или версия агента/процесса: «Финансовый директор», «r7», «v2». */
  meta?: string;
  /** Что делает сейчас, фразой. */
  now?: string;
  size?: "sm" | "md" | "lg";
  /** В одну строку (в мета-строках карточек). */
  inline?: boolean;
  waiting?: boolean;
}

export interface StatusMarkProps {
  status: Status;
  /** Слово из типа работы (displayName); по умолчанию — слово словаря консоли. */
  label?: string;
  /** Ждёт именно смотрящего — берёт accent. Только для waiting_human. */
  mine?: boolean;
  /** false — без подложки, в строку текста. */
  pill?: boolean;
  /** Машинное имя для tooltip (второй слой). */
  machine?: string;
}

export interface SourceChipProps {
  source: "authoritative" | "recalled" | "external";
  label?: string;
  /** Свежесть для recalled/external: «запомнено 3 дня назад», «12:30». */
  freshness?: string;
  /** Только значок с рамкой своего вида; слово — в aria-label и подсказке. В ленте ассистента — всегда. */
  iconOnly?: boolean;
}

export interface ChannelChipProps {
  channel?: string;
  state?: "sent" | "delivered" | "opened" | "decided" | "failed";
  at?: string;
  /** Причина недоставки. */
  reason?: string;
}

export interface SealOrigin { kind: "rule" | "process" | "human" | "external" | "harness" | "parent"; text: string; name?: string }
export interface SealExecutor { kind: ExecutorKind; name: string; label?: string; meta?: string }
export interface SealEvidence { method: "external" | "auto" | "human" | "model" | "pending" | "failed" | "none"; text?: string }
export interface SealSignature { who?: string; channel?: string; at?: string; pending?: boolean }

export interface SealsProps {
  /** null — звено отсутствует (пунктир с причиной). */
  origin: SealOrigin | null;
  executor: SealExecutor | null;
  evidence: SealEvidence | null;
  /** null — подпись не требуется. */
  signature: SealSignature | null;
  /** Шапка истории: четыре ячейки с подписями. Без него — строка для списка. */
  labelled?: boolean;
}

export interface TopBarProps {
  /** BRAND-слой: знак из конфигурации организации. Без brand.name на месте имени стоит название организации (org), второй раз оно не повторяется. */
  brand?: { name?: string; mark?: ReactNode };
  org: string;
  /** Область работы — например, выбор пространства (Combobox) рядом с организацией. */
  scope?: ReactNode;
  /** «Сегодня, 29 сентября». */
  date: string;
  /** Время последних данных. */
  at: string;
  /** false — соединения нет: «offline · данные на …»; иначе «online · <at>». */
  live?: boolean;
  /** Переключатель периода — только если передан непустой список; выбор — onPeriod. */
  periods?: string[];
  period?: string;
  onPeriod?: (period: string) => void;
  /** Кнопка поиска ⌘K — только если передан обработчик. */
  onSearch?: () => void;
  user?: string;
  /** false — индикатор связи не в строке состояния, а отдельным LiveChip над экраном. */
  showLive?: boolean;
  /** Кнопка меню слева от бренда. */
  onMenu?: () => void;
  menuOpen?: boolean;
  menuId?: string;
  /** Кнопка «Ассистент ⌘J»: открыть или закрыть панель. */
  onAssistant?: () => void;
  assistantOpen?: boolean;
  /** id панели для aria-controls. */
  assistantId?: string;
  /** Непрочитанные сообщения ассистента — счётчик на кнопке; urgent — среди них есть «нужен человек» (accent). */
  assistantUnread?: number;
  assistantUrgent?: boolean;
}

export interface SummaryChange {
  title: ReactNode;
  method?: SealEvidence["method"];
  methodText?: string;
  /** Подпись ссылки на evidence. */
  evidence?: string;
  /** Куда ведёт ссылка на доказательство. */
  evidenceHref?: string;
  /** Малый пункт: работы, снятые потому, что повод отпал. */
  small?: boolean;
}
export interface SummaryProps {
  verified: number;
  submitted: number;
  /** Слово с правильной формой числа: «работу», «работы», «работ». По умолчанию — форма числа verified из словаря локали (work item / work items, работу / работы / работ). */
  unit?: string;
  waiting?: number;
  broken?: number;
  lead?: string;
  changes?: SummaryChange[];
  /** Текст пустой полосы: «Проверенных результатов за сегодня ещё нет — 6 работ на проверке». */
  empty?: string;
  /** Пульт в одно окно: фраза 28px, полоса изменений в одну строку. */
  compact?: boolean;
}

export interface DecisionCardProps {
  /** «Согласование», «Приёмка»… */
  kind?: string;
  /** Заголовок с глагола. Строка — она же aria-label карточки; для узла (ссылки) подпись — в label. */
  title: ReactNode;
  /** Подпись карточки для чтения с экрана, когда title — узел. */
  label?: string;
  holds?: boolean;
  due?: string;
  requester?: IdentityBlockProps;
  since?: string;
  delivery?: ChannelChipProps;
  /** «Почему у вас» фразой; правило — вторым слоем. */
  why?: ReactNode;
  /** Последствия из объявления типа. */
  yes?: ReactNode;
  no?: ReactNode;
  /** Внешний эффект и обратимость при «да». */
  yesExternal?: string;
  preconditions?: { ok: boolean; text: string }[];
  /** high — доказательства раскрыты до кнопки. */
  risk?: "normal" | "high";
  /** Доказательства: строка или { label, href } — со ссылкой открывают документ. */
  evidence?: (string | { label: string; href: string; target?: string })[];
  evidenceOpen?: boolean;
  /** Рекомендация агента, помеченная как предложение. */
  proposal?: ReactNode;
  /** Подпись главной кнопки; по умолчанию — «Согласовать» / “Approve” по локали. */
  primary?: string;
  /** Подпись второй кнопки; по умолчанию — «Отклонить…» / “Decline…” по локали. */
  secondary?: string;
  kbd?: string;
  /** Смотрящему решать нельзя — действия скрыты, причина показана. */
  readOnlyReason?: string;
  /** «Вам нельзя решать: разделение обязанностей». */
  excluded?: string;
  mine?: boolean;
  dismissible?: boolean;
  /** Узкая колонка пульта: последствия столбиком, доказательства одной строкой, только две кнопки. */
  compact?: boolean;
  /** Свёрнутая карточка в очереди: тип, заголовок-ссылка, кто просит; без действий — решение открывается. */
  collapsed?: boolean;
  /** Свёрнутая карточка: нажатие на заголовок — открыть решение (страницу работы). */
  onOpen?: () => void;
  onPrimary?: () => void;
  onSecondary?: () => void;
  /** Заменяет кнопки после нажатия: «Отправляю… → Записано в ядре → Исполнено» и т. п. */
  footer?: ReactNode;
}

export interface ProblemCardProps {
  severity?: "failed" | "blocked" | "stale" | "approaching";
  /** Диагноз на языке организации. */
  diagnosis: ReactNode;
  where?: string;
  since?: string;
  actions?: { label: string; variant?: ButtonProps["variant"]; onClick?: () => void }[];
  /** Строка на всю ширину зоны: диагноз в одну строку, действие справа. */
  row?: boolean;
}

export interface WorkPathStage {
  label: string;
  count: number;
  byKind?: Partial<Record<ExecutorKind, number>>;
  /** Разбивка по происхождению фразой. */
  origin?: string;
  /** Хвост «Снято» (повод отпал). */
  tail?: boolean;
}
export interface WorkPathGate { count: number; reason?: string; mine?: boolean }
export interface WorkPathProps {
  stages: WorkPathStage[];
  gates: WorkPathGate[];
  /** Пульт в одно окно: числа 28px, плотнее отступы. */
  compact?: boolean;
  /** "flow" — числа стадий через стрелки, одна полоса «люди / агенты / процессы» под числом (детали — в подсказке), застрявшее на выходе из стадии — строкой под ней (gates[i] относится к стадии i), «Снято» — отдельно справа; легенда сверху. */
  look?: "flow";
  legend?: boolean;
}

export interface ExecutorCardProps {
  kind?: ExecutorKind;
  name?: string;
  label?: string;
  meta?: string;
  state?: Status;
  stateLabel?: string;
  now?: string;
  /** «Что доверено» одной строкой из объявлений; null — «полномочия не объявлены». */
  trusted?: string | null;
  channel?: string;
  problem?: boolean;
  /** Пустой пост роли. */
  vacant?: boolean;
  role?: string;
}

export interface WorkRowProps {
  status: Status;
  statusLabel?: string;
  title: string;
  /** Номер вторым слоем: TASK-000840. */
  number?: string;
  /** Фраза готовности. */
  readiness?: string;
  seals: SealsProps;
  age?: string;
  /** Главное действие строки на месте. */
  action?: string;
  /** Ссылка на страницу работы — заголовок становится ссылкой. */
  href?: string;
  onAction?: () => void;
  mine?: boolean;
}

export interface ChronicleGroup {
  kind: "origin" | "delivery" | "claim" | "attempt" | "result" | "verify" | "signature" | "discussion" | "spawned" | "reconcile" | "impact";
  kindLabel?: string;
  at?: string;
  title?: ReactNode;
  text?: ReactNode;
  actor?: { kind: ExecutorKind; name: string; label?: string };
  status?: Status;
  /** Ожидание или действие человека — пунктирная дорожка. */
  human?: boolean;
  done?: boolean;
  /** Звено отсутствует: пунктир с причиной в text. */
  missing?: boolean;
  channel?: ChannelChipProps;
  source?: SourceChipProps;
  criteria?: { ok: boolean; text: string }[];
  /** Раскрываемый ящик (протокол, технический слой). */
  box?: ReactNode;
}
export interface ChronicleProps {
  view?: "brief" | "time" | "full";
  onView?: (view: "brief" | "time" | "full") => void;
  groups?: ChronicleGroup[];
  /** Вид «По времени»: полосы в процентах периода. */
  spans?: { label: string; from: number; to: number; dur: string; human?: boolean }[];
  /** Вид «Полный журнал». */
  events?: { at: string; text: string; type: string }[];
  hideViews?: boolean;
}

export interface PlanDiffItem {
  op: "add" | "change" | "remove";
  object: string;
  kind?: string;
  before?: string;
  after?: string;
  /** Владение полем. */
  owner?: string;
  /** Судьба открытых дел. */
  openCases?: string;
}
export interface PlanDiffProps { summary: string; meta?: string; items: PlanDiffItem[]; hash?: string; actions?: boolean }

export interface JournalEntryProps {
  at: string;
  actor: { kind: ExecutorKind; name: string; label?: string };
  verb: string;
  object?: string;
  why?: string;
  channel?: string;
  /** Аварийный путь: аварийный вход, принудительная остановка, ручное отключение. */
  emergency?: boolean;
}

export interface AssistantMessage {
  from?: "user" | "asst";
  text?: ReactNode;
  source?: SourceChipProps;
  proposal?: string;
  detail?: string;
  /** Время сообщения. */
  at?: string;
  /** Канал той же беседы: «из Telegram» у человека, «и в Telegram» у ассистента. */
  channel?: string;
  /** Экран, данные которого ушли с вопросом человека: «по экрану «Сегодня»». */
  context?: string;
  /** Ассистент написал сам: origin — источник («процесс «Оплата счетов»», «агент «Подготовщик заявок»»), подпись «Источник: …»; human — нужен человек (рамка accent). */
  proactive?: { origin: string; human?: boolean; reason?: string };
  /** Действия прямо в сообщении. */
  actions?: { label: string; variant?: ButtonProps["variant"]; onClick?: () => void }[];
  /** Предложение работы: поля «Будет заведено» строками [ключ, значение]. */
  fields?: [string, ReactNode][];
  onAccept?: () => void;
  onEdit?: () => void;
  acceptLabel?: string;
  /** Предложение уже принято: текст вместо кнопок. */
  done?: string;
  /** Разделитель ленты: «Вчера», «Сегодня», «Новое» (unread — граница непрочитанного). */
  divider?: string;
  unread?: boolean;
}
export interface AssistantPanelProps {
  /** Что видит ассистент — текст плашки (только не docked: в панели плашки нет). */
  context?: string;
  contextOn?: boolean;
  onContextToggle?: () => void;
  messages?: AssistantMessage[];
  /** Панель, пристыкованная справа на всю высоту окна: шапка с «Новая беседа» и «Закрыть», лента с прокруткой, поле ввода внизу. */
  docked?: boolean;
  onClose?: () => void;
  /** Беседа одна на человека; кнопка «Новая беседа» появляется, только если передан onNew. */
  onNew?: () => void;
  /** Подсказки пустой беседы — вопросы по тому, что на экране. */
  suggestions?: string[];
  onSuggest?: (q: string) => void;
  hello?: string;
  /** Ответ готовится: «Смотрю…». */
  busy?: boolean;
  /** Поле ввода (docked): Enter — отправить, Shift+Enter — перенос. */
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend?: () => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}

export interface CommandPaletteItem { label: string; hint?: string; kbd?: string; kind?: ExecutorKind; glyph?: string; who?: string; status?: Status; selected?: boolean }
export interface CommandPaletteProps { query?: string; groups: { title: string; items: CommandPaletteItem[] }[] }

export interface DegradedBannerProps { kind?: "stale" | "down"; at?: string; text?: string }

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** Одно действие. */
  action?: string;
  actionVariant?: ButtonProps["variant"];
  /** Схема пути работы — только для онбординга. */
  art?: boolean;
}

export interface NavItem {
  label?: string;
  icon?: ReactNode;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  /** Счётчик справа; human — ждёт человека (accent). */
  count?: number;
  human?: boolean;
  /** Заглушка пункта, пока состав меню не задан. */
  placeholder?: boolean;
}
export interface NavDrawerProps {
  /** Организация в шапке меню (переключатель). */
  org: string;
  orgMeta?: string;
  groups: { title?: string; items: NavItem[] }[];
  /** Закреплено — меню сдвигает экран; иначе выезжает поверх с затемнением. */
  pinned?: boolean;
  onPin?: () => void;
  onClose?: () => void;
  /** Низ меню: настройки, участник. */
  footer?: ReactNode;
  label?: string;
}

export declare const Button: (p: ButtonProps) => JSX.Element;
export declare const ExecutorGlyph: (p: ExecutorGlyphProps) => JSX.Element;
export declare const IdentityBlock: (p: IdentityBlockProps) => JSX.Element;
export declare const StatusMark: (p: StatusMarkProps) => JSX.Element;
export declare const SourceChip: (p: SourceChipProps) => JSX.Element;
export declare const ChannelChip: (p: ChannelChipProps) => JSX.Element;
export declare const Seals: (p: SealsProps) => JSX.Element;
export declare const TopBar: (p: TopBarProps) => JSX.Element;
export declare const Summary: (p: SummaryProps) => JSX.Element;
export declare const DecisionCard: (p: DecisionCardProps) => JSX.Element;
export declare const ProblemCard: ((p: ProblemCardProps) => JSX.Element) & { Calm: (p: { text: string }) => JSX.Element };
export declare const WorkPath: (p: WorkPathProps) => JSX.Element;
export declare const ExecutorCard: (p: ExecutorCardProps) => JSX.Element;
export declare const WorkRow: (p: WorkRowProps) => JSX.Element;
export declare const Chronicle: (p: ChronicleProps) => JSX.Element;
export declare const PlanDiff: (p: PlanDiffProps) => JSX.Element;
export declare const JournalEntry: (p: JournalEntryProps) => JSX.Element;
export declare const AssistantPanel: (p: AssistantPanelProps) => JSX.Element;
export declare const CommandPalette: (p: CommandPaletteProps) => JSX.Element;
export declare const DegradedBanner: ((p: DegradedBannerProps) => JSX.Element) & { Section: (p: { text?: string }) => JSX.Element };
export declare const EmptyState: (p: EmptyStateProps) => JSX.Element;
export declare const NavDrawer: (p: NavDrawerProps) => JSX.Element;
/** Чип связи: «online · 14:02» / «offline · данные на 13:40». */
export declare const LiveChip: (p: { live?: boolean; at?: string; inline?: boolean }) => JSX.Element;

/* ---------- Каркас и общие части экранов (2026-10-02) ---------- */

export interface IconProps {
  name: "search" | "chevronDown" | "check" | "x" | "warn" | "info" | "clock" | "file" | "menu" | "today" | "work" | "knowledge" | "settings" | "arrowLeft";
  /** Подпись для чтения с экрана; без неё значок декоративный. */
  label?: string;
  className?: string;
}

export interface ZoneProps {
  title?: ReactNode;
  /** Число справа от заголовка или подпись («сегодня»). */
  count?: ReactNode;
  /** Узел справа вместо count (ссылка «Весь журнал»). */
  action?: ReactNode;
  /** human — полоса accent «нужен человек»; problem — полоса error, только когда проблема есть. */
  tone?: "human" | "problem";
  label?: string;
  className?: string;
  children?: ReactNode;
}

export interface PageHeaderProps {
  /** Путь: «← Работа». */
  crumbs?: { label: string; href?: string }[];
  /** Номер вторым слоем: TASK-000845. */
  number?: string;
  status?: StatusMarkProps;
  /** Заголовок с глагола. */
  title: ReactNode;
  /** Фраза готовности или пояснение экрана. */
  lead?: ReactNode;
  actions?: ReactNode;
}

export interface DialogProps {
  title: ReactNode;
  sub?: ReactNode;
  /** 960px вместо 640px — форма с предпросмотром. */
  wide?: boolean;
  /** alertdialog — для необратимых действий. */
  alert?: boolean;
  onClose?: () => void;
  /** Слева в подвале: «Обратимо: …» / «Необратимо: …». */
  hint?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export interface ConsequenceItem {
  /** ok — безопасно / уже ничего не менялось; warn — заметное или необратимое; info — нейтрально. */
  tone?: "ok" | "warn" | "info";
  /** «Текущая попытка», «Что уже сделано вовне», «Обратимо ли», «Дело процесса». */
  k: ReactNode;
  v: ReactNode;
}
export interface ConsequencesProps { items: ConsequenceItem[]; label?: string }

export interface CriterionItem {
  text: ReactNode;
  /** «автопроверка», «внешнее состояние», «человек», «оценка модели». */
  kind: string;
  /** ok — пройден, bad — не пройден, wait — ждёт; нет — проверка впереди. */
  state?: "ok" | "bad" | "wait";
}
export interface CriteriaProps { items: CriterionItem[]; label?: string }

export interface CalloutProps { tone?: "warning" | "info"; children?: ReactNode }

export interface DecisionStatusRow {
  /** wait — отправляется/исполняется, done — подтверждено ядром, fail — не записано, warn — нужно проверить заново. */
  state?: "wait" | "done" | "fail" | "warn";
  text: ReactNode;
  at?: string;
}
export interface DecisionStatusProps { rows: DecisionStatusRow[]; actions?: ReactNode }

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  /** На всю ширину сетки .tc-form. */
  wide?: boolean;
  /** Поле: <input class="tc-input">, <select class="tc-select">, <textarea class="tc-textarea">. */
  children?: ReactNode;
}

export interface PersonOption {
  id: string;
  name: string;
  kind?: ExecutorKind;
  glyph?: string;
  /** Роль и занятость: «Бухгалтер · в работе 3». */
  meta?: string;
  /** Нет нужной роли — meta предупреждением. */
  warn?: boolean;
  disabled?: boolean;
}
export interface PersonPickerProps { options: PersonOption[]; value?: string; onChange?: (id: string) => void; name?: string; label?: string }
export interface ComboOption {
  /** null — «ничего не выбрано». */
  value: string | null;
  label: string;
  /** Справа: роль, тип, путь. Строка участвует в поиске. */
  meta?: ReactNode;
  /** Дополнительный текст для поиска (ключ, путь). */
  search?: string;
  /** Исполнитель — глиф вида (человек, агент, сервис). */
  kind?: ExecutorKind;
  glyph?: string;
  /** Отступ уровня дерева (пространства). */
  depth?: number;
  warn?: boolean;
  disabled?: boolean;
}
export interface ComboboxProps {
  options: ComboOption[];
  value?: string | null;
  onChange?: (value: string | null) => void;
  /** aria-label поля и списка. */
  label?: string;
  placeholder?: string;
  /** Первый вариант «ничего не выбрано» (value null). */
  clearLabel?: string;
  emptyText?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Список открыт сразу — превью и тесты. */
  defaultOpen?: boolean;
}

export interface WorkPreviewProps {
  title?: ReactNode;
  /** Строки «Будет заведено»: [ключ, значение]. */
  fields?: [ReactNode, ReactNode][];
  seals?: SealsProps;
  label?: string;
}

export interface SearchFieldProps { placeholder?: string; value?: string; onChange?: (e: any) => void; label?: string; style?: any }
export interface FilterChipProps {
  label: string;
  /** С value — выпадающий фильтр «Тип работы: все ▾»; без — переключатель с pressed. */
  value?: string;
  pressed?: boolean;
  count?: number;
  onClick?: () => void;
}

export interface WorkGroupProps {
  title: string;
  count?: ReactNode;
  hint?: ReactNode;
  /** «Ждёт вас» — полоса accent. */
  human?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** Число — «Показать ещё N»; true — «Показать ещё», когда сколько осталось неизвестно. */
  more?: number | boolean;
  onMore?: () => void;
  /** Строки WorkRow. */
  children?: ReactNode;
  /** Пустая группа: «Ничего не застряло» или баннер сбоя — вне таблицы строк (таблица без строк недопустима). */
  empty?: ReactNode;
}

export interface DataTableColumn { key: string; title: ReactNode; num?: boolean }
export interface DataTableProps {
  columns: DataTableColumn[];
  /** Строка — объект по ключам колонок; ячейка — значение или узел (классы tc-cell-title, tc-cell-sub, tc-cell-warn). */
  rows: Record<string, ReactNode>[];
  caption?: string;
}

export interface AppShellProps {
  /** TopBar. */
  topbar: ReactNode;
  /** NavDrawer. */
  nav?: ReactNode;
  navOpen?: boolean;
  /** Закреплено — меню сдвигает экран (от 1280px); иначе поверх с затемнением. */
  navPinned?: boolean;
  onScrim?: () => void;
  navId?: string;
  /** AssistantPanel docked. */
  assistant?: ReactNode;
  assistantOpen?: boolean;
  assistantId?: string;
  /** LiveChip в верхнем отступе экрана. */
  status?: ReactNode;
  children?: ReactNode;
}

export declare const Icon: (p: IconProps) => JSX.Element;
export declare const Zone: (p: ZoneProps) => JSX.Element;
export declare const PageHeader: (p: PageHeaderProps) => JSX.Element;
export declare const Dialog: (p: DialogProps) => JSX.Element;
export declare const Consequences: (p: ConsequencesProps) => JSX.Element;
export declare const Criteria: (p: CriteriaProps) => JSX.Element;
export declare const Callout: (p: CalloutProps) => JSX.Element;
export declare const DecisionStatus: (p: DecisionStatusProps) => JSX.Element;
export declare const Field: (p: FieldProps) => JSX.Element;
export declare const PersonPicker: (p: PersonPickerProps) => JSX.Element;
/** Выбор из длинного списка поиском: люди, агенты, типы работ, пространства. */
export declare const Combobox: (p: ComboboxProps) => JSX.Element;
export declare const WorkPreview: (p: WorkPreviewProps) => JSX.Element;
export declare const SearchField: (p: SearchFieldProps) => JSX.Element;
export declare const FilterChip: (p: FilterChipProps) => JSX.Element;
export declare const WorkGroup: (p: WorkGroupProps) => JSX.Element;
export declare const DataTable: (p: DataTableProps) => JSX.Element;
export declare const AppShell: (p: AppShellProps) => JSX.Element;

/* ---------- Локали ---------- */

/** Язык встроенных строк компонентов: en — основной язык открытой поставки, ru — второй. */
export type Locale = "en" | "ru";

export interface LocaleProviderProps {
  /** Язык встроенных строк внутри; «ru-RU», «en-GB» сводятся к ru / en. */
  locale: Locale;
  children?: ReactNode;
}

/**
 * Язык встроенных строк для поддерева; разметки не добавляет. Ближайший провайдер побеждает.
 * Без провайдера — язык документа (document.documentElement.lang начинается с ru или en), иначе en;
 * вне браузера (нет document) — en.
 */
export declare const LocaleProvider: (p: LocaleProviderProps) => JSX.Element;

/** Хук React: текущая локаль — LocaleProvider → lang документа → en. */
export declare function useLocale(): Locale;

/** Формы числа по категориям Intl.PluralRules: en — one/other, ru — one/few/many/other. */
export interface PluralForms { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }

/** Словарь встроенных строк: ключ по смыслу («status.running», «decision.approve»); подстановки — {имя}, число — {n}. */
export declare const STRINGS: Record<Locale, Record<string, string | PluralForms>>;

/** Слова статусов StatusMark по локалям — срез словаря (status.*). */
export declare const STATUS_WORD: Record<Locale, Record<Status, string>>;
