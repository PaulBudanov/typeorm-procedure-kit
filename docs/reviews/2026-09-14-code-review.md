# Ревизия кода — 14 сентября 2026

Снимок отчёта, по которому построен план
`docs/superpowers/plans/2026-09-15-review-findings-remediation.md`. Закоммичен, чтобы ссылки
вида «P2 · 09» были разрешимы из репозитория.

> **Читать с двумя поправками.**
>
> 1. **P1 · 01 в исходной формулировке неверна.** Утверждение «на Oracle запрос
>    гарантированно падает» проверено против парсера драйвера и не подтвердилось: для
>    обычного SQL драйвер отводит слот на каждое вхождение, и старый код отдавал ровно
>    столько значений — путь работал. Сломан был только PL/SQL (один слот, два значения).
>    Первая попытка починки (`ad7996f`) инвертировала отказ и внесла рассогласование
>    позиций; итоговое решение — именованные связывания, `4c31ea6`.
> 2. **Номера строк относятся к состоянию до ремедиации** и устарели после ветки
>    `refactor/review-findings`. Сверяйтесь с текущим `src/`, а не с этими ссылками.

---

Ревизия кода · 14 сентября 2026

Две независимые проверки: чистота и принципы проектирования — и соответствие бизнес-логики задокументированному контракту. Вендорный форк `src/typeorm/**` вне периметра.

Базовая гигиена здесь заметно выше среднего. На 13 232 строки собственного кода приходится ровно **один** `eslint-disable`, **ноль** `any` и два `as unknown as`. Строгие флаги `tsconfig` включены по-настоящему и, судя по коду, соблюдаются, а не глушатся. Тесты и линтер зелёные.

**Главное.** Две проверки шли независимо — одна по структуре кода, другая по поведению — и сошлись в одной точке. Абстрактный контракт `DatabaseAdapter` объявляет Oracle и PostgreSQL взаимозаменяемыми, но по факту они расходятся: структурно (четыре разных ответа на вопрос «это plain object?», две разные хореографии закрытия подписки, дублирующиеся, но разошедшиеся реализации) и наблюдаемо (один и тот же SQL падает на Oracle и работает на PG; коллизия имён колонок на PG бросает ошибку, на Oracle молча теряет данные вопреки README).

Если из отчёта стоит вынести одно решение — это подтянуть вендоров к общему скелету и зафиксировать паритет тестами. Остальное — плановая уборка.

## Находки

### Бизнес-логика и контракт

Расхождения между реализацией и обещаниями README, а также между двумя СУБД. Все находки этого раздела подтверждены прогонами кода, а не только чтением.

### P1 · 01 — Повторный именованный параметр в raw SQL: на Oracle запрос гарантированно падает, на PostgreSQL работает

Oracle ≠ PG

`src/adapters/oracle/oracle-adapter.ts` : 192–211

```
replaceNamedParameters(sqlQuery, ({ full, key }) => {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return full;
  bindings.push(paramsInUpperCase[key.toUpperCase()] ?? null);
  return full;                       // SQL не переписывается
});
return { bindings, sqlString: sqlQuery };
```

`replaceNamedParameters` вызывает колбэк на **каждое вхождение** плейсхолдера. Oracle-адаптер оставляет SQL как есть и отдаёт драйверу массив, то есть позиционное связывание. Но в Oracle повторяющийся `:NAME` — это **одна** bind-переменная, а не две. PostgreSQL в том же месте переписывает каждое вхождение в собственный `$n`, поэтому там всё сходится.

Ломается самый обычный опциональный фильтр:

```
await db.callSqlTransaction(
  'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)',
  { FROM_DATE: '2024-01-01' }
);
// PG:     $1 / $2, два значения на две позиции — работает
// Oracle: два значения на одну позицию
//         thin  → NJS-098: 1 positional bind values are required, but 2 were provided
//         thick → ORA-01036 / ORA-01008
```

Один и тот же SQL нельзя переиспользовать между СУБД, что прямо противоречит README: «Raw SQL uses the same execution flow as procedure calls».

**Что сделать**Дедуплицировать параметры по имени и отдавать драйверу именованный объект биндингов вместо массива — либо переписывать повторы в уникальные `:tpk_1`, `:tpk_2`.

### P1 · 02 — Коллизия имён колонок на Oracle молча теряет данные — README обещает ошибку

Oracle ≠ PG

`src/adapters/oracle/oracle-result-materializer.ts` : 256–275 · `oracle-serializer.ts` : 46–48

README (стр. 608) обещает: «Output column names that collide after case conversion **raise an error instead of overwriting data**». PostgreSQL это делает:

```
// postgre-serializer.ts:56-63
const originalName = outputNames.get(outputName);
if (originalName !== undefined) {
  throw new ServerError(
    `PostgreSQL result columns "${originalName}" and "${key}" ...`
  );
}
```

Oracle — не делает нигде: ни в fetch-хендлере, который просто переименовывает колонку на месте, ни в материализаторе строк курсора, где значение пишется без проверки — `transformed[outputName] = …`. Показательно, что для полей Oracle RECORD проверка в том же файле **есть** (стр. 391–395), то есть это пропуск, а не осознанное решение.

