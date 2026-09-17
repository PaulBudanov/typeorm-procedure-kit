# Review Findings Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить находки ревизии от 2026-09-14 по собственному коду `typeorm-procedure-kit`, начиная с трёх подтверждённых P1 по бизнес-логике и заканчивая структурной уборкой.

**Architecture:** Работа разбита на волны. Внутри волны задачи затрагивают непересекающиеся файлы и выполняются параллельными агентами; между волнами оркестратор централизованно прогоняет `typecheck + lint + test` и делает коммит. Ни один агент не запускает git и не трогает файлы за пределами своего списка.

**Tech Stack:** TypeScript 5 (strict), vitest, ESLint flat config, vendored TypeORM fork (вне периметра).

**Spec:** отчёт ревизии от 2026-09-14, опубликованный как артефакт
https://claude.ai/artifact/8FPaUPnoP68C8WT6V916ym — в репозиторий не коммитился.
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

| Волна | Задачи | Параллельно | Пересечение файлов |
| --- | --- | --- | --- |
| 1 | T1, T2, T3 | да, 3 агента | нет |
| 2 | T4, T5 | да, 2 агента | нет |
| 3 | T6, T7, T8, T9, T10 | да, 5 агентов | нет |
| 4 | T11, T12 | нет, строго по очереди | да (крупные извлечения) |
| 5 | T13–T21 | частично | проверяется перед запуском |
| 6 | Ревью изменений | — | — |
| 7 | Ломающие изменения | **только после подтверждения владельца** | — |

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
  'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ', 'TIMESTAMP_LTZ',
  'BOOLEAN', 'CHAR', 'VARCHAR', 'JSON', 'BINARY', 'XML',
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

| Где | Семантика |
| --- | --- |
| `TypeGuards.isPlainObject` (удалён в Task 5) | чёрный список — **экземпляр класса проходит** |
| `DatabaseSerializer.isPlainRecord` | прототип, без явного отсева массивов |
| `OracleProcedureBindings.isPlainObject` | прототип + явный `Array.isArray` |
| `PostgreProcedureBindings.isPlainObject` | только прототип, без защиты от `null` |

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

## Волна 5 — оставшиеся P2 и P3

Задачи определены, файлы известны; детализация — перед запуском волны.

| Task | Отчёт | Суть | Файлы |
| --- | --- | --- | --- |
| T13 | P2 · 04 | Скалярные OUT на Oracle пропускают все сериализаторы, не только temporal | `oracle-result-materializer.ts:344-359, 496-511` |
| T14 | P2 · 05 | Отсутствующий/опечатанный параметр raw SQL → ошибка вместо тихого NULL; плейсхолдер не в верхнем регистре → внятная ошибка | оба адаптера + README |
| T15 | P2 · 06 | Конверт ошибки при ≥2 строках; набор из 8 захардкоженных ключей — в конфиг | `database-error-handler.ts` |
| T16 | P2 · 08 | Нижняя граница для `retryDelayMs`/`retryAfterMaxDelayMs` (сейчас `0` даёт self-DoS вопреки JSDoc) | `database-notify.ts:309-338` + README |
| T17 | P2 · 09 | Паритет отказа при конфликте алиасов ключей payload'а | `oracle-bindings.ts:161-165, 348` |
| T18 | P2 · 22 | Вендорную нормализацию уведомления — из `NotifyBase` в адаптеры | `notify-base.ts:110-133` + оба notify |
| T19 | P2 · 23 | `SerializerBase`: убрать посредника либо дать ему валидацию | `serializer-base.ts` |
| T20 | P2 · 24 | Nest: общая сборка модуля + фабрика провайдеров | `src/nest/**` |
| T21 | P3 · 27–31 | Опечатки, недостижимые ветки, `luxon`→`Date`, глобальный `outFormat`, `Proxy` на каждый вызов, пять `requireXxxBase`, грамматика логов, `CLAUDE.md` | разное |

---

## Волна 6 — ревью изменений

Отдельный проход по всему диффу ветки относительно `master`:

- `pr-review-toolkit:code-reviewer` — соответствие правилам репозитория и CLAUDE.md;
- `pr-review-toolkit:silent-failure-hunter` — проглоченные ошибки и неверные fallback'и (особенно актуально: T14/T15 меняют поведение при ошибках);
- `pr-review-toolkit:pr-test-analyzer` — достаточность тестов, прицельно по десяти пробелам из отчёта.

Финальная проверка оркестратора: `npm run check` целиком.

---

## Волна 7 — ломающие изменения (НЕ запускать без подтверждения владельца)

Требуют мажорной версии. Вынесены отдельно намеренно: пакет опубликован как v2.3.1.

- **P1 · 14 полностью** — заменить `export * from './utils/index.js'` в `src/index.ts` явным списком. Сейчас наружу уезжают `DatabaseNamingCache`, `QueryTimer`, `TypeOrmHelpers`, `DatabaseOptionsExecutor`, `QueryLogContextStorage`, `StringUtilities` — 12 из 15 утилит не упомянуты в README.
- **P3 · 27** — переименование `TOracleNormilizeOptionsNotify` → `TOracleNormalizeOptionsNotify` (экспортируемый тип).
- **P2 · 26** — схлопнуть тройную косвенность `interfaces/` → `types/` → `types/index` → `index`.
- Переименование классов `Postgre*` → `Postgres*` для согласия с форком и значением конфига.
