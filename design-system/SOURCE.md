# Откуда эта копия

Дизайн-система «Taimen Console» ведётся в Claude Design (артефакт типа Design
System, namespace `TaimenConsole`). Здесь — её полная копия: консоль собирается из
репозитория, а облачная версия показывает систему людям.

**Синхронизировано 2026-10-03** с облачной версией `1791023596-75f6` (Combobox: подпись варианта на подсвеченной строке — вторичным цветом, контраст AA), раньше `1791015914-9549` (WorkRow: основной колонке не меньше 40% строки) и `1791015039-a977`: новый компонент
`Combobox` (выбор поиском — люди, агенты, типы работ, пространства), `TopBar.scope`
(область работы в шапке), `WorkGroup.empty` (пустая группа вне таблицы строк), `Dialog`
пропускает Esc раскрытого combobox. Раньше (`1791010241-af0a`) — правки доступности
`WorkRow`, `DecisionCard`, `WorkGroup` (`more: true`). Локальных изменений, которых нет в
облаке, сейчас нет.

- Состав: `README.md` (бренд-бук и правила поведения), `vocabulary.md` (словарь
  первого слоя), `tokens.json`, `components/` (бандл, стили, типы, README и превью
  каждого компонента), `fonts/` (IBM Plex, SIL OFL 1.1), `assets/Icons/` (Lucide,
  ISC), `design-system.json` (индекс облачной версии).
- `tokens.css` — генерируемый файл: `python3 design-system/gen_tokens.py`. Руками
  не правится и в облако не публикуется (облако собирает свой).
- Превью компонентов (`components/*/preview.html`) рассчитаны на страницу
  дизайн-системы, которая сама подгружает токены, шрифты, React и бандл.

## Как вести

1. Правка компонента — в `components/bundle.js`, `bundle.css`, `index.d.ts`,
   README и превью компонента здесь; проверка — на `prototype/`.
2. Публикация в облако — одним обновлением артефакта: изменённые файлы под
   `project/…`, индекс `design-system.json` последним с новым `lastChange`.
   Файл, переданный как `file_path`, публикуется по пути относительно `root`:
   держите его под `project/`, иначе в корне артефакта появится лишний файл.
3. После публикации — строка «Синхронизировано» выше.

## Что вошло в систему 2026-10-01…02

Новые компоненты: `AppShell`, `NavDrawer`, `LiveChip`, `Icon`, `Zone`,
`PageHeader`, `Dialog`, `Consequences`, `Criteria`, `Callout`, `DecisionStatus`,
`Field` (+ классы `tc-form`, `tc-input`, `tc-select`, `tc-textarea`),
`PersonPicker`, `WorkPreview`, `SearchField`, `FilterChip`, `WorkGroup`,
`DataTable`; классы `tc-props`, `tc-linklist`; токен `layout-nav`.

Изменены: `TopBar` (меню, организация вместо имени продукта, кнопка
«Ассистент» `brand` со счётчиком, скрыта при открытом ассистенте, `showLive`),
`Summary` (`compact`, `evidenceHref`), `DecisionCard` (`compact`, `collapsed`,
доказательства-ссылки, `onPrimary`/`onSecondary`, `footer`), `ProblemCard`
(`row`, `actions[].onClick`), `WorkRow` (`href`, `onAction`, узкий список,
колонки постоянной ширины), `WorkPath` (`look="flow"`), `AssistantPanel`
(`docked`, одна беседа, проактивные сообщения «Источник: …», предложение работы
с полями), `SourceChip` (`iconOnly`), словарь (`work.reconciled` — «Снята —
повод отпал»). Правила поведения — раздел «Каркас и поведение» в `README.md`.

## Правки 2026-10-02 (опубликованы в `1790878972-bf0e`)

- `TopBar`: переключатель периода — только при непустом `periods` (`onPeriod`),
  поиск ⌘K — только при `onSearch`; без них кнопок нет.
- `AppShell`: `inert` закрытых меню и ассистента работает и в React 19 (булево).
- `DecisionCard`: `label` — подпись для чтения с экрана, когда `title` — узел.
- `Dialog`: Esc зовёт текущий `onClose`; ловушка Tab пропускает выключенные поля.
- Без `undefined` в тексте: подпись без `who` (`Seals`), ворота без `reason`
  (`WorkPath`), «Некому» без роли (`ExecutorCard`), баннер без `at`
  (`DegradedBanner`), плашка контекста без `context` (`AssistantPanel`).
- Две локали: `en` (основной язык открытой поставки) и `ru`. Все встроенные
  строки компонентов — в словаре `STRINGS` бандла (формы числа —
  `Intl.PluralRules`), выбор языка — новый `LocaleProvider` / `useLocale`
  (без провайдера — `lang` документа, иначе `en`); `STATUS_WORD` стал
  `STATUS_WORD[locale][status]`. Разметка не изменилась: в `ru` бандл рендерит
  ровно то же, что до правки. Новые файлы: `vocabulary.en.md`,
  `components/LocaleProvider/` (README и превью), раздел «Языки» в `README.md`.