Проверено прогоном в режиме `camelCase`: `COL_2` и `col2` оба дают `col2`; PG бросает ошибку, Oracle молча возвращает одно имя для обеих колонок. Сценарий — `SELECT ORDER_ID, "order id" …` или джойн таблиц с `ITEM_1` и `item1` в REF CURSOR. Приложение получает ровно одно значение, побеждает последнее. Ни ошибки, ни предупреждения.

**Что сделать**Повторить логику PG в `transformCursorRow`: накапливать `Map` и бросать `ServerError` при коллизии.

### P1 · 03 — Скалярные аргументы `CHAR`, `BOOLEAN`, `PLS_INTEGER` на Oracle вызвать нельзя — хотя внутри RECORD они поддержаны

Oracle ≠ PG

`src/adapters/oracle/oracle-bindings.ts` : 40–53 против : 75–96

Белый список типов для скалярных аргументов (`typeMapping`) содержит 12 типов. Белый список типов для **полей RECORD** (`recordFieldTypeMapping`) — те же 12 плюс ещё восемнадцать: `CHAR`, `NCHAR`, `VARCHAR`, `NVARCHAR2`, `BOOLEAN`, `PLS_INTEGER`, `BINARY_FLOAT`, `DOUBLE PRECISION` и другие. Второй список буквально начинается со спреда первого.

Проверено прогоном: процедура с аргументом `p_flag IN CHAR` падает на `Invalid data type: CHAR` ещё в `makeBindings`, до обращения к БД. Тот же `CHAR` как поле RECORD принимается. В PostgreSQL белого списка нет вообще — эквивалентная процедура работает.

Ограничение не описано ни в README, ни в `MIGRATION_V3.md`, и не покрыто ни одним тестом: `grep "Invalid data type"` по `test/` и докам даёт ноль совпадений. То есть отличить намеренное ограничение от регрессии сейчас невозможно.

**Что сделать**Расширить `typeMapping` до `recordFieldTypeMapping` — они и так вложены друг в друга. Если ограничение намеренное, задокументировать точный список и закрепить тестом.

### P2 · 04 — Скалярные OUT на Oracle проходят только через temporal-сериализаторы

Oracle ≠ PG

`src/adapters/oracle/oracle-result-materializer.ts` : 344–359, 496–511

`serializeScalarOut` опирается на `getScalarTemporalSerializerType`, который знает только `DATE` и три `TIMESTAMP`. Всё остальное — `VARCHAR`, `JSON`, `BINARY`, `BOOLEAN`, `CHAR`, `XML` — возвращается как есть. При этом поля RECORD в том же файле получают полный набор через `getRecordSerializerType`, а в PostgreSQL скалярные OUT приходят в строке результата `CALL` и потому проходят все зарегистрированные type-parser'ы пула.

Практически: пользователь регистрирует `setSerializer({ serializerType: 'JSON', … })`. На PostgreSQL `OUT p_payload json` придёт распарсенным объектом, на Oracle — сырым значением драйвера. Один и тот же прикладной код ломается при переезде; README эту разницу не оговаривает.

**Что сделать**Использовать в `serializeScalarOut` тот же `getRecordSerializerType` — он уже покрывает весь набор.

### P2 · 05 — Опечатка в имени параметра raw SQL молча превращается в NULL

тихий отказ

`oracle-adapter.ts` : 207 · `postgre-adapter.ts` : 260 — `paramsInUpperCase[key.toUpperCase()] ?? null`

Передали `{ USERID: 42 }` вместо `{ USER_ID: 42 }` — запрос выполнится с `NULL`. Для `WHERE id = :USER_ID` это значит «ноль строк» вместо падения: тест приложения увидит пустой результат, а не ошибку.

Рядом вторая версия той же проблемы: `if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return full;` — плейсхолдер в нижнем регистре просто остаётся в тексте SQL. PostgreSQL получит синтаксически неверный запрос, Oracle — `ORA-01008 not all variables bound`. README требует верхний регистр, но нарушение не диагностируется там, где сообщение было бы понятным.

**Что сделать**Бросать `ServerError` при отсутствии значения для плейсхолдера — или ввести опцию `strictParams`. Отдельно — явно отвергать плейсхолдер не в верхнем регистре с внятным сообщением.

### P2 · 06 — Конверт ошибки БД не распознаётся, если строк больше одной

тихий отказ

`src/utils/database-error-handler.ts` : 41–50

```
if (Array.isArray(responseData)) {
  if (responseData.length > 1) return;   // порог, а не рекурсия
  this.checkForDatabaseError(responseData[0], queryId, logger);
  return;
}
```

Курсор из двух и более строк, первая из которых — конверт `{error_code: 500, error_text: …}`, считается успехом. `ExecuteBase.executeProcedure` отдаёт в проверку `result.rows` — конкатенацию строк всех курсоров, поэтому ошибка превращается в обычные данные и уходит в прикладной код.

`MIGRATION_V3` говорит «arrays are not recursively scanned», но «1 строка проверяем, 2 строки не проверяем» — это не отсутствие рекурсии, а порог, и он нигде не описан.

