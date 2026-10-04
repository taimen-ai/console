// Тест паритета: каждый компонент @console/ui рендерит ровно ту же разметку, что и классический
// design-system/components/bundle.js. Бандл исполняется в node:vm с window = { React } — тем же React,
// что у пакета; обе версии рендерятся react-dom/server с одинаковыми пропсами, HTML сравнивается строго
// (renderToStaticMarkup и renderToString — второй ловит и разбиение текстовых узлов). Каждый вариант
// рендерится в обеих локалях: вокруг компонента — один и тот же LocaleProvider обеих библиотек
// (у бандла и пакета свои React-контексты, а в пропсах вариантов встречаются узлы из пакета).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import * as React from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as UI from "../src/index";

type AnyProps = Record<string, unknown>;
type AnyComponent = ComponentType<AnyProps> & Record<string, unknown>;

const BUNDLE = resolve(import.meta.dirname, "../../../design-system/components/bundle.js");

function loadBundle(): Record<string, unknown> {
  const sandbox: { window: { React: typeof React; TaimenConsole?: Record<string, unknown> } } = { window: { React } };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(BUNDLE, "utf8"), sandbox, { filename: "bundle.js" });
  if (!sandbox.window.TaimenConsole) throw new Error("bundle.js не положил window.TaimenConsole");
  return sandbox.window.TaimenConsole;
}

const OLD = loadBundle();
const NEW = UI as unknown as Record<string, unknown>;

/** Компонент по имени, со статическим членом (ProblemCard.Calm и т. п.). */
function pick(lib: Record<string, unknown>, name: string, sub?: string): AnyComponent {
  const base = lib[name] as AnyComponent | undefined;
  if (!base) throw new Error(`нет компонента ${name}`);
  if (!sub) return base;
  const member = base[sub] as AnyComponent | undefined;
  if (!member) throw new Error(`нет компонента ${name}.${sub}`);
  return member;
}

const noop = () => {};

/* ---------- Данные демо-организации (из README и preview.html компонентов) ---------- */
const fullSeals = {
  origin: { kind: "rule", text: "правило «Счёт получен»" },
  executor: { kind: "agent", name: "Сверщик счетов", label: "Сс", meta: "r7" },
  evidence: { method: "external", text: "платёж проведён банком" },
  signature: { who: "Ирина Котова", channel: "Telegram", at: "12:41" },
};
const pendingSeals = {
  origin: { kind: "human", text: "поручение Ирины", name: "Ирина Котова" },
  executor: { kind: "human", name: "Иван Лебедев" },
  evidence: { method: "pending" },
  signature: { pending: true, who: "финансовый директор" },
};
const otherSeals = {
  origin: { kind: "process", text: "процесс «Оплата счетов»" },
  executor: null,
  evidence: { method: "model" },
  signature: null,
};
const externalSeals = {
  origin: { kind: "external", text: "из 1С" },
  executor: { kind: "process", name: "Оплата счетов", label: "ОС" },
  evidence: { method: "failed", text: "сумма не совпала" },
  signature: null,
};
const noneSeals = { origin: { kind: "parent", text: "из работы TASK-000412" }, executor: null, evidence: { method: "none" }, signature: null };

const stages = [
  { label: "Возникло", count: 42, byKind: { human: 5, agent: 20, process: 17 }, origin: "правила 30 · люди 12" },
  { label: "Поручено", count: 38, byKind: { human: 8, agent: 30 } },
  { label: "Исполняется", count: 12, byKind: { agent: 9, process: 3 } },
  { label: "Проверено", count: 9, byKind: {} },
  { label: "Снято", count: 4, tail: true },
];
const gates = [
  { count: 3, reason: "ждут исполнителя" },
  { count: 0 },
  { count: 2, reason: "ждут вашей приёмки", mine: true },
  null,
];

const navGroups = [
  { items: [
    { label: "Сегодня", icon: <UI.Icon name="today" />, href: "/", active: true },
    { label: "Работа", icon: <UI.Icon name="work" />, href: "/work", count: 3, human: true },
    { label: "Знания", icon: <UI.Icon name="knowledge" />, href: "/knowledge", count: 0, onClick: noop },
  ] },
  { title: "Настройка", items: [{ label: "Настройки", icon: <UI.Icon name="settings" /> }, { placeholder: true }, { placeholder: true, label: "Отчёты" }] },
];

const assistantMessages = [
  { divider: "Вчера" },
  { from: "user", text: "Почему стоит?", at: "18:02", channel: "Telegram", context: "«Сегодня»" },
  { from: "asst", text: "Проверка «сумма совпадает с актом» не прошла трижды.", source: { source: "authoritative" }, at: "18:02", channel: "Telegram" },
  { divider: "Новое", unread: true },
  { from: "asst", proactive: { origin: "процесс «Оплата счетов»", human: true }, text: "Счёт №421 ждёт решения больше суток.",
    actions: [{ label: "Открыть решение", onClick: noop }, { label: "Напомнить завтра" }, { label: "Снять", variant: "danger" }], at: "09:10" },
  { from: "asst", proactive: { reason: "застряло 2 дня" }, text: "Тендер №0373 без гарантии.", source: { source: "recalled", freshness: "запомнено 3 дня назад" } },
  { from: "user", text: "Поручи Ивану запросить у поставщика исправленный счёт", context: "история работы" },
  { proposal: "Запросить исправленный счёт у «Вектор»", detail: "Выполняет: Иван Лебедев · срок 1 день",
    fields: [["Исполнитель", "Иван Лебедев"], ["Срок", "1 день"], ["Основание", <b key="b">«Сверить счёт №421»</b>]], onAccept: noop, onEdit: noop },
  { proposal: "Запросить акт сверки", done: "Работа заведена: TASK-000851" },
];

