/**
 * CSS-переменные из `design-system/tokens.json` — единственного источника токенов
 * (CON-ADR-0001, п. 3). Пишет `dist/tokens.css` и копирует шрифты в `dist/fonts/`.
 * Правила те же, что у `design-system/gen_tokens.py`: светлая тема — в `:root`, тёмная —
 * по `prefers-color-scheme` (если тема не выбрана явно) и по `data-theme="dark"`.
 *
 * `--check` сверяет результат с `design-system/tokens.css`: две копии генератора не
 * должны разойтись.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DS = join(HERE, '..', '..', '..', 'design-system')
const DIST = join(HERE, '..', 'dist')

type Value = string | number | { light: string | number, dark?: string | number }
interface Token { name: string, value: Value }
interface Tokens {
  type: { fonts: { family: string, file: string, weight: string | number, style?: string }[], families: Record<string, string> }
  color: { tokens: Token[] }
  [family: string]: { tokens?: Token[] } | unknown
}

const ref = (x: string | number): string => {
  if (typeof x !== 'string') return String(x)
  const m = /^\{([A-Za-z0-9_.-]+)\}$/.exec(x)
  return m !== null ? `var(--${m[1]})` : x
}

export function generate(t: Tokens): string {
  const out = ['/* Сгенерировано design-system/gen_tokens.py из tokens.json. Не править руками. */']
  for (const f of t.type.fonts) {
    out.push(`@font-face{font-family:"${f.family}";src:url("fonts/${basename(f.file)}") format("truetype");font-weight:${f.weight};font-style:${f.style ?? 'normal'};font-display:swap}`)
  }
  const light: string[] = []
  const dark: string[] = []
  for (const tok of t.color.tokens) {
    const v = tok.value
    if (typeof v === 'object') {
      light.push(`--${tok.name}:${ref(v.light)};`)
      if (v.dark !== undefined) dark.push(`--${tok.name}:${ref(v.dark)};`)
    } else light.push(`--${tok.name}:${ref(v)};`)
  }
  for (const fam of ['spacing', 'radius', 'density', 'zIndex', 'layout', 'shadow']) {
    for (const tok of (t[fam] as { tokens: Token[] }).tokens) {
      const v = tok.value
      if (typeof v === 'object') {
        light.push(`--${tok.name}:${v.light};`)
        dark.push(`--${tok.name}:${v.dark};`)
      } else light.push(`--${tok.name}:${v};`)
    }
  }
  for (const [k, v] of Object.entries(t.type.families)) light.push(`--font-${k}:${v};`)
  const d = dark.join('')
  out.push(`:root{color-scheme:light;${light.join('')}}`)
  out.push(`@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;${d}}}`)
  out.push(`[data-theme="dark"]{color-scheme:dark;${d}}`)
  return `${out.join('\n')}\n`
}

const tokens = JSON.parse(readFileSync(join(DS, 'tokens.json'), 'utf8')) as Tokens
const css = generate(tokens)
if (process.argv.includes('--check')) {
  if (css !== readFileSync(join(DS, 'tokens.css'), 'utf8')) {
    process.stderr.write('tokens: design-system/tokens.css расходится с tokens.json — запустите python3 design-system/gen_tokens.py\n')
    process.exit(1)
  }
  process.stdout.write('tokens: design-system/tokens.css совпадает с генерацией\n')
} else {
  mkdirSync(join(DIST, 'fonts'), { recursive: true })
  writeFileSync(join(DIST, 'tokens.css'), css)
  for (const f of tokens.type.fonts) copyFileSync(join(DS, 'fonts', basename(f.file)), join(DIST, 'fonts', basename(f.file)))
  process.stdout.write(`tokens: dist/tokens.css, шрифтов ${tokens.type.fonts.length}\n`)
}