Рядом — вторая сторона той же медали. Решение «считать ли результат ошибкой» принимается по восьми захардкоженным именам полей (`error_code`, `err_code`, `errorCode`, `errCode` и их текстовые пары, строки 138–149). Список не конфигурируется, поэтому однострочный результат с легитимной бизнес-колонкой `errorCode` превратится в брошенное исключение. Для процедур соглашение разумное, для `callSqlTransaction` — неочевидное: `SELECT error_code, error_text FROM audit WHERE id = 1` с ненулевым кодом упадёт вместо того, чтобы вернуть строку.

**Что сделать**Проверять первую строку независимо от длины массива либо явно задокументировать порог — сейчас поведение выглядит непреднамеренным. Набор ключей вынести в конфиг с текущим списком по умолчанию.

### P2 · 07 — Формат payload'а PG-уведомления нигде не описан, а семантика событий у вендоров разная

документация

`src/core/notify-base.ts` : 74–88, 110–133 · `oracle/oracle-sql.ts` : 146–147

- **Контракт не документирован.** README говорит только «PostgreSQL listens on `db_object_event`». Что именно должен слать триггер — JSON `{event: 'CREATE'|'DROP', object: ''}` — не написано ни в README, ни в переводах. Неверный payload тихо игнорируется, и пользователь не может корректно написать свой триггер.
- **Семантика разная.** Oracle-сторона фильтрует `ACTION='REPLACE'`, PG-сторона принимает только `CREATE` и `DROP`. То есть `CREATE OR REPLACE PROCEDURE` обновит метаданные на Oracle и может не обновить на PG.
- **JSDoc неверен.** Пример для массива показывает `[{event, object, owner}]`, тогда как код читает из элементов массива поле `name`.
  **Что сделать**Описать форму PG-события в README, привести JSDoc в соответствие с кодом, рассмотреть добавление `REPLACE` для паритета с Oracle.

### P2 · 08 — Цикл восстановления подписки может крутиться без задержки — вопреки собственному JSDoc

надёжность

`src/adapters/abstract/database-notify.ts` : 309–338, 381–418

Комментарий к `assertNotificationRetryOptions` обещает: «Rejects retry values that would make restore loops skip work or **spin**». Но `assertNotificationDelay` разрешает `0`, а после исчерпания `maxRetries` счётчик сбрасывается в 1 и цикл начинается заново — бесконечно:

```
if (currentRetry >= maxRetries) {
  await this.waitForRestoreRetryDelay(channelName, retryAfterMaxDelayMs);
  if (this.isNotificationRestoreCancelled(channelName)) return;
  currentRetry = DatabaseNotify.RESTORE_CURRENT_RETRY;   // сброс
  continue;
}
```

С `retryDelayMs: 0, retryAfterMaxDelayMs: 0` — значениями, которые README явно разрешает («integers in 0..2_147_483_647») — получается непрерывный цикл создания соединений к недоступной БД. Фактически self-DoS.

**Что сделать**Либо задать нижнюю границу (скажем, 100 мс) и поправить README, либо ввести окно/предел циклов, оставив `0` только для тестов.

### P2 · 09 — Конфликт алиасов ключей payload'а: PG отвергает, Oracle молча выбирает

Oracle ≠ PG

`postgre-bindings.ts` : 145–157 против `oracle-bindings.ts` : 161–165, 348

PostgreSQL для composite-аргумента вызывает `readPayloadValue(…, shouldRejectAliasConflict = true)` и бросает `Conflicting PostgreSQL procedure payload keys`. Oracle для RECORD-аргумента использует обычную версию, а она просто делает `record[normalizedName] ?? record[argumentName] ?? null`.

То есть payload `{ rec: {...}, p_rec: {...} }` на Oracle молча разрешается в пользу `rec`. README обещает «unknown or conflicting field names are rejected» без оговорок про вендор. Внутри самого RECORD конфликт полей Oracle всё же ловит — непоследовательность именно на уровне аргумента.

**Что сделать**Вынести версию с `shouldRejectAliasConflict` в общий код и применять её в обоих адаптерах для структурных аргументов.

### P3 · 10 — Наблюдения по поведению

разное

