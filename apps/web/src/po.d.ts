/** Каталоги Lingui импортируются как модули: плагин Vite компилирует .po при сборке. */
declare module '*.po' {
  export const messages: Record<string, unknown>
}
