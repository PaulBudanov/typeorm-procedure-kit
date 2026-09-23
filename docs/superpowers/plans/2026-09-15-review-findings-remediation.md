# Review Findings Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить находки ревизии от 2026-09-14 по собственному коду `typeorm-procedure-kit`, начиная с трёх подтверждённых P1 по бизнес-логике и заканчивая структурной уборкой.

**Architecture:** Работа разбита на волны. Внутри волны задачи затрагивают непересекающиеся файлы и выполняются параллельными агентами; между волнами оркестратор централизованно прогоняет `typecheck + lint + test` и делает коммит. Ни один агент не запускает git и не трогает файлы за пределами своего списка.

**Tech Stack:** TypeScript 5 (strict), vitest, ESLint flat config, vendored TypeORM fork (вне периметра).

**Spec:** `docs/reviews/2026-09-14-code-review.md` — отчёт ревизии от 2026-09-14.
Нумерация находок (`P1 · 01`, `P2 · 18`, …) в задачах ниже ссылается на него.

---

## Global Constraints

Действуют для **каждой** задачи без исключений.

- **Периметр.** Менять только `src/**` вне `src/typeorm/**` и `test/**`. Вендорный форк `src/typeorm/**` — read-only.
- **Импорты TypeORM.** Только из `../typeorm/...`, никогда из пакета `typeorm` (его нет в зависимостях).
- **Расширения.** Все относительные импорты — с `.js` (nodenext).
- **Строгость.** `tsconfig` строгий: запрещены `any`, `@ts-ignore`, `@ts-expect-error`, новые `eslint-disable`. Функции — с явным типом возврата, члены класса — с явным модификатором доступа.
- **Никакого git.** Агент не выполняет `git add/commit/checkout/stash`. Коммитит оркестратор.
- **Ограниченный прогон.** Агент запускает только свой тест-файл: `npx vitest run <путь>`. Полный `npm test`, `npm run lint`, `npm run typecheck` запускает оркестратор между волнами — параллельные прогоны портят `.cache/typescript/*.tsbuildinfo` и `reports/vitest/junit.xml`.
- **Поведение по умолчанию не ломать.** Если исправление меняет наблюдаемое поведение публичного API — оно должно быть либо строго более корректным (была тихая потеря данных → стала ошибка), либо за флагом. Никаких переименований экспортируемых сущностей в волнах 1–4.
- **Новые тесты — в новые файлы.** Не редактировать существующие тест-файлы без крайней необходимости: это главный источник конфликтов между параллельными агентами.

---

## Волны и параллелизм

| Волна | Задачи              | Параллельно                              | Пересечение файлов         |
| ----- | ------------------- | ---------------------------------------- | -------------------------- |
| 1     | T1, T2, T3          | да, 3 агента                             | нет                        |
| 2     | T4, T5              | да, 2 агента                             | нет                        |
| 3     | T6, T7, T8, T9, T10 | да, 5 агентов                            | нет                        |
| 4     | T11, T12            | нет, строго по очереди                   | да (крупные извлечения)    |
| 5     | T13–T21             | частично                                 | проверяется перед запуском |
| 6     | Ревью изменений     | —                                        | —                          |
| 7     | Ломающие изменения  | **только после подтверждения владельца** | —                          |

---

## Волна 1 — P1 по бизнес-логике (Oracle)

Все три подтверждены прогонами в ходе ревизии. Все три — расхождение Oracle и PostgreSQL. Каждая задача обязана идти через TDD: сначала падающий тест, потом исправление.

### Task 1: Повторный именованный параметр в raw SQL на Oracle

**Отчёт:** P1 · 01

**Files:**

- Modify: `src/adapters/oracle/oracle-adapter.ts:192-211` (`makeSqlBindings`)
- Test: `test/adapters/oracle-raw-sql-bindings.test.ts` (создать)

**Проблема.** `replaceNamedParameters` вызывает колбэк на каждое вхождение плейсхолдера. Oracle-адаптер оставляет SQL как есть и отдаёт драйверу массив — то есть позиционное связывание. Но в Oracle повторяющийся `:NAME` это **одна** bind-переменная. Итог: `SELECT * FROM T WHERE (:FROM_DATE IS NULL OR D >= :FROM_DATE)` даёт 2 значения на 1 позицию → `NJS-098` (thin) или `ORA-01036`/`ORA-01008` (thick).

**Interfaces:**

- Produces: `makeSqlBindings(sqlQuery, params)` сохраняет сигнатуру `ISqlBindingsObjectReturn`. Поле `bindings` может стать объектом `Record<string, unknown>` — тогда тип `ISqlBindingsObjectReturn['bindings']` расширяется, и это надо согласовать с `ExecuteBase.execute` и `IBindingsObjectReturn`.

**Решение.** Предпочтительный вариант — отдавать драйверу **именованный объект** биндингов: Oracle тогда сам сопоставляет `:NAME` с ключом, и повтор перестаёт быть проблемой by construction. Запасной вариант, если именованные биндинги ломают типы слишком широко: дедуплицировать по имени и переписывать повторные вхождения в уникальные `:tpk_n`.

**Acceptance:**

- `{ FROM_DATE: 'x' }` + SQL с двумя вхождениями `:FROM_DATE` → ровно одно связанное значение на имя.
- Уникальные плейсхолдеры продолжают работать как раньше (не сломать `test/adapters/oracle-adapter.test.ts:1316`).
- Литералы и комментарии, содержащие `:`, по-прежнему не трогаются.
- PostgreSQL-ветка не меняется.

---

### Task 2: Коллизия имён колонок на Oracle молча теряет данные

**Отчёт:** P1 · 02

**Files:**

- Modify: `src/adapters/oracle/oracle-result-materializer.ts:252-275` (`transformCursorRow`)
- Test: `test/adapters/oracle-cursor-column-collision.test.ts` (создать)

**Проблема.** README (стр. 608) обещает: «Output column names that collide after case conversion raise an error instead of overwriting data». PostgreSQL это делает (`postgre-serializer.ts:56-63`), Oracle — нет: `transformed[outputName] = …` пишет без проверки. `SELECT ORDER_ID, "order id"` в `camelCase` даёт два раза `orderId`, побеждает последний. Потеря данных без ошибки и без warn.