- **Сдвиг индексов биндингов в логах при composite OUT.** `query-log-context-builder.ts` : 94 берёт `bindings[index]` по индексу аргумента, но `postgre-bindings.ts` : 170 для `mode === 'OUT'` composite возвращает `NULL::type`, не добавляя биндинг. Дальше значения смещаются и логируются под чужими именами — это обходит `redact-by-name`: значение из `p_password` может попасть в лог под именем следующего аргумента.
- **Осиротевшая Oracle-подписка.** `oracle-notify.ts` : 729–738 — если `closeSubscription` бросит, подписка регистрируется под новым именем, а restore-state и возвращённое пользователю имя остались старыми. `unlistenNotify` её уже не найдёт: соединение и health-check останутся навсегда. Достижимость низкая, но путь есть.
- **Повторный `destroy()` никогда не логирует предупреждение.** `core/index.ts` : 452–457 — проверка `if (this.destroyPromise) return` стоит до проверки `state === 'destroyed'`, поэтому ветка с `logger.warn('already destroyed')` недостижима.
- **`.length` на возможно-не-массиве.** `execute-base.ts` : 73 — `queryTimer.success(result.length)` при типе `Awaited | T>`. Для non-SELECT в лог уходит `undefined`.
- **«Exponential backoff», который линейный.** `async-utils.ts` : 62 — `await this.delay(delayMs * attempt); // exponential backoff`. Код мёртвый (см. P1 · 13), но комментарий вводит в заблуждение.
- **`??`-цепочка съедает явный `null`.** `postgre-bindings.ts` : 159 / `oracle-bindings.ts` : 348 — при payload'е `{ flag: null, p_flag: 5 }` явно переданный `null` подменяется значением `p_flag`.
- **`resolveResourceLimits` ломается от явного `undefined`.** `resource-limits.ts` : 269–272 делает `{...DEFAULT, ...limits}`, поэтому `{ maxProcedureRows: undefined }` затирает дефолт и падает с вводящим в заблуждение сообщением.
- **`QueryTimer` пишет «started» до получения соединения** — при ошибке `getEntityManager` парного `success`/`error` в логе не будет.
- **Потенциальная утечка соединения на узком пути.** `oracle-notify.ts` : 201–220 — если `generateOptions` бросит между созданием соединения и `subscribe`, соединение не закроется. Сейчас нейтрализовано ранним разбором SQL, но контракт хрупкий.

### Чистота, SOLID, DRY, KISS

Структурные находки по собственному коду. Три системных мотива: ручные перечисления вместо данных, параллельные реализации одного понятия, публичный API шире библиотеки.

### P1 · 11 — Один union расписан семью перечислениями, три из них не покрыты проверкой исчерпаемости

DRY

`src/adapters/abstract/database-serializer.ts` — 354 строки

Десятичленный `TSerializerType` перечислен вручную семь раз: `serializeValue` (64 строки `switch`, где все десять веток отличаются только ключом реестра), `serializerMapping`, `hasSerializer`, `registerSerializer`, `unregisterSerializer`, `deleteAllSerializers`, `registeredSerializerTypes`.

Проверено экспериментом: скопировал `src`, добавил одиннадцатый тип `INTERVAL`, прогнал `tsc`. Компилятор ругнулся ровно в двух местах:

```
database-serializer.ts(61,6):   TS7030: Not all code paths return a value.
database-serializer.ts(158,61): TS2366: Function lacks ending return statement.
```

`noImplicitReturns` прикрывает только `serializeValue` и `hasSerializer`. Остальные три — `serializerMapping` (138), `deleteAllSerializers` (252–261), `registeredSerializerTypes` (264–277) — компилируются молча. Новый тип не попадёт в публичный `serializerMapping`, не будет сброшен вызовом `deleteAllSerializers()` и не появится в списке зарегистрированных.

**Что сделать**Массив `SERIALIZER_TYPES … as const satisfies ReadonlyArray` как единственный источник правды плюс индексация реестра. Прототип типизируется чисто: 354 → 228 строк. Локальный каст нужен в одном месте — присваивание в mapped type внутри `registerSerializer`.

### P1 · 12 — Тройной `switch` по типу СУБД в одном классе

SOLID · OCP

`src/core/database-initializer-base.ts` : 189, 250 + пара `getPostgresOptions`/`getOracleOptions`

Класс переключается на `dbConfig.type` трижды: в `configFactory`, в `databaseAdapterFactory` и неявно через две почти идентичные функции сборки `ConnectionOptions`. Добавление третьей СУБД требует правок в четырёх местах одного файла.

Побочно: у `databaseAdapterFactory` нет ветки `default`, в отличие от `configFactory`. Потребитель на чистом JS с опечаткой в `type` получит `undefined` и невнятный сбой позже по стеку вместо внятного сообщения на старте.

**Что сделать**Реестр адаптеров: вендорный модуль сам отдаёт и свои `ConnectionOptions`, и свой адаптер. Ядро тогда не знает названий СУБД вообще.

### P1 · 13 — 601 строка мёртвого кода — и весь он в публичном API

мёртвый код

`src/utils/async-utils.ts`, `type-guards.ts`, `queue-manager.ts`, `event-bus.ts`

МодульСтрокИспользований в `src/`

AsyncUtils116**0**
TypeGuards171**0**
QueueManager220**0**
EventBusService94только из `QueueManager`

`QueueManager` и `EventBusService` образуют замкнутый остров: ссылаются друг на друга и больше ни на кого. Все четыре покрыты тестами и экспортированы наружу.

Показательная деталь: мёртвый `AsyncUtils.retry()` лежит рядом с двумя рукописными циклами ретраев — `DatabaseNotify.restoreNotificationWithRetry` и `ProcedureListBase.scheduleRetry`. Обобщённая реализация есть, но ей никто не пользуется — а её комментарий про exponential backoff при этом не соответствует коду.

**Что сделать**Решить по каждому: удалить либо задокументировать как публичный хелпер. Промежуточное состояние — худшее из двух.

### P1 · 14 — Внутренняя кухня целиком экспортирована наружу

SOLID · ISP

`src/index.ts` : 6 — `export * from './utils/index.js'`

Наружу уезжают `QueueManager`, `EventBusService`, `DatabaseNamingCache`, `QueryTimer`, `TypeOrmHelpers`, `DatabaseOptionsExecutor`, `QueryLogContextStorage`, `StringUtilities` и другие. Из 15 экспортируемых утилит **12 не упомянуты в README** ни разу — при том что README занимает 36 КБ.

