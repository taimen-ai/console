# Словарь первого слоя — английский

Английский — **основной язык открытой поставки** консоли, русский — второй. Этот файл — пара к
[vocabulary.md](vocabulary.md): те же термины первого слоя, для каждого русского — английский. Машинное имя,
как и в русской версии, живёт только во втором слое (tooltip, технический слой), но не в подписи.

Встроенные строки компонентов (кнопки, `aria-label`, слова статусов, печати) лежат в словаре `STRINGS`
бандла (`components/bundle.js`) и пакета `@console/ui` — полный список там, тест проверяет, что в обеих
локалях одни и те же ключи. Здесь — термины и тон, по которым словарь пишется и сверяется.

## Тон

- Короткие человеческие слова, без машинных имён: Work, not *task entity*; Sign-off, not *approval gate*.
- Регистр как в предложении: “Awaiting your sign-off”, а не “Awaiting Your Sign-Off”.
- Кнопки и заголовки — с глагола: “Approve payment”, “Install exactly this plan”, “Hand to a person”.
- Обращение — “you”, без “please”, восклицаний, эмодзи и превосходных степеней.
- Причина — фразой: “why you: the amount is over the 150,000 threshold”; правило — вторым слоем.
- Кавычки — типографские “…”, апостроф — ’, многоточие — один знак «…».
- `online` / `offline` в индикаторе связи — одинаково в обеих локалях.

## Экраны, зоны и путь работы

| Первый слой (RU) | First layer (EN) |
|---|---|
| Сегодня | Today |
| Работа | Work |
| Знания | Knowledge |
| Настройки | Settings |
| Ждёт вашей подписи | Awaiting your sign-off |
| Сломано / застряло | Broken / stuck |
| Всё штатно | All normal |
| Итог | Summary |
| Изменилось | Changed |
| Поток работы | Work flow |
| Путь работы | Work path |
| История работы | Work history |
| Журнал | Log |
| Ассистент | Assistant |
| Источник | Source |
| Возникло | Raised |
| Поручено | Assigned |
| Взято | Taken |
| Исполняется (стадия) | In progress |
| Сдано | Submitted |
| Проверено | Verified |
| Снято — повод отпал | Withdrawn — no longer needed |
| Сверка / сверено | Reconciliation / reconciled |

## Термины модели (из словаря первого слоя)

| Машинное | Первый слой (RU) | First layer (EN) |
|---|---|---|
| Task / work item, `TASK-000840` | Работа; номер вторым слоем | Work; number as second layer. Исчисляемое — work item / work items |
| Process instance | Дело | Case |
| `systemStatusCategory` | не начата / в работе / застряла / сделано и проверено / снята | not started / in progress / stuck / done and verified / withdrawn |
| Principal human / agent / service | Исполнитель: человек ○ / агент ▢ / процесс ⬡ | Executor: person ○ / agent ▢ / process ⬡ (во множественном — people / agents / processes) |
| `ownerId` / `assigneeId` | Отвечает / Выполняет | Accountable / Doing |
| Claim, lease, TTL | Взял(а) в работу · до 14:20; срок истёк — работа вернулась в очередь | Picked up · until 14:20; expired — back in queue |
| Run, attempt, `failureReason` | Попытка №3 · «остановлена: нет прогресса 30 мин» | Attempt #3 · “stopped: no progress for 30 min” |
| Approval (gate), decide, channel | Решение / подпись · «держит работу» · «Ирина · из Telegram · 12:41» | Decision / sign-off · “holds the work” · “Irina · from Telegram · 12:41” |
| `approvalSchema` outcomes | При «да» / при «нет» | On “yes” / on “no” |
| precondition failed, `excludedPrincipals` | Пока нельзя подписать: … / Вам нельзя решать: разделение обязанностей | Can’t sign yet: … / You can’t decide: separation of duties |
| Evidence | Доказательства | Evidence |
| WorkRule | Правило: когда … и если … → … | Rule: when … and if … → … |
| `work.reconciled` | Снята — повод отпал | Withdrawn — no longer needed |
| Package plan / apply | План пакета · «установить ровно этот план» | Package plan · “install exactly this plan” |
| break-glass, `force_cancel` | Аварийно | Emergency |
| Notification delivery | в Telegram · доставлено 12:40 / не доставлено: бот заблокирован | delivered to Telegram 12:40 / not delivered: bot blocked |