const decisionFull = {
  kind: "Согласование", holds: true, due: "срок сегодня 18:00",
  title: <span>Согласовать оплату счёта «Альфа-Снаб», <span className="tc-num">184 500 ₽</span></span>,
  requester: { kind: "process", name: "Оплата счетов", label: "ОС", meta: "шаг «Согласование»" },
  since: "с 12:37", delivery: { channel: "Telegram", state: "delivered", at: "12:40" },
  why: "сумма выше порога 150 000 ₽ по таблице согласования.",
  yes: "Бухгалтерия получит уведомление, работа перейдёт в «Оплачивается».",
  yesExternal: "Внешний эффект: платёжное поручение в банк. Необратимо.",
  no: "Счёт будет отозван, поставщику уйдёт письмо с причиной.",
  preconditions: [{ ok: true, text: "Договор с «Альфа-Снаб» действует" }, { ok: true, text: "Счёт сверен с поставкой" }],
  risk: "high", evidence: ["Счёт №417 от 25.09 (PDF)", { label: "Акт сверки с поставкой — из 1С", href: "/docs/act-417", target: "_blank" }, { label: "Таблица согласования v3" }],
  primary: "Согласовать оплату", kbd: "E", onPrimary: noop, onSecondary: noop,
};

interface Case { name: string; sub?: string; variant: string; props: AnyProps }

