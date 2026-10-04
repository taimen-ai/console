// Работа: строка и группа работ, хроника, план пакета, предпросмотр заводимой работы, таблица справочника.
// Перенос из design-system/components/bundle.js — разметка и классы байт в байт.
import { Fragment, type Key, type ReactNode } from "react";
import { Icon, statusShape } from "./icons";
import {
  Button, ChannelChip, ExecutorGlyph, Seals, SourceChip, StatusMark,
  type ChannelChipProps, type SealsProps, type SourceChipProps,
} from "./primitives";
import { translate, useT } from "./locale";
import { cx, type ExecutorKind, type Status } from "./util";

/* ---------- WorkRow ---------- */
export interface WorkRowProps {
  status?: Status;
  statusLabel?: string;
  title: ReactNode;
  /** Номер вторым слоем: TASK-000840. */
  number?: string;
  /** Фраза готовности. */
  readiness?: ReactNode;
  /** Без печатей — все четыре звена «отсутствуют». */
  seals?: SealsProps;
  age?: string;
  /** Главное действие строки на месте. */
  action?: string;
  /** Ссылка на страницу работы — заголовок становится ссылкой. */
  href?: string;
  onAction?: () => void;
  mine?: boolean;
}

export function WorkRow(props: WorkRowProps) {
  return (
    <div className={cx("tc-workrow", "tc-root", props.mine && "tc-workrow-mine")} role="row">
      <div className="tc-workrow-main" role="cell">
        <div className="tc-workrow-top">
          <StatusMark status={props.status} label={props.statusLabel} mine={props.mine} />
          {props.href ? <a className="tc-workrow-title tc-workrow-link" href={props.href}>{props.title}</a> : <span className="tc-workrow-title">{props.title}</span>}
          {props.number ? <span className="tc-mono">{props.number}</span> : null}
        </div>
        {props.readiness ? <span className="tc-workrow-ready">{props.readiness}</span> : null}
      </div>
      <div className="tc-workrow-side" role="cell">
        <Seals {...(props.seals || {})} />
        {props.action ? <Button size="sm" variant={props.mine ? "human" : "secondary"} onClick={props.onAction}>{props.action}</Button> : null}
        {props.age ? <span className="tc-age">{props.age}</span> : null}
      </div>
    </div>
  );
}

/* ---------- WorkGroup: сворачиваемая группа строк работы ---------- */
export interface WorkGroupProps {
  title: string;
  count?: ReactNode;
  hint?: ReactNode;
  /** «Ждёт вас» — полоса accent. */
  human?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** «Показать ещё N»; true — «Показать ещё», когда сколько осталось неизвестно. */
  more?: number | boolean;
  onMore?: () => void;
  /** Строки WorkRow. */
  children?: ReactNode;
  /** Пустая группа: «Ничего не застряло» или баннер сбоя — вне таблицы строк (таблица без строк недопустима). */
  empty?: ReactNode;
}

export function WorkGroup(props: WorkGroupProps) {
  const t = useT();
  const open = props.open !== false;
  return (
    <section className={cx("tc-wgroup", "tc-root", props.human && "tc-wgroup-human")} aria-label={props.title}>
      <button type="button" className="tc-wgroup-head" aria-expanded={open ? "true" : "false"} onClick={props.onToggle}>
        <Icon name="chevronDown" />
        {props.title}
        {props.count != null ? <span className="tc-wgroup-count">{props.count}</span> : null}
        {props.hint ? <span className="tc-wgroup-hint">{props.hint}</span> : null}
      </button>
      {open ? (props.empty ? <div className="tc-wgroup-empty">{props.empty}</div> : <div className="tc-wgroup-rows tc-workrows" role="table" aria-label={props.title}>{props.children}</div>) : null}
      {open && props.more ? <button type="button" className="tc-wgroup-more" onClick={props.onMore}>{props.more === true ? t("group.more.any") : t("group.more", { n: props.more })}</button> : null}
    </section>
  );
}

/* ---------- Chronicle ---------- */
export type ChronicleView = "brief" | "time" | "full";
export type ChronicleKind = "origin" | "delivery" | "claim" | "attempt" | "result" | "verify" | "signature" | "discussion" | "spawned" | "reconcile" | "impact";