## Слова операционных статусов (`StatusMark`)

| Ключ | RU | EN |
|---|---|---|
| `queued` | не начата | not started |
| `running` | исполняется | running |
| `waiting_human` | ждёт человека | waiting for a person |
| `waiting_external` | ждёт внешнюю систему | waiting on external system |
| `blocked` | застряла | stuck |
| `paused` | приостановлена | paused |
| `stale` | нет прогресса | no progress |
| `failed` | не удалась | failed |
| `completed` | сдано | submitted |
| `verified` | проверено | verified |

## Четыре печати (`Seals`)

| RU | EN |
|---|---|
| Откуда · Кто делал · Чем доказано · Кто подписал | Origin · Done by · Verified · Signed by |
| звена нет | missing |
| не поручено | not assigned |
| внешним состоянием / автопроверкой / человеком / оценкой модели · помечено | by external state / by auto-check / by a person / by model judgement · flagged |
| не пройдено / на проверке / не проверялось | failed / under review / not verified |
| проверено внешним состоянием (полоса «Изменилось») | verified by external state |
| ждёт подписи / подписано / подпись не требуется | awaiting sign-off / signed / no sign-off needed |
| Ирина · из Telegram · 12:41 | Irina · from Telegram · 12:41 |

## Источник знания и канал

| RU | EN |
|---|---|
| ядро / из памяти / внешняя система | core / from memory / external system |
| Источник: процесс «Оплата счетов» | Source: process “Invoice payment” |
| в Telegram · отправлено / доставлено / открыто / не доставлено | sent to Telegram / delivered to Telegram / opened in Telegram / not delivered to Telegram |
| решено из Telegram | decided from Telegram |
| online · 14:02 / offline · данные на 13:40 | online · 14:02 / offline · data as of 13:40 |

## Решение (`DecisionCard`)

| RU | EN |
|---|---|
| Решение · держит работу | Decision · holds the work |
| Почему у вас: … | Why you: … |
| При «да» / При «нет» | On “yes” / On “no” |
| Доказательства · открыты до кнопки — решение с внешним эффектом | Evidence · shown before the button — the decision has an external effect |
| Предложение агента | Agent’s proposal |
| Согласовать / Отклонить… / Открыть историю | Approve / Decline… / Open history |
| Не нужно было показывать | Didn’t need to see this |

## Итог (`Summary`)

| RU | EN |
|---|---|
| Довела до проверенного результата 9 работ из 12 сданных | Verified 9 work items of 12 submitted |
| 1 ждёт вашего решения / 2 ждут вашего решения | 1 awaits your decision / 2 await your decision |
| 1 сломано / ничего не сломано | 1 broken / nothing broken |

Формы числа — `Intl.PluralRules`: в русском one/few/many/other (1 работу · 2 работы · 5 работ · 21 работу),
в английском one/other (1 work item · 2 work items).

## Ассистент и каркас

