// Панель ассистента (⌘J): плашка контекста, беседа, предложения работы, поле ввода.
// Перенос из design-system/components/bundle.js — разметка, классы и поведение байт в байт.
import { Fragment, useEffect, useRef, type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Ico } from "./icons";
import { Button, SourceChip, type ButtonVariant, type SourceChipProps } from "./primitives";
import { useT } from "./locale";
import { cx } from "./util";

export interface AssistantMessageAction { label: ReactNode; variant?: ButtonVariant; onClick?: () => void }

export interface AssistantMessage {
  from?: "user" | "asst";
  text?: ReactNode;
  source?: SourceChipProps;
  proposal?: ReactNode;
  detail?: ReactNode;
  /** Время сообщения. */
  at?: string;
  /** Канал той же беседы: «из Telegram» у человека, «и в Telegram» у ассистента. */
  channel?: string;
  /** Экран, данные которого ушли с вопросом человека: «по экрану «Сегодня»». */
  context?: string;
  /** Ассистент написал сам: origin — источник («процесс «Оплата счетов»»), подпись «Источник: …» (без origin — reason); human — нужен человек (рамка accent). */
  proactive?: { origin?: string; human?: boolean; reason?: string };
  /** Действия прямо в сообщении. */
  actions?: AssistantMessageAction[];
  /** Предложение работы: поля «Будет заведено» строками [ключ, значение]. */
  fields?: [ReactNode, ReactNode][];
  onAccept?: () => void;
  onEdit?: () => void;
  acceptLabel?: string;
  /** Предложение уже принято: текст вместо кнопок. */
  done?: ReactNode;
  /** Разделитель ленты: «Вчера», «Сегодня», «Новое» (unread — граница непрочитанного). */
  divider?: ReactNode;
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
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSend?: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
}

