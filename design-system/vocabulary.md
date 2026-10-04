# Словарь первого слоя

Утверждён владельцем 2026-09-29. Машинное имя живёт только во втором слое: tooltip или технический слой, но не подпись. Консоль проверяют по этой таблице: в первом слое не должно быть ни одного машинного имени.

Английская версия — [vocabulary.en.md](vocabulary.en.md): английский основной для открытой поставки, там же тон, встроенные строки компонентов и спорные места «Решить владельцу».

| Машинное | Первый слой (RU) | First layer (EN) |
|---|---|---|
| Task / work item, `TASK-000840` | Работа; номер вторым слоем | Work; number as second layer |
| Process instance | Дело | Case |
| `systemStatusCategory` backlog / active / blocked / terminal_success / terminal_cancelled | не начата / в работе / застряла / сделано и проверено / снята | not started / in progress / stuck / done and verified / withdrawn |
| Principal human / agent / service | Исполнитель: человек ○ / агент ▢ / процесс ⬡ | Executor: person ○ / agent ▢ / process ⬡ |
| `ownerId` / `assigneeId` | Отвечает / Выполняет | Accountable / Doing |
| Claim, lease, TTL | Взял(а) в работу · до 14:20; срок истёк — работа вернулась в очередь | Picked up · until 14:20; expired — back in queue |
| Run, attempt, `failureReason` | Попытка №3 · «остановлена: нет прогресса 30 мин» | Attempt #3 · "stopped: no progress for 30 min" |
| Run action `tool.*` | Шаг исполнителя словами (подпись от адаптера) | Executor step in words (label from the adapter) |
| Approval (gate), decide, channel | Решение / подпись · «держит работу» · «Ирина · из Telegram · 12:41» | Decision / sign-off · "holds the work" · "Irina · from Telegram · 12:41" |
| `approvalSchema` outcomes | Что произойдёт при «да» / при «нет» | What happens on "yes" / on "no" |
| precondition failed, `excludedPrincipals` | Пока нельзя подписать: не выполнено условие … / Вам нельзя решать: разделение обязанностей | Can't sign yet: condition … not met / You can't decide: separation of duties |
| Verification, acceptance kind | Проверка: ✓ внешним состоянием / ✓ автопроверкой 3/3 / ✓ человеком: Ирина / оценкой модели (помечено) / ✗ не пройдено 2/3 | Verified: ✓ by external state / ✓ by auto-check 3/3 / ✓ by a person: Irina / by model judgement (flagged) / ✗ failed 2/3 |
| Evidence | Доказательство | Evidence |
| `origin.kind` rule / process / human / harness / parent / external | Откуда: завело правило … / шаг процесса … / поручил(а) … / через ассистента / часть работы … / пришло из … | Origin: rule … / process step … / assigned by … / via assistant / part of … / came from … |
| WorkRule, rule evaluation | Правило: когда … и если … → …; срабатывание: подошло / не подошло / ждёт / ошибка / пропущено | Rule: when … and if … → …; evaluation: matched / not matched / waiting / error / skipped |
| `work.reconciled` | Снята — повод отпал («2 работы сняты — повод отпал») | Withdrawn — no longer needed ("2 works withdrawn — no longer needed") |
| Process definition / instance / `milestone_lost` | Процесс / дело / веха снята | Process / case / milestone lost |
| Agent phase | запускается / работает / ждёт машину / падает при запуске / машина недоступна / остановлен | starting / running / waiting for a machine / crashing on start / machine unavailable / stopped |
| Governance lattice | Автономия: под присмотром / с приёмкой / самостоятельно | Autonomy: supervised / with acceptance / autonomous |
| Package plan / apply | Пакет: «что изменится, если установить» / «установить ровно этот план» | Package: "what changes if installed" / "install exactly this plan" |
| `me/attention` reasonCode | «Почему я это вижу» фразой; правило — вторым слоем | "Why am I seeing this" in words; rule as second layer |
| Notification delivery | Доставлено в Telegram 12:40 / не доставлено: бот заблокирован | Delivered to Telegram 12:40 / not delivered: bot blocked |
| break-glass, `force_cancel`, `:disable` | Аварийный вход / принудительная остановка / участник отключён — помечены «Аварийно» | Emergency access / forced stop / member disabled — marked "Emergency" |
| Fleet node / placement / revision | Машина для агентов / размещение / версия описания — только технический слой | Agent machine / placement / spec revision — technical layer only |

## Слова операционных статусов (`StatusMark`)

| Ключ | RU | EN |
|---|---|---|
| `queued` | не начата | not started |
| `running` | исполняется | running |
| `waiting_human` | ждёт человека · ждёт вас | waiting for a person · waiting for you |
| `waiting_external` | ждёт внешнюю систему | waiting on external system |
| `blocked` | застряла | stuck |
| `paused` | приостановлена | paused |
| `stale` | нет прогресса | no progress |
| `failed` | не удалась | failed |
| `completed` | сдано | submitted |
| `verified` | проверено | verified |

Если у типа работы есть свой `displayName` статуса, первым слоем показывают его, а категорию выражает форма знака.