export interface ChronicleGroup {
  kind: ChronicleKind;
  kindLabel?: string;
  at?: string;
  title?: ReactNode;
  text?: ReactNode;
  actor?: { kind?: ExecutorKind; name: string; label?: string };
  status?: Status;
  /** Ожидание или действие человека — пунктирная дорожка. */
  human?: boolean;
  done?: boolean;
  /** Звено отсутствует: пунктир с причиной в text. */
  missing?: boolean;
  channel?: ChannelChipProps;
  source?: SourceChipProps;
  criteria?: { ok: boolean; text: ReactNode }[];
  /** Раскрываемый ящик (протокол, технический слой). */
  box?: ReactNode;
}
export interface ChronicleSpan { label: ReactNode; from: number; to: number; dur: ReactNode; human?: boolean }
export interface ChronicleEvent { at: ReactNode; text: ReactNode; type: ReactNode }
export interface ChronicleProps {
  view?: ChronicleView;
  onView?: (view: ChronicleView) => void;
  groups?: ChronicleGroup[];
  /** Вид «По времени»: полосы в процентах периода. */
  spans?: ChronicleSpan[];
  /** Вид «Полный журнал». */
  events?: ChronicleEvent[];
  hideViews?: boolean;
}

const VIEWS: ChronicleView[] = ["brief", "time", "full"];

function nodeFor(g: ChronicleGroup) {
  if (g.missing) return <span className="tc-chron-node" style={{ color: "var(--border-dashed)" }}>{statusShape("waiting_human")}</span>;
  if (g.actor) return <span className="tc-chron-node"><ExecutorGlyph kind={g.actor.kind} name={g.actor.name} label={g.actor.label} size="sm" waiting={g.human && !g.done} /></span>;
  return (
    <span className="tc-chron-node" style={{ color: g.status === "failed" ? "var(--status-failed)" : g.status === "verified" ? "var(--status-verified)" : "var(--machine-line)" }}>
      {statusShape(g.status || "running")}
    </span>
  );
}

