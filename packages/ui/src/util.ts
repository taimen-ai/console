// Общие хелперы и типы компонентов (словарь строк — strings.ts, выбор языка — locale.tsx). Перенос из design-system/components/bundle.js.

/** Вид исполнителя: человек ○, агент ▢, процесс или правило ⬡. */
export type ExecutorKind = "human" | "agent" | "process";

/** Операционные состояния работы и попытки. Форма знака различает их без цвета. */
export type Status =
  | "queued" | "running" | "waiting_human" | "waiting_external" | "blocked"
  | "paused" | "stale" | "failed" | "completed" | "verified";

/** Склейка классов: ложные значения отбрасываются (как cx в bundle.js — пустая строка, если всё ложно). */
export function cx(...parts: unknown[]): string {
  const out: string[] = [];
  for (const part of parts) if (part) out.push(String(part));
  return out.join(" ");
}

/** Инициалы для глифа: одно слово — две первые буквы, иначе первые буквы двух слов. */
export function initials(name: string | undefined): string {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}