/* Варианты: по 1–3 на компонент, с ветками compact/collapsed/row/docked, пустыми и непустыми списками. */
const CASES: Case[] = [
  // Button
  { name: "Button", variant: "по умолчанию", props: { children: "Отклонить…" } },
  { name: "Button", variant: "human + kbd + icon + aria", props: { variant: "human", size: "sm", kbd: "E", icon: <UI.Icon name="check" />, "aria-label": "Согласовать", disabled: true, onClick: noop, children: "Согласовать" } },
  { name: "Button", variant: "className и type submit", props: { className: "extra", type: "submit", variant: "danger", id: "b1", children: ["Снять", " работу"] } },
  // ExecutorGlyph
  { name: "ExecutorGlyph", variant: "человек по имени", props: { kind: "human", name: "Ирина Котова" } },
  { name: "ExecutorGlyph", variant: "агент, ожидание, lg", props: { kind: "agent", name: "Подготовщик", size: "lg", waiting: true } },
  { name: "ExecutorGlyph", variant: "процесс с меткой, вакантно, без kind", props: { label: "?", vacant: true, size: "sm" } },
  // IdentityBlock
  { name: "IdentityBlock", variant: "полный", props: { kind: "human", name: "Ирина Котова", meta: "Финансовый директор", now: "решает 2 согласования", waiting: true } },
  { name: "IdentityBlock", variant: "inline sm", props: { kind: "process", name: "Оплата счетов", label: "ОС", inline: true, size: "sm" } },
  // StatusMark
  { name: "StatusMark", variant: "ждёт меня", props: { status: "waiting_human", mine: true, machine: "waiting_approval" } },
  { name: "StatusMark", variant: "все формы без подложки", props: { status: "waiting_external", pill: false, label: "ждёт банк" } },
  { name: "StatusMark", variant: "неизвестный статус", props: { status: "archived" } },
  // SourceChip
  { name: "SourceChip", variant: "ядро", props: { source: "authoritative" } },
  { name: "SourceChip", variant: "из памяти со свежестью", props: { source: "recalled", freshness: "запомнено 3 дня назад" } },
  { name: "SourceChip", variant: "только значок", props: { source: "external", label: "из 1С", freshness: "12:30", iconOnly: true } },
  // ChannelChip
  { name: "ChannelChip", variant: "доставлено", props: { channel: "Telegram", state: "delivered", at: "12:40" } },
  { name: "ChannelChip", variant: "решено", props: { channel: "почта", state: "decided" } },
  { name: "ChannelChip", variant: "не доставлено", props: { state: "failed", reason: "бот заблокирован" } },
  // LiveChip
  { name: "LiveChip", variant: "online", props: { at: "14:02" } },
  { name: "LiveChip", variant: "offline inline", props: { live: false, at: "13:40", inline: true } },
  // Seals
  { name: "Seals", variant: "строка", props: fullSeals },
  { name: "Seals", variant: "подписи", props: { ...pendingSeals, labelled: true } },
  { name: "Seals", variant: "пусто", props: {} },
  { name: "Seals", sub: "Evidence", variant: "печать «проверено»", props: { method: "auto" } },
  { name: "Seals", sub: "Evidence", variant: "оценка модели", props: { method: "model", text: "оценкой модели r2" } },
  // TopBar
  { name: "TopBar", variant: "полная строка", props: { brand: { name: "Taimen", mark: "T" }, org: "Полярис", date: "Сегодня, 29 сентября", at: "14:02", period: "24 ч", user: "Ирина Котова",
    onMenu: noop, menuOpen: true, menuId: "nav", onAssistant: noop, assistantId: "assist", assistantUnread: 3, assistantUrgent: true } },
  { name: "TopBar", variant: "с областью работы", props: { org: "Полярис", date: "Сегодня", scope: <span>Финансы</span> } },
  { name: "TopBar", variant: "без бренда, offline, ассистент открыт", props: { org: "Полярис", date: "Сегодня", at: "13:40", live: false, periods: ["День", "Месяц"], assistantOpen: true } },
  { name: "TopBar", variant: "без индикатора связи", props: { org: "Полярис", date: "Сегодня", at: "14:02", showLive: false, assistantUnread: 0 } },
  // Summary
  { name: "Summary", variant: "полный", props: { verified: 9, submitted: 12, unit: "работ", waiting: 2, broken: 1,
    changes: [
      { title: "Оплачено 3 счёта на 412 000 ₽", method: "external", evidence: "Выписка банка", evidenceHref: "/docs/bank" },
      { title: "Подано 2 заявки на тендеры", method: "human", methodText: "руководителем отдела", evidence: "Заявки" },
      { title: "Снято 2 работы: повод отпал", small: true },
    ] } },
  { name: "Summary", variant: "compact", props: { verified: 1, submitted: 4, unit: "работу", lead: "Сегодня доведено ", waiting: 0, broken: 0, compact: true,
    changes: [
      { title: "Оплачен счёт «Вектор»", method: "pending" },
      { title: "Снято: дубль счёта", small: true },
      { title: "Снято: поставщик отозвал", small: true },
    ] } },
  { name: "Summary", variant: "пусто", props: { verified: 0, submitted: 6, empty: "Проверенных результатов за сегодня ещё нет — 6 работ на проверке" } },
  // DecisionCard
  { name: "DecisionCard", variant: "полная, риск высокий", props: decisionFull },
  { name: "DecisionCard", variant: "compact, предусловие не выполнено", props: { kind: "Приёмка", title: "Принять заявку на тендер №0373200041",
    requester: { kind: "agent", name: "Подготовщик заявок", label: "Пз", meta: "r4" }, since: "с 11:02", why: "вы — ответственный за тендерный отдел.",
    yes: "Заявка уйдёт на подпись ЭЦП.", no: "Вернётся исполнителю с причиной.",
    preconditions: [{ ok: false, text: "Пока нельзя подписать: не приложена банковская гарантия" }],
    proposal: "подать без гарантии нельзя — предлагаю запросить её у банка.", evidence: ["Заявка (DOCX)", { label: "Требования закупки", href: "/docs/req" }],
    primary: "Принять", compact: true } },
  { name: "DecisionCard", variant: "только чтение / исключён / footer / collapsed", props: { kind: "Согласование", mine: false, title: "Согласовать оплату счёта «Вектор», 96 000 ₽",
    requester: { kind: "process", name: "Оплата счетов", label: "ОС" },
    readOnlyReason: "Режим чтения: вы аудитор. Решает бухгалтерия (до 100 000 ₽)." } },
  { name: "DecisionCard", variant: "excluded + evidence свёрнуты + без dismiss", props: { title: "Согласовать договор", excluded: "Вам нельзя решать: разделение обязанностей",
    evidence: ["Договор", "Протокол"], dismissible: false, secondary: "Вернуть" } },
  { name: "DecisionCard", variant: "footer вместо кнопок, evidenceOpen", props: { title: "Согласовать оплату", evidence: ["Счёт"], evidenceOpen: true,
    footer: <UI.DecisionStatus rows={[{ state: "done", text: "Записано в ядре", at: "12:41" }, { text: "Исполняется" }]} /> } },
  { name: "DecisionCard", variant: "collapsed", props: { kind: "Приёмка", holds: true, since: "с 09:12", title: "Принять акт сверки «Альфа-Снаб»",
    requester: { kind: "agent", name: "Сверщик", label: "Св", meta: "r7" }, collapsed: true } },
  { name: "DecisionCard", variant: "collapsed без requester, только чтение", props: { title: "Принять отчёт", collapsed: true, readOnlyReason: "аудитор" } },
  // ProblemCard
  { name: "ProblemCard", variant: "сбой с действиями", props: { diagnosis: "Сверка счёта №421 не проходит трижды: сумма в акте 96 000 ₽, в счёте 99 600 ₽", where: "Оплата счетов · шаг «Сверка»", since: "2 дня",
    actions: [{ label: "Передать человеку", onClick: noop }, { label: "Спросить, почему стоит" }, { label: "Остановить", variant: "danger" }] } },
  { name: "ProblemCard", variant: "застряло, строка", props: { severity: "blocked", diagnosis: "Нет исполнителя с ролью «Юрист»", where: "Тендеры", row: true, actions: [] } },
  { name: "ProblemCard", variant: "приближается срок", props: { severity: "approaching", diagnosis: "До срока подачи 4 часа", since: "с 10:00" } },
  { name: "ProblemCard", sub: "Calm", variant: "всё штатно", props: { text: "Сбоев и застрявших работ нет" } },
  // WorkPath
  { name: "WorkPath", variant: "стадии и ворота", props: { stages, gates } },
  { name: "WorkPath", variant: "compact", props: { stages: stages.slice(0, 3), gates: gates.slice(0, 2), compact: true } },
  { name: "WorkPath", variant: "flow", props: { look: "flow", stages, gates } },
  { name: "WorkPath", variant: "flow без легенды, пусто", props: { look: "flow", legend: false } },
  { name: "WorkPath", variant: "пусто", props: {} },
  // ExecutorCard
  { name: "ExecutorCard", variant: "агент с проблемой", props: { kind: "agent", name: "Сверщик счетов", label: "Сс", meta: "r7", state: "blocked", stateLabel: "застрял на сверке",
    now: "сверяет счёт №421", trusted: "сверка счетов до 200 000 ₽", channel: "Telegram", problem: true } },
  { name: "ExecutorCard", variant: "без полномочий", props: { kind: "human", name: "Иван Лебедев", trusted: null } },
  { name: "ExecutorCard", variant: "вакантно", props: { vacant: true, role: "Юрист", now: "3 работы ждут исполнителя" } },
  // WorkRow
  { name: "WorkRow", variant: "моя, со ссылкой", props: { status: "waiting_human", title: "Согласовать оплату счёта «Альфа-Снаб»", number: "TASK-000840", readiness: "все автопроверки пройдены",
    seals: pendingSeals, age: "2 ч", action: "Согласовать", href: "/work/TASK-000840", onAction: noop, mine: true } },
  { name: "WorkRow", variant: "без печатей", props: { status: "failed", statusLabel: "не прошла сверка", title: "Сверить счёт №421" } },
  { name: "WorkRow", variant: "другие печати", props: { status: "verified", title: "Оплатить счёт «Вектор»", seals: externalSeals, action: "Открыть", age: "вчера" } },
  // Chronicle
  { name: "Chronicle", variant: "кратко", props: { view: "brief", onView: noop, groups: [
    { kind: "origin", at: "12:36", status: "running", title: "Правило «Счёт получен» завело работу",
      text: <span>Факт <b>«счёт №417 получен»</b> — сработало условие.</span>, source: { source: "external", label: "из 1С" } },
    { kind: "delivery", at: "12:37", human: true, done: true, actor: { kind: "human", name: "Ирина Котова" }, title: "Карточка финансовому директору",
      channel: { channel: "Telegram", state: "decided", at: "12:41" }, text: "Доставлено 12:40 → открыто 12:41." },
    { kind: "claim", human: true, actor: { kind: "human", name: "Иван Лебедев" } },
    { kind: "attempt", at: "12:42", actor: { kind: "process", name: "Оплата счетов", label: "ОС" }, title: "Попытка №1 · 3 мин", box: "Протокол: 6 шагов" },
    { kind: "verify", at: "13:05", status: "verified", title: "Проверено внешним состоянием",
      criteria: [{ ok: true, text: "Платёж проведён банком — 184 500 ₽" }, { ok: false, text: "Сумма совпадает со счётом" }] },
    { kind: "result", status: "failed", kindLabel: "Итог попытки", title: "Не удалось" },
    { kind: "reconcile", missing: true, title: "Сверки ещё не было", text: "Звена нет: сверка раз в сутки." },
  ] } },
  { name: "Chronicle", variant: "по времени", props: { view: "time", spans: [
    { label: "Ждало подписи", from: 0, to: 40, dur: "4 ч", human: true }, { label: "Исполнялось", from: 40, to: 40.5, dur: "3 мин" },
  ] } },
  { name: "Chronicle", variant: "полный журнал без переключателя", props: { view: "full", hideViews: true, events: [
    { at: "12:36:02", text: "Работа заведена правилом", type: "task.created" }, { at: "12:41:10", text: "Согласовано", type: "approval.decided" },
  ] } },
  // PlanDiff
  { name: "PlanDiff", variant: "план", props: { summary: "Пакет «Оплата счетов» 0.7.0: 2 добавится, 1 изменится, 1 уйдёт", meta: "с 0.6.2", hash: "sha256:9f2c…",
    items: [
      { op: "add", object: "Правило «invoice-sla-escalation»", kind: "правило" },
      { op: "change", object: "Процесс «Оплата счетов»", kind: "процесс", before: "v2", after: "v3", owner: "поле «порог» принадлежит организации", openCases: "3 открытых дела доработают на v2" },
      { op: "remove", object: "Правило «invoice-received»", before: "включено" },
      { op: "add", object: "Календарь «ru»", after: "рабочие часы" },
    ] } },
  { name: "PlanDiff", variant: "без действий и пунктов", props: { summary: "Изменений нет", actions: false } },
  // JournalEntry
  { name: "JournalEntry", variant: "решение из канала", props: { at: "12:41", actor: { kind: "human", name: "Ирина Котова" }, verb: "согласовала", object: "оплату счёта №417", channel: "Telegram", why: "поставка принята" } },
  { name: "JournalEntry", variant: "аварийно", props: { at: "03:12", actor: { kind: "agent", name: "Сверщик", label: "Св" }, verb: "остановлен вручную", emergency: true } },
  // AssistantPanel
  { name: "AssistantPanel", variant: "плашка контекста", props: { context: "история «Сверить счёт №421», попытка №3", messages: assistantMessages.slice(1, 3), busy: true } },
  { name: "AssistantPanel", variant: "контекст выключен, пусто с подсказками", props: { contextOn: false, suggestions: ["Почему стоит?", "Кто решает?"], hello: "Привет" } },
  { name: "AssistantPanel", variant: "docked с лентой и подсказками", props: { docked: true, onNew: noop, onClose: noop, messages: assistantMessages,
    suggestions: ["Что сломано?", "Что ждёт меня?"], value: "Поручи Ивану", onChange: noop, onSend: noop } },
  { name: "AssistantPanel", variant: "docked пусто, пустое поле", props: { docked: true, suggestions: ["Что ждёт меня?"], value: "   " } },
  // CommandPalette
  { name: "CommandPalette", variant: "группы", props: { query: "счёт", groups: [
    { title: "Работа", items: [{ label: "Сверить счёт №421", status: "failed", hint: "TASK-000421", selected: true }, { label: "Оплатить счёт «Вектор»", status: "verified" }] },
    { title: "Люди и агенты", items: [{ label: "Ирина Котова", kind: "human" }, { label: "Сверщик", kind: "agent", glyph: "Св", who: "Сверщик счетов" }] },
    { title: "Действия", items: [{ label: "Поручить работу", kbd: "E" }] },
  ] } },
  { name: "CommandPalette", variant: "пусто", props: {} },
  // DegradedBanner
  { name: "DegradedBanner", variant: "данные устарели", props: { at: "13:40" } },
  { name: "DegradedBanner", variant: "ядро недоступно", props: { kind: "down", at: "13:40" } },
  { name: "DegradedBanner", variant: "свой текст", props: { kind: "down", text: "Нет связи с ядром" } },
  { name: "DegradedBanner", sub: "Section", variant: "секция", props: {} },
  { name: "DegradedBanner", sub: "Section", variant: "секция со своим текстом", props: { text: "Память не ответила" } },
  // EmptyState
  { name: "EmptyState", variant: "онбординг", props: { title: "Работы пока нет", body: "Установите пакет — правила начнут заводить работу.", action: "Установить пакет", art: true } },
  { name: "EmptyState", variant: "спокойно", props: { title: "Ничего не ждёт вашей подписи", action: "Открыть журнал", actionVariant: "ghost" } },
  { name: "EmptyState", variant: "только заголовок", props: { title: "Пусто" } },
  // NavDrawer
  { name: "NavDrawer", variant: "закреплено", props: { org: "Полярис", orgMeta: "демо-организация", groups: navGroups, pinned: true, onPin: noop, onClose: noop, footer: "Ирина Котова", label: "Меню" } },
  { name: "NavDrawer", variant: "без групп", props: { org: "Полярис", onPin: noop } },
  // Icon
  { name: "Icon", variant: "декоративный", props: { name: "search" } },
  { name: "Icon", variant: "с подписью и классом", props: { name: "knowledge", label: "Знания", className: "big" } },
  { name: "Icon", variant: "неизвестное имя", props: { name: "rocket" } },
  // Zone
  { name: "Zone", variant: "human со счётчиком", props: { title: "Ждёт вашей подписи", count: 2, tone: "human", children: <p>Карточки</p> } },
  { name: "Zone", variant: "problem с действием и стилем", props: { title: <span>Сломано</span>, label: "Сломано / застряло", action: <a href="/journal">Весь журнал</a>, count: 5, tone: "problem", className: "x", style: { gridColumn: "1 / -1" }, children: "текст" } },
  { name: "Zone", variant: "без заголовка", props: { children: <p>Только тело</p> } },
  // PageHeader
  { name: "PageHeader", variant: "полный", props: { crumbs: [{ label: "← Работа", href: "/work" }, { label: "Оплата счетов" }], number: "TASK-000845",
    status: { status: "running" }, title: "Сверить счёт №421", lead: "Готово к приёмке после проверки суммы", actions: <UI.Button>Остановить</UI.Button> } },
  { name: "PageHeader", variant: "только номер", props: { number: "TASK-000846", crumbs: [], title: "Оплатить счёт" } },
  { name: "PageHeader", variant: "минимальный", props: { title: "Работа" } },
  // Dialog
  { name: "Dialog", variant: "alert с подвалом", props: { title: "Снять работу", sub: "TASK-000421 · Сверить счёт", alert: true, onClose: noop,
    hint: "Необратимо: попытка будет остановлена", footer: <><UI.Button variant="ghost">Отмена</UI.Button><UI.Button variant="danger">Снять</UI.Button></>,
    children: <UI.Consequences items={[{ tone: "warn", k: "Текущая попытка", v: "будет остановлена" }, { tone: "ok", k: "Что уже сделано вовне", v: "ничего" }, { k: "Дело процесса", v: "закроется" }]} /> } },
  { name: "Dialog", variant: "wide без подвала", props: { title: "Поручить работу", wide: true, children: <input className="tc-input" /> } },
  { name: "Dialog", variant: "подвал без подсказки", props: { title: "Передать человеку", footer: <UI.Button>Передать</UI.Button> } },
  // Consequences
  { name: "Consequences", variant: "три тона", props: { label: "Последствия", items: [{ tone: "ok", k: "Обратимо ли", v: "да, в течение суток" }, { tone: "warn", k: "Вовне", v: "письмо поставщику" }, { k: "Охват", v: "1 работа" }] } },
  { name: "Consequences", variant: "пусто", props: { items: [] } },
  // Criteria
  { name: "Criteria", variant: "все состояния", props: { items: [
    { text: "Сумма совпадает с актом", kind: "автопроверка", state: "ok" }, { text: "Платёж проведён", kind: "внешнее состояние", state: "bad" },
    { text: "Приёмка руководителем", kind: "человек", state: "wait" }, { text: "Текст письма вежлив", kind: "оценка модели" },
  ] } },
  { name: "Criteria", variant: "своя подпись", props: { label: "Проверки", items: [{ text: "Тесты зелёные", kind: "автопроверка" }] } },
  // Callout
  { name: "Callout", variant: "предупреждение", props: { children: "Действие нельзя отменить." } },
  { name: "Callout", variant: "пояснение", props: { tone: "info", children: <><b>Важно:</b> работа будет заведена после подписи.</> } },
  // DecisionStatus
  { name: "DecisionStatus", variant: "все состояния", props: { rows: [
    { state: "done", text: "Записано в ядре", at: "12:41" }, { state: "wait", text: "Исполняется" }, { state: "fail", text: "Ядро отказало: срок истёк" }, { state: "warn", text: "Проверьте заново" }, { text: "Отправляю…" },
  ], actions: <UI.Button size="sm">Повторить</UI.Button> } },
  { name: "DecisionStatus", variant: "пусто", props: { rows: [] } },
  // Field
  { name: "Field", variant: "с подсказкой, широкое", props: { label: "Причина", help: "Её увидит исполнитель", wide: true, children: <textarea className="tc-textarea" defaultValue="" /> } },
  { name: "Field", variant: "простое", props: { label: "Срок", children: <input className="tc-input" defaultValue="1 день" /> } },
  // PersonPicker
  { name: "PersonPicker", variant: "список", props: { value: "u2", onChange: noop, name: "assignee", label: "Кому поручить", options: [
    { id: "u1", name: "Ирина Котова", meta: "Финансовый директор · в работе 2" },
    { id: "u2", name: "Иван Лебедев", meta: "Бухгалтер · в работе 3" },
    { id: "a1", name: "Сверщик счетов", kind: "agent", glyph: "Сс", meta: "нет роли «Юрист»", warn: true },
    { id: "u3", name: "Пётр Сидоров", disabled: true },
  ] } },
  { name: "PersonPicker", variant: "пусто", props: { options: [] } },
  // Combobox
  { name: "Combobox", variant: "закрыт, выбрано", props: { label: "Исполняет", value: "u2", onChange: noop, options: [
    { value: "u1", label: "Ирина Котова", kind: "human", meta: "Финансовый директор" },
    { value: "u2", label: "Иван Лебедев", kind: "human", meta: "Бухгалтер" },
  ] } },
  { name: "Combobox", variant: "открыт: очистка, исполнители, предупреждение, выключенный", props: { label: "Исполняет", value: "a1", clearLabel: "пока не назначено", defaultOpen: true, id: "exec", options: [
    { value: "u1", label: "Ирина Котова", kind: "human", glyph: "ИК", meta: "нет роли «Бухгалтер»", warn: true },
    { value: "a1", label: "Сверщик счетов", kind: "agent", meta: "агент" },
    { value: "u3", label: "Пётр Сидоров", kind: "human", disabled: true },
  ] } },
  { name: "Combobox", variant: "открыт: дерево пространств", props: { label: "Пространство", placeholder: "Все пространства", defaultOpen: true, options: [
    { value: "org", label: "Полярис" }, { value: "fin", label: "Финансы", depth: 1, meta: "Полярис" }, { value: "pay", label: "Оплата счетов", depth: 2, search: "Полярис Финансы" },
  ] } },
  { name: "Combobox", variant: "открыт, пусто", props: { label: "Тип работы", defaultOpen: true, options: [], emptyText: "Типов нет" } },
  { name: "Combobox", variant: "выключен, ошибка", props: { label: "Тип", disabled: true, invalid: true, options: [] } },
  // WorkPreview
  { name: "WorkPreview", variant: "с полями и печатями", props: { title: "Запросить исправленный счёт у «Вектор»", fields: [["Исполнитель", "Иван Лебедев"], ["Срок", ""], ["Основание", <b key="o">TASK-000421</b>]], seals: noneSeals } },
  { name: "WorkPreview", variant: "пусто со своей подписью", props: { label: "Будет изменено" } },
  { name: "WorkPreview", variant: "печати процесса", props: { title: "Оплатить", seals: otherSeals } },
  // SearchField
  { name: "SearchField", variant: "с подписью и стилем", props: { placeholder: "Найти работу", value: "счёт", onChange: noop, label: "Поиск работы", style: { maxWidth: 320 } } },
  { name: "SearchField", variant: "только placeholder", props: { placeholder: "Найти человека" } },
  // FilterChip
  { name: "FilterChip", variant: "выпадающий со счётчиком", props: { label: "Тип работы", value: "все", count: 12, onClick: noop } },
  { name: "FilterChip", variant: "переключатель нажат", props: { label: "Ждёт меня", pressed: true, count: 0 } },
  { name: "FilterChip", variant: "переключатель без pressed", props: { label: "Мои" } },
  // WorkGroup
  { name: "WorkGroup", variant: "ждёт вас, ещё", props: { title: "Ждёт вас", count: 3, hint: "по сроку", human: true, more: 5, onMore: noop, onToggle: noop,
    children: <UI.WorkRow status="waiting_human" title="Согласовать оплату" seals={fullSeals as UI.SealsProps} mine={true} /> } },
  { name: "WorkGroup", variant: "свёрнута", props: { title: "Готово", count: 0, open: false, more: 2, children: "строки" } },
  { name: "WorkGroup", variant: "без счётчика, more = 0", props: { title: "Прочее", more: 0 } },
  { name: "WorkGroup", variant: "пустая", props: { title: "Застряла", count: 0, empty: <p>Ничего не застряло.</p>, children: "не рисуется" } },
  // DataTable
  { name: "DataTable", variant: "справочник", props: { caption: "Типы работ", columns: [{ key: "name", title: "Тип" }, { key: "ver", title: "Версия", num: true }, { key: "owner", title: "Владелец" }],
    rows: [
      { key: "ct", name: <span className="tc-cell-title">coding-task</span>, ver: 8, owner: "example" },
      { name: "invoice", ver: 3, owner: <span className="tc-cell-warn">не назначен</span> },
    ] } },
  { name: "DataTable", variant: "пусто без подписи", props: { columns: [{ key: "a", title: "A" }], rows: [] } },
  // LocaleProvider (внутри — свой провайдер с другой локалью: ближайший побеждает)
  { name: "LocaleProvider", variant: "текст внутри", props: { locale: "ru", children: "Экран" } },
  { name: "LocaleProvider", variant: "вложенный ru внутри en", props: { locale: "en", children: <UI.LocaleProvider locale="ru"><UI.StatusMark status="running" /></UI.LocaleProvider> } },
  // AppShell
  { name: "AppShell", variant: "меню закреплено, ассистент открыт", props: {
    topbar: <UI.TopBar org="Полярис" date="Сегодня" at="14:02" assistantOpen={true} />,
    nav: <UI.NavDrawer org="Полярис" groups={navGroups as UI.NavGroup[]} />, navPinned: true, navId: "nav", onScrim: noop,
    assistant: <UI.AssistantPanel docked={true} />, assistantOpen: true, assistantId: "assist", status: <UI.LiveChip at="14:02" />, children: <p>Экран</p> } },
  { name: "AppShell", variant: "всё закрыто", props: {
    topbar: <UI.TopBar org="Полярис" date="Сегодня" at="14:02" />, nav: <UI.NavDrawer org="Полярис" />, assistant: <UI.AssistantPanel docked={true} />, children: "Экран" } },
  { name: "AppShell", variant: "без меню и ассистента, меню открыто", props: { topbar: null, navOpen: true, children: <p>Экран</p> } },
];

