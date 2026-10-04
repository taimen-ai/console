# @console/ui

Компоненты дизайн-системы «Taimen Console» на React и TypeScript — перенос
`design-system/components/bundle.js` (классический скрипт, `window.TaimenConsole`)
в типизированные TSX-модули. Пакет без сборки: приложение берёт исходники через
`exports` (`./src/index.ts`), стили — `@console/ui/styles.css` (импортирует
`design-system/components/bundle.css`, своих стилей у пакета нет).

```tsx
import "@console/ui/styles.css";
import { AppShell, LocaleProvider, TopBar, DecisionCard } from "@console/ui";

<LocaleProvider locale="en">{/* приложение */}</LocaleProvider>
```

Имена экспорта те же, что в `window.TaimenConsole`, включая статические части
`ProblemCard.Calm`, `DegradedBanner.Section`, `Seals.Evidence`, локали `LocaleProvider` / `useLocale`,
словарь `STRINGS` и его срез `STATUS_WORD` (`STATUS_WORD[locale][status]`).
Типы пропсов — `<Имя>Props` (по `design-system/components/index.d.ts`; где d.ts
расходится с поведением бандла, прав бандл).

| Модуль | Компоненты |
|---|---|
| `src/util.ts` | `cx`, `initials`, типы `ExecutorKind`, `Status` |
| `src/strings.ts` | словарь встроенных строк `STRINGS` (en, ru), типы `Locale`, `StringKey`, `PluralForms` |
| `src/locale.tsx` | `LocaleProvider`, `useLocale`, `STATUS_WORD`; внутренние `useT`, `translate` |
| `src/icons.tsx` | `Icon`; внутренние глифы `Ico` и `statusShape` |
| `src/primitives.tsx` | `Button`, `ExecutorGlyph`, `IdentityBlock`, `StatusMark`, `SourceChip`, `ChannelChip`, `LiveChip`, `Seals` |
| `src/pult.tsx` | `Summary`, `DecisionCard`, `ProblemCard`, `WorkPath`, `ExecutorCard`, `JournalEntry` |
| `src/work.tsx` | `WorkRow`, `WorkGroup`, `Chronicle`, `PlanDiff`, `WorkPreview`, `DataTable` |
| `src/assistant.tsx` | `AssistantPanel` |
| `src/shell.tsx` | `TopBar`, `NavDrawer`, `CommandPalette`, `DegradedBanner`, `EmptyState`, `Zone`, `PageHeader`, `AppShell` |
| `src/forms.tsx` | `Dialog`, `Consequences`, `Criteria`, `Callout`, `DecisionStatus`, `Field`, `PersonPicker`, `SearchField`, `FilterChip` |

## Языки

Две локали — `en` (основной язык открытой поставки) и `ru`. Встроенные строки компонентов берутся
только из `STRINGS` (`src/strings.ts`, копия словаря бандла); новая строка добавляется сразу на обоих
языках, формы числа — объект категорий `Intl.PluralRules`. Локаль: `LocaleProvider`, без него — язык
документа (`lang` начинается с `ru` или `en`), иначе и вне браузера — `en`. Приложению лучше передавать
локаль явно: серверный рендер документа не видит. Данные из пропсов компоненты не переводят.

## Правило изменений

Источник истины — дизайн-система. **Сначала правится она** (`bundle.js`,
`bundle.css`, `README.md` и `preview.html` компонента), **затем изменение
переносится сюда**. Разметка, классы, `aria-*`, тексты и порядок атрибутов
повторяют бандл байт в байт — это перенос, а не редизайн.

Тест паритета `tests/parity.test.tsx` исполняет `bundle.js` в `node:vm`
(`window = { React }`), рендерит каждый компонент обеими версиями через
`react-dom/server` с одинаковыми пропсами и сравнивает HTML строго
(`renderToStaticMarkup` и `renderToString` — второй ловит и разбиение
текстовых узлов). Правка только в одной из сторон роняет тест. Новый компонент
бандла без вариантов в тесте тоже роняет его. Каждый вариант рендерится в обеих локалях: вокруг
компонента в обоих рендерах — один и тот же `LocaleProvider` обеих библиотек (у бандла и пакета свои
React-контексты, а в пропсах вариантов есть узлы пакета). Там же — проверки словаря: `STRINGS` пакета
равен словарю бандла, ключи en и ru совпадают, пустых строк нет, формы числа — ровно категории
`Intl.PluralRules` локали, подстановки `{имя}` одинаковы, в en нет кириллицы.

`tests/behavior.test.tsx` (jsdom) прогоняет одни и те же сценарии на бандле и на
пакете: `Dialog` — фокус внутрь, Esc, ловушка Tab, подложка, возврат фокуса;
`AssistantPanel` — Enter отправляет, Shift+Enter переносит строку, IME, подсказки; выбор языка —
`lang` документа и `LocaleProvider` поверх него.

## Проверки

Из `packages/ui`, по одной за раз:

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run --no-file-parallelism
```

Конфиг `vitest.config.ts` и так держит один воркер (`fileParallelism: false`,
`maxWorkers: 1`), поэтому `pnpm test` безопасен для ноутбука.