export function AssistantPanel(props: AssistantPanelProps) {
  const t = useT();
  const on = props.contextOn !== false;
  const docked = !!props.docked;
  const msgs = props.messages || [];
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = props.inputRef || null;
  // Лента прокручивается вниз при новом сообщении и при «Смотрю…».
  useEffect(() => { const b = bodyRef.current; if (b) b.scrollTop = b.scrollHeight; }, [msgs.length, props.busy]);
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (props.onSend) props.onSend(); }
  }
  function suggest(q: string) { if (props.onSuggest) props.onSuggest(q); }

  const head = docked ? (
    <div className="tc-assist-head">
      <span className="tc-assist-title">{Ico.chat()}{t("assistant.title")}</span>
      <span className="tc-assist-tools">
        {props.onNew ? <button type="button" className="tc-icon-btn" aria-label={t("assistant.new")} onClick={props.onNew}>{Ico.plus()}</button> : null}
        <kbd className="tc-kbd">⌘J</kbd>
        <button type="button" className="tc-icon-btn" aria-label={t("assistant.close")} onClick={props.onClose}>{Ico.x()}</button>
      </span>
    </div>
  ) : (
    <div className="tc-assist-head"><span className="tc-assist-title">{Ico.chat()}{t("assistant.title")}</span><kbd className="tc-kbd">⌘J</kbd></div>
  );

  const empty = !msgs.length && props.suggestions && props.suggestions.length ? (
    <div className="tc-assist-empty">
      <p className="tc-assist-hello">{props.hello || t("assistant.hello")}</p>
      <div className="tc-assist-sugg" role="group" aria-label={t("assistant.quick")}>
        {props.suggestions.map((q, k) => <button key={k} type="button" className="tc-sugg" onClick={() => { suggest(q); }}>{q}</button>)}
      </div>
    </div>
  ) : null;

  function message(m: AssistantMessage, i: number) {
    if (m.proposal) {
      return (
        <div key={i} className="tc-proposal">
          <span className="tc-proposal-k">{t("assistant.proposal")}</span>
          <span style={{ fontWeight: 600 }}>{m.proposal}</span>
          {m.detail ? <span className="tc-secondary" style={{ fontSize: 13 }}>{m.detail}</span> : null}
          {m.fields ? <dl className="tc-proposal-fields">{m.fields.map((f, k) => <Fragment key={k}><dt>{f[0]}</dt><dd>{f[1]}</dd></Fragment>)}</dl> : null}
          {m.done
            ? <span className="tc-proposal-done">{m.done}</span>
            : <div className="tc-actions"><Button size="sm" variant="human" onClick={m.onAccept}>{m.acceptLabel || t("assistant.accept")}</Button><Button size="sm" variant="ghost" onClick={m.onEdit}>{t("assistant.edit")}</Button></div>}
        </div>
      );
    }
    if (m.divider) {
      return <div key={i} className={cx("tc-msg-divider", m.unread && "tc-msg-divider-new")} role="separator"><span>{m.divider}</span></div>;
    }
    const meta = [m.at, m.channel ? t(m.from === "user" ? "assistant.fromChannel" : "assistant.alsoChannel", { channel: m.channel }) : null,
      m.from === "user" && m.context ? t("assistant.onScreen", { context: m.context }) : null].filter(Boolean).join(" · ");
    return (
      <div key={i} className={cx("tc-msg", m.from === "user" ? "tc-msg-user" : "tc-msg-asst", m.proactive && "tc-msg-proactive", m.proactive && m.proactive.human && "tc-msg-proactive-human")}>
        {m.proactive ? <span className="tc-msg-why">{t("source.label", { source: m.proactive.origin || m.proactive.reason })}</span> : null}
        <div>{m.text}{m.source ? <SourceChip iconOnly={docked} {...m.source} /> : null}</div>
        {m.actions && m.actions.length ? (
          <div className="tc-actions">
            {m.actions.map((a, k) => <Button key={k} size="sm" variant={a.variant || (k === 0 ? "secondary" : "ghost")} onClick={a.onClick}>{a.label}</Button>)}
          </div>
        ) : null}
        {meta ? <span className="tc-msg-meta">{meta}</span> : null}
      </div>
    );
  }

  return (
    <aside className={cx("tc-assist", "tc-root", docked && "tc-assist-docked")} aria-label={t("assistant.title")}>
      {head}
      {docked ? null : (
        <div className={cx("tc-assist-ctx", !on && "tc-assist-ctx-off")}>
          {Ico.search()}
          <span>{on ? t("assistant.sees", { context: props.context || t("assistant.thisScreen") }) : t("assistant.blind")}</span>
          <button type="button" className="tc-toggle" aria-pressed={on ? "true" : "false"} onClick={props.onContextToggle}>{t(on ? "assistant.contextOff" : "assistant.contextOn")}</button>
        </div>
      )}
      <div className="tc-assist-body" ref={bodyRef}>
        {empty}
        {msgs.map(message)}
        {props.busy ? <div className="tc-msg tc-msg-asst tc-msg-busy" aria-live="polite">{t("assistant.busy")}</div> : null}
      </div>
      {docked && msgs.length && props.suggestions && props.suggestions.length ? (
        <div className="tc-assist-quick" role="group" aria-label={t("assistant.quick")}>
          {props.suggestions.map((q, k) => <button key={k} type="button" className="tc-sugg tc-sugg-chip" onClick={() => { suggest(q); }}>{q}</button>)}
        </div>
      ) : null}
      {docked ? (
        <div className="tc-assist-compose">
          <textarea ref={inputRef} className="tc-compose-input" rows={1} placeholder={t("assistant.placeholder")} aria-label={t("assistant.input")}
            value={props.value != null ? props.value : undefined} onChange={props.onChange} onKeyDown={onKey} />
          <div className="tc-compose-bar">
            <span className="tc-muted tc-compose-hint">{t("assistant.hint")}</span>
            <Button variant="secondary" size="sm" onClick={props.onSend} disabled={!props.value || !String(props.value).trim()}>{t("assistant.send")}</Button>
          </div>
        </div>
      ) : (
        <div className="tc-assist-input"><input className="tc-input" placeholder={t("assistant.placeholder")} aria-label={t("assistant.input")} /><Button variant="secondary">{t("assistant.send")}</Button></div>
      )}
    </aside>
  );
}