**Образец для подражания — в том же файле.** `oracle-result-materializer.ts:385-395` уже делает ровно такую проверку для полей RECORD. Повторить её стиль и формат сообщения.

**Acceptance:**

- Две колонки, дающие одно имя после `transformColumnName`, → `ServerError` с обоими исходными именами и конфликтующим результатом в сообщении.
- Сообщение по форме согласовано с PG-версией и с существующей RECORD-версией.
- Отсутствие коллизии → поведение не меняется (regression по существующим тестам курсоров).
- Проверить оба пути в методе: и ветку по `metadata`, и раннюю ветку выше (строки ~240-251).

---

### Task 3: Скалярные аргументы Oracle ограничены урезанным белым списком

**Отчёт:** P1 · 03

**Files:**

- Modify: `src/adapters/oracle/oracle-bindings.ts:40-53` (`typeMapping`), `:325-331` (`isValidDataType`)
- Test: `test/adapters/oracle-scalar-argument-types.test.ts` (создать)

**Проблема.** `typeMapping` (для скалярных аргументов) содержит 12 типов. `recordFieldTypeMapping` (для полей RECORD) — те же 12 плюс 18: `CHAR`, `NCHAR`, `VARCHAR`, `NVARCHAR2`, `BOOLEAN`, `PL/SQL BOOLEAN`, `PLS_INTEGER`, `BINARY_FLOAT`, `DOUBLE PRECISION` и др. Второй буквально начинается со спреда первого. Процедура с `p_flag IN CHAR` падает на `Invalid data type: CHAR` ещё в `makeBindings`, до обращения к БД. В PostgreSQL белого списка нет вообще.

**Внимание — это не механическое слияние двух Map.** Значения `typeMapping` идут в `BindParameter.type` для скалярных биндов, и часть типов требует согласования с:

- `VARIABLE_SIZE_OUT_TYPES` (`:60-64`) — какие OUT-типы требуют `maxSize`;
- `VARIABLE_SIZE_RECORD_TYPES` (`:66-74`) — уже перечисляет `DB_TYPE_CHAR`, `DB_TYPE_NCHAR`, `DB_TYPE_VARCHAR`, `DB_TYPE_NVARCHAR`, `DB_TYPE_RAW`;
- `getVariableOutMaxSize` (`:461`) — размер по умолчанию для OUT переменной длины.

Расширяя скалярный список, разберись, какие из добавленных типов в режиме `OUT`/`IN/OUT` требуют `maxSize`, и покрой это тестом. Если для какого-то типа корректная поддержка неочевидна — **не добавляй его молча**: оставь вне списка и зафиксируй причину в JSDoc над `typeMapping`.

**Acceptance:**

- `IN`-аргументы типов `CHAR`, `NCHAR`, `NVARCHAR2`, `BOOLEAN`, `PLS_INTEGER`, `BINARY_FLOAT` больше не падают на `Invalid data type`.
- Для добавленных типов в режиме `OUT` проставляется корректный `maxSize` там, где он нужен.
- Действительно неподдерживаемый тип по-прежнему даёт внятную ошибку `Invalid data type: <TYPE>`.
- Тест фиксирует **полный** список поддерживаемых скалярных типов — чтобы отличать намеренное ограничение от регрессии (сейчас `grep "Invalid data type"` по `test/` даёт 0 совпадений).

---

## Волна 2 — P1 по структуре

### Task 4: Схлопнуть семь ручных перечислений сериализаторов

**Отчёт:** P1 · 11

**Files:**

- Modify: `src/adapters/abstract/database-serializer.ts` (354 строки)
- Test: `test/adapters/database-serializer-exhaustiveness.test.ts` (создать)

**Проблема.** Десятичленный `TSerializerType` перечислен вручную семь раз. Эксперимент во время ревизии (добавление 11-го типа `INTERVAL` + `tsc`) показал: `noImplicitReturns` ловит только `serializeValue` (:57) и `hasSerializer` (:158). Три перечисления компилируются молча — `serializerMapping` (:138), `deleteAllSerializers` (:252-261), `registeredSerializerTypes` (:264-277). Новый тип не попадёт в публичный `serializerMapping`, не будет сброшен `deleteAllSerializers()`, не появится в списке зарегистрированных.

**Решение.** Единственный источник правды:

```ts
export const SERIALIZER_TYPES = [
  'DATE',
  'TIMESTAMP',
  'TIMESTAMP_TZ',
  'TIMESTAMP_LTZ',
  'BOOLEAN',
  'CHAR',
  'VARCHAR',
  'JSON',
  'BINARY',
  'XML',
] as const satisfies ReadonlyArray<TSerializerType>;
```

`satisfies` даёт проверку «каждый элемент — валидный тип», но **не** даёт «перечислены все». Добавь тест, который это закрывает: сверка длины/множества `SERIALIZER_TYPES` с ключами объекта-свидетеля `Record<TSerializerType, true>`. Тогда 11-й тип сломает сборку или тест, а не уедет молча.

Прототип, проверенный при ревизии, типизируется чисто и даёт 354 → ~228 строк. Один локальный каст неизбежен — присваивание в mapped type внутри `registerSerializer`; изолируй его в одну строку с поясняющим комментарием.

**Acceptance:**

- `serializeValue`, `serializerMapping`, `hasSerializer`, `registerSerializer`, `unregisterSerializer`, `deleteAllSerializers`, `registeredSerializerTypes` больше не перечисляют типы вручную.
- Добавление 11-го значения в `TSerializerType` ломает сборку или тест.
- Поведение всех семи членов идентично прежнему (существующие тесты сериализаторов зелёные).

---

### Task 5: Удалить мёртвый код и сузить публичный экспорт утилит

**Отчёт:** P1 · 13, P1 · 14 (частично)

**Files:**