Практическое следствие: любой внутренний рефакторинг формально становится ломающим изменением, а потребитель не может отличить поддерживаемый API от случайно вытекшего.

**Что сделать**Заменить `export *` явным списком. Удачный момент — вместе со следующим мажором, который всё равно понадобится из-за опечатки в `TOracleNormilizeOptionsNotify`.

### P2 · 15 — Декодер метаданных живёт внутри оркестратора

SOLID · SRP

`src/core/procedure-list-base.ts` : 334–590 — 257 строк из 622

Сорок один процент файла — это `decodeProcedureArgument`, `decodeStructuredType`, `decodeStructuredField` и шесть хелперов-читателей. Полноценный валидатор внутри класса, который отвечает за загрузку, ретраи и дедупликацию запросов.

Внутри него — свой слой дублей: локальные замыкания `readString` (344) и `readOptionalString` (391) повторяют методы `readRequiredStructuredString` (536) и `readStructuredString` (548). Четыре реализации «прочитай непустую строку». То же с числами: разбор `order`, `size` и `subprogramId` (364–418) трижды повторяет логику `readStructuredInteger`.

**Что сделать**Выделить `ProcedureMetadataDecoder` с одним набором читателей. `ProcedureListBase` ужмётся примерно вдвое.

### P2 · 16 — Парсер Oracle RECORD живёт внутри фасада адаптера

SOLID · SRP

`src/adapters/oracle/oracle-adapter.ts` — 512 строк, из них ~230 на разбор словаря

`prepareProcedureMetadataRows`, `createRecordMetadata`, `createRecordFieldMetadata`, `isRecordType`, `isCollectionType` и пара читателей — это разбор словаря Oracle, а не «тонкий фасад, связывающий возможности адаптера», как заявлено в комментарии к классу. Для сравнения: у Postgres эквивалентная задача занимает 25 строк, потому что решена в SQL.

**Что сделать**Выделить `OracleRecordMetadataParser`. Заодно исчезнет третья по счёту копия читателей `readMetadataString`/`readMetadataInteger`.

### P2 · 17 — Метод `build()` на 229 строк с девятью аккумуляторами

KISS

`src/adapters/oracle/oracle-bindings.ts` : 98–327

Самый длинный метод в кодовой базе. Собирает анонимный PL/SQL-блок, заводя девять изменяемых накопителей подряд: `bindings`, `recordLogBindings`, `cursorsNames`, `outBindings`, `placeholders`, `declarations`, `inputAssignments`, `outputAssignments`, `reservedNames`, плюс счётчик `generatedNameIndex`.

Когда метод держит девять единиц изменяемого состояния — это класс, который не выделили. У Postgres тот же `build()` занимает 102 строки.

**Что сделать**`OracleAnonymousBlockBuilder`, где накопители станут полями, а этапы сборки — методами.

### P2 · 18 — Четыре реализации «это plain object?» с тремя разными семантиками

DRY

`utils/type-guards.ts` : 47 · `abstract/database-serializer.ts` : 339 · `oracle/oracle-bindings.ts` : 453 · `postgres/postgre-bindings.ts` : 267

ГдеКак решает

TypeGuards.isPlainObjectчёрный список (не Array/Date/RegExp/Error/Promise) — **экземпляр класса проходит**
DatabaseSerializer.isPlainRecordпроверка прототипа, без явного отсева массивов
OracleProcedureBindings.isPlainObjectпрототип + явный `Array.isArray`
PostgreProcedureBindings.isPlainObjectтолько прототип, без защиты от `null`

Это решает, как трактовать payload процедуры — как объект полей или как скаляр. То, что Oracle и Postgres отвечают на вопрос по-разному, — реальный риск расхождения, а не стилистика; он того же рода, что и подтверждённые расхождения в P1 · 01–03. Отдельная ирония: канонический вариант, экспортированный как публичная утилита, — тот самый мёртвый `TypeGuards`.

**Что сделать**Одна реализация на всех, с зафиксированным в тестах контрактом для экземпляров классов, массивов и `null`.

### P2 · 19 — Обход типов значения написан трижды в одном файле

DRY

`src/adapters/abstract/procedure-resource-tracker.ts` : ~86–110, 130–136, 151–175

Диспетчер «сколько байт занимает значение» (string / number / boolean / bigint / Buffer / Date) повторён три раза: в быстром пути `measureRow`, в начале `measureValue` и в цикле обхода графа внутри `measureValue`.

Три копии обязаны оставаться побайтово одинаковыми. Иначе быстрый путь и fallback начнут считать по-разному, и лимит `maxProcedureBytes` будет срабатывать неконсистентно — в зависимости от того, встретился ли во входных данных вложенный объект.

**Что сделать**Вынести скалярный диспетчер в одну приватную функцию. Кэш формы строки при этом сохраняется — дублировался именно диспетчер.

### P2 · 20 — Дубли между адаптерами вместо Template Method

DRY

`oracle/oracle-adapter.ts` : 342 ↔ `postgres/postgre-adapter.ts` : 143