| RU | EN |
|---|---|
| Ассистент · Новая беседа · Закрыть ассистента | Assistant · New conversation · Close assistant |
| Спросите о том, что на экране, или поручите словами — поручение станет работой после вашей подписи. | Ask about what’s on the screen, or assign something in words — it becomes work once you sign off. |
| Будет заведена работа — нужна ваша подпись · Завести работу · Изменить | Work will be created — needs your sign-off · Create work · Edit |
| из Telegram / и в Telegram / по экрану «Сегодня» | from Telegram / also in Telegram / on screen “Today” |
| Смотрю… | Looking… |
| Спросить или поручить словами… · Отправить | Ask, or assign in words… · Send |
| Enter — отправить · Shift+Enter — перенос | Enter — send · Shift+Enter — new line |
| Меню · Период · Найти работу, человека… | Menu · Period · Find work, a person… |
| Закрепить меню / Открепить меню / Закрыть меню | Pin menu / Unpin menu / Close menu |
| Работа, человек, действие… · выбрать · открыть · действие с подтверждением | Work, person, action… · select · open · action with confirmation |
| Ядро недоступно — показаны данные на 13:40. Действия отключены до восстановления. | Core unavailable — showing data as of 13:40. Actions are off until it’s back. |
| Живое соединение прервано — данные на 13:40. | Live connection lost — data as of 13:40. |
| Источник не ответил — секция не обновлена. | The source didn’t respond — this section isn’t updated. |
| Повторить | Retry |

## Работа, хроника, формы

| RU | EN |
|---|---|
| Основание · Доставка людям · Взято · Попытка · Результат · Проверка · Подпись | Origin · Delivered to people · Taken · Attempt · Result · Verification · Sign-off |
| Обсуждение · Порождённое · Сверка · Что изменилось | Discussion · Follow-up work · Reconciliation · What changed |
| Кратко · По времени · Полный журнал | Brief · By time · Full log |
| Некому: юрист · Назначить · Поручить агенту | No one: lawyer · Assign · Hand to an agent |
| полномочия не объявлены | no authority declared |
| добавится / изменится / уйдёт · Протестировать | will be added / will change / will be removed · Test |
| Что произойдёт · Критерии приёмки (пройден / не пройден / ждёт) | What will happen · Acceptance criteria (passed / failed / waiting) |
| Исполнитель · Будет заведено · Показать ещё 5 | Executor · Will be created · Show 5 more |
| N застряло / переход свободен | N stuck / nothing stuck |

## Решить владельцу

Спорные места. В словаре `STRINGS` сейчас стоит первый вариант.

1. **«исполняется» (статус `running`).** `running` — так в утверждённом словаре статусов; стадия пути
   «Исполняется» при этом — `In progress`, и категория «в работе» — тоже `in progress`.
   Варианты: running / in progress (тогда статус и стадия совпадут, но сольются со «в работе»).
2. **«Почему у вас».** Why you / Why it’s yours / Why this is on you.
3. **Печати.** Подписи-существительные Origin · Done by · Verified · Signed by (Origin и Verified — как в
   утверждённом словаре) / вопросы, как в русском: Where from · Who did it · How proven · Who signed.
4. **«Взято» (группа хроники).** Taken (как в задаче) / Picked up (так в утверждённом словаре для claim).
5. **«Поручить».** «Назначить» — Assign, «Поручить агенту» — Hand to an agent / Delegate to an agent /
   Assign to an agent (тогда два действия называются одинаково).
6. **«Исполнитель».** Executor (утверждённый словарь; по-английски звучит официально, почти юридически) /
   Assignee / Doer.
7. **«Ядро» как источник.** core / system of record / platform — и вслед за ним «Ядро недоступно».
8. **«Отклонить…».** Decline… / Reject…
9. **«Не нужно было показывать».** Didn’t need to see this / Not for me / Shouldn’t have been shown.
10. **«Порождённое».** Follow-up work / Spawned work / Child work.
11. **«Работа» как исчисляемое.** work item(s) / piece(s) of work / task(s) — в «Итоге» и счётчиках.
12. **«на проверке» (способ проверки ещё идёт).** under review / being verified / awaiting verification.
13. **«не пройдено».** failed (утверждённый словарь; совпадает со статусом `failed`) / not passed.
14. **«Довела до проверенного результата».** “Verified 9 work items of 12 submitted” — подлежащее
    (организация) опущено; вариант — “Brought 9 work items to a verified result, of 12 submitted”.
15. **«Парк»** (люди, агенты, процессы одной анатомией). Roster / Fleet / Team — в компонентах не встречается,
    нужно для экрана.
16. **Кавычки.** Типографские “yes” / прямые "yes" (проще для переводов и поиска).
