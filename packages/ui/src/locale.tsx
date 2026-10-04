// Выбор языка встроенных строк: LocaleProvider / useLocale, перевод по словарю с формами числа.
// Перенос из design-system/components/bundle.js — то же поведение выбора локали.
import { createContext, useContext, type ReactNode } from "react";
import { LOCALES, STRINGS, type Locale, type StringKey } from "./strings";
import type { Status } from "./util";

/** Подстановки строки: {имя} → значение; {n} — ещё и число для формы числа. */
export type Vars = Record<string, string | number | null | undefined>;

const hasOwn = Object.prototype.hasOwnProperty;

/** «ru», «ru-RU», «EN» → локаль системы; иное — null. */
export function normalizeLocale(value: unknown): Locale | null {
  const s = String(value || "").toLowerCase();
  for (const loc of LOCALES) if (s === loc || s.startsWith(loc + "-")) return loc;
  return null;
}

/** Без LocaleProvider — язык документа (lang="ru…" или "en…"), иначе и вне браузера — en. */
export function documentLocale(): Locale {
  const el = typeof document !== "undefined" && document ? document.documentElement : null;
  return (el && normalizeLocale(el.lang)) || "en";
}

const pluralRules: Partial<Record<Locale, Intl.PluralRules>> = {};

function pluralCategory(loc: Locale, n: unknown): Intl.LDMLPluralRule {
  try {
    const rules = pluralRules[loc] || (pluralRules[loc] = new Intl.PluralRules(loc));
    return rules.select(Number(n));
  } catch {
    return Number(n) === 1 ? "one" : "other";
  }
}

/** Строка словаря; undefined — ключа нет (вызывающий решает, чем заменить: так ведут себя ключи из данных). */
export function translate(locale: Locale | string, key: string, vars?: Vars): string | undefined {
  const loc = normalizeLocale(locale) || "en";
  const dict = STRINGS[loc] as Record<string, (typeof STRINGS)[Locale][StringKey]>;
  if (!hasOwn.call(dict, key)) return undefined;
  const entry = dict[key];
  if (entry === undefined) return undefined;
  const s = typeof entry === "object" ? (entry[pluralCategory(loc, vars && vars.n)] || entry.other) : entry;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (hasOwn.call(vars, k) ? String(vars[k]) : m));
}

const LocaleContext = createContext<Locale | null>(null);

export interface LocaleProviderProps {
  /** Язык встроенных строк компонентов внутри. */
  locale: Locale;
  children?: ReactNode;
}

/** Язык встроенных строк для поддерева. Разметки не добавляет. */
export function LocaleProvider(props: LocaleProviderProps) {
  return <LocaleContext.Provider value={normalizeLocale(props.locale)}>{props.children}</LocaleContext.Provider>;
}

/** Текущая локаль: LocaleProvider, иначе язык документа, иначе en. */
export function useLocale(): Locale {
  return useContext(LocaleContext) || documentLocale();
}

/** Перевод по ключу словаря в текущей локали; locale — для ключей из данных (через translate). */
export type Translate = ((key: StringKey, vars?: Vars) => string) & { locale: Locale };

export function useT(): Translate {
  const loc = useLocale();
  return Object.assign((key: StringKey, vars?: Vars) => translate(loc, key, vars) ?? key, { locale: loc });
}

/** Слова статусов по локалям — срез словаря (status.*). */
export const STATUS_WORD = Object.fromEntries(LOCALES.map((loc) => [
  loc,
  Object.fromEntries(Object.entries(STRINGS[loc]).filter(([k]) => k.startsWith("status.")).map(([k, v]) => [k.slice("status.".length), v])),
])) as Record<Locale, Record<Status, string>>;