- `replacePackageNamePlaceholder` — **побайтово идентичен** в обоих адаптерах.
- `NO_ARGUMENT_SENTINEL = '__tpk_no_argument__'` — приватная статика с одинаковым значением в обоих.
- `generatePackageInfoSql` — один скелет (валидация идентификатора → подстановка → пять строк расчёта `detectionLimit` → дописать лимит), различия только в регистре и синтаксисе `FETCH FIRST` против `LIMIT`.
- `makeSqlBindings` — одинаковая сборка `paramsInUpperCase` и одинаковая регулярка. Именно здесь разошедшиеся копии и породили P1 · 01.
  **Что сделать**Скелет — в `DatabaseAdapter`, вендорам оставить два-три абстрактных хука. Сентинел — в общие константы.

### P2 · 21 — Одинаковый lifecycle закрытия подписки — с разошедшимся поведением

DRY · LSP

`oracle/oracle-notify.ts` `performCloseSubscription` ↔ `postgres/postgre-notify.ts` `performCloseListenerConnection`

Один и тот же алгоритм: достать соединение из пула → удалить → health-check с таймаутом `500` → вендорная отписка → лог → `catch` с логом → `finally` с закрытием. Но реализации разошлись:

- Oracle вызывает `stopConnectionHealthCheck` **до** дренажа коллбэков, Postgres — **после**.
- Oracle обрабатывает флаг `shouldCancelRestore` и вызывает `clearNotificationRestoreState`; в Postgres такого параметра нет вообще.
- Число `500` вписано в оба файла литералом — единственный таймаут подсистемы без имени, тогда как все остальные вынесены в статические поля `DatabaseNotify`.
  **Что сделать**Поднять хореографию закрытия в `DatabaseNotify`, оставив вендорам только сам вызов отписки, и зафиксировать порядок тестом базового класса.

### P2 · 22 — Вендорная логика внутри вендор-нейтрального класса

SOLID · OCP

`src/core/notify-base.ts` : 110–133

`packageNotifyCallback` различает СУБД по форме payload: `Array.isArray(notifyData)` — значит Oracle, читаем поле `name`; иначе Postgres, читаем `event` и `object`. Автор сам пометил это `//TODO: Extend to support other databases, refactor interfaces` на строке 179. Это же место порождает расхождение семантики событий из P2 · 07.

**Что сделать**Нормализацию уведомления — в адаптер, который и так знает свой формат. `NotifyBase` получает общую форму `{ packageName }`.

### P2 · 23 — Два уровня посредников ради нуля логики

Middle Man

`src/core/serializer-base.ts` — все четыре члена класса

`setSerializer`, `deleteSerializer`, `deleteAllSerializers` и геттер `serializerMapping` — однострочные делегации в `databaseAdapter`. При этом `TypeOrmProcedureKit` делегирует в `SerializerBase`. Вызов проходит три объекта, не меняясь.

**Что сделать**Либо убрать класс, либо дать ему собственную ответственность — например, валидацию сериализаторов при регистрации, которой сейчас нет нигде.

### P2 · 24 — Nest-слой: три вида одинакового бойлерплейта

DRY

`src/nest/`

- `forRoot` (40–56) и `forRootAsync` (94–107) повторяют массивы `providers` и `exports` целиком.
- `providers/core-methods.providers.ts` — восемь провайдеров одинаковой формы `useFactory: (service) => (...args) => service.method(...args)`, 92 строки.
- `decorators/` — восемь отдельных файлов, тело каждого `return Inject(TOKEN)`.
  **Что сделать**Общая функция сборки модуля для первых двух и типизированный `createMethodProvider(token, pick)` для провайдеров. Восемь файлов декораторов можно оставить — они дёшевы и хорошо ищутся.

### P2 · 25 — Дубль каркаса в `ExecuteBase`

DRY

`src/core/execute-base.ts` — `execute` и `executeProcedure`

Одинаковый каркас: разбор `executionOptions` → создание `QueryTimer` → получение `EntityManager` → `try/catch/finally` с обёрткой ошибки и освобождением соединения. Различаются двумя строками — какой метод адаптера вызвать и что скормить `checkForDatabaseError`.

**Что сделать**Один приватный `runWithConnection(sql, bindings, options, operation)`, два тонких публичных метода поверх.

### P2 · 26 — Тройная косвенность типов

Shotgun Surgery

`src/interfaces/*.interfaces.ts` → `src/types/*.types.ts` → `src/types/index.ts` → `src/index.ts`

Интерфейс объявляется в `interfaces/`, затем реэкспортируется один в один в `types/`, затем ещё дважды. В `types/notification.types.ts` из 34 строк 19 — импорт и реэкспорт того же самого. Добавление одного интерфейса требует правки трёх-четырёх файлов.

**Что сделать**Либо объявлять типы там, где они реэкспортируются, либо оставить `interfaces/` единственным местом. Промежуточный слой не даёт ничего, кроме обязательной правки.

### P3 · 27 — Опечатки в идентификаторах, одна — в публичном API

именование

ОпечаткаГдеЦена правки