type Locale = UI.Locale;
const LOCALES: Locale[] = ["en", "ru"];
const OldProvider = OLD["LocaleProvider"] as AnyComponent;

/** Один и тот же провайдер вокруг компонента в обоих рендерах: контекст бандла и контекст пакета. */
function inLocale(locale: Locale | null, node: React.ReactElement): React.ReactElement {
  if (!locale) return node;
  return <OldProvider locale={locale}><UI.LocaleProvider locale={locale}>{node}</UI.LocaleProvider></OldProvider>;
}

function render(C: AnyComponent, props: AnyProps, locale: Locale | null = null): { markup: string; string: string } {
  return { markup: renderToStaticMarkup(inLocale(locale, <C {...props} />)), string: renderToString(inLocale(locale, <C {...props} />)) };
}

const CYRILLIC = /[\u0400-\u04FF]/;
type Entry = string | Record<string, string>;
const strings = (lib: Record<string, unknown>) => lib["STRINGS"] as Record<Locale, Record<string, Entry>>;
/** Все тексты записи: строка или формы числа. */
const texts = (e: Entry): string[] => (typeof e === "string" ? [e] : Object.values(e));

// Предупреждения React (ключи, inert="", value без onChange) одинаковы у обеих версий — не засоряем вывод.
const silence = vi.spyOn(console, "error").mockImplementation(() => {});
beforeAll(() => { silence.mockClear(); });
afterAll(() => { silence.mockRestore(); });

