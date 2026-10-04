// Примитивы: кнопка, глиф исполнителя, подпись личности, статус, чипы источника, канала и связи, печати.
// Перенос из design-system/components/bundle.js — разметка и классы байт в байт.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Ico, statusShape } from "./icons";
import { translate, useLocale, useT, type Translate } from "./locale";
import { cx, initials, type ExecutorKind, type Status } from "./util";

export type ButtonVariant = "human" | "brand" | "secondary" | "ghost" | "danger";

/* ---------- Button ---------- */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** human — одно главное действие «нужен человек» (accent); brand — главное действие настройки; danger — аварийное. */
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** Клавиша-подсказка, например "E" или "⌘J". */
  kbd?: string;
  icon?: ReactNode;
}

export function Button(props: ButtonProps) {
  const variant = props.variant || "secondary", size = props.size || "md";
  const { variant: _variant, size: _size, kbd: _kbd, icon: _icon, ...rest } = props;
  return (
    <button {...rest} className={cx("tc-btn", "tc-btn-" + variant, size === "sm" && "tc-btn-sm", props.className)} type={props.type || "button"}>
      {props.icon || null}
      {props.children}
      {props.kbd ? <kbd className="tc-kbd">{props.kbd}</kbd> : null}
    </button>
  );
}

/* ---------- ExecutorGlyph ---------- */
export interface ExecutorGlyphProps {
  /** По умолчанию — human. */
  kind?: ExecutorKind;
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

const HEX_PATH = "M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75z";

export function ExecutorGlyph(props: ExecutorGlyphProps) {
  const loc = useLocale();
  const kind = props.kind || "human", size = props.size || "md";
  const label = props.label != null ? props.label : initials(props.name);
  let shape: ReactNode;
  if (kind === "human") shape = <circle className="tc-g-shape" cx={12} cy={12} r={11} strokeWidth={1.2} />;
  else if (kind === "agent") shape = <rect className="tc-g-shape" x={1.5} y={1.5} width={21} height={21} rx={6} strokeWidth={1.4} />;
  else shape = <path className="tc-g-shape" d={HEX_PATH} strokeWidth={1.4} strokeLinejoin="round" />;
  const kindWord = translate(loc, "glyph.kind." + kind) || kind;
  return (
    <span className={cx("tc-glyph", "tc-glyph-" + kind, "tc-glyph-" + size, props.waiting && "tc-glyph-waiting", props.vacant && "tc-glyph-vacant")}
      role="img" aria-label={(props.name ? props.name + ", " : "") + kindWord + (props.waiting ? ", " + translate(loc, "glyph.waiting") : "")}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{shape}</svg>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

/* ---------- IdentityBlock ---------- */
export interface IdentityBlockProps {
  /** По умолчанию — human (как у ExecutorGlyph). */
  kind?: ExecutorKind;
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

export function IdentityBlock(props: IdentityBlockProps) {
  const size = props.size || "md";
  return (
    <span className={cx("tc-id", props.inline && "tc-id-inline")}>
      <ExecutorGlyph kind={props.kind} name={props.name} label={props.label} size={size} waiting={props.waiting} />
      <span className="tc-id-text">
        <span className="tc-id-name">{props.name}</span>
        {props.meta ? <span className="tc-id-meta">{props.meta}</span> : null}
        {props.now ? <span className="tc-id-now">{props.now}</span> : null}
      </span>
    </span>
  );
}

/* ---------- StatusMark ---------- */
export interface StatusMarkProps {
  /** По умолчанию — queued. */
  status?: Status;
  /** Слово из типа работы (displayName); по умолчанию — слово словаря консоли. */
  label?: string;
  /** Ждёт именно смотрящего — берёт accent. Только для waiting_human. */
  mine?: boolean;
  /** false — без подложки, в строку текста. */
  pill?: boolean;
  /** Машинное имя для tooltip (второй слой). */
  machine?: string;
}

export function StatusMark(props: StatusMarkProps) {
  const loc = useLocale();
  const s = props.status || "queued";
  const word = props.label || translate(loc, "status." + s) || s;
  return (
    <span className={cx("tc-status", props.pill !== false && "tc-status-pill", "tc-s-" + s, props.mine && s === "waiting_human" && "tc-s-mine")}
      title={props.machine || undefined}>
      {statusShape(s)}
      <span>{word}</span>
    </span>
  );
}

/* ---------- SourceChip ---------- */
export type Source = "authoritative" | "recalled" | "external";
export interface SourceChipProps {
  source?: Source;
  label?: string;
  /** Свежесть для recalled/external: «запомнено 3 дня назад», «12:30». */
  freshness?: string;
  /** Только значок с рамкой своего вида; слово — в aria-label и подсказке. В ленте ассистента — всегда. */
  iconOnly?: boolean;
}

export function SourceChip(props: SourceChipProps) {
  const loc = useLocale();
  const src = props.source || "authoritative";
  const word = props.label || translate(loc, "source.kind." + src);
  const ic = src === "external" ? Ico.arrowOut() : src === "recalled" ? Ico.clock() : Ico.shield();
  if (props.iconOnly) {
    const full = translate(loc, "source.label", { source: word }) + (props.freshness ? ", " + props.freshness : "");
    return <span className={cx("tc-chip", "tc-chip-icon", "tc-src-" + src)} role="img" aria-label={full} title={full}>{ic}</span>;
  }
  return (
    <span className={cx("tc-chip", "tc-src-" + src)}>
      {ic}
      {word}
      {props.freshness ? <span className="tc-chip-fresh">{"· " + props.freshness}</span> : null}
    </span>
  );
}

/* ---------- ChannelChip ---------- */
export type ChannelState = "sent" | "delivered" | "opened" | "decided" | "failed";
export interface ChannelChipProps {
  channel?: string;
  state?: ChannelState;
  at?: string;
  /** Причина недоставки. */
  reason?: string;
}

export function ChannelChip(props: ChannelChipProps) {
  const loc = useLocale();
  const state = props.state || "delivered";
  const ch = props.channel || "Telegram";
  const text = translate(loc, "channel." + state, { channel: ch });
  return (
    <span className={cx("tc-chip", "tc-chan", "tc-chan-" + state)}>
      {state === "failed" ? Ico.alert() : Ico.chat()}
      {text}
      {props.at ? <span className="tc-num">{" " + props.at}</span> : null}
      {props.reason ? <span>{": " + props.reason}</span> : null}
    </span>
  );
}

/* ---------- LiveChip: есть ли связь и на какое время данные ---------- */
export interface LiveChipProps {
  /** false — «offline · данные на …»; иначе «online · <at>». */
  live?: boolean;
  at?: string;
  /** В строке состояния — без рамки чипа. */
  inline?: boolean;
}

/** Чип связи: «online · 14:02» / «offline · данные на 13:40». */
export function LiveChip(props: LiveChipProps) {
  const t = useT();
  const live = props.live !== false;
  return (
    <span className={cx("tc-live", !props.inline && "tc-live-chip", !live && "tc-live-off")} role="status">
      <span className="tc-live-dot" aria-hidden="true" />
      {t(live ? "live.online" : "live.offline", { at: props.at || "" })}
    </span>
  );
}

/* ---------- Seals: четыре печати ---------- */
export interface SealOrigin { kind?: "rule" | "process" | "human" | "external" | "harness" | "parent"; text: string; name?: string }
export interface SealExecutor { kind?: ExecutorKind; name: string; label?: string; meta?: string }
export type EvidenceMethod = "external" | "auto" | "human" | "model" | "pending" | "failed" | "none";
export interface SealEvidence { method: EvidenceMethod; text?: string }
export interface SealSignature { who?: string; channel?: string; at?: string; pending?: boolean }

export interface SealsProps {
  /** null или нет — звено отсутствует (пунктир с причиной). */
  origin?: SealOrigin | null;
  executor?: SealExecutor | null;
  evidence?: SealEvidence | null;
  /** null или нет — подпись не требуется. */
  signature?: SealSignature | null;
  /** Шапка истории: четыре ячейки с подписями. Без него — строка для списка. */
  labelled?: boolean;
}

interface SealView { cls: string; ic: ReactNode; text: string }

function sealOrigin(o: SealOrigin | null | undefined, t: Translate): SealView {
  if (!o) return { cls: "tc-seal-missing", ic: Ico.rule(), text: t("seal.origin.missing") };
  const kind = o.kind || "rule";
  const ic = kind === "human" ? <ExecutorGlyph kind="human" name={o.name} size="sm" />
    : kind === "process" ? <ExecutorGlyph kind="process" label="" size="sm" />
    : kind === "external" ? Ico.arrowOut() : Ico.rule();
  return { cls: "", ic, text: o.text };
}
function sealExecutor(e: SealExecutor | null | undefined, t: Translate): SealView {
  if (!e) return { cls: "tc-seal-missing", ic: Ico.clock(), text: t("seal.executor.missing") };
  return { cls: "", ic: <ExecutorGlyph kind={e.kind} name={e.name} label={e.label} size="sm" />, text: e.name + (e.meta ? " · " + e.meta : "") };
}
function sealEvidence(v: SealEvidence | null | undefined, t: Translate): SealView {
  if (!v || v.method === "none") return { cls: "tc-seal-missing", ic: Ico.doc(), text: (v && v.text) || t("evidence.none") };
  if (v.method === "failed") return { cls: "tc-seal-fail", ic: statusShape("failed"), text: v.text || t("evidence.failed") };
  if (v.method === "pending") return { cls: "", ic: statusShape("completed"), text: v.text || t("evidence.pending") };
  const ok = <span style={{ color: "var(--status-verified)", display: "inline-flex" }}>{statusShape("verified")}</span>;
  return {
    cls: v.method === "model" ? "tc-seal-model" : "tc-seal-ok", ic: v.method === "model" ? Ico.clock() : ok,
    text: (v.text || translate(t.locale, "evidence." + v.method)) + (v.method === "model" ? " · " + t("seal.model.flag") : ""),
  };
}
function sealSignature(s: SealSignature | null | undefined, t: Translate): SealView {
  if (!s) return { cls: "tc-seal-missing", ic: Ico.signature(), text: t("seal.signature.none") };
  if (s.pending) return { cls: "tc-seal-missing", ic: Ico.signature(), text: t("seal.signature.pending") + (s.who ? ": " + s.who : "") };
  return { cls: "tc-seal-sign", ic: Ico.signature(), text: (s.who || t("seal.signature.signed")) + (s.channel ? " · " + t("seal.signature.from", { channel: s.channel }) : "") + (s.at ? " · " + s.at : "") };
}

export function Seals(props: SealsProps) {
  const t = useT();
  const items: [string, SealView][] = [
    [t("seal.origin"), sealOrigin(props.origin, t)],
    [t("seal.executor"), sealExecutor(props.executor, t)],
    [t("seal.evidence"), sealEvidence(props.evidence, t)],
    [t("seal.signature"), sealSignature(props.signature, t)],
  ];
  const labelled = props.labelled;
  return (
    <div className={cx("tc-seals", labelled && "tc-seals-labelled")} role="list" aria-label={t("seals.label")}>
      {items.map(([title, s], i) => {
        if (labelled) {
          return (
            <div key={i} role="listitem" className={cx("tc-seal", s.cls)}>
              <span className="tc-seal-label">{title}</span>
              <span className="tc-seal-body">{s.ic}<span className="tc-seal-text">{s.text}</span></span>
            </div>
          );
        }
        return (
          <span key={i} role="listitem" className={cx("tc-seal", s.cls)} title={title + ": " + s.text}>
            {s.ic}
            <span className="tc-sr">{title + ": "}</span>
            <span className="tc-seal-text">{s.text}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Одна печать «проверено …» — для полосы «Изменилось» в Summary. */
Seals.Evidence = function SealsEvidence(v: SealEvidence) {
  const t = useT();
  const s = sealEvidence(v, t);
  return (
    <span className={cx("tc-seals")} style={{ gap: 0 }}>
      <span className={cx("tc-seal", s.cls)}>{s.ic}<span className="tc-seal-text">{t("seal.verified", { text: s.text })}</span></span>
    </span>
  );
};