TOracleNormilizeOptionsNotifytypes/notification.types.ts**мажор** — экспортируемый тип
serialzierBasecore/index.ts — 5 местприватное поле
settingsLogernest/…-nest.service.ts — 3 местаприватное поле
generaionutils/typeorm-helpers.ts : 171локальная переменная
shuwtdown.consts.tssrc/consts/имя файла

Отдельно — расхождение `Postgre` против `Postgres`: собственные классы названы `PostgreAdapter`, `PostgreNotify`, `INotifyPackageCallbackPostgre`, тогда как форк и значение конфига используют `Postgres` и `'postgres'`.

### P3 · 28 — Недостижимая ветка кода

мёртвый код

`src/core/procedure-list-base.ts` : 210–215

Проверка `procedureMap.length < 1` стоит после раннего выхода по `Object.keys(procedureObject).length < 1` на строке 201. У `Object.entries` и `Object.keys` одного объекта длина одинакова, поэтому ветка не исполняется никогда — вместе с сообщением `"No procedures in map for package …"`, которое никто никогда не увидит. Второй такой случай — в P3 · 10 (недостижимый `warn` в `destroy()`).

### P3 · 29 — Глобальная мутация драйвера из конструктора

побочный эффект

`src/adapters/oracle/oracle-adapter.ts` : 85

```
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
```

Конструктор адаптера меняет настройку модуля `oracledb` для всего процесса. Если хост-приложение использует `oracledb` напрямую, создание экземпляра библиотеки молча меняет форму его результатов. В README это упомянуто, но поведение остаётся неожиданным.

**Что сделать**Передавать `outFormat` в опциях конкретного запроса, а не переключать глобально.

### P3 · 30 — Новый `Proxy` на каждое обращение к геттеру

KISS

`src/core/serializer-base.ts` : 303

`serializerReadOnlyMapping` создаёт свежий `Proxy` при каждом чтении — идентичность объекта нестабильна между вызовами. Вдобавок ловушка `get` бросает исключение при попытке **прочитать** свойства `set`, `clear` и `delete`, то есть даже `typeof map.set` падает.

**Что сделать**Возвращать замороженный снимок или готовый `ReadonlyMap` — он и так формируется в `DatabaseSerializer.serializerMapping`.

### P3 · 31 — Мелочи, которые стоит подобрать заодно

разное

- **Пять одинаковых методов** `requireConnectionBase` … `requireSerializerBase` — `core/index.ts` : 114–147. Различаются именем поля и ничем больше.
- **Закомментированный код** — `core/database-initializer-base.ts` : 130.
- **`luxon` ради `new Date()`** — `utils/server-error.ts` : 9, `DateTime.now().toLocal().toJSDate()` даёт ровно то же самое.
- **`ENSURE_SERVER_ERROR`** — единственный метод в проекте в SCREAMING_SNAKE_CASE.
- **`unsafeGetContextAs()`** — `utils/server-error.ts` : 111, возвращает публичное поле `errorContext`, к которому и так есть прямой доступ.
- **`isMapRecord`** — `typeorm-extend/repository/abstract-typeorm-repository.ts` : 288, проверка `typeof value === 'object'` пропускает `null`. Сейчас спасает тип, но охранник хрупкий.
- **`getPropertyPathsMap` и `getPropertyMap`** — там же, 117 и 134: одинаковый паттерн «кэш → сборка → запись», различие в три строки.
- **Грамматика в сообщениях логов** — `"because you don't add they to procedure object"`, `"No arguments in package X , load package and restart server"` (пробел перед запятой). Это то, что увидит пользователь библиотеки в проде.
- **`CLAUDE.md` расходится с кодом** — сказано «each lazily constructed», фактически `initMainClasses()` создаёт все пять баз разом при `initDatabase()`.
- **`dotenv` и `app-root-path` в runtime-зависимостях** — нужны только для `ConnectionOptionsReader` в форке, которого путь библиотеки никогда не касается: `DataSourceOptions` всегда собирается программно в `DatabaseInitializerBase`.

## Пробелы в тестах

Перечисленное ниже сейчас **не поймается** существующим набором из 678 тестов. Первые три — это подтверждённые P1.

| Что не покрыто                                    | Текущее состояние                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Повторный именованный параметр в raw SQL          | тестируются только уникальные плейсхолдеры — `oracle-adapter.test.ts` : 1316, `postgre-adapter.test.ts` : 1414 |
| Коллизия имён колонок на Oracle                   | есть тесты на PG и на поля Oracle RECORD, ни одного на строки Oracle-курсора                                   |
| Белый список скалярных типов Oracle               | `grep "Invalid data type"` по `test/` — 0 совпадений                                                           |
| Паритет сериализаторов scalar-out между вендорами | нет теста «зарегистрировали `VARCHAR` → применился к OUT» для Oracle                                           |
| Пропущенный или опечатанный параметр raw SQL      | нет теста, фиксирующего, что `NULL` — осознанное решение, а не баг                                             |
| Конверт ошибки в многострочном результате         | нет кейса «первая строка — ошибка, строк ≥ 2»                                                                  |
| Контракт PG-payload'а пакетных уведомлений        | зафиксирован только в тесте — то есть спецификация недоступна пользователю                                     |
| `retryDelayMs: 0` / `retryAfterMaxDelayMs: 0`     | значения принимаются валидатором, поведение цикла на них не проверяется                                        |
| Переименование канала в `restoreSubscription`     | ветка `catch` с генерацией нового UUID не покрыта                                                              |
| Выравнивание лог-биндингов при composite OUT      | нет теста на соответствие «имя аргумента ↔ значение» в логе                                                    |

