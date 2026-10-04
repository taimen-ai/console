// Значки: внутренние глифы компонентов (Ico, statusShape) и публичный Icon.
// Разметка и порядок атрибутов — как в design-system/components/bundle.js.
import type { ReactNode, SVGProps } from "react";
import { cx, type Status } from "./util";

/** Общая обводка внутренних значков (контур Lucide-стиля, 16×16). */
const SW = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

type PathExtra = Omit<SVGProps<SVGPathElement>, "d">;

function svg(props: SVGProps<SVGSVGElement>, kids: ReactNode) {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false" {...props}>{kids}</svg>;
}
function p(d: string, extra?: PathExtra) {
  return <path d={d} {...SW} {...extra} />;
}

/* ---------- Иконки (контур Lucide-стиля, 16×16) ---------- */
export const Ico = {
  check: () => svg({}, p("M3.5 8.5l3 3 6-7")),
  x: () => svg({}, <>{p("M4 4l8 8")}{p("M12 4l-8 8")}</>),
  search: () => svg({}, <><circle cx={7} cy={7} r={4.5} {...SW} />{p("M10.5 10.5L14 14")}</>),
  clock: () => svg({}, <><circle cx={8} cy={8} r={6} {...SW} />{p("M8 5v3.2l2 1.3")}</>),
  lock: () => svg({}, <><rect x={3.5} y={7} width={9} height={6.5} rx={1.5} {...SW} />{p("M5.5 7V5a2.5 2.5 0 015 0v2")}</>),
  alert: () => svg({}, <>{p("M8 2.2L14.3 13.3H1.7z")}{p("M8 6.5v3")}{p("M8 11.6v.1")}</>),
  arrowOut: () => svg({}, <>{p("M6 3.5H3.5v9h9V10")}{p("M9 3h4v4")}{p("M13 3L8 8")}</>),
  wifiOff: () => svg({}, <>{p("M2 2l12 12")}{p("M5.2 8.6a4 4 0 015.6 0")}{p("M8 12h.01")}</>),
  shield: () => svg({}, <>{p("M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4C5.2 13 3 10.8 3 7.8v-4z")}{p("M5.8 8l1.6 1.6L10.4 6.6")}</>),
  doc: () => svg({}, <>{p("M4 1.8h5.5L12.5 5v9.2H4z")}{p("M9.2 1.8V5.3h3.3")}</>),
  chat: () => svg({}, p("M2.5 3.5h11v7.5H6.5L3.5 13.5v-2.5h-1z")),
  signature: () => svg({}, <>{p("M2 11.5c1.8-3.6 3-5.3 3.8-5 1.1.4-1.3 5.2 0 5.2 1 0 1.7-2.6 2.7-2.6.8 0 .6 1.7 1.6 1.7.7 0 1.4-.6 2-1.3")}{p("M2 14h12")}</>),
  rule: () => svg({}, <>{p("M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z")}{p("M6 8h4")}</>),
  menu: () => svg({}, <>{p("M2.5 4.5h11")}{p("M2.5 8h11")}{p("M2.5 11.5h11")}</>),
  panelLeft: () => svg({}, <>{p("M2.5 3h11v10h-11z")}{p("M6.5 3v10")}</>),
  chevronDown: () => svg({}, p("M4.5 6.5l3.5 3.5 3.5-3.5")),
  sliders: () => svg({}, <>{p("M2.5 5h6.5M11.5 5h2")}{p("M2.5 11h2M7 11h6.5")}{p("M10.25 3.5v3")}{p("M5.75 9.5v3")}</>),
  plus: () => svg({}, <>{p("M8 3v10")}{p("M3 8h10")}</>),
  command: () => svg({}, p("M5.5 10.5v-5m5 5v-5m-5 0h5m-5 5h5M5.5 5.5A1.5 1.5 0 104 4a1.5 1.5 0 001.5 1.5zm5 0A1.5 1.5 0 1012 4a1.5 1.5 0 00-1.5 1.5zm-5 5A1.5 1.5 0 104 12a1.5 1.5 0 001.5-1.5zm5 0A1.5 1.5 0 1012 12a1.5 1.5 0 00-1.5-1.5z")),
};

/** Знак статуса: форма различает состояния без цвета. Неизвестный статус — пустой круг. */
export function statusShape(s: Status | string) {
  switch (s) {
    case "queued": return svg({}, <circle cx={8} cy={8} r={5.5} {...SW} />);
    case "running": return svg({}, <><circle cx={8} cy={8} r={5.5} {...SW} /><circle cx={8} cy={8} r={2.6} fill="currentColor" /></>);
    case "waiting_human": return svg({}, <circle cx={8} cy={8} r={5.5} strokeDasharray="2.4 2.2" {...SW} />);
    case "waiting_external": return svg({}, <><rect x={2.5} y={2.5} width={11} height={11} rx={2} strokeDasharray="2.4 2.2" {...SW} />{p("M6.5 9.5L10.5 5.5M7.5 5.5h3v3")}</>);
    case "blocked": return svg({}, <><rect x={2.5} y={2.5} width={11} height={11} rx={2} fill="currentColor" /><path d="M5 8h6" stroke="var(--surface-card)" strokeWidth={1.8} strokeLinecap="round" /></>);
    case "paused": return svg({}, <>{p("M6 4v8", { strokeWidth: 2.2 })}{p("M10 4v8", { strokeWidth: 2.2 })}</>);
    case "stale": return svg({}, <><circle cx={8} cy={8} r={5.5} {...SW} />{p("M8 5.2V8l1.8 1.2")}</>);
    case "failed": return svg({}, <><path d="M8 1.8L14.4 13.4H1.6z" fill="currentColor" /><path d="M8 6.2v3.2M8 11.4v.1" stroke="var(--surface-card)" strokeWidth={1.7} strokeLinecap="round" /></>);
    case "completed": return svg({}, <><circle cx={8} cy={8} r={5.5} {...SW} />{p("M5.6 8.2l1.6 1.6 3.2-3.4")}</>);
    case "verified": return svg({}, <><circle cx={8} cy={8} r={6.5} fill="currentColor" /><path d="M5.3 8.2l1.9 1.9 3.6-3.8" stroke="var(--surface-card)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);
    default: return svg({}, <circle cx={8} cy={8} r={5.5} {...SW} />);
  }
}

/* ================= Icon: значки системы по имени ================= */

export type IconName =
  | "search" | "chevronDown" | "check" | "x" | "warn" | "info" | "clock" | "file" | "menu"
  | "today" | "work" | "knowledge" | "settings" | "arrowLeft";

/* Контур 1.5px в сетке 16, цвет — currentColor. */
const ICON_PATHS: Record<IconName, string[]> = {
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
  arrowLeft: ["M13 8H3", "M7 4L3 8l4 4"],
};

export interface IconProps {
  name: IconName;
  /** Подпись для чтения с экрана; без неё значок декоративный. */
  label?: string;
  className?: string;
}

export function Icon(props: IconProps) {
  const d = ICON_PATHS[props.name] || [];
  return (
    <svg className={cx("tc-icon", props.className)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={props.label ? undefined : "true"} role={props.label ? "img" : undefined} aria-label={props.label}>
      {d.map((x, i) => <path key={i} d={x} />)}
    </svg>
  );
}
