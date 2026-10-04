// Действия и формы: модальное окно, последствия, критерии, пояснение, статус решения, поле, выбор исполнителя, поиск, фильтр.
// Перенос из design-system/components/bundle.js — разметка, классы и поведение байт в байт.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icon } from "./icons";
import { IdentityBlock } from "./primitives";
import { useT } from "./locale";
import { cx, type ExecutorKind } from "./util";

/* ---------- Dialog: модальное окно ---------- */
export interface DialogProps {
  title: ReactNode;
  sub?: ReactNode;
  /** 960px вместо 640px — форма с предпросмотром. */
  wide?: boolean;
  /** alertdialog — для необратимых действий. */
  alert?: boolean;
  /** Esc, клик по подложке и кнопка «Закрыть». Берётся при открытии: для Esc действует обработчик первого рендера. */
  onClose?: () => void;
  /** Слева в подвале: «Обратимо: …» / «Необратимо: …». */
  hint?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

/* Сквозной счётчик id заголовков диалогов (как dialogSeq в bundle.js). */

/** Модальное окно: фокус внутри, Esc и клик по подложке закрывают, фокус возвращается туда, откуда открыли. */
export function Dialog(props: DialogProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = "tc-dlg-" + useId().replace(/[^A-Za-z0-9_-]/g, "");
  const onClose = useRef(props.onClose);
  useLayoutEffect(() => { onClose.current = props.onClose; });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current && ref.current.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])");
    if (el) el.focus();
    function k(e: KeyboardEvent) {
      // Esc раскрытого списка (combobox) закрывает список, а не окно: окно — следующим Esc.
      const target = e.target as Element | null;
      if (e.key === "Escape" && target && target.getAttribute && target.getAttribute("role") === "combobox" && target.getAttribute("aria-expanded") === "true") return;
      if (e.key === "Escape") { e.stopPropagation(); if (onClose.current) onClose.current(); }
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", k, true);
    return () => { document.removeEventListener("keydown", k, true); if (prev && prev.focus) prev.focus(); };
    // Подписка один раз на открытие — как в bundle.js.
  }, []);
  return (
    // Клик по подложке — удобство для мыши; с клавиатуры окно закрывает Esc (обработчик выше).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="tc-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}>
      <div className={cx("tc-dialog", "tc-root", props.wide && "tc-dialog-wide")} role={props.alert ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="tc-dialog-head">
          <div>
            <h2 className="tc-dialog-title" id={titleId}>{props.title}</h2>
            {props.sub ? <p className="tc-dialog-sub">{props.sub}</p> : null}
          </div>
          <button type="button" className="tc-icon-btn" aria-label={t("dialog.close")} data-close="" onClick={props.onClose}><Icon name="x" /></button>
        </div>
        <div className="tc-dialog-body">{props.children}</div>
        {props.footer ? <div className="tc-dialog-foot">{props.hint ? <span className="tc-dialog-hint">{props.hint}</span> : null}{props.footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------- Consequences: последствия действия до кнопки ---------- */
export interface ConsequenceItem {
  /** ok — безопасно / уже ничего не менялось; warn — заметное или необратимое; info — нейтрально. */
  tone?: "ok" | "warn" | "info";
  /** «Текущая попытка», «Что уже сделано вовне», «Обратимо ли», «Дело процесса». */
  k: ReactNode;
  v: ReactNode;
}
export interface ConsequencesProps { items: ConsequenceItem[]; label?: string }

export function Consequences(props: ConsequencesProps) {
  const t = useT();
  return (
    <ul className="tc-cons tc-root" aria-label={props.label || t("consequences.label")}>
      {props.items.map((it, i) => {
        const tone = it.tone || "info";
        return (
          <li key={i} className={"tc-cons-" + tone}>
            <Icon name={tone === "ok" ? "check" : tone === "warn" ? "warn" : "info"} />
            <span className="tc-cons-k">{it.k}</span>
            <span className="tc-cons-v">{it.v}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Criteria: критерии приёмки работы с видом проверки и состоянием ---------- */
export interface CriterionItem {
  text: ReactNode;
  /** «автопроверка», «внешнее состояние», «человек», «оценка модели». */
  kind: ReactNode;
  /** ok — пройден, bad — не пройден, wait — ждёт; нет — проверка впереди. */
  state?: "ok" | "bad" | "wait";
}
export interface CriteriaProps { items: CriterionItem[]; label?: string }

export function Criteria(props: CriteriaProps) {
  const t = useT();
  return (
    <ul className="tc-criteria tc-root" aria-label={props.label || t("criteria.label")}>
      {props.items.map((c, i) => {
        const st = c.state;
        return (
          <li key={i} className={st ? "tc-crit-" + st : undefined}>
            {st
              ? <Icon name={st === "ok" ? "check" : st === "bad" ? "x" : "clock"} label={t(st === "ok" ? "criteria.ok" : st === "bad" ? "criteria.bad" : "criteria.wait")} />
              : <span className="tc-crit-blank" aria-hidden="true" />}
            <span className="tc-crit-text">{c.text}</span>
            <span className="tc-crit-kind">{c.kind}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Callout: предупреждение или пояснение в потоке формы ---------- */
export interface CalloutProps { tone?: "warning" | "info"; children?: ReactNode }

export function Callout(props: CalloutProps) {
  const tone = props.tone || "warning";
  return (
    <div className={cx("tc-callout", "tc-callout-" + tone, "tc-root")} role="note">
      <Icon name={tone === "warning" ? "warn" : "info"} />
      <div>{props.children}</div>
    </div>
  );
}

/* ---------- DecisionStatus: что стало с решением после нажатия ---------- */
export interface DecisionStatusRow {
  /** wait — отправляется/исполняется, done — подтверждено ядром, fail — не записано, warn — нужно проверить заново. */
  state?: "wait" | "done" | "fail" | "warn";
  text: ReactNode;
  at?: string;
}
export interface DecisionStatusProps { rows: DecisionStatusRow[]; actions?: ReactNode }

export function DecisionStatus(props: DecisionStatusProps) {
  return (
    <div className="tc-dstatus tc-root" role="status" aria-live="polite">
      {props.rows.map((r, i) => {
        const st = r.state || "wait";
        return (
          <div key={i} className={"tc-dstatus-row tc-dstatus-" + st}>
            <Icon name={st === "done" ? "check" : st === "fail" ? "x" : st === "warn" ? "warn" : "clock"} />
            <span className="tc-dstatus-text">{r.text}</span>
            {r.at ? <span className="tc-num tc-muted">{r.at}</span> : null}
          </div>
        );
      })}
      {props.actions ? <div className="tc-actions">{props.actions}</div> : null}
    </div>
  );
}

/* ---------- Field: подпись, подсказка и поле ---------- */
export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  /** На всю ширину сетки .tc-form. */
  wide?: boolean;
  /** Поле: <input class="tc-input">, <select class="tc-select">, <textarea class="tc-textarea">. */
  children?: ReactNode;
}

export function Field(props: FieldProps) {
  return (
    <label className={cx("tc-field", props.wide && "tc-field-wide")}>
      <span className="tc-field-label">{props.label}</span>
      {props.help ? <span className="tc-field-help">{props.help}</span> : null}
      {props.children}
    </label>
  );
}

/* ---------- PersonPicker: выбор исполнителя списком ---------- */
export interface PersonOption {
  id: string;
  name: string;
  kind?: ExecutorKind;
  glyph?: string;
  /** Роль и занятость: «Бухгалтер · в работе 3». */
  meta?: ReactNode;
  /** Нет нужной роли — meta предупреждением. */
  warn?: boolean;
  disabled?: boolean;
}
export interface PersonPickerProps { options: PersonOption[]; value?: string; onChange?: (id: string) => void; name?: string; label?: string }

export function PersonPicker(props: PersonPickerProps) {
  const t = useT();
  const nm = props.name || "person";
  return (
    <ul className="tc-picker tc-root" role="radiogroup" aria-label={props.label || t("picker.label")}>
      {props.options.map((o) => (
        <li key={o.id}>
          <label className={cx(o.disabled && "tc-picker-off")}>
            <input type="radio" name={nm} checked={props.value === o.id} disabled={!!o.disabled} onChange={() => { if (props.onChange) props.onChange(o.id); }} />
            <IdentityBlock kind={o.kind || "human"} name={o.name} label={o.glyph} inline={true} size="sm" />
            {o.meta ? <span className={cx("tc-picker-meta", o.warn && "tc-picker-warn")}>{o.meta}</span> : null}
          </label>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Combobox: выбор из длинного списка поиском ---------- */
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

function comboNorm(s: unknown): string { return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е"); }

/**
 * Закрыт — в поле выбранное; фокус или ввод открывают список, ввод его сужает (без учёта регистра и
 * «ё»); ↑↓ — по вариантам, Enter — выбрать, Esc — закрыть, не закрывая диалог вокруг.
 */
export function Combobox(props: ComboboxProps) {
  const t = useT();
  const options = props.options || [];
  const uid = "tc-cb-" + useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [open, setOpen] = useState(!!props.defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  let selected: ComboOption | null = null;
  for (let i = 0; i < options.length; i++) if (options[i]!.value === props.value) selected = options[i]!;
  const q = comboNorm(query).trim();
  let shown = options.filter((o) => !q || comboNorm(o.label).indexOf(q) >= 0 || comboNorm(o.search).indexOf(q) >= 0 || (typeof o.meta === "string" && comboNorm(o.meta).indexOf(q) >= 0));
  if (props.clearLabel && !q) shown = [{ value: null, label: props.clearLabel } as ComboOption].concat(shown);
  const cur = Math.min(active, Math.max(shown.length - 1, 0));
  function choose(o: ComboOption | undefined) {
    if (!o || o.disabled) return;
    if (props.onChange) props.onChange(o.value);
    setOpen(false); setQuery("");
  }
  function openAt() {
    let at = 0;
    for (let j = 0; j < shown.length; j++) if (shown[j]!.value === (props.value === undefined ? null : props.value)) at = j;
    setActive(at); setOpen(true);
  }
  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) openAt(); else setActive(Math.min(cur + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(cur - 1, 0)); }
    else if (e.key === "Enter") { if (open && shown.length) { e.preventDefault(); choose(shown[cur]); } }
    else if (e.key === "Escape") { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(""); } }
  }
  const listId = uid + "-list";
  return (
    <div className={cx("tc-combo tc-root", props.disabled && "tc-combo-disabled")}>
      <input id={props.id} className="tc-input tc-combo-input" type="text" role="combobox" autoComplete="off"
        aria-label={props.label} aria-expanded={open ? "true" : "false"} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && shown.length ? uid + "-o" + cur : undefined} aria-invalid={props.invalid ? "true" : undefined}
        placeholder={open && selected ? selected.label : props.placeholder}
        value={open ? query : (selected ? selected.label : "")} disabled={!!props.disabled}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={openAt} onClick={() => { if (!open) openAt(); }}
        onBlur={() => { setOpen(false); setQuery(""); }} onKeyDown={onKey} />
      <span className="tc-combo-caret" aria-hidden="true"><Icon name="chevronDown" /></span>
      {open ? (
        <ul id={listId} role="listbox" className="tc-combo-list" aria-label={props.label}>
          {shown.length ? shown.map((o, k) => (
            <li key={String(o.value)} id={uid + "-o" + k} role="option" aria-selected={k === cur ? "true" : "false"} aria-disabled={o.disabled ? "true" : undefined}
              className={cx("tc-combo-opt", o.value === props.value && "tc-combo-chosen", o.disabled && "tc-combo-optoff")}
              style={o.depth ? { paddingLeft: 12 + o.depth * 16 } : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(k)}>
              {o.kind ? <IdentityBlock kind={o.kind} name={o.label} label={o.glyph} inline={true} size="sm" /> : <span className="tc-combo-label">{o.label}</span>}
              {o.meta ? <span className={cx("tc-combo-meta", o.warn && "tc-picker-warn")}>{o.meta}</span> : null}
            </li>
          )) : <li className="tc-combo-empty" role="option" aria-selected="false" aria-disabled="true">{props.emptyText || t("combo.empty")}</li>}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------- SearchField и FilterChip: строка поиска и фильтры списка ---------- */
export interface SearchFieldProps {
  placeholder?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** aria-label поля; по умолчанию — placeholder. */
  label?: string;
  style?: CSSProperties;
}

export function SearchField(props: SearchFieldProps) {
  return (
    <label className="tc-search tc-root" style={props.style}>
      <Icon name="search" />
      <input type="search" placeholder={props.placeholder} value={props.value} onChange={props.onChange} aria-label={props.label || props.placeholder} />
    </label>
  );
}

export interface FilterChipProps {
  label: string;
  /** С value — выпадающий фильтр «Тип работы: все ▾»; без — переключатель с pressed. */
  value?: ReactNode;
  pressed?: boolean;
  count?: ReactNode;
  onClick?: () => void;
}

export function FilterChip(props: FilterChipProps) {
  return (
    <button type="button" className="tc-chipbtn" aria-pressed={props.pressed == null ? undefined : (props.pressed ? "true" : "false")} onClick={props.onClick}>
      {props.value != null ? <>{props.label + ": "}<b>{props.value}</b><Icon name="chevronDown" /></> : props.label}
      {props.count != null ? <span className="tc-chipbtn-count">{props.count}</span> : null}
    </button>
  );
}
