/* @ds-bundle: {"format":4,"namespace":"TaimenConsole","components":[{"name":"Button"},{"name":"ExecutorGlyph"},{"name":"IdentityBlock"},{"name":"StatusMark"},{"name":"SourceChip"},{"name":"ChannelChip"},{"name":"Seals"},{"name":"TopBar"},{"name":"Summary"},{"name":"DecisionCard"},{"name":"ProblemCard"},{"name":"WorkPath"},{"name":"ExecutorCard"},{"name":"WorkRow"},{"name":"Chronicle"},{"name":"PlanDiff"},{"name":"JournalEntry"},{"name":"AssistantPanel"},{"name":"CommandPalette"},{"name":"DegradedBanner"},{"name":"EmptyState"},{"name":"NavDrawer"},{"name":"LiveChip"},{"name":"Icon"},{"name":"Zone"},{"name":"PageHeader"},{"name":"Dialog"},{"name":"Consequences"},{"name":"Criteria"},{"name":"Callout"},{"name":"DecisionStatus"},{"name":"Field"},{"name":"PersonPicker"},{"name":"WorkPreview"},{"name":"SearchField"},{"name":"FilterChip"},{"name":"WorkGroup"},{"name":"DataTable"},{"name":"AppShell"},{"name":"LocaleProvider"}]} */
(function () {
  "use strict";
  var React = window.React;
  var h = React.createElement;
  var F = React.Fragment;

  /* inert: React 19 знает атрибут и ждёт булево, React 18 пишет его строкой. */
  var INERT = parseInt(React.version, 10) >= 19 ? true : "";

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(" ");
  }
  function svg(props, kids) {
    return h("svg", Object.assign({ viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", focusable: "false" }, props), kids);
  }
  var SW = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  function p(d, extra) { return h("path", Object.assign({ d: d }, SW, extra || {})); }

  /* ---------- Локали: словарь встроенных строк, выбор языка ---------- */
  /*
   * Встроенные строки компонентов живут только здесь: en — основной язык открытой поставки, ru — второй.
   * Новая строка добавляется сразу на обоих языках. Формы числа — объект категорий Intl.PluralRules
   * (en: one/other, ru: one/few/many/other); подстановки — {имя}. Данные из пропсов компонент не переводит.
   */
  var STRINGS = {
    en: {
      "glyph.kind.human": "person",
      "glyph.kind.agent": "agent",
      "glyph.kind.process": "process",
      "glyph.waiting": "waiting",
      "kind.human": "people",
      "kind.agent": "agents",
      "kind.process": "processes",

      "status.queued": "not started",
      "status.running": "running",
      "status.waiting_human": "waiting for a person",
      "status.waiting_external": "waiting on external system",
      "status.blocked": "stuck",
      "status.paused": "paused",
      "status.stale": "no progress",
      "status.failed": "failed",
      "status.completed": "submitted",
      "status.verified": "verified",

      "source.kind.authoritative": "core",
      "source.kind.recalled": "from memory",
      "source.kind.external": "external system",
      "source.label": "Source: {source}",

      "channel.sent": "sent to {channel}",
      "channel.delivered": "delivered to {channel}",
      "channel.opened": "opened in {channel}",
      "channel.failed": "not delivered to {channel}",
      "channel.decided": "decided from {channel}",

      "live.online": "online · {at}",
      "live.offline": "offline · data as of {at}",

      "seals.label": "Four seals",
      "seal.origin": "Origin",
      "seal.executor": "Done by",
      "seal.evidence": "Verified",
      "seal.signature": "Signed by",
      "seal.origin.missing": "missing",
      "seal.executor.missing": "not assigned",
      "seal.signature.none": "no sign-off needed",
      "seal.signature.pending": "awaiting sign-off",
      "seal.signature.signed": "signed",
      "seal.signature.from": "from {channel}",
      "seal.model.flag": "flagged",
      "seal.verified": "verified {text}",

      "evidence.external": "by external state",
      "evidence.auto": "by auto-check",
      "evidence.human": "by a person",
      "evidence.model": "by model judgement",
      "evidence.failed": "failed",
      "evidence.pending": "under review",
      "evidence.none": "not verified",

      "topbar.menu": "Menu",
      "topbar.period": "Period",
      "topbar.search": "Search and commands",
      "topbar.searchHint": "Find work, a person…",
      "topbar.assistantUnread": "Assistant, new messages: {n}",

      "summary.label": "Summary",
      "summary.lead": "Verified",
      "summary.unit": { one: "work item", other: "work items" },
      "summary.of": "of",
      "summary.submitted": { one: "submitted", other: "submitted" },
      "summary.waiting": { one: "{n} awaits your decision", other: "{n} await your decision" },
      "summary.broken": "{n} broken",
      "summary.nothingBroken": "nothing broken",
      "summary.changes": "Changed",

      "decision.kind": "Decision",
      "decision.holds": "holds the work",
      "decision.why": "Why you",
      "decision.yes": "On “yes”",
      "decision.no": "On “no”",
      "decision.evidence": "Evidence",
      "decision.evidenceOpen": "shown before the button — the decision has an external effect",
      "decision.showEvidence": "Show {n}",
      "decision.proposal": "Agent’s proposal",
      "decision.approve": "Approve",
      "decision.decline": "Decline…",
      "decision.history": "Open history",
      "decision.dismiss": "Didn’t need to see this",

      "problem.calm": "All normal",

      "path.label": "Work path",
      "path.flow": "Work flow",
      "path.stuck": "{n} stuck",
      "path.clear": "nothing stuck",

      "executor.vacant": "vacant",
      "executor.nobody": "No one",
      "executor.assign": "Assign",
      "executor.toAgent": "Hand to an agent",
      "executor.noAuthority": "no authority declared",

      "chronicle.kind.origin": "Origin",
      "chronicle.kind.delivery": "Delivered to people",
      "chronicle.kind.claim": "Taken",
      "chronicle.kind.attempt": "Attempt",
      "chronicle.kind.result": "Result",
      "chronicle.kind.verify": "Verification",
      "chronicle.kind.signature": "Sign-off",
      "chronicle.kind.discussion": "Discussion",
      "chronicle.kind.spawned": "Follow-up work",
      "chronicle.kind.reconcile": "Reconciliation",
      "chronicle.kind.impact": "What changed",
      "chronicle.label": "Work history",
      "chronicle.views": "History view",
      "chronicle.view.brief": "Brief",
      "chronicle.view.time": "By time",
      "chronicle.view.full": "Full log",

      "plan.label": "Package plan",
      "plan.op.add": "will be added",
      "plan.op.change": "will change",
      "plan.op.remove": "will be removed",
      "plan.install": "Install exactly this plan",
      "plan.test": "Test",

      "journal.emergency": "Emergency",

      "assistant.title": "Assistant",
      "assistant.new": "New conversation",
      "assistant.close": "Close assistant",
      "assistant.hello": "Ask about what’s on the screen, or assign something in words — it becomes work once you sign off.",
      "assistant.sees": "Assistant sees: {context}",
      "assistant.thisScreen": "this screen",
      "assistant.blind": "Assistant can’t see the screen",
      "assistant.contextOff": "Turn off",
      "assistant.contextOn": "Show",
      "assistant.proposal": "Work will be created — needs your sign-off",
      "assistant.accept": "Create work",
      "assistant.edit": "Edit",
      "assistant.fromChannel": "from {channel}",
      "assistant.alsoChannel": "also in {channel}",
      "assistant.onScreen": "on screen {context}",
      "assistant.busy": "Looking…",
      "assistant.quick": "Ask about the screen",
      "assistant.placeholder": "Ask, or assign in words…",
      "assistant.input": "Message to the assistant",
      "assistant.hint": "Enter — send · Shift+Enter — new line",
      "assistant.send": "Send",

      "nav.label": "Sections",
      "nav.placeholder": "menu item",
      "nav.org": "Organization: {org}",
      "nav.pin": "Pin menu",
      "nav.unpin": "Unpin menu",
      "nav.close": "Close menu",

      "palette.label": "Command palette",
      "palette.placeholder": "Work, person, action…",
      "palette.search": "Search",
      "palette.select": "select",
      "palette.open": "open",
      "palette.confirm": "action with confirmation",

      "banner.down": "Core unavailable — data may be out of date. Actions are off until it’s back.",
      "banner.downAt": "Core unavailable — showing data as of {at}. Actions are off until it’s back.",
      "banner.stale": "Live connection lost.",
      "banner.staleAt": "Live connection lost — data as of {at}.",
      "banner.retry": "Retry",
      "banner.section": "The source didn’t respond — this section isn’t updated.",

      "crumbs.label": "Breadcrumb",
      "dialog.close": "Close",
      "consequences.label": "What will happen",
      "criteria.label": "Acceptance criteria",
      "criteria.ok": "passed",
      "criteria.bad": "failed",
      "criteria.wait": "waiting",
      "picker.label": "Executor",
      "combo.empty": "Nothing found",
      "preview.label": "Will be created",
      "group.more": "Show {n} more",
      "group.more.any": "Show more"
    },
    ru: {
      "glyph.kind.human": "человек",
      "glyph.kind.agent": "агент",
      "glyph.kind.process": "процесс",
      "glyph.waiting": "ожидание",
      "kind.human": "люди",
      "kind.agent": "агенты",
      "kind.process": "процессы",

      "status.queued": "не начата",
      "status.running": "исполняется",
      "status.waiting_human": "ждёт человека",
      "status.waiting_external": "ждёт внешнюю систему",
      "status.blocked": "застряла",
      "status.paused": "приостановлена",
      "status.stale": "нет прогресса",
      "status.failed": "не удалась",
      "status.completed": "сдано",
      "status.verified": "проверено",

      "source.kind.authoritative": "ядро",
      "source.kind.recalled": "из памяти",
      "source.kind.external": "внешняя система",
      "source.label": "Источник: {source}",

      "channel.sent": "в {channel} · отправлено",
      "channel.delivered": "в {channel} · доставлено",
      "channel.opened": "в {channel} · открыто",
      "channel.failed": "в {channel} · не доставлено",
      "channel.decided": "решено из {channel}",

      "live.online": "online · {at}",
      "live.offline": "offline · данные на {at}",

      "seals.label": "Четыре печати",
      "seal.origin": "Откуда",
      "seal.executor": "Кто делал",
      "seal.evidence": "Чем доказано",
      "seal.signature": "Кто подписал",
      "seal.origin.missing": "звена нет",
      "seal.executor.missing": "не поручено",
      "seal.signature.none": "подпись не требуется",
      "seal.signature.pending": "ждёт подписи",
      "seal.signature.signed": "подписано",
      "seal.signature.from": "из {channel}",
      "seal.model.flag": "помечено",
      "seal.verified": "проверено {text}",

      "evidence.external": "внешним состоянием",
      "evidence.auto": "автопроверкой",
      "evidence.human": "человеком",
      "evidence.model": "оценкой модели",
      "evidence.failed": "не пройдено",
      "evidence.pending": "на проверке",
      "evidence.none": "не проверялось",

      "topbar.menu": "Меню",
      "topbar.period": "Период",
      "topbar.search": "Поиск и команды",
      "topbar.searchHint": "Найти работу, человека…",
      "topbar.assistantUnread": "Ассистент, новых сообщений: {n}",

      "summary.label": "Итог",
      "summary.lead": "Довела до проверенного результата",
      "summary.unit": { one: "работу", few: "работы", many: "работ", other: "работы" },
      "summary.of": "из",
      "summary.submitted": { one: "сданной", few: "сданных", many: "сданных", other: "сданных" },
      "summary.waiting": { one: "{n} ждёт вашего решения", few: "{n} ждут вашего решения", many: "{n} ждут вашего решения", other: "{n} ждут вашего решения" },
      "summary.broken": "{n} сломано",
      "summary.nothingBroken": "ничего не сломано",
      "summary.changes": "Изменилось",

      "decision.kind": "Решение",
      "decision.holds": "держит работу",
      "decision.why": "Почему у вас",
      "decision.yes": "При «да»",
      "decision.no": "При «нет»",
      "decision.evidence": "Доказательства",
      "decision.evidenceOpen": "открыты до кнопки — решение с внешним эффектом",
      "decision.showEvidence": "Показать {n}",
      "decision.proposal": "Предложение агента",
      "decision.approve": "Согласовать",
      "decision.decline": "Отклонить…",
      "decision.history": "Открыть историю",
      "decision.dismiss": "Не нужно было показывать",

      "problem.calm": "Всё штатно",

      "path.label": "Путь работы",
      "path.flow": "Поток работы",
      "path.stuck": "{n} застряло",
      "path.clear": "переход свободен",

      "executor.vacant": "вакантно",
      "executor.nobody": "Некому",
      "executor.assign": "Назначить",
      "executor.toAgent": "Поручить агенту",
      "executor.noAuthority": "полномочия не объявлены",

      "chronicle.kind.origin": "Основание",
      "chronicle.kind.delivery": "Доставка людям",
      "chronicle.kind.claim": "Взято",
      "chronicle.kind.attempt": "Попытка",
      "chronicle.kind.result": "Результат",
      "chronicle.kind.verify": "Проверка",
      "chronicle.kind.signature": "Подпись",
      "chronicle.kind.discussion": "Обсуждение",
      "chronicle.kind.spawned": "Порождённое",
      "chronicle.kind.reconcile": "Сверка",
      "chronicle.kind.impact": "Что изменилось",
      "chronicle.label": "История работы",
      "chronicle.views": "Вид хроники",
      "chronicle.view.brief": "Кратко",
      "chronicle.view.time": "По времени",
      "chronicle.view.full": "Полный журнал",

      "plan.label": "План пакета",
      "plan.op.add": "добавится",
      "plan.op.change": "изменится",
      "plan.op.remove": "уйдёт",
      "plan.install": "Установить ровно этот план",
      "plan.test": "Протестировать",

      "journal.emergency": "Аварийно",

      "assistant.title": "Ассистент",
      "assistant.new": "Новая беседа",
      "assistant.close": "Закрыть ассистента",
      "assistant.hello": "Спросите о том, что на экране, или поручите словами — поручение станет работой после вашей подписи.",
      "assistant.sees": "Ассистент видит: {context}",
      "assistant.thisScreen": "этот экран",
      "assistant.blind": "Ассистент не видит экран",
      "assistant.contextOff": "Отключить",
      "assistant.contextOn": "Показать",
      "assistant.proposal": "Будет заведена работа — нужна ваша подпись",
      "assistant.accept": "Завести работу",
      "assistant.edit": "Изменить",
      "assistant.fromChannel": "из {channel}",
      "assistant.alsoChannel": "и в {channel}",
      "assistant.onScreen": "по экрану {context}",
      "assistant.busy": "Смотрю…",
      "assistant.quick": "Спросить про экран",
      "assistant.placeholder": "Спросить или поручить словами…",
      "assistant.input": "Сообщение ассистенту",
      "assistant.hint": "Enter — отправить · Shift+Enter — перенос",
      "assistant.send": "Отправить",

      "nav.label": "Разделы",
      "nav.placeholder": "пункт меню",
      "nav.org": "Организация: {org}",
      "nav.pin": "Закрепить меню",
      "nav.unpin": "Открепить меню",
      "nav.close": "Закрыть меню",

      "palette.label": "Палитра команд",
      "palette.placeholder": "Работа, человек, действие…",
      "palette.search": "Поиск",
      "palette.select": "выбрать",
      "palette.open": "открыть",
      "palette.confirm": "действие с подтверждением",

      "banner.down": "Ядро недоступно — данные могли устареть. Действия отключены до восстановления.",
      "banner.downAt": "Ядро недоступно — показаны данные на {at}. Действия отключены до восстановления.",
      "banner.stale": "Живое соединение прервано.",
      "banner.staleAt": "Живое соединение прервано — данные на {at}.",
      "banner.retry": "Повторить",
      "banner.section": "Источник не ответил — секция не обновлена.",

      "crumbs.label": "Путь",
      "dialog.close": "Закрыть",
      "consequences.label": "Что произойдёт",
      "criteria.label": "Критерии приёмки",
      "criteria.ok": "пройден",
      "criteria.bad": "не пройден",
      "criteria.wait": "ждёт",
      "picker.label": "Исполнитель",
      "combo.empty": "Ничего не найдено",
      "preview.label": "Будет заведено",
      "group.more": "Показать ещё {n}",
      "group.more.any": "Показать ещё"
    }
  };
  var LOCALES = ["en", "ru"];
  var hasOwn = Object.prototype.hasOwnProperty;
  function normLocale(v) {
    var s = String(v || "").toLowerCase();
    for (var i = 0; i < LOCALES.length; i++) if (s === LOCALES[i] || s.indexOf(LOCALES[i] + "-") === 0) return LOCALES[i];
    return null;
  }
  /* Без LocaleProvider — язык документа (lang="ru…" или "en…"), иначе и вне браузера — en. */
  function documentLocale() {
    var el = typeof document !== "undefined" && document ? document.documentElement : null;
    return (el && normLocale(el.lang)) || "en";
  }
  var PLURAL_RULES = {};
  function pluralCategory(loc, n) {
    try {
      var r = PLURAL_RULES[loc] || (PLURAL_RULES[loc] = new Intl.PluralRules(loc));
      return r.select(Number(n));
    } catch (e) { return Number(n) === 1 ? "one" : "other"; }
  }
  /* Строка словаря; undefined — ключа нет (вызывающий решает, чем заменить). */
  function translate(loc, key, vars) {
    var L = normLocale(loc) || "en", dict = STRINGS[L];
    if (!hasOwn.call(dict, key)) return undefined;
    var s = dict[key];
    if (typeof s === "object") s = s[pluralCategory(L, vars && vars.n)] || s.other;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return hasOwn.call(vars, k) ? String(vars[k]) : m; });
  }
  var LocaleContext = React.createContext(null);
  function LocaleProvider(props) {
    return h(LocaleContext.Provider, { value: normLocale(props.locale) }, props.children);
  }
  function useLocale() { return React.useContext(LocaleContext) || documentLocale(); }
  function useT() {
    var loc = useLocale();
    return function (key, vars) { return translate(loc, key, vars); };
  }
  var STATUS_WORD = {};
  LOCALES.forEach(function (loc) {
    STATUS_WORD[loc] = {};
    Object.keys(STRINGS[loc]).forEach(function (k) { if (k.indexOf("status.") === 0) STATUS_WORD[loc][k.slice(7)] = STRINGS[loc][k]; });
  });

  /* ---------- Иконки (контур Lucide-стиля, 16×16) ---------- */
  var Ico = {
    check: function () { return svg({}, p("M3.5 8.5l3 3 6-7")); },
    x: function () { return svg({}, [p("M4 4l8 8", { key: 1 }), p("M12 4l-8 8", { key: 2 })]); },
    search: function () { return svg({}, [h("circle", Object.assign({ key: 1, cx: 7, cy: 7, r: 4.5 }, SW)), p("M10.5 10.5L14 14", { key: 2 })]); },
    clock: function () { return svg({}, [h("circle", Object.assign({ key: 1, cx: 8, cy: 8, r: 6 }, SW)), p("M8 5v3.2l2 1.3", { key: 2 })]); },
    lock: function () { return svg({}, [h("rect", Object.assign({ key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }, SW)), p("M5.5 7V5a2.5 2.5 0 015 0v2", { key: 2 })]); },
    alert: function () { return svg({}, [p("M8 2.2L14.3 13.3H1.7z", { key: 1 }), p("M8 6.5v3", { key: 2 }), p("M8 11.6v.1", { key: 3 })]); },
    arrowOut: function () { return svg({}, [p("M6 3.5H3.5v9h9V10", { key: 1 }), p("M9 3h4v4", { key: 2 }), p("M13 3L8 8", { key: 3 })]); },
    wifiOff: function () { return svg({}, [p("M2 2l12 12", { key: 1 }), p("M5.2 8.6a4 4 0 015.6 0", { key: 2 }), p("M8 12h.01", { key: 3 })]); },
    shield: function () { return svg({}, [p("M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4C5.2 13 3 10.8 3 7.8v-4z", { key: 1 }), p("M5.8 8l1.6 1.6L10.4 6.6", { key: 2 })]); },
    doc: function () { return svg({}, [p("M4 1.8h5.5L12.5 5v9.2H4z", { key: 1 }), p("M9.2 1.8V5.3h3.3", { key: 2 })]); },
    chat: function () { return svg({}, p("M2.5 3.5h11v7.5H6.5L3.5 13.5v-2.5h-1z")); },
    signature: function () { return svg({}, [p("M2 11.5c1.8-3.6 3-5.3 3.8-5 1.1.4-1.3 5.2 0 5.2 1 0 1.7-2.6 2.7-2.6.8 0 .6 1.7 1.6 1.7.7 0 1.4-.6 2-1.3", { key: 1 }), p("M2 14h12", { key: 2 })]); },
    rule: function () { return svg({}, [p("M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z", { key: 1 }), p("M6 8h4", { key: 2 })]); },
    menu: function () { return svg({}, [p("M2.5 4.5h11", { key: 1 }), p("M2.5 8h11", { key: 2 }), p("M2.5 11.5h11", { key: 3 })]); },
    panelLeft: function () { return svg({}, [p("M2.5 3h11v10h-11z", { key: 1 }), p("M6.5 3v10", { key: 2 })]); },
    chevronDown: function () { return svg({}, p("M4.5 6.5l3.5 3.5 3.5-3.5")); },
    sliders: function () { return svg({}, [p("M2.5 5h6.5M11.5 5h2", { key: 1 }), p("M2.5 11h2M7 11h6.5", { key: 2 }), p("M10.25 3.5v3", { key: 3 }), p("M5.75 9.5v3", { key: 4 })]); },
    plus: function () { return svg({}, [p("M8 3v10", { key: 1 }), p("M3 8h10", { key: 2 })]); },
    command: function () { return svg({}, p("M5.5 10.5v-5m5 5v-5m-5 0h5m-5 5h5M5.5 5.5A1.5 1.5 0 104 4a1.5 1.5 0 001.5 1.5zm5 0A1.5 1.5 0 1012 4a1.5 1.5 0 00-1.5 1.5zm-5 5A1.5 1.5 0 104 12a1.5 1.5 0 001.5-1.5zm5 0A1.5 1.5 0 1012 12a1.5 1.5 0 00-1.5-1.5z")); }
  };

  /* ---------- Button ---------- */
  function Button(props) {
    var variant = props.variant || "secondary", size = props.size || "md";
    var rest = Object.assign({}, props);
    delete rest.variant; delete rest.size; delete rest.kbd; delete rest.icon;
    rest.className = cx("tc-btn", "tc-btn-" + variant, size === "sm" && "tc-btn-sm", props.className);
    rest.type = props.type || "button";
    return h("button", rest, props.icon || null, props.children, props.kbd ? h("kbd", { className: "tc-kbd" }, props.kbd) : null);
  }

  /* ---------- ExecutorGlyph ---------- */
  function initials(name) {
    if (!name) return "";
    var parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function hexPath() { return "M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75z"; }
  function ExecutorGlyph(props) {
    var t = useT();
    var kind = props.kind || "human", size = props.size || "md";
    var label = props.label != null ? props.label : initials(props.name);
    var shape;
    if (kind === "human") shape = h("circle", { className: "tc-g-shape", cx: 12, cy: 12, r: 11, strokeWidth: 1.2 });
    else if (kind === "agent") shape = h("rect", { className: "tc-g-shape", x: 1.5, y: 1.5, width: 21, height: 21, rx: 6, strokeWidth: 1.4 });
    else shape = h("path", { className: "tc-g-shape", d: hexPath(), strokeWidth: 1.4, strokeLinejoin: "round" });
    var kindWord = t("glyph.kind." + kind) || kind;
    return h("span", {
      className: cx("tc-glyph", "tc-glyph-" + kind, "tc-glyph-" + size, props.waiting && "tc-glyph-waiting", props.vacant && "tc-glyph-vacant"),
      role: "img", "aria-label": (props.name ? props.name + ", " : "") + kindWord + (props.waiting ? ", " + t("glyph.waiting") : "")
    }, h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, shape), h("span", { "aria-hidden": "true" }, label));
  }

  /* ---------- IdentityBlock ---------- */
  function IdentityBlock(props) {
    var size = props.size || "md";
    return h("span", { className: cx("tc-id", props.inline && "tc-id-inline") },
      h(ExecutorGlyph, { kind: props.kind, name: props.name, label: props.label, size: size, waiting: props.waiting }),
      h("span", { className: "tc-id-text" },
        h("span", { className: "tc-id-name" }, props.name),
        props.meta ? h("span", { className: "tc-id-meta" }, props.meta) : null,
        props.now ? h("span", { className: "tc-id-now" }, props.now) : null));
  }

  /* ---------- StatusMark ---------- */
  function statusShape(s) {
    switch (s) {
      case "queued": return svg({}, h("circle", Object.assign({ cx: 8, cy: 8, r: 5.5 }, SW)));
      case "running": return svg({}, [h("circle", Object.assign({ key: 1, cx: 8, cy: 8, r: 5.5 }, SW)), h("circle", { key: 2, cx: 8, cy: 8, r: 2.6, fill: "currentColor" })]);
      case "waiting_human": return svg({}, h("circle", Object.assign({ cx: 8, cy: 8, r: 5.5, strokeDasharray: "2.4 2.2" }, SW)));
      case "waiting_external": return svg({}, [h("rect", Object.assign({ key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 2, strokeDasharray: "2.4 2.2" }, SW)), p("M6.5 9.5L10.5 5.5M7.5 5.5h3v3", { key: 2 })]);
      case "blocked": return svg({}, [h("rect", { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 2, fill: "currentColor" }), h("path", { key: 2, d: "M5 8h6", stroke: "var(--surface-card)", strokeWidth: 1.8, strokeLinecap: "round" })]);
      case "paused": return svg({}, [p("M6 4v8", { key: 1, strokeWidth: 2.2 }), p("M10 4v8", { key: 2, strokeWidth: 2.2 })]);
      case "stale": return svg({}, [h("circle", Object.assign({ key: 1, cx: 8, cy: 8, r: 5.5 }, SW)), p("M8 5.2V8l1.8 1.2", { key: 2 })]);
      case "failed": return svg({}, [h("path", { key: 1, d: "M8 1.8L14.4 13.4H1.6z", fill: "currentColor" }), h("path", { key: 2, d: "M8 6.2v3.2M8 11.4v.1", stroke: "var(--surface-card)", strokeWidth: 1.7, strokeLinecap: "round" })]);
      case "completed": return svg({}, [h("circle", Object.assign({ key: 1, cx: 8, cy: 8, r: 5.5 }, SW)), p("M5.6 8.2l1.6 1.6 3.2-3.4", { key: 2 })]);
      case "verified": return svg({}, [h("circle", { key: 1, cx: 8, cy: 8, r: 6.5, fill: "currentColor" }), h("path", { key: 2, d: "M5.3 8.2l1.9 1.9 3.6-3.8", stroke: "var(--surface-card)", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" })]);
      default: return svg({}, h("circle", Object.assign({ cx: 8, cy: 8, r: 5.5 }, SW)));
    }
  }
  function StatusMark(props) {
    var t = useT();
    var s = props.status || "queued";
    var word = props.label || t("status." + s) || s;
    return h("span", {
      className: cx("tc-status", props.pill !== false && "tc-status-pill", "tc-s-" + s, props.mine && s === "waiting_human" && "tc-s-mine"),
      title: props.machine || undefined
    }, statusShape(s), h("span", null, word));
  }

  /* ---------- SourceChip ---------- */
  function SourceChip(props) {
    var t = useT();
    var src = props.source || "authoritative";
    var word = props.label || t("source.kind." + src);
    var ic = src === "external" ? Ico.arrowOut() : src === "recalled" ? Ico.clock() : Ico.shield();
    if (props.iconOnly) {
      var full = t("source.label", { source: word }) + (props.freshness ? ", " + props.freshness : "");
      return h("span", { className: cx("tc-chip", "tc-chip-icon", "tc-src-" + src), role: "img", "aria-label": full, title: full }, ic);
    }
    return h("span", { className: cx("tc-chip", "tc-src-" + src) }, ic, word,
      props.freshness ? h("span", { className: "tc-chip-fresh" }, "· " + props.freshness) : null);
  }

  /* ---------- ChannelChip ---------- */
  function ChannelChip(props) {
    var t = useT();
    var state = props.state || "delivered";
    var ch = props.channel || "Telegram";
    var text = t("channel." + state, { channel: ch });
    return h("span", { className: cx("tc-chip", "tc-chan", "tc-chan-" + state) },
      state === "failed" ? Ico.alert() : Ico.chat(), text,
      props.at ? h("span", { className: "tc-num" }, " " + props.at) : null,
      props.reason ? h("span", null, ": " + props.reason) : null);
  }

  /* ---------- Seals ---------- */
  function sealOrigin(o, t) {
    if (!o) return { cls: "tc-seal-missing", ic: Ico.rule(), text: t("seal.origin.missing") };
    var kind = o.kind || "rule";
    var ic = kind === "human" ? h(ExecutorGlyph, { kind: "human", name: o.name, size: "sm" })
      : kind === "process" ? h(ExecutorGlyph, { kind: "process", label: "", size: "sm" })
      : kind === "external" ? Ico.arrowOut() : Ico.rule();
    return { cls: "", ic: ic, text: o.text };
  }
  function sealExecutor(e, t) {
    if (!e) return { cls: "tc-seal-missing", ic: Ico.clock(), text: t("seal.executor.missing") };
    return { cls: "", ic: h(ExecutorGlyph, { kind: e.kind, name: e.name, label: e.label, size: "sm" }), text: e.name + (e.meta ? " · " + e.meta : "") };
  }
  function sealEvidence(v, t) {
    if (!v || v.method === "none") return { cls: "tc-seal-missing", ic: Ico.doc(), text: (v && v.text) || t("evidence.none") };
    if (v.method === "failed") return { cls: "tc-seal-fail", ic: statusShape("failed"), text: v.text || t("evidence.failed") };
    if (v.method === "pending") return { cls: "", ic: statusShape("completed"), text: v.text || t("evidence.pending") };
    var ok = h("span", { style: { color: "var(--status-verified)", display: "inline-flex" } }, statusShape("verified"));
    return { cls: v.method === "model" ? "tc-seal-model" : "tc-seal-ok", ic: v.method === "model" ? Ico.clock() : ok,
      text: (v.text || t("evidence." + v.method)) + (v.method === "model" ? " · " + t("seal.model.flag") : "") };
  }
  function sealSignature(s, t) {
    if (!s) return { cls: "tc-seal-missing", ic: Ico.signature(), text: t("seal.signature.none") };
    if (s.pending) return { cls: "tc-seal-missing", ic: Ico.signature(), text: t("seal.signature.pending") + (s.who ? ": " + s.who : "") };
    return { cls: "tc-seal-sign", ic: Ico.signature(), text: (s.who || t("seal.signature.signed")) + (s.channel ? " · " + t("seal.signature.from", { channel: s.channel }) : "") + (s.at ? " · " + s.at : "") };
  }
  function Seals(props) {
    var t = useT();
    var items = [
      [t("seal.origin"), sealOrigin(props.origin, t)],
      [t("seal.executor"), sealExecutor(props.executor, t)],
      [t("seal.evidence"), sealEvidence(props.evidence, t)],
      [t("seal.signature"), sealSignature(props.signature, t)]
    ];
    var labelled = props.labelled;
    return h("div", { className: cx("tc-seals", labelled && "tc-seals-labelled"), role: "list", "aria-label": t("seals.label") },
      items.map(function (it, i) {
        var s = it[1];
        if (labelled) {
          return h("div", { key: i, role: "listitem", className: cx("tc-seal", s.cls) },
            h("span", { className: "tc-seal-label" }, it[0]),
            h("span", { className: "tc-seal-body" }, s.ic, h("span", { className: "tc-seal-text" }, s.text)));
        }
        return h("span", { key: i, role: "listitem", className: cx("tc-seal", s.cls), title: it[0] + ": " + s.text },
          s.ic, h("span", { className: "tc-sr" }, it[0] + ": "), h("span", { className: "tc-seal-text" }, s.text));
      }));
  }

  /* ---------- TopBar (зона 0) ---------- */
  function TopBar(props) {
    var t = useT();
    var brand = props.brand || {};
    var live = props.live !== false;
    var periods = props.periods || [];
    return h("header", { className: "tc-topbar tc-root" },
      props.onMenu ? h("button", { type: "button", className: "tc-icon-btn tc-topbar-menu", "aria-label": t("topbar.menu"), "aria-expanded": props.menuOpen ? "true" : "false", "aria-controls": props.menuId, onClick: props.onMenu }, Ico.menu()) : null,
      h("span", { className: "tc-brand" },
        brand.mark ? h("span", { className: "tc-brand-mark", "aria-hidden": "true" }, brand.mark) : null,
        brand.name || props.org || null),
      h("span", { className: "tc-topbar-org" }, brand.name ? h("b", null, props.org) : null, h("span", { className: "tc-topbar-date" }, props.date)),
      props.scope ? h("span", { className: "tc-topbar-scope" }, props.scope) : null,
      props.showLive === false ? null : h(LiveChip, { live: live, at: props.at, inline: true }),
      h("span", { className: "tc-topbar-spacer" }),
      periods.length ? h("span", { className: "tc-seg", role: "group", "aria-label": t("topbar.period") }, periods.map(function (pp) {
        return h("button", { key: pp, type: "button", "aria-pressed": pp === (props.period || periods[0]) ? "true" : "false", onClick: props.onPeriod ? function () { props.onPeriod(pp); } : undefined }, pp);
      })) : null,
      props.onSearch ? h("button", { type: "button", className: "tc-topbar-search", "aria-label": t("topbar.search"), onClick: props.onSearch }, Ico.search(), h("span", null, t("topbar.searchHint")), h("kbd", { className: "tc-kbd" }, "⌘K")) : null,
      props.user ? h(ExecutorGlyph, { kind: "human", name: props.user, size: "md" }) : null,
      props.assistantOpen ? null : h(Button, { variant: "brand", size: "sm", kbd: "⌘J", onClick: props.onAssistant, "aria-expanded": props.assistantOpen ? "true" : "false", "aria-controls": props.assistantId,
        "aria-label": props.assistantUnread ? t("topbar.assistantUnread", { n: props.assistantUnread }) : undefined },
        t("assistant.title"), props.assistantUnread ? h("span", { className: cx("tc-badge", props.assistantUrgent && "tc-badge-human"), "aria-hidden": "true" }, props.assistantUnread) : null));
  }

  /* ---------- LiveChip: есть ли связь и на какое время данные ---------- */
  function LiveChip(props) {
    var t = useT();
    var live = props.live !== false;
    return h("span", { className: cx("tc-live", !props.inline && "tc-live-chip", !live && "tc-live-off"), role: "status" },
      h("span", { className: "tc-live-dot", "aria-hidden": "true" }),
      t(live ? "live.online" : "live.offline", { at: props.at || "" }));
  }

  /* ---------- Summary (Итог) + полоса «Изменилось» ---------- */
  function Summary(props) {
    var t = useT();
    var changes = props.changes || [];
    var cards = props.compact ? changes.filter(function (c) { return !c.small; }) : changes;
    var notes = props.compact ? changes.filter(function (c) { return c.small; }) : [];
    return h("section", { className: cx("tc-root", props.compact && "tc-summary-compact"), "aria-label": t("summary.label") },
      h("p", { className: "tc-summary" },
        props.lead || t("summary.lead") + " ",
        h("button", { className: "tc-link", type: "button" }, props.verified + " " + (props.unit || t("summary.unit", { n: props.verified }))),
        " " + t("summary.of") + " ", h("span", { className: "tc-num" }, props.submitted), " " + t("summary.submitted", { n: props.submitted }),
        props.waiting != null ? h(F, null, h("span", { className: "tc-summary-sep" }, " · "),
          h("button", { className: "tc-link tc-sum-human", type: "button" }, t("summary.waiting", { n: props.waiting }))) : null,
        props.broken != null ? h(F, null, h("span", { className: "tc-summary-sep" }, " · "),
          h("button", { className: "tc-link" + (props.broken ? " tc-sum-problem" : ""), type: "button" }, props.broken ? t("summary.broken", { n: props.broken }) : t("summary.nothingBroken"))) : null),
      cards.length ? h("div", { className: "tc-changes", role: "list", "aria-label": t("summary.changes") }, cards.map(function (c, i) {
        return h("div", { key: i, role: "listitem", className: cx("tc-change", c.small && "tc-change-small") },
          h("span", { className: "tc-change-title" }, c.title),
          c.method ? h(Seals.Evidence, { method: c.method, text: c.methodText }) : null,
          c.evidence ? (c.evidenceHref ? h("a", { className: "tc-link", href: c.evidenceHref, style: { fontSize: 12, alignSelf: "flex-start" } }, c.evidence)
            : h("button", { className: "tc-link", type: "button", style: { fontSize: 12, alignSelf: "flex-start" } }, c.evidence)) : null);
      })) : null,
      notes.length ? h("p", { className: "tc-change-notes" }, notes.map(function (c, i) {
        return h(F, { key: i }, i ? " · " : null, h("button", { className: "tc-link", type: "button" }, c.title));
      })) : null,
      props.empty ? h("p", { className: "tc-secondary", style: { margin: "12px 0 0" } }, props.empty) : null);
  }
  Seals.Evidence = function (v) {
    var t = useT();
    var s = sealEvidence(v, t);
    return h("span", { className: cx("tc-seals"), style: { gap: 0 } }, h("span", { className: cx("tc-seal", s.cls) }, s.ic, h("span", { className: "tc-seal-text" }, t("seal.verified", { text: s.text }))));
  };

  /* ---------- DecisionCard ---------- */
  function DecisionCard(props) {
    var t = useT();
    var mine = props.mine !== false;
    var ro = props.readOnlyReason;
    var pre = props.preconditions || [];
    var blocked = pre.some(function (x) { return !x.ok; }) || props.excluded;
    var needsEvidence = props.risk === "high";
    var ev = props.evidence;
    var compact = !!props.compact;
    if (props.collapsed) {
      return h("article", { className: cx("tc-decision", "tc-decision-compact", "tc-decision-collapsed", "tc-root", mine && !ro && "tc-decision-mine"), "aria-label": typeof props.title === "string" ? props.title : props.label },
        h("div", { className: "tc-decision-kind" }, h("span", null, (props.kind || t("decision.kind")) + (props.holds ? " · " + t("decision.holds") : "")), props.since ? h("span", { className: "tc-num" }, props.since) : null),
        h("h3", { className: "tc-decision-title" }, h("button", { className: "tc-link tc-decision-open", type: "button", onClick: props.onOpen }, props.title)),
        props.requester ? h("div", { className: "tc-decision-meta" }, h(IdentityBlock, Object.assign({ inline: true, size: "sm" }, props.requester))) : null);
    }
    return h("article", { className: cx("tc-decision", "tc-root", mine && !ro && "tc-decision-mine", compact && "tc-decision-compact"), "aria-label": typeof props.title === "string" ? props.title : props.label },
      h("div", { className: "tc-decision-kind" },
        h("span", null, (props.kind || t("decision.kind")) + (props.holds ? " · " + t("decision.holds") : "")),
        props.due ? h("span", { className: "tc-num" }, props.due) : null),
      h("h3", { className: "tc-decision-title" }, props.title),
      h("div", { className: "tc-decision-meta" },
        props.requester ? h(IdentityBlock, Object.assign({ inline: true, size: "sm" }, props.requester)) : null,
        props.since ? h("span", { className: "tc-num" }, props.since) : null,
        props.delivery ? h(ChannelChip, props.delivery) : null),
      props.why ? h("div", { className: "tc-why" }, h("b", null, t("decision.why") + ": "), props.why) : null,
      (props.yes || props.no) ? h("div", { className: "tc-outcomes" },
        h("div", { className: "tc-outcome" }, h("span", { className: "tc-outcome-k" }, t("decision.yes")), props.yes,
          props.yesExternal ? h("span", { className: "tc-outcome-flag", style: { display: "block" } }, props.yesExternal) : null),
        h("div", { className: "tc-outcome" }, h("span", { className: "tc-outcome-k" }, t("decision.no")), props.no)) : null,
      pre.length ? h("div", { className: "tc-precond" }, pre.map(function (x, i) {
        return h("div", { key: i, className: cx("tc-precond-row", x.ok ? "tc-precond-ok" : "tc-precond-bad") }, x.ok ? Ico.check() : statusShape("blocked"), x.text);
      })) : null,
      ev && compact ? h("div", { className: "tc-evidence tc-evidence-one" }, h("b", null, t("decision.evidence") + ": "), evList(ev)) : ev ? h("div", { className: "tc-evidence" },
        h("div", { className: "tc-evidence-head" }, h("span", null, t("decision.evidence")), needsEvidence && !compact ? h("span", { className: "tc-muted", style: { fontSize: 12, fontWeight: 400 } }, t("decision.evidenceOpen")) : null),
        (needsEvidence || props.evidenceOpen) ? h("ul", null, ev.map(function (e, i) { return h("li", { key: i }, evLink(e, i)); })) : h("button", { className: "tc-link", type: "button", style: { fontSize: 13 } }, t("decision.showEvidence", { n: ev.length }))) : null,
      props.proposal ? h("div", { className: "tc-why" }, h("b", null, t("decision.proposal") + ": "), props.proposal) : null,
      ro ? h("div", { className: "tc-readonly" }, Ico.lock(), ro)
        : props.footer ? props.footer
        : h("div", { className: "tc-actions" },
          h(Button, { variant: "human", size: compact ? "sm" : "md", disabled: !!blocked, kbd: props.kbd, onClick: props.onPrimary }, props.primary || t("decision.approve")),
          h(Button, { variant: "secondary", size: compact ? "sm" : "md", onClick: props.onSecondary }, props.secondary || t("decision.decline")),
          compact ? null : h(Button, { variant: "ghost" }, t("decision.history")),
          !compact && props.dismissible !== false ? h(Button, { variant: "ghost", size: "sm" }, t("decision.dismiss")) : null),
      props.excluded ? h("div", { className: "tc-readonly" }, Ico.lock(), props.excluded) : null);
  }

  /* Доказательство: строка или { label, href } — со ссылкой открывает документ. */
  function evLink(e, i) {
    var label = typeof e === "string" ? e : e.label, href = typeof e === "string" ? null : e.href;
    return href ? h("a", { key: i, className: "tc-ev-link", href: href, target: e.target }, label) : h("span", { key: i }, label);
  }
  function evList(ev) {
    var out = [];
    ev.forEach(function (e, i) { if (i) out.push(" · "); out.push(evLink(e, i)); });
    return out;
  }

  /* ---------- ProblemCard ---------- */
  function ProblemCard(props) {
    var sev = props.severity || "failed";
    var ic = sev === "failed" ? statusShape("failed") : sev === "blocked" ? statusShape("blocked") : statusShape("stale");
    return h("article", { className: cx("tc-problem", "tc-root", "tc-problem-" + sev, props.row && "tc-problem-row") },
      ic,
      h("div", { className: "tc-problem-body" },
        h("div", { className: "tc-problem-dx" }, props.diagnosis),
        h("div", { className: "tc-problem-where" }, [props.where, props.since].filter(Boolean).join(" · ")),
        props.actions && props.actions.length ? h("div", { className: "tc-actions", style: { marginTop: 4 } }, props.actions.map(function (a, i) {
          return h(Button, { key: i, size: "sm", variant: a.variant || (i === 0 ? "secondary" : "ghost"), onClick: a.onClick }, a.label);
        })) : null));
  }
  ProblemCard.Calm = function (props) {
    var t = useT();
    return h("div", { className: "tc-calm tc-root" }, Ico.shield(), h("div", null, h("div", { style: { color: "var(--text-primary)", fontWeight: 500 } }, t("problem.calm")),
      h("div", { style: { fontSize: 12 } }, props.text)));
  };

  /* ---------- WorkPath (стадии и ворота) ---------- */
  function Split(props) {
    var t = useT();
    var k = props.byKind || {};
    return h("span", { className: "tc-stage-split" },
      ["human", "agent", "process"].map(function (kind) {
        return k[kind] != null ? h("span", { key: kind }, h(ExecutorGlyph, { kind: kind, label: "", size: "sm", name: t("kind." + kind) }), k[kind]) : null;
      }));
  }
  function FlowBar(props) {
    var t = useT();
    var k = props.byKind || {}, kinds = ["human", "agent", "process"];
    var total = kinds.reduce(function (n, x) { return n + (k[x] || 0); }, 0);
    if (!total) return h("span", { className: "tc-flow-bar tc-flow-bar-empty", "aria-hidden": "true" });
    var text = kinds.filter(function (x) { return k[x]; }).map(function (x) { return t("kind." + x) + " " + k[x]; }).join(" · ");
    return h("span", { className: "tc-flow-bar", role: "img", "aria-label": text, title: text },
      kinds.map(function (x) { return k[x] ? h("span", { key: x, className: "tc-flow-seg tc-flow-" + x, style: { flexGrow: k[x] } }) : null; }));
  }
  function WorkFlow(props) {
    var t = useT();
    var stages = props.stages || [], gates = props.gates || [];
    var main = stages.filter(function (s) { return !s.tail; }), tail = stages.filter(function (s) { return s.tail; });
    var kids = [];
    main.forEach(function (s, i) {
      var g = gates[i];
      kids.push(h("button", { key: "s" + i, type: "button", className: "tc-flow-stage" },
        h("span", { className: "tc-flow-label" }, s.label),
        h("span", { className: "tc-flow-count" }, s.count),
        h(FlowBar, { byKind: s.byKind }),
        g && g.count ? h("span", { className: cx("tc-flow-stuck", g.mine && "tc-flow-stuck-mine") }, g.count + (g.reason ? " " + g.reason : "")) : h("span", { className: "tc-flow-stuck tc-flow-stuck-none", "aria-hidden": "true" }, "\u00a0")));
      if (i < main.length - 1) kids.push(h("span", { key: "a" + i, className: "tc-flow-arrow", "aria-hidden": "true" }, "→"));
    });
    return h("div", { className: "tc-flow tc-root" },
      props.legend !== false ? h("div", { className: "tc-flow-legend", "aria-hidden": "true" },
        ["human", "agent", "process"].map(function (x) { return h("span", { key: x }, h("i", { className: "tc-flow-" + x }), t("kind." + x)); })) : null,
      h("div", { className: "tc-flow-row", role: "group", "aria-label": t("path.flow") },
        h("div", { className: "tc-flow-main" }, kids),
        tail.map(function (s, i) {
          return h("button", { key: "t" + i, type: "button", className: "tc-flow-stage tc-flow-tail" },
            h("span", { className: "tc-flow-label" }, s.label), h("span", { className: "tc-flow-count" }, s.count));
        })));
  }
  function WorkPath(props) {
    var t = useT();
    if (props.look === "flow") return h(WorkFlow, props);
    var stages = props.stages || [], gates = props.gates || [];
    var kids = [];
    stages.forEach(function (s, i) {
      kids.push(h("button", { key: "s" + i, type: "button", className: cx("tc-stage", s.tail && "tc-stage-tail") },
        h("span", { className: "tc-stage-label" }, s.label),
        h("span", { className: "tc-stage-count" }, s.count),
        s.byKind ? h(Split, { byKind: s.byKind }) : null,
        s.origin ? h("span", { className: "tc-stage-origin" }, s.origin) : null));
      var g = gates[i];
      if (g && i < stages.length - 1) {
        kids.push(h("button", { key: "g" + i, type: "button", className: cx("tc-gate", !g.count && "tc-gate-zero", g.mine && "tc-gate-mine"), "aria-label": g.count ? t("path.stuck", { n: g.count }) + (g.reason ? ": " + g.reason : "") : t("path.clear") },
          h("span", { className: "tc-gate-count" }, g.count || "—"),
          g.count ? h("span", { className: "tc-gate-reason" }, g.reason) : null));
      }
    });
    var cols = stages.map(function (s, i) { return (s.tail ? "minmax(0, 0.8fr)" : "minmax(0, 1fr)") + (i < stages.length - 1 && gates[i] ? (props.compact ? " var(--path-gate, 64px)" : " 76px") : ""); }).join(" ");
    return h("div", { className: cx("tc-path", "tc-root", props.compact && "tc-path-compact"), role: "group", "aria-label": t("path.label"), style: { gridTemplateColumns: cols } }, kids);
  }

  /* ---------- ExecutorCard (Парк) ---------- */
  function ExecutorCard(props) {
    var t = useT();
    if (props.vacant) {
      return h("div", { className: "tc-exec tc-exec-vacant tc-root" },
        h("div", { className: "tc-exec-head" }, h("span", { className: "tc-id" }, h(ExecutorGlyph, { kind: "human", label: "?", vacant: true, size: "md", name: t("executor.vacant") }),
          h("span", { className: "tc-id-name" }, t("executor.nobody") + (props.role ? ": " + props.role : "")))),
        h("div", { className: "tc-exec-now" }, props.now),
        h("div", { className: "tc-actions" }, h(Button, { size: "sm", variant: "secondary" }, t("executor.assign")), h(Button, { size: "sm", variant: "ghost" }, t("executor.toAgent"))));
    }
    return h("div", { className: cx("tc-exec", "tc-root", props.problem && "tc-exec-problem") },
      h("div", { className: "tc-exec-head" },
        h(IdentityBlock, { kind: props.kind, name: props.name, meta: props.meta, label: props.label }),
        props.state ? h(StatusMark, { status: props.state, label: props.stateLabel }) : null),
      props.now ? h("div", { className: "tc-exec-now" }, props.now) : null,
      h("div", { className: cx("tc-exec-trust", !props.trusted && "tc-exec-trust-none") }, Ico.shield(), props.trusted || t("executor.noAuthority")),
      props.channel ? h("div", null, h(ChannelChip, { channel: props.channel, state: "delivered", at: "" })) : null);
  }

  /* ---------- WorkRow ---------- */
  function WorkRow(props) {
    return h("div", { className: cx("tc-workrow", "tc-root", props.mine && "tc-workrow-mine"), role: "row" },
      h("div", { className: "tc-workrow-main", role: "cell" },
        h("div", { className: "tc-workrow-top" },
          h(StatusMark, { status: props.status, label: props.statusLabel, mine: props.mine }),
          props.href ? h("a", { className: "tc-workrow-title tc-workrow-link", href: props.href }, props.title) : h("span", { className: "tc-workrow-title" }, props.title),
          props.number ? h("span", { className: "tc-mono" }, props.number) : null),
        props.readiness ? h("span", { className: "tc-workrow-ready" }, props.readiness) : null),
      h("div", { className: "tc-workrow-side", role: "cell" },
        h(Seals, props.seals || {}),
        props.action ? h(Button, { size: "sm", variant: props.mine ? "human" : "secondary", onClick: props.onAction }, props.action) : null,
        props.age ? h("span", { className: "tc-age" }, props.age) : null));
  }

  /* ---------- Chronicle ---------- */
  function nodeFor(g) {
    if (g.missing) return h("span", { className: "tc-chron-node", style: { color: "var(--border-dashed)" } }, statusShape("waiting_human"));
    if (g.actor) return h("span", { className: "tc-chron-node" }, h(ExecutorGlyph, { kind: g.actor.kind, name: g.actor.name, label: g.actor.label, size: "sm", waiting: g.human && !g.done }));
    return h("span", { className: "tc-chron-node", style: { color: g.status === "failed" ? "var(--status-failed)" : g.status === "verified" ? "var(--status-verified)" : "var(--machine-line)" } }, statusShape(g.status || "running"));
  }
  function Chronicle(props) {
    var t = useT();
    var view = props.view || "brief";
    var groups = props.groups || [];
    var views = h("div", { className: "tc-views", role: "group", "aria-label": t("chronicle.views") },
      ["brief", "time", "full"].map(function (v) {
        return h("button", { key: v, type: "button", "aria-pressed": view === v ? "true" : "false", onClick: props.onView ? function () { props.onView(v); } : undefined }, t("chronicle.view." + v));
      }));
    var body;
    if (view === "time") {
      body = h("div", { className: "tc-timebars" }, (props.spans || []).map(function (s, i) {
        return h("div", { key: i, className: cx("tc-timebar", s.human && "tc-timebar-human") },
          h("span", null, s.label),
          h("span", { className: "tc-timebar-track" }, h("span", { className: "tc-timebar-fill", style: { left: s.from + "%", width: Math.max(1.5, s.to - s.from) + "%" } })),
          h("span", { className: "tc-age" }, s.dur));
      }));
    } else if (view === "full") {
      body = h("table", { className: "tc-fulllog" }, h("tbody", null, (props.events || []).map(function (e, i) {
        return h("tr", { key: i }, h("td", { className: "tc-age" }, e.at), h("td", null, e.text), h("td", { className: "tc-mono" }, e.type));
      })));
    } else {
      body = h("ol", { className: "tc-chron", style: { listStyle: "none", margin: 0, padding: 0 } }, groups.map(function (g, i) {
        return h("li", { key: i, className: cx("tc-chron-group", g.human && "tc-chron-human", g.missing && "tc-chron-missing") },
          h("span", { className: "tc-chron-time" }, g.at || ""),
          h("span", { className: "tc-chron-rail" }, nodeFor(g)),
          h("div", { className: "tc-chron-body" },
            h("div", { className: "tc-chron-title" }, h("span", { className: "tc-chron-kind" }, g.kindLabel || t("chronicle.kind." + g.kind) || g.kind), g.title || null,
              g.channel ? h(ChannelChip, g.channel) : null, g.source ? h(SourceChip, g.source) : null),
            g.text ? h("div", { className: "tc-chron-text" }, g.text) : null,
            g.criteria ? h("div", { className: "tc-crit" }, g.criteria.map(function (c, j) {
              return h("div", { key: j, className: "tc-crit-row", style: { color: c.ok ? "var(--text-secondary)" : "var(--status-failed)" } },
                h("span", { style: { color: c.ok ? "var(--status-verified)" : "var(--status-failed)", display: "inline-flex" } }, statusShape(c.ok ? "verified" : "failed")), c.text);
            })) : null,
            g.box ? h("div", { className: "tc-chron-box" }, g.box) : null));
      }));
    }
    return h("section", { className: "tc-root", "aria-label": t("chronicle.label") }, props.hideViews ? null : views, body);
  }

  /* ---------- PlanDiff ---------- */
  function PlanDiff(props) {
    var t = useT();
    var sign = { add: "+", change: "~", remove: "−" };
    return h("section", { className: "tc-plan tc-root", "aria-label": t("plan.label") },
      h("div", { className: "tc-plan-head" },
        h("span", { className: "tc-plan-sum" }, props.summary),
        props.meta ? h("span", { className: "tc-secondary", style: { fontSize: 13 } }, props.meta) : null),
      (props.items || []).map(function (it, i) {
        return h("div", { key: i, className: cx("tc-plan-row", "tc-plan-" + it.op) },
          h("span", { className: "tc-plan-op", "aria-label": t("plan.op." + it.op) }, sign[it.op]),
          h("div", null,
            h("div", null, h("span", { className: "tc-plan-obj" }, it.object), it.kind ? h("span", { className: "tc-muted", style: { fontSize: 12 } }, " · " + it.kind) : null),
            (it.before || it.after) ? h("div", { className: "tc-plan-ba" },
              h("span", { className: "tc-plan-before" }, it.before || "—"), h("span", { className: "tc-muted", "aria-hidden": "true" }, "→"), h("span", { className: "tc-plan-after" }, it.after || "—")) : null,
            it.owner ? h("div", { className: "tc-plan-note" }, it.owner) : null,
            it.openCases ? h("div", { className: "tc-plan-note tc-plan-warn" }, it.openCases) : null));
      }),
      props.actions !== false ? h("div", { className: "tc-plan-row", style: { gridTemplateColumns: "1fr" } },
        h("div", { className: "tc-actions" }, h(Button, { variant: "brand" }, t("plan.install")), h(Button, { variant: "ghost" }, t("plan.test")), h("span", { className: "tc-mono" }, props.hash || ""))) : null);
  }

  /* ---------- JournalEntry ---------- */
  function JournalEntry(props) {
    var t = useT();
    return h("div", { className: cx("tc-jentry", "tc-root", props.emergency && "tc-jentry-emergency") },
      h("span", { className: "tc-jentry-time" }, props.at),
      h("div", { className: "tc-jentry-main" },
        h(ExecutorGlyph, { kind: props.actor.kind, name: props.actor.name, label: props.actor.label, size: "md" }),
        h("div", { className: "tc-jentry-text" },
          props.emergency ? h("span", { className: "tc-jflag" }, t("journal.emergency")) : null,
          h("b", null, props.actor.name), " ", props.verb, " ",
          props.object ? h("button", { className: "tc-link", type: "button" }, props.object) : null,
          props.channel ? h(F, null, " ", h(ChannelChip, { channel: props.channel, state: "decided" })) : null,
          props.why ? h("span", { className: "tc-jentry-why" }, props.why) : null)));
  }

  /* ---------- AssistantPanel ---------- */
  function AssistantPanel(props) {
    var t = useT();
    var on = props.contextOn !== false;
    var docked = !!props.docked;
    var msgs = props.messages || [];
    var bodyRef = React.useRef(null);
    var inputRef = props.inputRef || null;
    React.useEffect(function () { var b = bodyRef.current; if (b) b.scrollTop = b.scrollHeight; }, [msgs.length, props.busy]);
    function onKey(e) {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (props.onSend) props.onSend(); }
    }
    var head = docked
      ? h("div", { className: "tc-assist-head" },
          h("span", { className: "tc-assist-title" }, Ico.chat(), t("assistant.title")),
          h("span", { className: "tc-assist-tools" },
            props.onNew ? h("button", { type: "button", className: "tc-icon-btn", "aria-label": t("assistant.new"), onClick: props.onNew }, Ico.plus()) : null,
            h("kbd", { className: "tc-kbd" }, "⌘J"),
            h("button", { type: "button", className: "tc-icon-btn", "aria-label": t("assistant.close"), onClick: props.onClose }, Ico.x())))
      : h("div", { className: "tc-assist-head" }, h("span", { className: "tc-assist-title" }, Ico.chat(), t("assistant.title")), h("kbd", { className: "tc-kbd" }, "⌘J"));
    var empty = !msgs.length && props.suggestions && props.suggestions.length
      ? h("div", { className: "tc-assist-empty" },
          h("p", { className: "tc-assist-hello" }, props.hello || t("assistant.hello")),
          h("div", { className: "tc-assist-sugg", role: "group", "aria-label": t("assistant.quick") }, props.suggestions.map(function (q, k) {
            return h("button", { key: k, type: "button", className: "tc-sugg", onClick: function () { if (props.onSuggest) props.onSuggest(q); } }, q);
          })))
      : null;
    return h("aside", { className: cx("tc-assist", "tc-root", docked && "tc-assist-docked"), "aria-label": t("assistant.title") },
      head,
      docked ? null : h("div", { className: cx("tc-assist-ctx", !on && "tc-assist-ctx-off") },
        Ico.search(), h("span", null, on ? t("assistant.sees", { context: props.context || t("assistant.thisScreen") }) : t("assistant.blind")),
        h("button", { type: "button", className: "tc-toggle", "aria-pressed": on ? "true" : "false", onClick: props.onContextToggle }, t(on ? "assistant.contextOff" : "assistant.contextOn"))),
      h("div", { className: "tc-assist-body", ref: bodyRef }, empty, msgs.map(function (m, i) {
        if (m.proposal) {
          return h("div", { key: i, className: "tc-proposal" },
            h("span", { className: "tc-proposal-k" }, t("assistant.proposal")),
            h("span", { style: { fontWeight: 600 } }, m.proposal),
            m.detail ? h("span", { className: "tc-secondary", style: { fontSize: 13 } }, m.detail) : null,
            m.fields ? h("dl", { className: "tc-proposal-fields" }, m.fields.map(function (f, k) { return h(F, { key: k }, h("dt", null, f[0]), h("dd", null, f[1])); })) : null,
            m.done ? h("span", { className: "tc-proposal-done" }, m.done)
              : h("div", { className: "tc-actions" }, h(Button, { size: "sm", variant: "human", onClick: m.onAccept }, m.acceptLabel || t("assistant.accept")), h(Button, { size: "sm", variant: "ghost", onClick: m.onEdit }, t("assistant.edit"))));
        }
        if (m.divider) {
          return h("div", { key: i, className: cx("tc-msg-divider", m.unread && "tc-msg-divider-new"), role: "separator" }, h("span", null, m.divider));
        }
        var meta = [m.at, m.channel ? t(m.from === "user" ? "assistant.fromChannel" : "assistant.alsoChannel", { channel: m.channel }) : null,
          m.from === "user" && m.context ? t("assistant.onScreen", { context: m.context }) : null].filter(Boolean).join(" · ");
        return h("div", { key: i, className: cx("tc-msg", m.from === "user" ? "tc-msg-user" : "tc-msg-asst", m.proactive && "tc-msg-proactive", m.proactive && m.proactive.human && "tc-msg-proactive-human") },
          m.proactive ? h("span", { className: "tc-msg-why" }, t("source.label", { source: m.proactive.origin || m.proactive.reason })) : null,
          h("div", null, m.text, m.source ? h(SourceChip, Object.assign({ iconOnly: docked }, m.source)) : null),
          m.actions && m.actions.length ? h("div", { className: "tc-actions" }, m.actions.map(function (a, k) {
            return h(Button, { key: k, size: "sm", variant: a.variant || (k === 0 ? "secondary" : "ghost"), onClick: a.onClick }, a.label);
          })) : null,
          meta ? h("span", { className: "tc-msg-meta" }, meta) : null);
      }), props.busy ? h("div", { className: "tc-msg tc-msg-asst tc-msg-busy", "aria-live": "polite" }, t("assistant.busy")) : null),
      docked && msgs.length && props.suggestions && props.suggestions.length
        ? h("div", { className: "tc-assist-quick", role: "group", "aria-label": t("assistant.quick") }, props.suggestions.map(function (q, k) {
            return h("button", { key: k, type: "button", className: "tc-sugg tc-sugg-chip", onClick: function () { if (props.onSuggest) props.onSuggest(q); } }, q);
          }))
        : null,
      docked
        ? h("div", { className: "tc-assist-compose" },
            h("textarea", { ref: inputRef, className: "tc-compose-input", rows: 1, placeholder: t("assistant.placeholder"), "aria-label": t("assistant.input"),
              value: props.value != null ? props.value : undefined, onChange: props.onChange, onKeyDown: onKey }),
            h("div", { className: "tc-compose-bar" },
              h("span", { className: "tc-muted tc-compose-hint" }, t("assistant.hint")),
              h(Button, { variant: "secondary", size: "sm", onClick: props.onSend, disabled: !props.value || !String(props.value).trim() }, t("assistant.send"))))
        : h("div", { className: "tc-assist-input" }, h("input", { className: "tc-input", placeholder: t("assistant.placeholder"), "aria-label": t("assistant.input") }), h(Button, { variant: "secondary" }, t("assistant.send"))));
  }

  /* ---------- NavDrawer (меню слева) ---------- */
  function NavDrawer(props) {
    var t = useT();
    var groups = props.groups || [];
    function item(it, k) {
      if (it.placeholder) {
        return h("li", { key: k }, h("span", { className: "tc-nav-item tc-nav-ph", "aria-hidden": "true" }, h("span", { className: "tc-nav-ico" }), h("span", { className: "tc-nav-label" }, it.label || t("nav.placeholder"))));
      }
      return h("li", { key: k },
        h("a", { className: cx("tc-nav-item", it.active && "tc-nav-active"), href: it.href || "#", "aria-current": it.active ? "page" : undefined, onClick: it.onClick },
          h("span", { className: "tc-nav-ico", "aria-hidden": "true" }, it.icon || null),
          h("span", { className: "tc-nav-label" }, it.label),
          it.count ? h("span", { className: cx("tc-nav-count", it.human && "tc-nav-count-human") }, it.count) : null));
    }
    return h("nav", { className: cx("tc-nav", "tc-root"), "aria-label": props.label || t("nav.label") },
      h("div", { className: "tc-nav-head" },
        h("button", { type: "button", className: "tc-nav-org", "aria-label": t("nav.org", { org: props.org || "" }) }, h("span", { className: "tc-nav-org-name" }, props.org), props.orgMeta ? h("span", { className: "tc-nav-org-meta" }, props.orgMeta) : null, Ico.chevronDown()),
        h("span", { className: "tc-nav-tools" },
          props.onPin ? h("button", { type: "button", className: "tc-icon-btn", "aria-pressed": props.pinned ? "true" : "false", "aria-label": t(props.pinned ? "nav.unpin" : "nav.pin"), title: t(props.pinned ? "nav.unpin" : "nav.pin"), onClick: props.onPin }, Ico.panelLeft()) : null,
          props.onClose ? h("button", { type: "button", className: "tc-icon-btn", "aria-label": t("nav.close"), onClick: props.onClose }, Ico.x()) : null)),
      h("div", { className: "tc-nav-body" }, groups.map(function (g, i) {
        return h("div", { key: i, className: "tc-nav-group" },
          g.title ? h("div", { className: "tc-nav-gt" }, g.title) : null,
          h("ul", null, (g.items || []).map(item)));
      })),
      props.footer ? h("div", { className: "tc-nav-foot" }, props.footer) : null);
  }

  /* ---------- CommandPalette ---------- */
  function CommandPalette(props) {
    var t = useT();
    return h("div", { className: "tc-palette tc-root", role: "dialog", "aria-label": t("palette.label") },
      h("div", { className: "tc-palette-search" }, Ico.search(), h("input", { defaultValue: props.query || "", placeholder: t("palette.placeholder"), "aria-label": t("palette.search") }), h("kbd", { className: "tc-kbd" }, "Esc")),
      h("div", { role: "listbox" }, (props.groups || []).map(function (g, i) {
        return h("div", { key: i, className: "tc-palette-group", role: "group", "aria-label": g.title },
          h("div", { className: "tc-palette-gt" }, g.title),
          g.items.map(function (it, j) {
            return h("div", { key: j, className: "tc-palette-item", role: "option", "aria-selected": it.selected ? "true" : "false" },
              it.kind ? h(ExecutorGlyph, { kind: it.kind, name: it.who || it.label, label: it.glyph, size: "sm" }) : it.status ? h(StatusMark, { status: it.status, pill: false, label: " " }) : null,
              h("span", { className: "tc-palette-item-label" }, it.label),
              it.hint ? h("span", { className: "tc-palette-hint" }, it.hint) : null,
              it.kbd ? h("kbd", { className: "tc-kbd" }, it.kbd) : null);
          }));
      })),
      h("div", { className: "tc-palette-foot" }, h("span", null, h("kbd", { className: "tc-kbd" }, "↑↓"), " " + t("palette.select")), h("span", null, h("kbd", { className: "tc-kbd" }, "Enter"), " " + t("palette.open")), h("span", null, h("kbd", { className: "tc-kbd" }, "E"), " " + t("palette.confirm"))));
  }

  /* ---------- DegradedBanner ---------- */
  function DegradedBanner(props) {
    var t = useT();
    var kind = props.kind || "stale";
    return h("div", { className: cx("tc-banner", "tc-banner-" + kind, "tc-root"), role: "status" },
      kind === "down" ? Ico.wifiOff() : Ico.clock(),
      h("span", null, props.text || (kind === "down"
        ? (props.at ? t("banner.downAt", { at: props.at }) : t("banner.down"))
        : (props.at ? t("banner.staleAt", { at: props.at }) : t("banner.stale")))),
      kind === "down" ? h(Button, { size: "sm", variant: "secondary" }, t("banner.retry")) : null);
  }
  DegradedBanner.Section = function (props) {
    var t = useT();
    return h("div", { className: "tc-sect-err tc-root", role: "status" }, Ico.wifiOff(), props.text || t("banner.section"));
  };

  /* ---------- EmptyState ---------- */
  function PathArt() {
    return h("svg", { className: "tc-empty-art", viewBox: "0 0 280 56", "aria-hidden": "true" },
      h("path", { className: "tc-ea-line", d: "M20 28H100" }), h("path", { className: "tc-ea-line tc-ea-gate", d: "M100 28H140" }), h("path", { className: "tc-ea-line", d: "M140 28H260" }),
      [20, 70, 140, 200, 260].map(function (x, i) { return h("circle", { key: i, className: "tc-ea-node", cx: x, cy: 28, r: 7 }); }),
      h("circle", { className: "tc-ea-human", cx: 120, cy: 28, r: 5 }));
  }
  function EmptyState(props) {
    return h("div", { className: "tc-empty tc-root" },
      props.art ? h(PathArt) : null,
      h("h3", { className: "tc-empty-title" }, props.title),
      props.body ? h("p", { className: "tc-empty-body" }, props.body) : null,
      props.action ? h(Button, { variant: props.actionVariant || "brand" }, props.action) : null);
  }


  /* ================= Каркас и общие части экранов (2026-10-02) ================= */

  /* Icon: значки системы по имени — контур 1.5px в сетке 16, цвет — currentColor. */
  var ICON_PATHS = {
    search: ["M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z", "M10.5 10.5l3 3"],
    chevronDown: ["M4.5 6.5l3.5 3.5 3.5-3.5"],
    check: ["M3.5 8.5l3 3 6-7"],
    x: ["M4 4l8 8", "M12 4l-8 8"],
    warn: ["M8 2.5l6 10.5H2z", "M8 6.5v3", "M8 11.5v.01"],
    info: ["M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M8 7.5v4", "M8 5v.01"],
    clock: ["M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M8 4.5V8l2.5 1.5"],
    file: ["M9 2.5H4.5v11h7V5L9 2.5z", "M9 2.5V5h2.5"],
    menu: ["M2.5 4.5h11", "M2.5 8h11", "M2.5 11.5h11"],
    today: ["M2.5 10.5a5.5 5.5 0 0 1 11 0", "M8 10.5l2.5-3"],
    work: ["M3 4.5h10", "M3 8h10", "M3 11.5h6"],
    knowledge: ["M3 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 0-1.5-1.5H3z", "M13 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H13z"],
    settings: ["M2.5 5h6.5M11.5 5h2", "M2.5 11h2M7 11h6.5", "M10.25 3.5v3", "M5.75 9.5v3"],
    arrowLeft: ["M13 8H3", "M7 4L3 8l4 4"]
  };
  function Icon(props) {
    var d = ICON_PATHS[props.name] || [];
    return h("svg", { className: cx("tc-icon", props.className), viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
      "aria-hidden": props.label ? undefined : "true", role: props.label ? "img" : undefined, "aria-label": props.label },
      d.map(function (x, i) { return h("path", { key: i, d: x }); }));
  }

  /* Zone: зона экрана — карточка с заголовком; tone human — полоса accent, problem — полоса error. */
  function Zone(props) {
    var label = props.label || (typeof props.title === "string" ? props.title : undefined);
    return h("section", { className: cx("tc-zone", props.tone === "human" && "tc-zone-human", props.tone === "problem" && "tc-zone-problem", props.className), "aria-label": label, style: props.style },
      props.title ? h("div", { className: "tc-zone-head" }, h("h2", { className: "tc-zone-title" }, props.title),
        props.action || (props.count != null ? h("span", { className: "tc-zone-count" }, props.count) : null)) : null,
      props.children);
  }

  /* PageHeader: путь, статус, заголовок с глагола, фраза готовности, действия справа. */
  function PageHeader(props) {
    var t = useT();
    return h("div", { className: "tc-pagehead tc-root" },
      props.crumbs || props.number ? h("nav", { className: "tc-crumbs", "aria-label": t("crumbs.label") },
        (props.crumbs || []).map(function (c, i) { return h(F, { key: i }, i ? h("span", { "aria-hidden": "true" }, "·") : null, c.href ? h("a", { href: c.href }, c.label) : h("span", null, c.label)); }),
        props.number ? h(F, null, props.crumbs && props.crumbs.length ? h("span", { "aria-hidden": "true" }, "·") : null, h("span", { className: "tc-mono" }, props.number)) : null) : null,
      h("div", { className: "tc-pagehead-row" },
        h("div", { className: "tc-pagehead-main" },
          props.status ? h(StatusMark, props.status) : null,
          h("h1", { className: "tc-pagehead-title" }, props.title),
          props.lead ? h("p", { className: "tc-pagehead-lead" }, props.lead) : null),
        props.actions ? h("div", { className: "tc-pagehead-actions" }, props.actions) : null));
  }

  /* Dialog: модальное окно — фокус внутри, Esc и клик по подложке закрывают, фокус возвращается. */
  function Dialog(props) {
    var t = useT();
    var ref = React.useRef(null);
    var titleId = "tc-dlg-" + React.useId().replace(/[^A-Za-z0-9_-]/g, "");
    var onClose = React.useRef(props.onClose);
    React.useLayoutEffect(function () { onClose.current = props.onClose; });
    React.useEffect(function () {
      var prev = document.activeElement;
      var el = ref.current && ref.current.querySelector("input,select,textarea,button:not([data-close])");
      if (el) el.focus();
      function k(e) {
        // Esc раскрытого списка (combobox) закрывает список, а не окно: окно — следующим Esc.
        var target = e.target;
        if (e.key === "Escape" && target && target.getAttribute && target.getAttribute("role") === "combobox" && target.getAttribute("aria-expanded") === "true") return;
        if (e.key === "Escape") { e.stopPropagation(); if (onClose.current) onClose.current(); }
        if (e.key === "Tab" && ref.current) {
          var f = ref.current.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])");
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener("keydown", k, true);
      return function () { document.removeEventListener("keydown", k, true); if (prev && prev.focus) prev.focus(); };
    }, []);
    return h("div", { className: "tc-backdrop", onMouseDown: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
      h("div", { className: cx("tc-dialog", "tc-root", props.wide && "tc-dialog-wide"), role: props.alert ? "alertdialog" : "dialog", "aria-modal": "true", "aria-labelledby": titleId, ref: ref },
        h("div", { className: "tc-dialog-head" },
          h("div", null, h("h2", { className: "tc-dialog-title", id: titleId }, props.title), props.sub ? h("p", { className: "tc-dialog-sub" }, props.sub) : null),
          h("button", { type: "button", className: "tc-icon-btn", "aria-label": t("dialog.close"), "data-close": "", onClick: props.onClose }, h(Icon, { name: "x" }))),
        h("div", { className: "tc-dialog-body" }, props.children),
        props.footer ? h("div", { className: "tc-dialog-foot" }, props.hint ? h("span", { className: "tc-dialog-hint" }, props.hint) : null, props.footer) : null));
  }

  /* Consequences: последствия действия до кнопки — что произойдёт, охват, обратимо ли, что уже сделано вовне. */
  function Consequences(props) {
    var t = useT();
    return h("ul", { className: "tc-cons tc-root", "aria-label": props.label || t("consequences.label") }, props.items.map(function (it, i) {
      var tone = it.tone || "info";
      return h("li", { key: i, className: "tc-cons-" + tone }, h(Icon, { name: tone === "ok" ? "check" : tone === "warn" ? "warn" : "info" }),
        h("span", { className: "tc-cons-k" }, it.k), h("span", { className: "tc-cons-v" }, it.v));
    }));
  }

  /* Criteria: критерии приёмки работы с видом проверки и состоянием. */
  function Criteria(props) {
    var t = useT();
    return h("ul", { className: "tc-criteria tc-root", "aria-label": props.label || t("criteria.label") }, props.items.map(function (c, i) {
      var st = c.state;
      return h("li", { key: i, className: st ? "tc-crit-" + st : undefined },
        st ? h(Icon, { name: st === "ok" ? "check" : st === "bad" ? "x" : "clock", label: t(st === "ok" ? "criteria.ok" : st === "bad" ? "criteria.bad" : "criteria.wait") }) : h("span", { className: "tc-crit-blank", "aria-hidden": "true" }),
        h("span", { className: "tc-crit-text" }, c.text), h("span", { className: "tc-crit-kind" }, c.kind));
    }));
  }

  /* Callout: предупреждение или пояснение в потоке формы. */
  function Callout(props) {
    var tone = props.tone || "warning";
    return h("div", { className: cx("tc-callout", "tc-callout-" + tone, "tc-root"), role: "note" }, h(Icon, { name: tone === "warning" ? "warn" : "info" }), h("div", null, props.children));
  }

  /* DecisionStatus: что стало с решением после нажатия — до подтверждения ядра и после. */
  function DecisionStatus(props) {
    return h("div", { className: "tc-dstatus tc-root", role: "status", "aria-live": "polite" }, props.rows.map(function (r, i) {
      var st = r.state || "wait";
      return h("div", { key: i, className: "tc-dstatus-row tc-dstatus-" + st },
        h(Icon, { name: st === "done" ? "check" : st === "fail" ? "x" : st === "warn" ? "warn" : "clock" }),
        h("span", { className: "tc-dstatus-text" }, r.text), r.at ? h("span", { className: "tc-num tc-muted" }, r.at) : null);
    }), props.actions ? h("div", { className: "tc-actions" }, props.actions) : null);
  }

  /* Field: подпись, подсказка и поле (tc-input, tc-select, tc-textarea) внутри. */
  function Field(props) {
    return h("label", { className: cx("tc-field", props.wide && "tc-field-wide") },
      h("span", { className: "tc-field-label" }, props.label),
      props.help ? h("span", { className: "tc-field-help" }, props.help) : null,
      props.children);
  }

  /* PersonPicker: выбор исполнителя списком; meta — роль и занятость, warn — нет нужной роли. */
  function PersonPicker(props) {
    var t = useT();
    var nm = props.name || "person";
    return h("ul", { className: "tc-picker tc-root", role: "radiogroup", "aria-label": props.label || t("picker.label") }, props.options.map(function (o) {
      return h("li", { key: o.id }, h("label", { className: cx(o.disabled && "tc-picker-off") },
        h("input", { type: "radio", name: nm, checked: props.value === o.id, disabled: !!o.disabled, onChange: function () { if (props.onChange) props.onChange(o.id); } }),
        h(IdentityBlock, { kind: o.kind || "human", name: o.name, label: o.glyph, inline: true, size: "sm" }),
        o.meta ? h("span", { className: cx("tc-picker-meta", o.warn && "tc-picker-warn") }, o.meta) : null));
    }));
  }

  /* Combobox: выбор из длинного списка поиском — люди, агенты, типы работ, пространства.
     Закрыт — в поле выбранное; фокус или ввод открывают список, ввод его сужает (без учёта
     регистра и «ё»); ↑↓ — по вариантам, Enter — выбрать, Esc — закрыть, не закрывая диалог.
     clearLabel — первый вариант «ничего не выбрано» (value null). */
  function comboNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е"); }
  function Combobox(props) {
    var t = useT();
    var options = props.options || [];
    var uid = "tc-cb-" + React.useId().replace(/[^A-Za-z0-9_-]/g, "");
    var os = React.useState(!!props.defaultOpen), open = os[0], setOpen = os[1];
    var qs = React.useState(""), query = qs[0], setQuery = qs[1];
    var as = React.useState(0), active = as[0], setActive = as[1];
    var selected = null;
    for (var i = 0; i < options.length; i++) if (options[i].value === props.value) selected = options[i];
    var q = comboNorm(query).trim();
    var shown = options.filter(function (o) {
      return !q || comboNorm(o.label).indexOf(q) >= 0 || comboNorm(o.search).indexOf(q) >= 0 || (typeof o.meta === "string" && comboNorm(o.meta).indexOf(q) >= 0);
    });
    if (props.clearLabel && !q) shown = [{ value: null, label: props.clearLabel }].concat(shown);
    var cur = Math.min(active, Math.max(shown.length - 1, 0));
    function choose(o) {
      if (!o || o.disabled) return;
      if (props.onChange) props.onChange(o.value);
      setOpen(false); setQuery("");
    }
    function openAt() {
      var at = 0;
      for (var j = 0; j < shown.length; j++) if (shown[j].value === (props.value === undefined ? null : props.value)) at = j;
      setActive(at); setOpen(true);
    }
    function onKey(e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!open) openAt(); else setActive(Math.min(cur + 1, shown.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(cur - 1, 0)); }
      else if (e.key === "Enter") { if (open && shown.length) { e.preventDefault(); choose(shown[cur]); } }
      else if (e.key === "Escape") { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(""); } }
    }
    var listId = uid + "-list";
    return h("div", { className: cx("tc-combo tc-root", props.disabled && "tc-combo-disabled") },
      h("input", {
        id: props.id, className: "tc-input tc-combo-input", type: "text", role: "combobox", autoComplete: "off",
        "aria-label": props.label, "aria-expanded": open ? "true" : "false", "aria-controls": listId, "aria-autocomplete": "list",
        "aria-activedescendant": open && shown.length ? uid + "-o" + cur : undefined, "aria-invalid": props.invalid ? "true" : undefined,
        placeholder: open && selected ? selected.label : props.placeholder,
        value: open ? query : (selected ? selected.label : ""), disabled: !!props.disabled,
        onChange: function (e) { setQuery(e.target.value); setActive(0); setOpen(true); },
        onFocus: openAt, onClick: function () { if (!open) openAt(); },
        onBlur: function () { setOpen(false); setQuery(""); }, onKeyDown: onKey,
      }),
      h("span", { className: "tc-combo-caret", "aria-hidden": "true" }, h(Icon, { name: "chevronDown" })),
      open ? h("ul", { id: listId, role: "listbox", className: "tc-combo-list", "aria-label": props.label },
        shown.length ? shown.map(function (o, k) {
          return h("li", {
            key: String(o.value), id: uid + "-o" + k, role: "option", "aria-selected": k === cur ? "true" : "false", "aria-disabled": o.disabled ? "true" : undefined,
            className: cx("tc-combo-opt", o.value === props.value && "tc-combo-chosen", o.disabled && "tc-combo-optoff"),
            style: o.depth ? { paddingLeft: 12 + o.depth * 16 } : undefined,
            onMouseDown: function (e) { e.preventDefault(); choose(o); }, onMouseEnter: function () { setActive(k); },
          },
            o.kind ? h(IdentityBlock, { kind: o.kind, name: o.label, label: o.glyph, inline: true, size: "sm" }) : h("span", { className: "tc-combo-label" }, o.label),
            o.meta ? h("span", { className: cx("tc-combo-meta", o.warn && "tc-picker-warn") }, o.meta) : null);
        }) : h("li", { className: "tc-combo-empty", role: "option", "aria-selected": "false", "aria-disabled": "true" }, props.emptyText || t("combo.empty"))) : null);
  }

  /* WorkPreview: «Будет заведено» — что именно создастся до кнопки. */
  function WorkPreview(props) {
    var t = useT();
    var label = props.label || t("preview.label");
    return h("div", { className: "tc-wpreview tc-root", "aria-label": label },
      h("span", { className: "tc-wpreview-k" }, label),
      h("span", { className: "tc-wpreview-title" }, props.title || "—"),
      props.fields ? h("dl", null, props.fields.map(function (f, i) { return h(F, { key: i }, h("dt", null, f[0]), h("dd", null, f[1] || "—")); })) : null,
      props.seals ? h(Seals, props.seals) : null);
  }

  /* SearchField и FilterChip: строка поиска и фильтры списка. */
  function SearchField(props) {
    return h("label", { className: "tc-search tc-root", style: props.style }, h(Icon, { name: "search" }),
      h("input", { type: "search", placeholder: props.placeholder, value: props.value, onChange: props.onChange, "aria-label": props.label || props.placeholder }));
  }
  function FilterChip(props) {
    return h("button", { type: "button", className: "tc-chipbtn", "aria-pressed": props.pressed == null ? undefined : (props.pressed ? "true" : "false"), onClick: props.onClick },
      props.value != null ? h(F, null, props.label + ": ", h("b", null, props.value), h(Icon, { name: "chevronDown" })) : props.label,
      props.count != null ? h("span", { className: "tc-chipbtn-count" }, props.count) : null);
  }

  /* WorkGroup: сворачиваемая группа строк работы; human — полоса accent. */
  function WorkGroup(props) {
    var t = useT();
    var open = props.open !== false;
    return h("section", { className: cx("tc-wgroup", "tc-root", props.human && "tc-wgroup-human"), "aria-label": props.title },
      h("button", { type: "button", className: "tc-wgroup-head", "aria-expanded": open ? "true" : "false", onClick: props.onToggle },
        h(Icon, { name: "chevronDown" }), props.title, props.count != null ? h("span", { className: "tc-wgroup-count" }, props.count) : null,
        props.hint ? h("span", { className: "tc-wgroup-hint" }, props.hint) : null),
      open ? (props.empty ? h("div", { className: "tc-wgroup-empty" }, props.empty) : h("div", { className: "tc-wgroup-rows tc-workrows", role: "table", "aria-label": props.title }, props.children)) : null,
      open && props.more ? h("button", { type: "button", className: "tc-wgroup-more", onClick: props.onMore }, (props.more === true ? t("group.more.any") : t("group.more", { n: props.more }))) : null);
  }

  /* DataTable: таблица справочника; ячейка — значение или узел; num — табличные цифры. */
  function DataTable(props) {
    return h("div", { className: "tc-table-wrap tc-root" }, h("table", { className: "tc-table" },
      props.caption ? h("caption", { className: "tc-sr" }, props.caption) : null,
      h("thead", null, h("tr", null, props.columns.map(function (c) { return h("th", { key: c.key, scope: "col" }, c.title); }))),
      h("tbody", null, props.rows.map(function (r, i) {
        return h("tr", { key: r.key || i }, props.columns.map(function (c) { return h("td", { key: c.key, className: c.num ? "tc-num" : undefined }, r[c.key]); }));
      }))));
  }

  /* AppShell: каркас консоли — строка состояния, меню слева (поверх или закреплено), ассистент справа (сдвигает экран). */
  function AppShell(props) {
    var navOpen = !!(props.navOpen || props.navPinned);
    return h("div", { className: cx("tc-shell", props.assistantOpen && "tc-shell-assist", navOpen && "tc-shell-navopen", props.navPinned && "tc-shell-pinned") },
      props.nav ? h(F, null,
        h("div", { className: "tc-shell-scrim", "aria-hidden": "true", onClick: props.onScrim }),
        h("div", { className: "tc-shell-nav", id: props.navId, inert: navOpen ? undefined : INERT, "aria-hidden": navOpen ? undefined : "true" }, props.nav)) : null,
      h("div", { className: "tc-shell-app" },
        h("div", { className: "tc-shell-page tc-root" }, props.topbar,
          h("main", { className: "tc-shell-content" }, props.status ? h("div", { className: "tc-shell-status" }, props.status) : null, props.children))),
      props.assistant ? h("div", { className: "tc-shell-dock", id: props.assistantId, inert: props.assistantOpen ? undefined : INERT, "aria-hidden": props.assistantOpen ? undefined : "true" }, props.assistant) : null);
  }

  window.TaimenConsole = {
    Button: Button, ExecutorGlyph: ExecutorGlyph, IdentityBlock: IdentityBlock, StatusMark: StatusMark,
    SourceChip: SourceChip, ChannelChip: ChannelChip, Seals: Seals, TopBar: TopBar, Summary: Summary,
    DecisionCard: DecisionCard, ProblemCard: ProblemCard, WorkPath: WorkPath, ExecutorCard: ExecutorCard,
    WorkRow: WorkRow, Chronicle: Chronicle, PlanDiff: PlanDiff, NavDrawer: NavDrawer, LiveChip: LiveChip,
    Icon: Icon, Zone: Zone, PageHeader: PageHeader, Dialog: Dialog, Consequences: Consequences, Criteria: Criteria, Callout: Callout, DecisionStatus: DecisionStatus,
    Field: Field, PersonPicker: PersonPicker, Combobox: Combobox, WorkPreview: WorkPreview, SearchField: SearchField, FilterChip: FilterChip, WorkGroup: WorkGroup, DataTable: DataTable, AppShell: AppShell, JournalEntry: JournalEntry,
    AssistantPanel: AssistantPanel, CommandPalette: CommandPalette, DegradedBanner: DegradedBanner, EmptyState: EmptyState,
    LocaleProvider: LocaleProvider, useLocale: useLocale, STRINGS: STRINGS, STATUS_WORD: STATUS_WORD
  };
})();