- Delete: `src/utils/async-utils.ts`, `src/utils/type-guards.ts`, `src/utils/queue-manager.ts`, `src/utils/event-bus.ts`
- Delete: соответствующие тест-файлы в `test/utils/`
- Modify: `src/utils/index.ts`, `src/interfaces/index.ts`, `src/types/index.ts`, `src/types/utility.types.ts`, `src/interfaces/utility.interfaces.ts` (убрать `IEventBusService`, `TEventBusListener` и прочие осиротевшие типы)

**Обоснование.** Проверено grep'ом по всему `src/`: `AsyncUtils` — 0 использований, `TypeGuards` — 0, `QueueManager` — 0, `EventBusService` — только из `QueueManager`. Это замкнутый остров на 601 строку, экспортированный наружу и не упомянутый в README ни разу.

**Важно.** `TypeGuards.isPlainObject` удаляется вместе с модулем. Его роль «канонической реализации» в волне 3 берёт новый узкий хелпер (Task 7) — с семантикой прототипа, а не чёрного списка. Не пытайся сохранить `TypeGuards` ради этого.

**Acceptance:**

- Четыре модуля и их тесты удалены.
- `npx tsc --noEmit -p tsconfig.json` чистый (нет осиротевших импортов/типов).
- `src/utils/index.ts` не экспортирует удалённое.
- `safeStringify`, `StringUtilities`, `DatabaseNamingCache`, `SqlIdentifier`, `DateFormatter`, `DatabaseOptionsExecutor` **остаются** — они используются.

---

## Волна 3 — P2 дедупликация

### Task 6: Поднять общий скелет адаптеров в базовый класс

**Отчёт:** P2 · 20

**Files:**

- Modify: `src/adapters/abstract/database-adapter.ts`, `src/adapters/oracle/oracle-adapter.ts`, `src/adapters/postgres/postgre-adapter.ts`
- Create: `src/consts/procedure.consts.ts` (для сентинела)
- Test: `test/adapters/adapter-shared-skeleton.test.ts` (создать)

**Что дублируется:**

- `replacePackageNamePlaceholder` — **побайтово идентичен** в обоих адаптерах (`oracle-adapter.ts:342`, `postgre-adapter.ts:143`).
- `NO_ARGUMENT_SENTINEL = '__tpk_no_argument__'` — одинаковая приватная статика в обоих.
- `generatePackageInfoSql` — один скелет: валидация идентификатора → подстановка → пять строк расчёта `detectionLimit` → дописать лимит. Различия: регистр (`toUpperCase` vs `toLowerCase`) и синтаксис лимита (`FETCH FIRST n ROWS ONLY` / обёртка `ROWNUM` для legacy vs `LIMIT n`).

**Решение.** `replacePackageNamePlaceholder` и расчёт `detectionLimit` — в `DatabaseAdapter`. `generatePackageInfoSql` — Template Method: база делает общее, вендор реализует два хука (нормализация имени пакета и применение лимита к запросу). Сентинел — в общие константы.

**Осторожно.** Oracle-ветка выбирает между `SQL_GET_PACKAGE_INFO` и `SQL_GET_PACKAGE_INFO_LEGACY` по версии БД и применяет разную форму лимита. Это остаётся в Oracle-хуке.

**Acceptance:** дублей нет, поведение обоих `generatePackageInfoSql` побайтово прежнее (зафиксируй тестом на точную строку SQL до и после для обоих вендоров).

---

### Task 7: Одна реализация «это plain object?»

**Отчёт:** P2 · 18

**Files:**

- Create: `src/utils/plain-object.ts`
- Modify: `src/adapters/abstract/database-serializer.ts` (`isPlainRecord`, :339), `src/adapters/oracle/oracle-bindings.ts` (`isPlainObject`, :453), `src/adapters/postgres/postgre-bindings.ts` (`isPlainObject`, :267)
- Test: `test/utils/plain-object.test.ts` (создать)

**Проблема.** Четыре реализации с тремя разными семантиками решают, трактовать ли payload процедуры как объект полей или как скаляр. Oracle и PostgreSQL отвечают по-разному — это того же рода расхождение, что и подтверждённые P1 · 01–03.

| Где                                          | Семантика                                     |
| -------------------------------------------- | --------------------------------------------- |
| `TypeGuards.isPlainObject` (удалён в Task 5) | чёрный список — **экземпляр класса проходит** |
| `DatabaseSerializer.isPlainRecord`           | прототип, без явного отсева массивов          |
| `OracleProcedureBindings.isPlainObject`      | прототип + явный `Array.isArray`              |
| `PostgreProcedureBindings.isPlainObject`     | только прототип, без защиты от `null`         |

**Канонический контракт** — прототипный: `true` только для объектов с прототипом `Object.prototype` или `null`. `false` для `null`, массивов, `Date`, `Buffer`, экземпляров классов, `Map`/`Set`. Это самая строгая из трёх и единственная, при которой Oracle и PG совпадают.

**Acceptance:** одна экспортируемая функция, три места вызова, тест фиксирует контракт по всем перечисленным случаям. Существующие тесты биндингов зелёные.

---

### Task 8: Хореография закрытия подписки — в базовый класс

**Отчёт:** P2 · 21

**Files:**

- Modify: `src/adapters/abstract/database-notify.ts`, `src/adapters/oracle/oracle-notify.ts` (`closeSubscription`/`performCloseSubscription`), `src/adapters/postgres/postgre-notify.ts` (`closeListenerConnection`/`performCloseListenerConnection`)
- Test: `test/adapters/notify-close-lifecycle.test.ts` (создать)

**Один алгоритм, две разошедшиеся реализации:** достать соединение из пула → удалить → health-check с таймаутом `500` → вендорная отписка → лог → `catch` с логом → `finally` с закрытием.

**Расхождения, которые надо устранить:**

- Oracle вызывает `stopConnectionHealthCheck` **до** дренажа коллбэков, Postgres — **после**.
- Oracle обрабатывает `shouldCancelRestore` и вызывает `clearNotificationRestoreState`; в Postgres такого параметра нет вообще.
- Литерал `500` вписан в оба файла — единственный таймаут подсистемы без имени, тогда как остальные вынесены в статические поля `DatabaseNotify`.

