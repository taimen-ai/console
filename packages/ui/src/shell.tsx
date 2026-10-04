// Каркас консоли и общие части экранов: строка состояния, меню, палитра команд, баннеры, заголовок, зона, каркас.
// Перенос из design-system/components/bundle.js — разметка и классы байт в байт.
import { Fragment, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Ico } from "./icons";
import { Button, ExecutorGlyph, LiveChip, StatusMark, type ButtonVariant, type StatusMarkProps } from "./primitives";
import { useT, type Translate } from "./locale";
import { cx, type ExecutorKind, type Status } from "./util";

/* ---------- TopBar (зона 0) ---------- */
export interface TopBarProps {
  /** BRAND-слой: знак из конфигурации организации. Без brand.name на месте имени стоит название организации (org), второй раз оно не повторяется. */
  brand?: { name?: string; mark?: ReactNode };
  org?: string;
  /** Область работы — например, выбор пространства (Combobox) рядом с организацией. */
  scope?: ReactNode;
  /** «Сегодня, 29 сентября». */
  date?: ReactNode;
  /** Время последних данных. */
  at?: string;
  /** false — соединения нет: «offline · данные на …»; иначе «online · <at>». */
  live?: boolean;
  /** Период — только если передан и есть onPeriod; иначе переключателя нет. */
  periods?: string[];
  period?: string;
  onPeriod?: (period: string) => void;
  /** Поиск ⌘K — только если передан обработчик; иначе кнопки нет. */
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


export function TopBar(props: TopBarProps) {
  const t = useT();
  const brand = props.brand || {};
  const live = props.live !== false;
  const periods = props.periods || [];
  return (
    <header className="tc-topbar tc-root">
      {props.onMenu ? (
        <button type="button" className="tc-icon-btn tc-topbar-menu" aria-label={t("topbar.menu")} aria-expanded={props.menuOpen ? "true" : "false"} aria-controls={props.menuId} onClick={props.onMenu}>{Ico.menu()}</button>
      ) : null}
      <span className="tc-brand">
        {brand.mark ? <span className="tc-brand-mark" aria-hidden="true">{brand.mark}</span> : null}
        {brand.name || props.org || null}
      </span>
      <span className="tc-topbar-org">{brand.name ? <b>{props.org}</b> : null}<span className="tc-topbar-date">{props.date}</span></span>
      {props.scope ? <span className="tc-topbar-scope">{props.scope}</span> : null}
      {props.showLive === false ? null : <LiveChip live={live} at={props.at} inline={true} />}
      <span className="tc-topbar-spacer" />
      {periods.length ? (
        <span className="tc-seg" role="group" aria-label={t("topbar.period")}>
          {periods.map((pp) => <button key={pp} type="button" aria-pressed={pp === (props.period || periods[0]) ? "true" : "false"} onClick={props.onPeriod ? () => props.onPeriod?.(pp) : undefined}>{pp}</button>)}
        </span>
      ) : null}
      {props.onSearch ? <button type="button" className="tc-topbar-search" aria-label={t("topbar.search")} onClick={props.onSearch}>{Ico.search()}<span>{t("topbar.searchHint")}</span><kbd className="tc-kbd">⌘K</kbd></button> : null}
      {props.user ? <ExecutorGlyph kind="human" name={props.user} size="md" /> : null}
      {props.assistantOpen ? null : (
        <Button variant="brand" size="sm" kbd="⌘J" onClick={props.onAssistant} aria-expanded={props.assistantOpen ? "true" : "false"} aria-controls={props.assistantId}
          aria-label={props.assistantUnread ? t("topbar.assistantUnread", { n: props.assistantUnread }) : undefined}>
          {t("assistant.title")}
          {props.assistantUnread ? <span className={cx("tc-badge", props.assistantUrgent && "tc-badge-human")} aria-hidden="true">{props.assistantUnread}</span> : null}
        </Button>
      )}
    </header>
  );
}

/* ---------- NavDrawer (меню слева) ---------- */
export interface NavItem {
  label?: ReactNode;
  icon?: ReactNode;
  href?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  active?: boolean;
  /** Счётчик справа; human — ждёт человека (accent). */
  count?: number;
  human?: boolean;
  /** Заглушка пункта, пока состав меню не задан. */
  placeholder?: boolean;
}
export interface NavGroup { title?: ReactNode; items?: NavItem[] }
export interface NavDrawerProps {
  /** Организация в шапке меню (переключатель). */
  org?: string;
  orgMeta?: string;
  groups?: NavGroup[];
  /** Закреплено — меню сдвигает экран; иначе выезжает поверх с затемнением. */
  pinned?: boolean;
  onPin?: () => void;
  onClose?: () => void;
  /** Низ меню: настройки, участник. */
  footer?: ReactNode;
  label?: string;
}

function navItem(it: NavItem, k: number, t: Translate) {
  if (it.placeholder) {
    return (
      <li key={k}>
        <span className="tc-nav-item tc-nav-ph" aria-hidden="true"><span className="tc-nav-ico" /><span className="tc-nav-label">{it.label || t("nav.placeholder")}</span></span>
      </li>
    );
  }
  return (
    <li key={k}>
      <a className={cx("tc-nav-item", it.active && "tc-nav-active")} href={it.href || "#"} aria-current={it.active ? "page" : undefined} onClick={it.onClick}>
        <span className="tc-nav-ico" aria-hidden="true">{it.icon || null}</span>
        <span className="tc-nav-label">{it.label}</span>
        {it.count ? <span className={cx("tc-nav-count", it.human && "tc-nav-count-human")}>{it.count}</span> : null}
      </a>
    </li>
  );
}

export function NavDrawer(props: NavDrawerProps) {
  const t = useT();
  const groups = props.groups || [];
  const pinTitle = t(props.pinned ? "nav.unpin" : "nav.pin");
  return (
    <nav className={cx("tc-nav", "tc-root")} aria-label={props.label || t("nav.label")}>
      <div className="tc-nav-head">
        <button type="button" className="tc-nav-org" aria-label={t("nav.org", { org: props.org || "" })}>
          <span className="tc-nav-org-name">{props.org}</span>
          {props.orgMeta ? <span className="tc-nav-org-meta">{props.orgMeta}</span> : null}
          {Ico.chevronDown()}
        </button>
        <span className="tc-nav-tools">
          {props.onPin ? <button type="button" className="tc-icon-btn" aria-pressed={props.pinned ? "true" : "false"} aria-label={pinTitle} title={pinTitle} onClick={props.onPin}>{Ico.panelLeft()}</button> : null}
          {props.onClose ? <button type="button" className="tc-icon-btn" aria-label={t("nav.close")} onClick={props.onClose}>{Ico.x()}</button> : null}
        </span>
      </div>
      <div className="tc-nav-body">
        {groups.map((g, i) => (
          <div key={i} className="tc-nav-group">
            {g.title ? <div className="tc-nav-gt">{g.title}</div> : null}
            <ul>{(g.items || []).map((it, k) => navItem(it, k, t))}</ul>
          </div>
        ))}
      </div>
      {props.footer ? <div className="tc-nav-foot">{props.footer}</div> : null}
    </nav>
  );
}

/* ---------- CommandPalette ---------- */
export interface CommandPaletteItem { label: string; hint?: string; kbd?: string; kind?: ExecutorKind; glyph?: string; who?: string; status?: Status; selected?: boolean }
export interface CommandPaletteGroup { title: string; items: CommandPaletteItem[] }
export interface CommandPaletteProps { query?: string; groups?: CommandPaletteGroup[] }

export function CommandPalette(props: CommandPaletteProps) {
  const t = useT();
  return (
    <div className="tc-palette tc-root" role="dialog" aria-label={t("palette.label")}>
      <div className="tc-palette-search">{Ico.search()}<input defaultValue={props.query || ""} placeholder={t("palette.placeholder")} aria-label={t("palette.search")} /><kbd className="tc-kbd">Esc</kbd></div>
      <div role="listbox">
        {(props.groups || []).map((g, i) => (
          <div key={i} className="tc-palette-group" role="group" aria-label={g.title}>
            <div className="tc-palette-gt">{g.title}</div>
            {g.items.map((it, j) => (
              <div key={j} className="tc-palette-item" role="option" aria-selected={it.selected ? "true" : "false"}>
                {it.kind ? <ExecutorGlyph kind={it.kind} name={it.who || it.label} label={it.glyph} size="sm" /> : it.status ? <StatusMark status={it.status} pill={false} label=" " /> : null}
                <span className="tc-palette-item-label">{it.label}</span>
                {it.hint ? <span className="tc-palette-hint">{it.hint}</span> : null}
                {it.kbd ? <kbd className="tc-kbd">{it.kbd}</kbd> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="tc-palette-foot">
        <span><kbd className="tc-kbd">↑↓</kbd>{" " + t("palette.select")}</span>
        <span><kbd className="tc-kbd">Enter</kbd>{" " + t("palette.open")}</span>
        <span><kbd className="tc-kbd">E</kbd>{" " + t("palette.confirm")}</span>
      </div>
    </div>
  );
}

/* ---------- DegradedBanner ---------- */
export interface DegradedBannerProps { kind?: "stale" | "down"; at?: string; text?: ReactNode }
export interface DegradedBannerSectionProps { text?: ReactNode }

export function DegradedBanner(props: DegradedBannerProps) {
  const t = useT();
  const kind = props.kind || "stale";
  return (
    <div className={cx("tc-banner", "tc-banner-" + kind, "tc-root")} role="status">
      {kind === "down" ? Ico.wifiOff() : Ico.clock()}
      <span>{props.text || (kind === "down"
        ? (props.at ? t("banner.downAt", { at: props.at }) : t("banner.down"))
        : (props.at ? t("banner.staleAt", { at: props.at }) : t("banner.stale")))}</span>
      {kind === "down" ? <Button size="sm" variant="secondary">{t("banner.retry")}</Button> : null}
    </div>
  );
}

/** Ошибка одной секции экрана. */
DegradedBanner.Section = function DegradedBannerSection(props: DegradedBannerSectionProps) {
  const t = useT();
  return <div className="tc-sect-err tc-root" role="status">{Ico.wifiOff()}{props.text || t("banner.section")}</div>;
};

/* ---------- EmptyState ---------- */
export interface EmptyStateProps {
  title: ReactNode;
  body?: ReactNode;
  /** Одно действие. */
  action?: ReactNode;
  actionVariant?: ButtonVariant;
  /** Схема пути работы — только для онбординга. */
  art?: boolean;
}

function PathArt() {
  return (
    <svg className="tc-empty-art" viewBox="0 0 280 56" aria-hidden="true">
      <path className="tc-ea-line" d="M20 28H100" />
      <path className="tc-ea-line tc-ea-gate" d="M100 28H140" />
      <path className="tc-ea-line" d="M140 28H260" />
      {[20, 70, 140, 200, 260].map((x, i) => <circle key={i} className="tc-ea-node" cx={x} cy={28} r={7} />)}
      <circle className="tc-ea-human" cx={120} cy={28} r={5} />
    </svg>
  );
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div className="tc-empty tc-root">
      {props.art ? <PathArt /> : null}
      <h3 className="tc-empty-title">{props.title}</h3>
      {props.body ? <p className="tc-empty-body">{props.body}</p> : null}
      {props.action ? <Button variant={props.actionVariant || "brand"}>{props.action}</Button> : null}
    </div>
  );
}

/* ---------- Zone: зона экрана — карточка с заголовком ---------- */
export interface ZoneProps {
  title?: ReactNode;
  /** Число справа от заголовка или подпись («сегодня»). */
  count?: ReactNode;
  /** Узел справа вместо count (ссылка «Весь журнал»). */
  action?: ReactNode;
  /** human — полоса accent «нужен человек»; problem — полоса error, только когда проблема есть. */
  tone?: "human" | "problem";
  /** aria-label секции; по умолчанию — title, если он строка. */
  label?: string;
  className?: string;
  /** Есть в bundle.js, нет в index.d.ts. */
  style?: CSSProperties;
  children?: ReactNode;
}

export function Zone(props: ZoneProps) {
  const label = props.label || (typeof props.title === "string" ? props.title : undefined);
  return (
    <section className={cx("tc-zone", props.tone === "human" && "tc-zone-human", props.tone === "problem" && "tc-zone-problem", props.className)} aria-label={label} style={props.style}>
      {props.title ? (
        <div className="tc-zone-head">
          <h2 className="tc-zone-title">{props.title}</h2>
          {props.action || (props.count != null ? <span className="tc-zone-count">{props.count}</span> : null)}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

/* ---------- PageHeader: путь, статус, заголовок с глагола, фраза готовности, действия справа ---------- */
export interface PageHeaderProps {
  /** Путь: «← Работа». */
  crumbs?: { label: ReactNode; href?: string }[];
  /** Номер вторым слоем: TASK-000845. */
  number?: string;
  status?: StatusMarkProps;
  /** Заголовок с глагола. */
  title: ReactNode;
  /** Фраза готовности или пояснение экрана. */
  lead?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader(props: PageHeaderProps) {
  const t = useT();
  return (
    <div className="tc-pagehead tc-root">
      {props.crumbs || props.number ? (
        <nav className="tc-crumbs" aria-label={t("crumbs.label")}>
          {(props.crumbs || []).map((c, i) => (
            <Fragment key={i}>{i ? <span aria-hidden="true">·</span> : null}{c.href ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}</Fragment>
          ))}
          {props.number ? <>{props.crumbs && props.crumbs.length ? <span aria-hidden="true">·</span> : null}<span className="tc-mono">{props.number}</span></> : null}
        </nav>
      ) : null}
      <div className="tc-pagehead-row">
        <div className="tc-pagehead-main">
          {props.status ? <StatusMark {...props.status} /> : null}
          <h1 className="tc-pagehead-title">{props.title}</h1>
          {props.lead ? <p className="tc-pagehead-lead">{props.lead}</p> : null}
        </div>
        {props.actions ? <div className="tc-pagehead-actions">{props.actions}</div> : null}
      </div>
    </div>
  );
}

/* ---------- AppShell: каркас консоли ---------- */
export interface AppShellProps {
  /** TopBar. */
  topbar?: ReactNode;
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

/*
 * Паритет с bundle.js: закрытые меню и ассистент получают inert="". React 19 считает inert булевым
 * атрибутом и пустую строку трактует как false — атрибут не выводится (с предупреждением в dev).
 * Баг дизайн-системы: правка — сначала в bundle.js (inert: true), затем здесь.
 */
/* inert — булево React 19: скрытые меню и ассистент недоступны с клавиатуры. */
const INERT = true;

export function AppShell(props: AppShellProps) {
  const navOpen = !!(props.navOpen || props.navPinned);
  return (
    <div className={cx("tc-shell", props.assistantOpen && "tc-shell-assist", navOpen && "tc-shell-navopen", props.navPinned && "tc-shell-pinned")}>
      {props.nav ? (
        <>
          <div className="tc-shell-scrim" aria-hidden="true" onClick={props.onScrim} />
          <div className="tc-shell-nav" id={props.navId} inert={navOpen ? undefined : INERT} aria-hidden={navOpen ? undefined : "true"}>{props.nav}</div>
        </>
      ) : null}
      <div className="tc-shell-app">
        <div className="tc-shell-page tc-root">
          {props.topbar}
          <main className="tc-shell-content">
            {props.status ? <div className="tc-shell-status">{props.status}</div> : null}
            {props.children}
          </main>
        </div>
      </div>
      {props.assistant ? (
        <div className="tc-shell-dock" id={props.assistantId} inert={props.assistantOpen ? undefined : INERT} aria-hidden={props.assistantOpen ? undefined : "true"}>{props.assistant}</div>
      ) : null}
    </div>
  );
}