describe("словарь встроенных строк", () => {
  const dict = strings(NEW);

  it("словарь пакета совпадает со словарём бандла", () => {
    expect(dict).toEqual(strings(OLD));
  });

  it("ключи en и ru совпадают", () => {
    expect(Object.keys(dict.ru).sort()).toEqual(Object.keys(dict.en).sort());
  });

  it("ни одной пустой строки", () => {
    for (const loc of LOCALES) {
      for (const [key, entry] of Object.entries(dict[loc])) {
        for (const s of texts(entry)) expect(s.trim(), `${loc} ${key}`).not.toBe("");
      }
    }
  });

  it("формы числа — ровно категории Intl.PluralRules локали, в обеих локалях", () => {
    for (const key of Object.keys(dict.en)) {
      const kinds = LOCALES.map((loc) => typeof dict[loc][key]);
      expect(new Set(kinds).size, `${key}: строка в одной локали и формы числа в другой`).toBe(1);
      if (kinds[0] !== "object") continue;
      for (const loc of LOCALES) {
        const want = [...new Intl.PluralRules(loc).resolvedOptions().pluralCategories].sort();
        expect(Object.keys(dict[loc][key] as Record<string, string>).sort(), `${loc} ${key}`).toEqual(want);
      }
    }
  });

  it("подстановки {имя} одни и те же в en и ru", () => {
    const names = (e: Entry) => [...new Set(texts(e).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
    for (const key of Object.keys(dict.en)) expect(names(dict.ru[key] as Entry), key).toEqual(names(dict.en[key] as Entry));
  });

  it("в en нет кириллицы", () => {
    for (const [key, entry] of Object.entries(dict.en)) {
      for (const s of texts(entry)) expect(CYRILLIC.test(s), `${key}: ${s}`).toBe(false);
    }
  });

  it("STATUS_WORD — срез словаря и совпадает с бандлом", () => {
    expect(JSON.parse(JSON.stringify(UI.STATUS_WORD))).toEqual(JSON.parse(JSON.stringify(OLD["STATUS_WORD"])));
    expect(UI.STATUS_WORD.en.running).toBe(dict.en["status.running"]);
    expect(UI.STATUS_WORD.ru.verified).toBe(dict.ru["status.verified"]);
  });
});

describe("выбор локали", () => {
  for (const [name, lib] of [["bundle.js", OLD], ["@console/ui", NEW]] as const) {
    it(`${name}: без провайдера и без document — en`, () => {
      const html = renderToStaticMarkup(<StatusMarkOf lib={lib} />);
      expect(html).toContain(">running<");
    });
    it(`${name}: свой LocaleProvider переключает на ru`, () => {
      const P = pick(lib, "LocaleProvider");
      expect(renderToStaticMarkup(<P locale="ru"><StatusMarkOf lib={lib} /></P>)).toContain(">исполняется<");
    });
    it(`${name}: «ru-RU» в провайдере — ru, неизвестная локаль — как без провайдера`, () => {
      const P = pick(lib, "LocaleProvider");
      expect(renderToStaticMarkup(<P locale="ru-RU"><StatusMarkOf lib={lib} /></P>)).toContain(">исполняется<");
      expect(renderToStaticMarkup(<P locale="de"><StatusMarkOf lib={lib} /></P>)).toContain(">running<");
    });
  }

  it("формы числа ru: 1 работу, 2 работы, 5 работ; 1 ждёт, 2 ждут", () => {
    const sum = (n: number) => renderToStaticMarkup(inLocale("ru", <UI.Summary verified={n} submitted={n} waiting={n} />));
    expect(sum(1)).toContain(">1 работу<");
    expect(sum(1)).toContain(">1 ждёт вашего решения<");
    expect(sum(1)).toContain(" сданной");
    expect(sum(2)).toContain(">2 работы<");
    expect(sum(2)).toContain(">2 ждут вашего решения<");
    expect(sum(5)).toContain(">5 работ<");
    expect(sum(21)).toContain(">21 работу<");
  });

  it("формы числа en: 1 work item, 2 work items; 1 awaits, 2 await", () => {
    const sum = (n: number) => renderToStaticMarkup(inLocale("en", <UI.Summary verified={n} submitted={n} waiting={n} />));
    expect(sum(1)).toContain(">1 work item<");
    expect(sum(1)).toContain(">1 awaits your decision<");
    expect(sum(2)).toContain(">2 work items<");
    expect(sum(2)).toContain(">2 await your decision<");
  });
});

/** StatusMark «running» из выбранной библиотеки. */
function StatusMarkOf(props: { lib: Record<string, unknown> }) {
  const C = pick(props.lib, "StatusMark");
  return <C status="running" />;
}

describe("паритет с design-system/components/bundle.js", () => {
  const components = Object.keys(OLD).filter((k) => typeof OLD[k] === "function").sort();
  /* Хуки (useLocale) экспортируются, но это не компоненты — вариантов рендера у них нет. */
  const renderable = components.filter((k) => !/^use[A-Z]/.test(k));

  it("пакет экспортирует все компоненты бандла под теми же именами", () => {
    expect(components.length).toBeGreaterThanOrEqual(39);
    for (const name of components) expect(typeof NEW[name], name).toBe("function");
    for (const [name, sub] of [["ProblemCard", "Calm"], ["DegradedBanner", "Section"], ["Seals", "Evidence"]] as const) {
      expect(typeof pick(OLD, name, sub), `${name}.${sub} в бандле`).toBe("function");
      expect(typeof pick(NEW, name, sub), `${name}.${sub} в пакете`).toBe("function");
    }
  });

  it("каждый компонент бандла покрыт вариантами", () => {
    const covered = new Set(CASES.map((c) => c.name));
    expect(renderable.filter((n) => !covered.has(n))).toEqual([]);
  });

  for (const locale of LOCALES) {
    for (const c of CASES) {
      const title = `${locale} · ${c.sub ? c.name + "." + c.sub : c.name}: ${c.variant}`;
      it(title, () => {
        const before = render(pick(OLD, c.name, c.sub), c.props, locale);
        const after = render(pick(NEW, c.name, c.sub), c.props, locale);
        expect(after.markup).toBe(before.markup);
        expect(after.string).toBe(before.string);
      });
    }
  }
});