**Решение.** Базовый класс владеет порядком операций и константой таймаута; вендор реализует один хук — собственно отписку (`connection.unsubscribe(channel)` для Oracle, `UNLISTEN "channel"` для PG). Зафиксируй порядок тестом базового класса.

**Acceptance:** оба вендора идут по одному порядку, `500` получает имя, тест проверяет последовательность вызовов, существующие тесты notify зелёные.

---

### Task 9: Общий каркас в `ExecuteBase`

**Отчёт:** P2 · 25

**Files:**

- Modify: `src/core/execute-base.ts`
- Test: существующие `test/core/` (новый файл не нужен, изменение чисто внутреннее)

**Проблема.** `execute` и `executeProcedure` повторяют каркас: разбор `executionOptions` → `QueryTimer` → `getEntityManager` → `try/catch/finally` с обёрткой ошибки и освобождением соединения. Различаются двумя строками: какой метод адаптера вызвать и что скормить `checkForDatabaseError`.

**Решение.** Один приватный `runWithConnection(...)`, два тонких публичных метода поверх. Публичные сигнатуры не менять.

**Попутно** (P3 · 10): `queryTimer.success(result.length)` на строке 73 вызывает `.length` на значении типа `Awaited<Array<T> | T>` — для non-SELECT в лог уходит `undefined`. Почини вместе с рефакторингом.

**Acceptance:** публичное поведение неизменно, `AggregateError` при одновременном падении операции и release сохраняется, существующие тесты `core` зелёные.

---

### Task 10: Тройной дубль обхода типов в счётчике ресурсов

**Отчёт:** P2 · 19

**Files:**

- Modify: `src/adapters/abstract/procedure-resource-tracker.ts`
- Test: `test/adapters/procedure-resource-tracker.test.ts` (существует — дополнить, файл ничей больше)

**Проблема.** Диспетчер «сколько байт занимает значение» (string / number / boolean / bigint / Buffer / Date) повторён три раза: быстрый путь `measureRow` (~:86-110), начало `measureValue` (:130-136), цикл обхода графа в `measureValue` (:151-175). Три копии обязаны оставаться побайтово одинаковыми, иначе `maxProcedureBytes` срабатывает неконсистентно в зависимости от наличия вложенного объекта.

**Решение.** Один приватный скалярный диспетчер, три места вызова. **Кэш формы строки (`rowShape`) в `measureRow` сохранить** — дублировался диспетчер, а не оптимизация.

**Acceptance:** одна реализация диспетчера; тест проверяет, что быстрый путь и fallback дают одинаковый результат на одном и том же объекте (в том числе с вложенностью, которая переключает пути).

---

## Волна 4 — крупные извлечения (строго последовательно)

### Task 11: Выделить `ProcedureMetadataDecoder`

**Отчёт:** P2 · 15. `src/core/procedure-list-base.ts:334-590` — 257 строк из 622 (41%) это декодер, живущий внутри оркестратора загрузки/ретраев. Внутри него ещё и четыре реализации «прочитай непустую строку» (локальные `readString`/`readOptionalString` на :344/:391 против методов на :536/:548) и тройное повторение разбора целого (`order`, `size`, `subprogramId`, :364-418).

Извлечь в `src/core/procedure-metadata-decoder.ts` с одним набором читателей. Публичный API `ProcedureListBase` не менять.

### Task 12: Выделить `OracleRecordMetadataParser`

**Отчёт:** P2 · 16. `src/adapters/oracle/oracle-adapter.ts` — 512 строк, из них ~230 разбор словаря Oracle (`prepareProcedureMetadataRows`, `createRecordMetadata`, `createRecordFieldMetadata`, `isRecordType`, `isCollectionType`, `readMetadataString`, `readMetadataInteger`). У Postgres та же задача — 25 строк, потому что решена в SQL.

Извлечь в `src/adapters/oracle/oracle-record-metadata-parser.ts`. Публичный API адаптера не менять.

---

## Волна 5 — оставшиеся P2/P3 (пересобрана 2026-09-21)

Исходная волна 5 строилась из одного источника — отчёта ревизии. За четыре раунда ревью
накопились находки, которых план не знал, а часть его пунктов успели закрыться в волнах 1–4.
Аудит плана (агент-ревьюер, 2026-09-21) восстановил полный список; все загруженные ниже
утверждения перепроверены оркестратором независимо.

**Правило владения:** у каждой задачи эксклюзивный набор файлов `src/` и тестов.
`README.md` и три перевода не принадлежат **никому, кроме T26**: задача, которой нужна правка
документации, возвращает текст оркестратору, а не пишет в файл. Это главный источник коллизий.