export function Chronicle(props: ChronicleProps) {
  const t = useT();
  const view = props.view || "brief";
  const groups = props.groups || [];
  const onView = props.onView;
  const views = (
    <div className="tc-views" role="group" aria-label={t("chronicle.views")}>
      {VIEWS.map((key) => (
        <button key={key} type="button" aria-pressed={view === key ? "true" : "false"} onClick={onView ? () => { onView(key); } : undefined}>{t(`chronicle.view.${key}`)}</button>
      ))}
    </div>
  );
  let body: ReactNode;
  if (view === "time") {
    body = (
      <div className="tc-timebars">
        {(props.spans || []).map((s, i) => (
          <div key={i} className={cx("tc-timebar", s.human && "tc-timebar-human")}>
            <span>{s.label}</span>
            <span className="tc-timebar-track"><span className="tc-timebar-fill" style={{ left: s.from + "%", width: Math.max(1.5, s.to - s.from) + "%" }} /></span>
            <span className="tc-age">{s.dur}</span>
          </div>
        ))}
      </div>
    );
  } else if (view === "full") {
    body = (
      <table className="tc-fulllog">
        <tbody>
          {(props.events || []).map((e, i) => (
            <tr key={i}><td className="tc-age">{e.at}</td><td>{e.text}</td><td className="tc-mono">{e.type}</td></tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    body = (
      <ol className="tc-chron" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {groups.map((g, i) => (
          <li key={i} className={cx("tc-chron-group", g.human && "tc-chron-human", g.missing && "tc-chron-missing")}>
            <span className="tc-chron-time">{g.at || ""}</span>
            <span className="tc-chron-rail">{nodeFor(g)}</span>
            <div className="tc-chron-body">
              <div className="tc-chron-title">
                <span className="tc-chron-kind">{g.kindLabel || translate(t.locale, "chronicle.kind." + g.kind) || g.kind}</span>
                {g.title || null}
                {g.channel ? <ChannelChip {...g.channel} /> : null}
                {g.source ? <SourceChip {...g.source} /> : null}
              </div>
              {g.text ? <div className="tc-chron-text">{g.text}</div> : null}
              {g.criteria ? (
                <div className="tc-crit">
                  {g.criteria.map((c, j) => (
                    <div key={j} className="tc-crit-row" style={{ color: c.ok ? "var(--text-secondary)" : "var(--status-failed)" }}>
                      <span style={{ color: c.ok ? "var(--status-verified)" : "var(--status-failed)", display: "inline-flex" }}>{statusShape(c.ok ? "verified" : "failed")}</span>
                      {c.text}
                    </div>
                  ))}
                </div>
              ) : null}
              {g.box ? <div className="tc-chron-box">{g.box}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <section className="tc-root" aria-label={t("chronicle.label")}>
      {props.hideViews ? null : views}
      {body}
    </section>
  );
}

/* ---------- PlanDiff ---------- */
export type PlanOp = "add" | "change" | "remove";
export interface PlanDiffItem {
  op: PlanOp;
  object: ReactNode;
  kind?: string;
  before?: ReactNode;
  after?: ReactNode;
  /** Владение полем. */
  owner?: ReactNode;
  /** Судьба открытых дел. */
  openCases?: ReactNode;
}
export interface PlanDiffProps { summary: ReactNode; meta?: ReactNode; items?: PlanDiffItem[]; hash?: string; actions?: boolean }

const PLAN_SIGN: Record<PlanOp, string> = { add: "+", change: "~", remove: "−" };
export function PlanDiff(props: PlanDiffProps) {
  const t = useT();
  return (
    <section className="tc-plan tc-root" aria-label={t("plan.label")}>
      <div className="tc-plan-head">
        <span className="tc-plan-sum">{props.summary}</span>
        {props.meta ? <span className="tc-secondary" style={{ fontSize: 13 }}>{props.meta}</span> : null}
      </div>
      {(props.items || []).map((it, i) => (
        <div key={i} className={cx("tc-plan-row", "tc-plan-" + it.op)}>
          <span className="tc-plan-op" aria-label={translate(t.locale, "plan.op." + it.op)}>{PLAN_SIGN[it.op]}</span>
          <div>
            <div><span className="tc-plan-obj">{it.object}</span>{it.kind ? <span className="tc-muted" style={{ fontSize: 12 }}>{" · " + it.kind}</span> : null}</div>
            {(it.before || it.after) ? (
              <div className="tc-plan-ba">
                <span className="tc-plan-before">{it.before || "—"}</span>
                <span className="tc-muted" aria-hidden="true">→</span>
                <span className="tc-plan-after">{it.after || "—"}</span>
              </div>
            ) : null}
            {it.owner ? <div className="tc-plan-note">{it.owner}</div> : null}
            {it.openCases ? <div className="tc-plan-note tc-plan-warn">{it.openCases}</div> : null}
          </div>
        </div>
      ))}
      {props.actions !== false ? (
        <div className="tc-plan-row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="tc-actions">
            <Button variant="brand">{t("plan.install")}</Button>
            <Button variant="ghost">{t("plan.test")}</Button>
            <span className="tc-mono">{props.hash || ""}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- WorkPreview: «Будет заведено» — что именно создастся до кнопки ---------- */
export interface WorkPreviewProps {
  title?: ReactNode;
  /** Строки «Будет заведено»: [ключ, значение]. */
  fields?: [ReactNode, ReactNode][];
  seals?: SealsProps;
  label?: string;
}

export function WorkPreview(props: WorkPreviewProps) {
  const t = useT();
  const label = props.label || t("preview.label");
  return (
    <div className="tc-wpreview tc-root" aria-label={label}>
      <span className="tc-wpreview-k">{label}</span>
      <span className="tc-wpreview-title">{props.title || "—"}</span>
      {props.fields ? <dl>{props.fields.map((f, i) => <Fragment key={i}><dt>{f[0]}</dt><dd>{f[1] || "—"}</dd></Fragment>)}</dl> : null}
      {props.seals ? <Seals {...props.seals} /> : null}
    </div>
  );
}

/* ---------- DataTable: таблица справочника ---------- */
export interface DataTableColumn { key: string; title: ReactNode; num?: boolean }
export interface DataTableProps {
  columns: DataTableColumn[];
  /** Строка — объект по ключам колонок; ячейка — значение или узел (классы tc-cell-title, tc-cell-sub, tc-cell-warn). Поле key — ключ строки React. */
  rows: Record<string, ReactNode>[];
  caption?: string;
}

export function DataTable(props: DataTableProps) {
  return (
    <div className="tc-table-wrap tc-root">
      <table className="tc-table">
        {props.caption ? <caption className="tc-sr">{props.caption}</caption> : null}
        <thead><tr>{props.columns.map((c) => <th key={c.key} scope="col">{c.title}</th>)}</tr></thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={(r["key"] as Key | null | undefined) || i}>
              {props.columns.map((c) => <td key={c.key} className={c.num ? "tc-num" : undefined}>{r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
