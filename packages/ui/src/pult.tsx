// Зоны пульта: итог, карточки решения и проблемы, путь работы, исполнитель, запись журнала.
// Перенос из design-system/components/bundle.js — разметка и классы байт в байт.
import { Fragment, type ReactNode } from "react";
import { Ico, statusShape } from "./icons";
import {
  Button, ChannelChip, ExecutorGlyph, IdentityBlock, Seals, StatusMark,
  type ButtonVariant, type ChannelChipProps, type EvidenceMethod, type IdentityBlockProps,
} from "./primitives";
import { useT } from "./locale";
import { cx, type ExecutorKind, type Status } from "./util";

/* ---------- Summary (Итог) + полоса «Изменилось» ---------- */
export interface SummaryChange {
  title: ReactNode;
  method?: EvidenceMethod;
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
  /** Слово с правильной формой числа: «работу», «работы», «работ». По умолчанию — форма числа verified из словаря локали. */
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

export function Summary(props: SummaryProps) {
  const t = useT();
  const changes = props.changes || [];
  const cards = props.compact ? changes.filter((c) => !c.small) : changes;
  const notes = props.compact ? changes.filter((c) => c.small) : [];
  return (
    <section className={cx("tc-root", props.compact && "tc-summary-compact")} aria-label={t("summary.label")}>
      <p className="tc-summary">
        {props.lead || t("summary.lead") + " "}
        <button className="tc-link" type="button">{props.verified + " " + (props.unit || t("summary.unit", { n: props.verified }))}</button>
        {" " + t("summary.of") + " "}
        <span className="tc-num">{props.submitted}</span>
        {" " + t("summary.submitted", { n: props.submitted })}
        {props.waiting != null ? (
          <>
            <span className="tc-summary-sep">{" · "}</span>
            <button className="tc-link tc-sum-human" type="button">{t("summary.waiting", { n: props.waiting })}</button>
          </>
        ) : null}
        {props.broken != null ? (
          <>
            <span className="tc-summary-sep">{" · "}</span>
            <button className={"tc-link" + (props.broken ? " tc-sum-problem" : "")} type="button">{props.broken ? t("summary.broken", { n: props.broken }) : t("summary.nothingBroken")}</button>
          </>
        ) : null}
      </p>
      {cards.length ? (
        <div className="tc-changes" role="list" aria-label={t("summary.changes")}>
          {cards.map((c, i) => (
            <div key={i} role="listitem" className={cx("tc-change", c.small && "tc-change-small")}>
              <span className="tc-change-title">{c.title}</span>
              {c.method ? <Seals.Evidence method={c.method} text={c.methodText} /> : null}
              {c.evidence ? (c.evidenceHref
                ? <a className="tc-link" href={c.evidenceHref} style={{ fontSize: 12, alignSelf: "flex-start" }}>{c.evidence}</a>
                : <button className="tc-link" type="button" style={{ fontSize: 12, alignSelf: "flex-start" }}>{c.evidence}</button>) : null}
            </div>
          ))}
        </div>
      ) : null}
      {notes.length ? (
        <p className="tc-change-notes">
          {notes.map((c, i) => (
            <Fragment key={i}>{i ? " · " : null}<button className="tc-link" type="button">{c.title}</button></Fragment>
          ))}
        </p>
      ) : null}
      {props.empty ? <p className="tc-secondary" style={{ margin: "12px 0 0" }}>{props.empty}</p> : null}
    </section>
  );
}

/* ---------- DecisionCard ---------- */
/** Доказательство: строка или { label, href } — со ссылкой открывает документ. */
export type EvidenceItem = string | { label: string; href?: string; target?: string };

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
  preconditions?: { ok: boolean; text: ReactNode }[];
  /** high — доказательства раскрыты до кнопки. */
  risk?: "normal" | "high";
  evidence?: EvidenceItem[];
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

function evLink(e: EvidenceItem, i: number) {
  const label = typeof e === "string" ? e : e.label, href = typeof e === "string" ? null : e.href;
  return href && typeof e !== "string"
    ? <a key={i} className="tc-ev-link" href={href} target={e.target}>{label}</a>
    : <span key={i}>{label}</span>;
}
function evList(ev: EvidenceItem[]): ReactNode[] {
  const out: ReactNode[] = [];
  ev.forEach((e, i) => { if (i) out.push(" · "); out.push(evLink(e, i)); });
  return out;
}

export function DecisionCard(props: DecisionCardProps) {
  const t = useT();
  const mine = props.mine !== false;
  const ro = props.readOnlyReason;
  const pre = props.preconditions || [];
  const blocked = pre.some((x) => !x.ok) || props.excluded;
  const needsEvidence = props.risk === "high";
  const ev = props.evidence;
  const compact = !!props.compact;
  // aria-label получает title как есть — паритет с bundle.js.
  const ariaLabel = typeof props.title === "string" ? props.title : props.label;
  if (props.collapsed) {
    return (
      <article className={cx("tc-decision", "tc-decision-compact", "tc-decision-collapsed", "tc-root", mine && !ro && "tc-decision-mine")} aria-label={ariaLabel}>
        <div className="tc-decision-kind"><span>{(props.kind || t("decision.kind")) + (props.holds ? " · " + t("decision.holds") : "")}</span>{props.since ? <span className="tc-num">{props.since}</span> : null}</div>
        <h3 className="tc-decision-title"><button className="tc-link tc-decision-open" type="button" onClick={props.onOpen}>{props.title}</button></h3>
        {props.requester ? <div className="tc-decision-meta"><IdentityBlock inline={true} size="sm" {...props.requester} /></div> : null}
      </article>
    );
  }
  return (
    <article className={cx("tc-decision", "tc-root", mine && !ro && "tc-decision-mine", compact && "tc-decision-compact")} aria-label={ariaLabel}>
      <div className="tc-decision-kind">
        <span>{(props.kind || t("decision.kind")) + (props.holds ? " · " + t("decision.holds") : "")}</span>
        {props.due ? <span className="tc-num">{props.due}</span> : null}
      </div>
      <h3 className="tc-decision-title">{props.title}</h3>
      <div className="tc-decision-meta">
        {props.requester ? <IdentityBlock inline={true} size="sm" {...props.requester} /> : null}
        {props.since ? <span className="tc-num">{props.since}</span> : null}
        {props.delivery ? <ChannelChip {...props.delivery} /> : null}
      </div>
      {props.why ? <div className="tc-why"><b>{t("decision.why") + ": "}</b>{props.why}</div> : null}
      {(props.yes || props.no) ? (
        <div className="tc-outcomes">
          <div className="tc-outcome">
            <span className="tc-outcome-k">{t("decision.yes")}</span>
            {props.yes}
            {props.yesExternal ? <span className="tc-outcome-flag" style={{ display: "block" }}>{props.yesExternal}</span> : null}
          </div>
          <div className="tc-outcome"><span className="tc-outcome-k">{t("decision.no")}</span>{props.no}</div>
        </div>
      ) : null}
      {pre.length ? (
        <div className="tc-precond">
          {pre.map((x, i) => (
            <div key={i} className={cx("tc-precond-row", x.ok ? "tc-precond-ok" : "tc-precond-bad")}>{x.ok ? Ico.check() : statusShape("blocked")}{x.text}</div>
          ))}
        </div>
      ) : null}
      {ev && compact ? (
        <div className="tc-evidence tc-evidence-one"><b>{t("decision.evidence") + ": "}</b>{evList(ev)}</div>
      ) : ev ? (
        <div className="tc-evidence">
          <div className="tc-evidence-head">
            <span>{t("decision.evidence")}</span>
            {needsEvidence && !compact ? <span className="tc-muted" style={{ fontSize: 12, fontWeight: 400 }}>{t("decision.evidenceOpen")}</span> : null}
          </div>
          {(needsEvidence || props.evidenceOpen)
            ? <ul>{ev.map((e, i) => <li key={i}>{evLink(e, i)}</li>)}</ul>
            : <button className="tc-link" type="button" style={{ fontSize: 13 }}>{t("decision.showEvidence", { n: ev.length })}</button>}
        </div>
      ) : null}
      {props.proposal ? <div className="tc-why"><b>{t("decision.proposal") + ": "}</b>{props.proposal}</div> : null}
      {ro ? <div className="tc-readonly">{Ico.lock()}{ro}</div>
        : props.footer ? props.footer
        : (
          <div className="tc-actions">
            <Button variant="human" size={compact ? "sm" : "md"} disabled={!!blocked} kbd={props.kbd} onClick={props.onPrimary}>{props.primary || t("decision.approve")}</Button>
            <Button variant="secondary" size={compact ? "sm" : "md"} onClick={props.onSecondary}>{props.secondary || t("decision.decline")}</Button>
            {compact ? null : <Button variant="ghost">{t("decision.history")}</Button>}
            {!compact && props.dismissible !== false ? <Button variant="ghost" size="sm">{t("decision.dismiss")}</Button> : null}
          </div>
        )}
      {props.excluded ? <div className="tc-readonly">{Ico.lock()}{props.excluded}</div> : null}
    </article>
  );
}

/* ---------- ProblemCard ---------- */
export interface ProblemAction { label: string; variant?: ButtonVariant; onClick?: () => void }
export interface ProblemCardProps {
  severity?: "failed" | "blocked" | "stale" | "approaching";
  /** Диагноз на языке организации. */
  diagnosis: ReactNode;
  where?: string;
  since?: string;
  actions?: ProblemAction[];
  /** Строка на всю ширину зоны: диагноз в одну строку, действие справа. */
  row?: boolean;
}

export function ProblemCard(props: ProblemCardProps) {
  const sev = props.severity || "failed";
  const ic = sev === "failed" ? statusShape("failed") : sev === "blocked" ? statusShape("blocked") : statusShape("stale");
  return (
    <article className={cx("tc-problem", "tc-root", "tc-problem-" + sev, props.row && "tc-problem-row")}>
      {ic}
      <div className="tc-problem-body">
        <div className="tc-problem-dx">{props.diagnosis}</div>
        <div className="tc-problem-where">{[props.where, props.since].filter(Boolean).join(" · ")}</div>
        {props.actions && props.actions.length ? (
          <div className="tc-actions" style={{ marginTop: 4 }}>
            {props.actions.map((a, i) => (
              <Button key={i} size="sm" variant={a.variant || (i === 0 ? "secondary" : "ghost")} onClick={a.onClick}>{a.label}</Button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export interface ProblemCardCalmProps { text?: ReactNode }

/** Спокойное состояние зоны «Сломано / застряло». */
ProblemCard.Calm = function ProblemCardCalm(props: ProblemCardCalmProps) {
  const t = useT();
  return (
    <div className="tc-calm tc-root">
      {Ico.shield()}
      <div>
        <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{t("problem.calm")}</div>
        <div style={{ fontSize: 12 }}>{props.text}</div>
      </div>
    </div>
  );
};

/* ---------- WorkPath (стадии и ворота) ---------- */
export type ByKind = Partial<Record<ExecutorKind, number>>;
export interface WorkPathStage {
  label: ReactNode;
  count: ReactNode;
  byKind?: ByKind;
  /** Разбивка по происхождению фразой. */
  origin?: ReactNode;
  /** Хвост «Снято» (повод отпал). */
  tail?: boolean;
}
export interface WorkPathGate { count: number; reason?: string; mine?: boolean }
export interface WorkPathProps {
  stages?: WorkPathStage[];
  gates?: (WorkPathGate | null | undefined)[];
  /** Пульт в одно окно: числа 28px, плотнее отступы. */
  compact?: boolean;
  /** "flow" — числа стадий через стрелки, одна полоса «люди / агенты / процессы» под числом, застрявшее на выходе из стадии — строкой под ней (gates[i] относится к стадии i), «Снято» — отдельно справа; легенда сверху. */
  look?: "flow";
  legend?: boolean;
}

const KINDS: ExecutorKind[] = ["human", "agent", "process"];

function Split(props: { byKind?: ByKind }) {
  const t = useT();
  const k = props.byKind || {};
  return (
    <span className="tc-stage-split">
      {KINDS.map((kind) => k[kind] != null
        ? <span key={kind}><ExecutorGlyph kind={kind} label="" size="sm" name={t(`kind.${kind}`)} />{k[kind]}</span>
        : null)}
    </span>
  );
}

function FlowBar(props: { byKind?: ByKind }) {
  const t = useT();
  const k = props.byKind || {};
  const total = KINDS.reduce((n, x) => n + (k[x] || 0), 0);
  if (!total) return <span className="tc-flow-bar tc-flow-bar-empty" aria-hidden="true" />;
  const text = KINDS.filter((x) => k[x]).map((x) => t(`kind.${x}`) + " " + k[x]).join(" · ");
  return (
    <span className="tc-flow-bar" role="img" aria-label={text} title={text}>
      {KINDS.map((x) => k[x] ? <span key={x} className={"tc-flow-seg tc-flow-" + x} style={{ flexGrow: k[x] }} /> : null)}
    </span>
  );
}

function WorkFlow(props: WorkPathProps) {
  const t = useT();
  const stages = props.stages || [], gates = props.gates || [];
  const main = stages.filter((s) => !s.tail), tail = stages.filter((s) => s.tail);
  const kids: ReactNode[] = [];
  main.forEach((s, i) => {
    const g = gates[i];
    kids.push(
      <button key={"s" + i} type="button" className="tc-flow-stage">
        <span className="tc-flow-label">{s.label}</span>
        <span className="tc-flow-count">{s.count}</span>
        <FlowBar byKind={s.byKind} />
        {g && g.count
          ? <span className={cx("tc-flow-stuck", g.mine && "tc-flow-stuck-mine")}>{g.count + (g.reason ? " " + g.reason : "")}</span>
          : <span className="tc-flow-stuck tc-flow-stuck-none" aria-hidden="true">{" "}</span>}
      </button>,
    );
    if (i < main.length - 1) kids.push(<span key={"a" + i} className="tc-flow-arrow" aria-hidden="true">→</span>);
  });
  return (
    <div className="tc-flow tc-root">
      {props.legend !== false ? (
        <div className="tc-flow-legend" aria-hidden="true">
          {KINDS.map((x) => <span key={x}><i className={"tc-flow-" + x} />{t(`kind.${x}`)}</span>)}
        </div>
      ) : null}
      <div className="tc-flow-row" role="group" aria-label={t("path.flow")}>
        <div className="tc-flow-main">{kids}</div>
        {tail.map((s, i) => (
          <button key={"t" + i} type="button" className="tc-flow-stage tc-flow-tail">
            <span className="tc-flow-label">{s.label}</span><span className="tc-flow-count">{s.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function WorkPath(props: WorkPathProps) {
  const t = useT();
  if (props.look === "flow") return <WorkFlow {...props} />;
  const stages = props.stages || [], gates = props.gates || [];
  const kids: ReactNode[] = [];
  stages.forEach((s, i) => {
    kids.push(
      <button key={"s" + i} type="button" className={cx("tc-stage", s.tail && "tc-stage-tail")}>
        <span className="tc-stage-label">{s.label}</span>
        <span className="tc-stage-count">{s.count}</span>
        {s.byKind ? <Split byKind={s.byKind} /> : null}
        {s.origin ? <span className="tc-stage-origin">{s.origin}</span> : null}
      </button>,
    );
    const g = gates[i];
    if (g && i < stages.length - 1) {
      kids.push(
        <button key={"g" + i} type="button" className={cx("tc-gate", !g.count && "tc-gate-zero", g.mine && "tc-gate-mine")} aria-label={g.count ? t("path.stuck", { n: g.count }) + (g.reason ? ": " + g.reason : "") : t("path.clear")}>
          <span className="tc-gate-count">{g.count || "—"}</span>
          {g.count ? <span className="tc-gate-reason">{g.reason}</span> : null}
        </button>,
      );
    }
  });
  const cols = stages.map((s, i) => (s.tail ? "minmax(0, 0.8fr)" : "minmax(0, 1fr)") + (i < stages.length - 1 && gates[i] ? (props.compact ? " var(--path-gate, 64px)" : " 76px") : "")).join(" ");
  return (
    <div className={cx("tc-path", "tc-root", props.compact && "tc-path-compact")} role="group" aria-label={t("path.label")} style={{ gridTemplateColumns: cols }}>
      {kids}
    </div>
  );
}

/* ---------- ExecutorCard (Парк) ---------- */
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

export function ExecutorCard(props: ExecutorCardProps) {
  const t = useT();
  if (props.vacant) {
    return (
      <div className="tc-exec tc-exec-vacant tc-root">
        <div className="tc-exec-head">
          <span className="tc-id">
            <ExecutorGlyph kind="human" label="?" vacant={true} size="md" name={t("executor.vacant")} />
            <span className="tc-id-name">{t("executor.nobody") + (props.role ? ": " + props.role : "")}</span>
          </span>
        </div>
        <div className="tc-exec-now">{props.now}</div>
        <div className="tc-actions"><Button size="sm" variant="secondary">{t("executor.assign")}</Button><Button size="sm" variant="ghost">{t("executor.toAgent")}</Button></div>
      </div>
    );
  }
  return (
    <div className={cx("tc-exec", "tc-root", props.problem && "tc-exec-problem")}>
      <div className="tc-exec-head">
        <IdentityBlock kind={props.kind} name={props.name as string} meta={props.meta} label={props.label} />
        {props.state ? <StatusMark status={props.state} label={props.stateLabel} /> : null}
      </div>
      {props.now ? <div className="tc-exec-now">{props.now}</div> : null}
      <div className={cx("tc-exec-trust", !props.trusted && "tc-exec-trust-none")}>{Ico.shield()}{props.trusted || t("executor.noAuthority")}</div>
      {props.channel ? <div><ChannelChip channel={props.channel} state="delivered" at="" /></div> : null}
    </div>
  );
}

/* ---------- JournalEntry ---------- */
export interface JournalEntryProps {
  at: string;
  actor: { kind?: ExecutorKind; name: string; label?: string };
  verb: string;
  object?: string;
  why?: string;
  channel?: string;
  /** Аварийный путь: аварийный вход, принудительная остановка, ручное отключение. */
  emergency?: boolean;
}

export function JournalEntry(props: JournalEntryProps) {
  const t = useT();
  return (
    <div className={cx("tc-jentry", "tc-root", props.emergency && "tc-jentry-emergency")}>
      <span className="tc-jentry-time">{props.at}</span>
      <div className="tc-jentry-main">
        <ExecutorGlyph kind={props.actor.kind} name={props.actor.name} label={props.actor.label} size="md" />
        <div className="tc-jentry-text">
          {props.emergency ? <span className="tc-jflag">{t("journal.emergency")}</span> : null}
          <b>{props.actor.name}</b>{" "}{props.verb}{" "}
          {props.object ? <button className="tc-link" type="button">{props.object}</button> : null}
          {props.channel ? <>{" "}<ChannelChip channel={props.channel} state="decided" /></> : null}
          {props.why ? <span className="tc-jentry-why">{props.why}</span> : null}
        </div>
      </div>
    </div>
  );
}
