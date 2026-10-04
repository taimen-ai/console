/**
 * Каталоги языков: `extract` — собрать строки из кода в `src/locales/{locale}/messages.po`
 * (исходный английский и перевод), `check` — то же и отказ, если в каком-то языке есть
 * строка без перевода. Вызывает API `@lingui/cli` напрямую: его команды запускаются через
 * `import.meta.main`, которого нет в Node до 24.2.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getConfig } from '@lingui/conf'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Команды CLI не входят в exports пакета — берём модули по пути установленного пакета.
const cli = (file: string): Promise<Record<string, unknown>> => import(pathToFileURL(join(ROOT, 'node_modules', '@lingui', 'cli', 'dist', file)).href) as Promise<Record<string, unknown>>
const extract = (await cli('lingui-extract.js')).default as (config: unknown, options: unknown) => Promise<boolean>
const { resolveWorkersOptions } = await cli('api/resolveWorkersOptions.js') as { resolveWorkersOptions: (o: { workers: number }) => unknown }
const mode = process.argv[2] ?? 'extract'
const config = getConfig({ cwd: ROOT, configPath: join(ROOT, 'lingui.config.ts') })

const ok = await extract(config, { clean: true, overwrite: false, verbose: false, workersOptions: resolveWorkersOptions({ workers: 1 }) })
if (!ok) process.exit(1)

if (mode === 'check') {
  let missing = 0
  for (const locale of config.locales) {
    if (locale === config.sourceLocale) continue
    const po = readFileSync(join(ROOT, 'src', 'locales', locale, 'messages.po'), 'utf8')
    // Запись PO: msgid "…" и msgstr "…"; пустой msgstr без продолжения — нет перевода.
    for (const block of po.split(/\n\n+/)) {
      const id = /^msgid "(.*)"$/m.exec(block)?.[1]
      const str = /^msgstr "(.*)"((?:\n".*")*)/m.exec(block)
      if (id === undefined || id === '' && !/^msgctxt|^#\./m.test(block)) continue
      if (str === null || (str[1] === '' && (str[2] ?? '') === '')) {
        missing++
        process.stderr.write(`${locale}: нет перевода — ${id === '' ? block.split('\n').find(l => l.startsWith('msgid')) : id}\n`)
      }
    }
  }
  if (missing > 0) {
    process.stderr.write(`i18n: строк без перевода — ${missing}\n`)
    process.exit(1)
  }
  process.stdout.write('i18n: все строки переведены\n')
}