| ID       | Закрывает                                                                                                                                                                                                                                         | Файлы `src/` (эксклюзивно)                                                                                                                                                                                         | Тесты                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **T13**  | P2 · 04 + R2 (скалярные OUT только temporal), R4 (`getResultSetMetadata` молча отдаёт `[]` и обходит guard), R5 (LOB внутри строк курсора не регистрируются), R7 (двойное преобразование регистра), двойная сериализация temporal-колонок курсора | `adapters/oracle/oracle-result-materializer.ts`                                                                                                                                                                    | `oracle-cursor-column-collision.test.ts`, новый `oracle-scalar-out-serializers.test.ts`                                                   |
| **T14**  | P2 · 05, опечатка/нижний регистр плейсхолдера (`4c31ea6`), остаток P2 · 20, инвариант `:PACKAGE_NAME` в `generatePackageInfoSql`                                                                                                                  | `adapters/abstract/database-adapter.ts`, `adapters/oracle/oracle-adapter.ts`, `adapters/postgres/postgre-adapter.ts`                                                                                               | `oracle-raw-sql-bindings.test.ts`, `adapter-shared-skeleton.test.ts`, новый `postgre-raw-sql-bindings.test.ts`                            |
| **T15**  | P2 · 06, P3 · 10h (`QueryTimer` пишет «started» до получения соединения), `key in` → `Object.hasOwn`                                                                                                                                              | `utils/database-error-handler.ts`, `utils/query-timer.ts`, `core/execute-base.ts`, `types/config.types.ts`, `interfaces/config.interfaces.ts`                                                                      | `database-error-handler.test.ts`, `query-timer.test.ts`, `execute-base.test.ts`                                                           |
| **T16**  | P2 · 08, R6 (`waitForShutdownTask` не отличает отказ от успеха)                                                                                                                                                                                   | `adapters/abstract/database-notify.ts`                                                                                                                                                                             | `database-notify.test.ts`, `database-notify-shutdown-containers.test.ts`                                                                  |
| **T17a** | P2 · 09, P3 · 10f (`??` съедает явный `null`), P3 · 10a (сдвиг индекса связываний в логе — обход редактирования по имени), R3 (потеря точности на алиасах NUMBER), `readPayloadValue` по цепочке прототипов                                       | `adapters/oracle/oracle-bindings.ts`, `adapters/postgres/postgre-bindings.ts`, `utils/query-log-context-builder.ts`                                                                                                | `oracle-record-bindings.test.ts`, `postgre-adapter.test.ts`, новый `query-log-context-builder.test.ts`                                    |
| **T17b** | **P2 · 17** — `build()` на 229 строк с девятью аккумуляторами (в плане не было)                                                                                                                                                                   | `adapters/oracle/oracle-bindings.ts`, новый `adapters/oracle/oracle-anonymous-block-builder.ts`                                                                                                                    | `oracle-record-bindings.test.ts`                                                                                                          |
| **T18**  | P2 · 22, **P2 · 07** (контракт payload'а PG; асимметрия `ACTION='REPLACE'`; PG молча глотает битый payload), P3 · 10b (осиротевшая подписка при восстановлении), P3 · 10i (утечка соединения в `subscribe`)                                       | `core/notify-base.ts`, `adapters/oracle/oracle-notify.ts`, `adapters/postgres/postgre-notify.ts`, `types/notification.types.ts`, `interfaces/notification.interfaces.ts`, `interfaces/oracle-notify.interfaces.ts` | `notify-base.test.ts`, `oracle-notify.test.ts`, `postgre-notify.test.ts`                                                                  |
| **T19**  | P2 · 23, P3 · 30, R8 (`setSerializer` пропускает `toString`/`constructor` через прототип), **R1** (PG молча схлопывает одноимённые колонки — зеркало `778427e`)                                                                                   | `core/serializer-base.ts`, `adapters/abstract/database-serializer.ts`, `adapters/oracle/oracle-serializer.ts`, `adapters/postgres/postgre-serializer.ts`                                                           | `serializer-base.test.ts`, `serializers.test.ts`, `database-serializer-exhaustiveness.test.ts`, новый `postgre-duplicate-columns.test.ts` |
| **T20**  | P2 · 24, опечатка `settingsLoger`                                                                                                                                                                                                                 | `src/nest/**`                                                                                                                                                                                                      | `test/nest/*`                                                                                                                             |
| **T21**  | P3 · 27 (`serialzierBase`, `generaion`, `shuwtdown.consts.ts`), P3 · 31 (пять `requireXxxBase`, `ENSURE_SERVER_ERROR`, `unsafeGetContextAs`, luxon→`Date` в `server-error.ts`, закомментированный код), P3 · 10c                                  | `core/index.ts`, `utils/typeorm-helpers.ts`, `utils/server-error.ts`, `consts/shuwtdown.consts.ts`→`shutdown.consts.ts`, `consts/index.ts`                                                                         | `typeorm-procedure-kit.test.ts`, `server-error.test.ts`                                                                                   |
| **T22**  | **P1 · 12** — `databaseAdapterFactory` без ветки `default:` (в плане не было)                                                                                                                                                                     | `core/database-initializer-base.ts`                                                                                                                                                                                | `database-initializer-base.test.ts`                                                                                                       |
| **T23**  | P3 · 10g — `resolveResourceLimits` падает на явном `undefined`; у модуля вообще нет тестов                                                                                                                                                        | `utils/resource-limits.ts`                                                                                                                                                                                         | новый `resource-limits.test.ts`                                                                                                           |
| **T24**  | Хвост `1e05222`: литерал sentinel захардкожен в SQL-шаблонах в другом регистре, чем константа                                                                                                                                                     | `adapters/oracle/oracle-sql.ts`, `adapters/postgres/postgre-sql.ts`, `consts/procedure.consts.ts`                                                                                                                  | `adapter-shared-skeleton.test.ts` (после T14)                                                                                             |
| **T25**  | P3 · 28, грамматика логов, два побайтно одинаковых текста ошибки на разных guard'ах                                                                                                                                                               | `core/procedure-list-base.ts`                                                                                                                                                                                      | `procedure-list-base.test.ts`                                                                                                             |
| **T26**  | Все обязательства по документации из T13–T19, пропущенная нота в `d6bac74`, порядок `CHANGELOG.md`, `CLAUDE.md`                                                                                                                                   | —                                                                                                                                                                                                                  | —                                                                                                                                         |
| **T27**  | P3 · 31 (`isMapRecord` пропускает `null`, `getPropertyPathsMap`/`getPropertyMap`)                                                                                                                                                                 | `typeorm-extend/repository/abstract-typeorm-repository.ts`                                                                                                                                                         | `abstract-typeorm-repository.test.ts`                                                                                                     |
| **T28**  | Гейт версии Oracle RECORD: анонимный thunk → именованный интерфейс; мемоизация (сейчас читает `driver.version` на каждую строку RECORD)                                                                                                           | `adapters/oracle/oracle-record-metadata-parser.ts`                                                                                                                                                                 | `oracle-record-metadata.test.ts`                                                                                                          |

### Конфликты и порядок запуска

Жёсткие, никогда не в одной партии:

1. **T17a → T17b** — один файл `oracle-bindings.ts`. Сначала поведение, потом извлечение,
   иначе паритет придётся выводить заново после каждой правки поведения.
2. **T14 → T24** — общий `adapter-shared-skeleton.test.ts` с шестью побайтными отпечатками SQL.
   T24 меняет шаблоны, то есть меняет отпечатки; обновление отпечатков принадлежит T24.
3. **T20 ⊥ T21** — опечатка `settingsLoger` отдана T20; T21 не открывает ни одного файла в `src/nest/`.
4. **T15 ⊥ T21** — `query-timer.ts` целиком у T15, включая снятие luxon. У T21 luxon только в `server-error.ts`.

Мягкий: **T13 ⊥ T19** — R7 чинится либо в материализаторе, либо в `oracle-serializer.ts`.
Второй файл принадлежит T19, поэтому T13 берёт правку на своей стороне; если сочтёт верной
правку в сериализаторе — возвращает решение оркестратору, а не правит.

| Партия | Агенты                       | Почему так                                                                                                                                                                                                                                                       |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | T13 · T15 · T16 · T20 · T22  | Поведенческие правки без переименований. T15 фиксирует, чем является конверт ошибки, до того как T14 меняет поведение при отсутствующем параметре; T16 фиксирует семантику выключения notify до того, как T18 двигает вендорную логику внутри той же подсистемы. |
| 2      | T14 · T17a · T18 · T19       | Четыре задачи про паритет вендоров, разрезанные по слоям: адаптеры / связывания / notify / сериализаторы.                                                                                                                                                        |
| 3      | T17b · T21 · T23 · T25 · T28 | Структура и косметика поверх устоявшегося поведения. T17b проверяется дифференциально — по методу T11/T12.                                                                                                                                                       |
| 4      | T27 · T24                    | T24 только после T14 из-за отпечатков.                                                                                                                                                                                                                           |
| 5      | T26                          | Одна задача, вся документация.                                                                                                                                                                                                                                   |
| 6      | Волна 6                      | Ревью + полный `npm run check` **и** `check:dist`/`check:runtime`: T22 и T24 меняют поведение на этапе загрузки, а межволновой прогон этого не покрывает.                                                                                                        |

R1 и R2 намеренно разведены по разным задачам: они в разных файлах и тянут в противоположные
стороны — R1 делает PostgreSQL строже по образцу Oracle, R2 делает Oracle богаче по образцу
PostgreSQL. Объединять их в один коммит нельзя, общая история у них появляется только в
описании волны 6.

### Закрыто в волнах 1–4 — не переделывать

- `src/consts/procedure.consts.ts` (Task 6, `1e05222`) — файл создан, константа экспортирована;
- rider P3 · 10 про `.length` (`104a6b6`);
- P3 · 10e — комментарий про backoff уехал вместе с удалённым `async-utils` (`e60910f`);
- пробелы в тестах 1–3 из десяти — закрыты; остальные семь разнесены по T13–T18.

### Отклонено

- Проверка rowset-guard на oracledb 6.x: цена — постоянное измерение в матрице CI,
  выигрыш — уточнение в docstring. `778427e` уже сделал деградацию безопасной.
- `afterEach` в тесте кэша ключей: `beforeEach` там уже есть, пул `forks` с `isolate: true`
  даёт файлу отдельный процесс, промах кэша возвращает то же число. Нечего чинить.
- Снятие `dotenv`/`app-root-path` из зависимостей: требует правки вендорного форка
  (по CLAUDE.md — обслуживание форка с обновлением `docs/TYPEORM_FORK.md`) либо оставляет
  потребителю голый `MODULE_NOT_FOUND`. Две зависимости этого не стоят.
- P2 · 26 (тройная косвенность `interfaces/` → `types/`): правка ~20 файлов, конфликтующая
  с импортами типов во всех остальных задачах, при нулевом наблюдаемом эффекте.

---

## Волна 6 — ревью изменений

Отдельный проход по всему диффу ветки относительно `master`:

- `pr-review-toolkit:code-reviewer` — соответствие правилам репозитория и CLAUDE.md;
- `pr-review-toolkit:silent-failure-hunter` — проглоченные ошибки и неверные fallback'и (особенно актуально: T14/T15 меняют поведение при ошибках);
- `pr-review-toolkit:pr-test-analyzer` — достаточность тестов, прицельно по десяти пробелам из отчёта.

Финальная проверка оркестратора: `npm run check` целиком плюс `check:dist` и `check:runtime`.

---

## Волна 7 — переименования по всему дереву (НЕ запускать без подтверждения владельца)

Исходное основание волны — «требуют мажорной версии, пакет опубликован как v2.3.1» — больше
не работает: v3.0.0 протегирован, `package.json` уже `3.0.0`, а шесть коммитов ветки помечены
как ломающие. Ветка в любом случае становится v4, и по признаку «ломает ли» волна 7 больше
ничего не отделяет: ломающими являются и T13, и T14, и T15, и T16, и T17a, и T19, и T21.

Новое основание — механическое: **переименование символа по всему дереву обесценивает файлы
всех агентов, которые в этот момент в работе.** Поэтому — в одиночку и последними.

- **P1 · 14 полностью** — заменить `export * from './utils/index.js'` в `src/index.ts` явным
  списком. Сейчас наружу уезжают `DatabaseNamingCache`, `QueryTimer`, `TypeOrmHelpers`,
  `DatabaseOptionsExecutor`, `QueryLogContextStorage`, `StringUtilities`.
- **P3 · 27** — `TOracleNormilizeOptionsNotify` → `TOracleNormalizeOptionsNotify`.
- Переименование классов `Postgre*` → `Postgres*` для согласия с форком и значением конфига.

---

## Приложение A — ход волны 5 (на 2026-09-24)

| Задача | Коммит               | Состояние                                                                         |
| ------ | -------------------- | --------------------------------------------------------------------------------- |
| T16    | `cacfbda`            | готово                                                                            |
| T22    | `2c9bd21`            | готово                                                                            |
| T15    | `c1d4a33`            | готово; агент погиб до отчёта, текста для README нет — T26 формулирует по коммиту |
| T20    | `ac29534`, `c925e02` | готово                                                                            |
| T13    | `1de2c2c`            | готово                                                                            |
| T17a   | `710390e`            | готово; решение владельца по унаследованным ключам — отдельная задача T17c        |
| T18    | `80b665d`            | пункты 2–4 и конверт готовы; пункт 1 (P2 · 22) заблокирован → T18b                |
| T19    | `67f641d`            | готово; удаление `SerializerBase` передано в T21                                  |

## Приложение B — решения владельца

1. **Ключ payload'а, найденный только на прототипе** (2026-09-23): отказывать громко. Читаются
   собственные свойства; если ключ аргумента найден на прототипе, отличном от `Object.prototype`
   (геттер класса-DTO), — `ServerError` с именем ключа. Ключи `Object.prototype` игнорируются, как
   сейчас. Задача T17c.
2. **Точность Oracle `NUMBER`** (2026-09-23): поведение не менять, задокументировать (текст ниже).
3. **Атрибуция в git и PR** (2026-09-23): строки об авторстве инструментов не добавляются ни в коммиты, ни в описания PR. История ветки
   переписана 2026-09-24, ссылки на хэши в телах коммитов и в этом плане переназначены.

## Приложение C — новые задачи и передачи

| ID       | Суть                                                                                                                                                                                                                                                                                                                                                                                                           | Файлы (эксклюзивно)                                                                                                                                                                                              | Порядок    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **T17c** | Решение B.1: громкий отказ для ключа с прототипа класса                                                                                                                                                                                                                                                                                                                                                        | `oracle-bindings.ts`, `postgre-bindings.ts`, `test/adapters/{oracle,postgre}-payload-reader.test.ts`                                                                                                             | до T17b    |
| **T18b** | P2 · 22: `readPackageChangeNotification(payload: unknown): Array<string>` в `IAdapterNotificationCapability` и `IDatabaseAdapterContract`, делегирование в `DatabaseAdapter`, мок в `test/support/helpers.ts`; затем форма payload'а уходит из `NotifyBase` в вендорные notifier'ы. Плюс: на Oracle ошибка колбэка прерывает оставшиеся чанки события и логируется дважды, PostgreSQL изолирует каждый payload | `database-adapter.ts`, `interfaces/adapter-capabilities.interfaces.ts`, `interfaces/adapter.interfaces.ts`, `test/support/helpers.ts`, `core/notify-base.ts`, `oracle-notify.ts`, `postgre-notify.ts` + их тесты | после T14  |
| **T29**  | Булевы параметры `closeNotificationSubscription(name, false, false)`; `(error as Error)` без проверки (семь мест в `database-notify.ts`, плюс `database-options-executor.ts`, `database-initializer-base.ts`); русская строка лога в `database-options-executor.ts:64`                                                                                                                                         | `adapters/abstract/database-notify.ts`, `utils/database-options-executor.ts`, `core/database-initializer-base.ts`                                                                                                | после T18b |

Дополнения к существующим задачам:

- **T21** += удалить `SerializerBase` целиком. В `core/index.ts` — импорт, поле, пункт в JSDoc,
  создание, `requireSerializerBase()`, сброс в `cleanupResources`; четыре места вызова
  (`setSerializer`, `deleteSerializer`, `deleteAllSerializers`, `serializerReadOnlyMapping`) — на
  адаптер под guard, сохраняющий сообщение `TypeOrmProcedureKit is not initialized` до `init()`.
  Удалить `src/core/serializer-base.ts` и его тест; тест снапшота реестра — на уровень фасада.
  JSDoc `setSerializer`/`deleteSerializer` — добавить `@throws` для не-функции и неизвестного типа.
  Опечатку `serialzierBase` не переименовывать, а удалить вместе с полем.
- **T14** += JSDoc `database-adapter.ts` (~:330) «Current mutable serializer registry» →
  «Immutable snapshot of the serializer registry in canonical order; the same object until the
  registry changes».
- **T24** += `oracle-sql.ts`: запрос CQN по умолчанию следит только за `ACTION='REPLACE'`, поэтому
  DROP пакета на Oracle метаданные не обновляет, а на PostgreSQL обновляет. Решить: расширить до
  `ACTION IN (...)` или оставить (README-текст T18 ниже уже описывает текущее поведение).

## Приложение D — открытый вопрос к владельцу

Пример README `db.call('billing.create_invoice', { customerId: 42, … })` связывается, только если
аргумент называется ровно `customerid` или `p_customerid`: имена аргументов приводятся к нижнему
регистру и на входе не проходят case strategy, так что `p_customer_id` молча получит `NULL`. Ключ
payload'а, не совпавший ни с одним аргументом, сейчас просто игнорируется. Отвергать неизвестные
ключи верхнего уровня (как уже отвергаются неизвестные поля RECORD) — решение владельца, не агента.

## Приложение E — тексты для README (применяет только T26)

Английский — для `README.md`; переводы в `docs/README.{ru,de,zh}.md` T26 делает сам, кроме T16,
где агент дал все четыре.

**T16** — заменить по одному предложению в каждом языке:

- `README.md` (~:610) «Notification retry delays must be integers in `0..2_147_483_647` milliseconds.» →
  «Notification retry delays (`retryDelayMs` and `retryAfterMaxDelayMs`) must be integers in `100..2_147_483_647` milliseconds; a smaller value is rejected with a `RangeError` when the subscription is registered, because the restore loop restarts its attempt counter and would otherwise reconnect to a failing database with no pause.»
- `docs/README.ru.md` (~:605) «Retry delays уведомлений принимают целые миллисекунды `0..2_147_483_647`.» →
  «Retry delays уведомлений (`retryDelayMs` и `retryAfterMaxDelayMs`) принимают целые миллисекунды `100..2_147_483_647`; меньшее значение отклоняется с `RangeError` при регистрации подписки, потому что цикл восстановления сбрасывает счётчик попыток и иначе переподключался бы к недоступной базе без паузы.»
- `docs/README.de.md` (~:588) «Retry delays erlauben ganze Millisekunden in `0..2_147_483_647`.» →
  «Retry delays (`retryDelayMs` und `retryAfterMaxDelayMs`) erlauben ganze Millisekunden in `100..2_147_483_647`; ein kleinerer Wert wird bei der Registrierung der Subscription mit einem `RangeError` abgelehnt, da die Restore-Schleife ihren Versuchszaehler zurueksetzt und sonst ohne Pause zu einer ausgefallenen Datenbank neu verbinden wuerde.»
- `docs/README.zh.md` (~:550) «通知重试延迟仅接受 `0..2_147_483_647` 范围的整数毫秒。» →
  «通知重试延迟（`retryDelayMs` 和 `retryAfterMaxDelayMs`）仅接受 `100..2_147_483_647` 范围的整数毫秒；更小的值会在注册订阅时抛出 `RangeError`，因为恢复循环会重置重试计数器，否则将不间断地向已故障的数据库发起重连。»

**T15** — агент не вернул текст. Описать по `c1d4a33`: `executionOptions.errorEnvelopeKeys`
(`errorCodeKeys`, `errorTextKeys`; пустой массив отключает половину проверки); конверт в первой
строке теперь распознаётся при любом числе строк.

**T13:**

1. On Oracle, every registered serializer runs on scalar OUT and IN/OUT bind values, not only the temporal ones: a `BOOLEAN`, `CHAR`, `NCHAR`, `VARCHAR`, `VARCHAR2`, `NVARCHAR2`, `JSON`, `RAW` or `XMLTYPE` argument reaches the strategy under `source: 'scalar-out'`, exactly as the identically typed field of a PL/SQL RECORD already did.
2. Oracle REF CURSOR columns are named and serialized by the fetch handler alone, so the case strategy and the registered serializer each run exactly once per column: a cursor column is named exactly as the same column of a plain query, and a strategy is never handed back a value it produced itself.
3. When Oracle returns a cursor without a usable column description, its rows are passed through as the driver produced them and a warning naming the cursor is logged, instead of degrading in silence.
4. LOB handles that arrive inside REF CURSOR rows are released with the rest of the call's resources, so a row that fails part-way through no longer leaves undrained handles open until the connection returns to the pool.

**T17a** — после «Scalar strings and numbers are rejected at runtime.». Предложение про прототип
заменить по итогам T17c (решение B.1: ключ с прототипа класса — ошибка, а не `NULL`):

> An object payload is matched to procedure arguments by name: each argument reads the key equal to its lowercase argument name (`p_amount`) or the same name without a leading `p_` (`amount`). Supplying both keys for one argument is rejected on both databases, for scalar, cursor, and structured arguments alike. A key set to `null` counts as supplied and binds SQL `NULL`; a key set to `undefined` counts as absent, so spreading an object with unset optional properties does not cause a conflict. Only the payload's own properties are read: values inherited from a prototype, including class getters, are ignored and the argument binds `NULL`. An array payload binds its elements by argument position; a missing, `null`, or `undefined` element binds `NULL`.

**T17a, решение B.2** — в раздел Oracle:

> Oracle `NUMBER` values, including its `INTEGER`, `DECIMAL`, `NUMERIC`, `FLOAT`, `REAL`, and `DOUBLE PRECISION` subtypes, arrive as JavaScript numbers in scalar `OUT`/`INOUT` values, `RECORD` fields, and REF CURSOR rows; integers beyond `Number.MAX_SAFE_INTEGER` and values with more than 15 significant digits are rounded. Return such values as `VARCHAR2` (for example with `TO_CHAR`) when exact digits matter, and pass exact integer inputs as `bigint`.

**T18:**

- В **PostgreSQL LISTEN/NOTIFY**: «Payloads are passed to the callback as data: a payload that looks like a procedure error envelope is not turned into an error.»
- В **Oracle Continuous Query Notification**: «Refetched rows are passed to the callback as data, even when their columns look like a procedure error envelope.»
- В **Dynamic package metadata refresh** — заменить два предложения, начинающиеся с «PostgreSQL listens on…»:

> Every notification that names a configured package refreshes that package's procedure metadata. The kit does not interpret an event name: which DDL produces a notification is decided in the database, by the CQN query on Oracle and by your trigger on PostgreSQL. A notification that names no package is logged as a warning and skipped; a package that is not in `packagesSettings.packages` is skipped silently. Field names are matched case-insensitively. The databases differ only in how the notification arrives: Oracle CQN delivers the changed rows of the watched query, PostgreSQL delivers one text payload per NOTIFY.
>
> PostgreSQL listens on `db_object_event` unless `listenEventName` is configured. Each NOTIFY payload must be one JSON object whose `object` field is the configured package (schema) name, for example `SELECT pg_notify('db_object_event', json_build_object('event', 'CREATE', 'object', 'billing')::text);`. Other fields, including `event`, are ignored, so `CREATE OR REPLACE`, `ALTER` and `DROP` all refresh as long as the trigger sends a notification for them. Send one for changes that can alter procedure signatures, such as creating, replacing, altering or dropping a procedure or a composite type in a configured schema. A payload that is not JSON, is not an object, or has no string `object` field is logged and skipped.
>
> Oracle subscribes with CQN to `SOLUTION_ROOT.DB_OBJECT_LOG` rows where `ACTION='REPLACE'` and `TYPE='PACKAGE'` for the configured packages, and reads the package name from each changed row's `NAME` column. The default query watches only `ACTION='REPLACE'`; to refresh on other actions such as a drop, set `metadataNotificationSql` to a query that selects them. A custom Oracle query must return a string `NAME` column; a row without one is logged and skipped.

**T19:**

- После «…both raise an error instead of overwriting data.»: «This applies to PostgreSQL and Oracle alike, and also when the query returns no rows.»
- После «Supported serializer keys are …»: «`setSerializer()` and `deleteSerializer()` throw for any other key (including names such as `toString` that exist only on `Object.prototype`), for a strategy that is not a function, and for an argument that is not an object. Deleting a supported key that has no registered strategy does nothing.»
- После примера `serializerReadOnlyMapping`: «`serializerReadOnlyMapping` is an immutable snapshot: `set`, `delete` and `clear` throw, it does not change after later registrations, and repeated reads return the same object until the registry changes.»