## Что проверено и оказалось корректным

Это не отчёт о плохом коде. Ниже — то, что при ревью обычно приходится требовать, а здесь уже есть. Каждый пункт проверялся целенаправленно.

- **Типобезопасность не имитируется.** Один `eslint-disable` на 13 тысяч строк, ноль `any`. Строгие флаги включены и соблюдаются, а не глушатся.
- **Инъекционных путей нет.** Имена пакетов, процедур и полей везде проходят `SqlIdentifier.validateIdentifier` до интерполяции; PG-идентификаторы дополнительно квотируются; имена порталов ограничены 63 байтами и проверены на управляющие символы; `optionsCommands` проходят строгий allow-list с запретом `;`, `--` и блочных комментариев; Oracle CQN SQL разбирается токенизатором с учётом кавычек и `q''`-литералов и отвергает join, union и подзапросы.
- **Ресурсы освобождаются на всех путях.** PG-порталы закрываются в `finally` с дедупликацией по имени и отдельной обработкой `PostgreUnnamedPortalError`; Oracle `ResultSet` и LOB собираются заранее и освобождаются в `finally` даже при превышении `maxLobBytes`; `destroyLob` проверяет `lob.destroyed` — двойного release нет.
- **Ошибки не теряются.** Там, где операция и обязательное освобождение падают вместе, собирается `AggregateError` с обоими — в `ExecuteBase`, `ConnectionBase` и `initDatabaseInternal`. Это редко делают.
- **Lifecycle без гонок.** `initDatabase` идемпотентен через `initPromise`; `destroy()` во время идущей инициализации сначала дожидается её, поэтому подписка, созданная в последний момент, всё равно снимается; порядок выключения (notify → метаданные → DataSource → case strategy) корректен; сигнальные обработчики снимаются до повторной отправки сигнала.
- **Coalescing обновления метаданных работает.** `rerunRequested` плюс одна активная промис-цепочка на пакет; карта пакетов подменяется атомарно, без `await` между чтением и записью — конкурентные обновления разных пакетов не теряются.
- **Восстановление Oracle NLS-сессии доведено до конца.** Исходные значения снимаются до мутации и восстанавливаются в любом случае; при провале восстановления ошибка помечается символом, который читает `EntityManager.transaction` и физически выбрасывает соединение — обещание README «a restoration failure drops that physical connection» выполняется.
- **Темпоральная логика соответствует v3-контракту.** Строгий SQL/ISO-паттерн, отказ от тихой трактовки беззонных значений как зонных, валидация numeric offset в пределах ±14:00, нормализация вывода до миллисекунд.
- **Case strategy идемпотентна** на всех проверенных входах — что важно, поскольку Oracle применяет преобразование дважды.
- **Границы ресурсов заданы явно** и проверяются на нескольких этапах конвейера, а не одной формальной проверкой на входе.
- **Контракт `ExtendColumn` по UNIQUE выполняется буквально:** наследованный UNIQUE не дублируется, попытка снять его только у потомка бросает **до** изменения метаданных, собственный UNIQUE снимается. Защита от `__proto__`/`constructor`/`prototype` в картах свойств присутствует.
- **Форк документирован.** `docs/TYPEORM_FORK.md` фиксирует происхождение, список патчей и процедуру синхронизации — обычно вендоринг оставляют без объяснений.

## Порядок работ

- **Починить связывание повторных параметров на Oracle** (P1 · 01). Единственная находка, которая ломает типовой пользовательский сценарий прямо сейчас, — и ломает молча, только на одной из двух СУБД.
- **Добавить проверку коллизии имён колонок в Oracle-материализатор** (P1 · 02). Тихая потеря данных вопреки явному обещанию README. Логика уже написана для PG — скопировать.
- **Расширить белый список скалярных типов Oracle** (P1 · 03) или задокументировать ограничение. Сейчас часть существующих процедур просто невызываема без объяснения.
- **Закрыть три соответствующих пробела в тестах** — без них любой из трёх пунктов выше вернётся.
- **Схлопнуть перечисления в `database-serializer.ts`** (P1 · 11). Наибольший выигрыш при наименьшем риске: прототип типизируется без ошибок, поведение не меняется, файл худеет на треть.
- **Решить судьбу четырёх мёртвых утилит** (P1 · 13) и сузить `export *` до явного списка (P1 · 14). Совместить со следующим мажором, который всё равно нужен из-за `TOracleNormilizeOptionsNotify`.
- **Поднять общий скелет в `DatabaseAdapter` и `DatabaseNotify`** (P2 · 20, 21) и свести `isPlainObject` к одной реализации (P2 · 18). Это устраняет не отдельные дубли, а механизм, которым расхождения вроде P1 · 01 появляются.
- **Выделить два класса:** декодер метаданных из `ProcedureListBase` и парсер RECORD из `OracleAdapter` (P2 · 15, 16).
- **Опечатки, недостижимые ветки и грамматика логов** — попутно, одним проходом.
