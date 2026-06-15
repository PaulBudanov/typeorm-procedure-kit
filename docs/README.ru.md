# typeorm-procedure-kit

Enterprise TypeORM toolkit для Oracle и PostgreSQL.

Строго типизированные репозитории, хранимые процедуры, наследование сущностей
для нескольких баз данных, orchestration raw SQL, database notifications,
serializers и расширенный встроенный TypeORM-compatible runtime.

<p align="center">
  <a href="https://www.npmjs.com/package/typeorm-procedure-kit"><img alt="npm version" src="https://img.shields.io/npm/v/typeorm-procedure-kit?color=cb3837&logo=npm"></a>
  <a href="https://www.npmjs.com/package/typeorm-procedure-kit"><img alt="npm downloads" src="https://img.shields.io/npm/dm/typeorm-procedure-kit?color=2f9e44&logo=npm"></a>
  <a href="https://www.npmjs.com/package/typeorm-procedure-kit"><img alt="types included" src="https://img.shields.io/npm/types/typeorm-procedure-kit?color=3178c6&logo=typescript"></a>
  <a href="https://www.npmjs.com/package/typeorm-procedure-kit"><img alt="node version" src="https://img.shields.io/node/v/typeorm-procedure-kit?color=339933&logo=node.js"></a>
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/LICENSE.md"><img alt="license" src="https://img.shields.io/npm/l/typeorm-procedure-kit?color=0ea5e9"></a>
</p>

<p align="center">
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/tests.yml"><img alt="tests" src="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/tests.yml/badge.svg"></a>
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/security.yml"><img alt="security" src="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/security.yml/badge.svg"></a>
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/release.yml"><img alt="release" src="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/release.yml/badge.svg"></a>
  <a href="https://github.com/semantic-release/semantic-release"><img alt="semantic-release" src="https://img.shields.io/badge/semantic--release-enabled-e10079?logo=semantic-release"></a>
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit"><img alt="last commit" src="https://img.shields.io/github/last-commit/PaulBudanov/typeorm-procedure-kit?color=64748b&logo=github"></a>
</p>

## Переводы

- [English](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.md)
- [Русский](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.ru.md)
- [Deutsch](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.de.md)
- [中文](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.zh.md)

---

## Зачем существует этот пакет

TypeORM хорошо подходит для CRUD-oriented приложений, но enterprise database
systems часто требуют возможностей вокруг stored procedures, package metadata,
dual deployments Oracle/PostgreSQL, notification-driven synchronization и
database-specific entity variants.

`typeorm-procedure-kit` сохраняет TypeORM-compatible developer experience и
добавляет:

- metadata-aware вызовы Oracle packages и PostgreSQL schema procedures;
- raw SQL execution через тот же transaction и error-handling flow;
- PostgreSQL `LISTEN/NOTIFY` и Oracle Continuous Query Notification;
- dynamic procedure metadata refresh после изменений database objects;
- общие naming/case rules для native rows и ORM column names;
- serializers для database result values;
- встроенный TypeORM-compatible API, сфокусированный на Oracle и PostgreSQL;
- entity extension decorators и repository helpers для database-specific entity
  targets.

## Сравнение с upstream TypeORM

| Возможность                          | TypeORM        | typeorm-procedure-kit |
| ------------------------------------ | -------------- | --------------------- |
| Метаданные stored procedures         | Частично/вручную | Встроено            |
| Enterprise support для Oracle + PostgreSQL | Ограничено | Сфокусированная поддержка |
| Строгая типизация repositories       | Частично       | Расширена             |
| Multi-database entity inheritance    | Нет            | Да                    |
| LISTEN/NOTIFY + Oracle CQN           | Нет            | Да                    |
| Runtime metadata refresh             | Нет            | Да                    |
| Database-specific repositories       | Вручную        | Встроено              |

## Требования

- Node.js `>=20`
- TypeScript с включенными decorators при использовании entity decorators
- PostgreSQL driver: `pg`
- Oracle driver: `oracledb`
- Optional PostgreSQL streaming dependency: `pg-query-stream`
- Optional NestJS peer dependencies: `@nestjs/common` и `@nestjs/core`

## Установка

```bash
npm install typeorm-procedure-kit
```

Установите driver для вашей базы данных:

```bash
npm install pg
npm install oracledb
```

Устанавливайте `pg-query-stream` только при использовании PostgreSQL streaming
API, например `SelectQueryBuilder.stream()` или `QueryRunner.stream()`.

```bash
npm install pg-query-stream
```

## Быстрый старт

Минимальный PostgreSQL пример инициализирует kit, вызывает одну настроенную
procedure и освобождает ресурсы:

```ts
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { IModuleConfig, ILoggerModule } from 'typeorm-procedure-kit';

const logger: ILoggerModule = {
  error: console.error,
  log: console.log,
  warn: console.warn,
};

const settings: IModuleConfig = {
  logger: { module: logger },
  config: {
    type: 'postgres',
    parseInt8AsBigInt: true,
    master: {
      host: 'localhost',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'app_db',
    },
    poolSize: 10,
    packagesSettings: {
      packages: ['billing'],
      procedureObjectList: {
        findInvoices: 'billing.find_invoices',
      },
    },
  },
};

const db = new TypeOrmProcedureKit(settings);

await db.initDatabase();

try {
  const invoices = await db.call<{ invoiceId: number }>(
    'billing.find_invoices',
    { customerId: 42 }
  );
  console.log(invoices);
} finally {
  await db.destroy();
}
```

## Точки импорта

```ts
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { IModuleConfig } from 'typeorm-procedure-kit';

import { TypeOrmProcedureKitNestModule } from 'typeorm-procedure-kit/nestjs';

import { Entity, Column, PrimaryColumn } from 'typeorm-procedure-kit/typeorm';

import {
  AbstractTypeormRepository,
  ExtendColumn,
  ExtendEntity,
  ExtendPrimaryColumn,
  ExtendPrimaryGeneratedColumn,
} from 'typeorm-procedure-kit/typeorm-extend';
```

| Import path                            | Для чего используется                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `typeorm-procedure-kit`                | `TypeOrmProcedureKit`, public types, constants, utilities                       |
| `typeorm-procedure-kit/nestjs`         | NestJS module, service, method injection decorators                             |
| `typeorm-procedure-kit/typeorm`        | Bundled TypeORM-compatible decorators, DataSource, repositories, query builders |
| `typeorm-procedure-kit/typeorm-extend` | Entity metadata extension decorators и database-specific repository helpers     |

Для сущностей, управляемых этим пакетом, импортируйте TypeORM APIs из
`typeorm-procedure-kit/typeorm`. Пакет включает TypeORM-compatible API, который
использует внутри.

## Миграция с TypeORM

Минимальный путь миграции:

Замените импорты:

```ts
// before
import { Entity, Column } from 'typeorm';

// after
import { Entity, Column } from 'typeorm-procedure-kit/typeorm';
```

Затем постепенно подключайте расширенные возможности:

- stored procedures;
- repository helpers;
- multi-database entity inheritance;
- notification infrastructure;
- serializer pipeline;
- database-specific repositories.

Пакет сохраняет TypeORM-compatible developer experience и расширяет runtime
Oracle/PostgreSQL-focused workflows и более строгой типизацией.

## Карта API

| Задача                                | API                                                |
| ------------------------------------- | -------------------------------------------------- |
| Инициализация доступа к базе          | `new TypeOrmProcedureKit(settings)`, `initDatabase()` |
| Вызов stored procedure                | `db.call<T>(name, params, options?)`               |
| Выполнение raw SQL transaction        | `db.callSqlTransaction<T>(sql, params?, options?)` |
| Подписка на notifications             | `db.makeNotify<T>(options, oracleOptions?)`        |
| Отписка от notifications              | `db.unlistenNotify(channel)`                       |
| Регистрация serializers               | `db.setSerializer()`, `db.deleteSerializer()`, `db.deleteAllSerializers()` |
| Доступ к DataSource или EntityManager | `db.dataSource`, `db.getEntityManager()`           |
| Graceful shutdown                     | `db.destroy()`, `db.registerShutdownHandlers()`    |

## Конфигурация

Каждая настройка использует объект `IModuleConfig`:

```ts
import type { IModuleConfig, ILoggerModule } from 'typeorm-procedure-kit';

const logger: ILoggerModule = {
  error: (message, ...optionalParams) =>
    console.error(message, ...optionalParams),
  log: (message, ...optionalParams) => console.log(message, ...optionalParams),
  warn: (message, ...optionalParams) =>
    console.warn(message, ...optionalParams),
};

const settings: IModuleConfig = {
  logger: {
    module: logger,
    typeormLogLevels: ['query', 'error', 'warn', 'migration'],
  },
  isRegisterShutdownHandlers: true,
  config: {
    type: 'postgres',
    parseInt8AsBigInt: true,
    master: {
      host: 'localhost',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'app_db',
    },
    poolSize: 10,
    appName: 'procedure-service',
    maxQueryExecutionTime: 30_000,
    outKeyTransformCase: 'camelCase',
    isNeedRegisterDefaultSerializers: true,
    packagesSettings: {
      packages: ['billing'],
      procedureObjectList: {
        createInvoice: 'billing.create_invoice',
        findInvoices: 'billing.find_invoices',
      },
      isNeedDynamicallyUpdatePackagesInfo: true,
      listenEventName: 'package_changed',
    },
  },
  entity: {
    isNeedEntitySync: false,
    entityPath: ['dist/entities/*.js'],
  },
  migration: {
    isNeedMigrationStart: false,
    migrationPath: ['dist/migrations/*.js'],
  },
};
```

Общие опции:

- `master`: credentials основной database connection.
- `slaves`: optional read replicas для TypeORM replication.
- `poolSize`: размер connection pool.
- `appName`: application name, передаваемый поддерживаемым drivers.
- `maxQueryExecutionTime`: slow-query threshold для underlying DataSource;
  логирует медленные запросы, не отменяя их.
- `logger.typeormLogLevels`: уровни логирования TypeORM, которые идут через
  `logger.module`. Поддерживаются `query`, `error`, `schema`, `info`, `warn`,
  `migration` или `all`.
- `queryTimeoutMs`: optional положительный integer query timeout в
  миллисекундах. PostgreSQL передает его в `pg` pool как `statement_timeout`,
  то есть statement-level timeout. Oracle применяет значение к каждому
  полученному physical connection как `oracledb` `connection.callTimeout`; это
  ограничивает отдельный database round-trip, а не полную длительность
  statement.
- `callTimeout`: deprecated alias для `maxQueryExecutionTime`.
- `outKeyTransformCase`: `camelCase`, `lowerCase` или `snakeCase`; default
  значение `camelCase`.
- `isNeedRegisterDefaultSerializers`: регистрирует default date/time
  serializers.
- `entity`: entity discovery и optional synchronization settings.
- `migration`: migration discovery и optional startup execution settings.
- `isRegisterShutdownHandlers`: регистрирует process signal handlers, которые
  вызывают `destroy()`.

PostgreSQL опции:

- `parseInt8AsBigInt`: обязательная опция PostgreSQL config type, передается во
  встроенный driver как `parseInt8`. Когда значение `true`, `node-postgres`
  парсит `int8` как JavaScript numbers вместо strings; значения выше
  `Number.MAX_SAFE_INTEGER` могут потерять точность, несмотря на имя опции.
- `packagesSettings.listenEventName`: обязательна, когда
  `isNeedDynamicallyUpdatePackagesInfo` равно `true`; переопределяет
  notification channel для package updates.

Oracle опции:

- `libraryPath`: optional Oracle Client library directory для thick mode.
- Oracle CQN options вроде `clientInitiated` и legacy `cqnPort` передаются
  вторым аргументом `makeNotify()`, а не через database config.

`packagesSettings.packages` содержит реальные database package/schema names и
должен использовать lowercase values. Значения `procedureObjectList` должны
быть реальными procedure names, например `billing.find_invoices`; ключи являются
labels внутри config object и не являются aliases для `call()`.

`call()` может использовать `package.procedure` или `schema.procedure`. Bare
`procedure` name допустим только когда настроен ровно один package/schema.

## Встроенная case strategy

Одна и та же case strategy используется для native result keys и bundled
TypeORM-compatible column naming. Настраивается через `outKeyTransformCase`.

| Значение    | Пример database key             | Output key |
| ----------- | ------------------------------- | ---------- |
| `camelCase` | `USER_ID`, `user_id`, `user id` | `userId`   |
| `snakeCase` | `USER_ID`, `userId`, `User Id`  | `user_id`  |
| `lowerCase` | `USER_ID`, `User_Id`            | `user_id`  |

## Поддерживаемые базы данных

| Database   | Adapter support                                      |
| ---------- | ---------------------------------------------------- |
| PostgreSQL | Procedure metadata, raw SQL, LISTEN/NOTIFY, ORM APIs |
| Oracle     | Package metadata, raw SQL, CQN, ORM APIs             |

Встроенный TypeORM-compatible runtime сфокусирован на Oracle и PostgreSQL
workflows. Это не обещание, что пакет оборачивает каждую database-specific
возможность обеих баз данных.

## Хранимые процедуры

```ts
await db.call('billing.create_invoice', {
  customerId: 42,
  amount: 1000,
});
```

Procedure metadata загружается из настроенных database packages/schemas во
время `initDatabase()`. Database user должен иметь возможность inspect
configured packages/schemas. `call()` нельзя использовать без
`config.packagesSettings`.

Procedure payload может быть object, array, `null` или `undefined`. Scalar
strings и numbers отклоняются runtime-ом.

## Raw SQL transactions

```ts
await db.callSqlTransaction<{ total: number }>(
  'SELECT COUNT(*) AS total FROM invoices WHERE customer_id = :CUSTOMER_ID',
  { CUSTOMER_ID: 42 },
  { mode: 'master' }
);
```

Raw SQL placeholders должны быть uppercase named parameters, например
`:USER_ID`. PostgreSQL переписывает их в positional `$1`, `$2` bindings; Oracle
оставляет named placeholders и передает binding values driver-у. Raw SQL
использует тот же execution, transaction, serializer и error-handling flow, что
и procedure calls.

Execution options:

- `mode`: `master` или `slave`, default `master`.
- `optionsCommands`: ограниченные setup-команды, выполняемые в той же
  transaction перед основным query. Каждый элемент должен содержать одну
  безопасную команду без комментариев и разделителей. Для PostgreSQL разрешены
  поддерживаемые формы `SET`, `SET LOCAL` и `SET TRANSACTION`; для Oracle —
  `ALTER SESSION SET name = value`.
- `queryId`: custom id для logs и wrapped database errors.

## Уведомления

### PostgreSQL LISTEN/NOTIFY

```ts
const channel = await db.makeNotify<{ invoiceId: number }>({
  sql: 'LISTEN invoice_changed',
  notifyCallback: (payload) => {
    console.log(payload);
  },
});

await db.unlistenNotify(channel);
```

PostgreSQL adapter парсит JSON payloads, когда это возможно. Если parsing не
удается, callback получает raw string; empty payload передается как `{}`.
Listeners используют dedicated connections, periodic health checks и guarded
restore attempts после connection loss.

### Oracle Continuous Query Notification

```ts
import oracledb from 'oracledb';

const channel = await db.makeNotify<Array<{ ID: number }>>(
  {
    sql: 'SELECT ID, STATUS FROM BILLING.INVOICES',
    notifyCallback: (rows) => {
      console.log(rows);
    },
  },
  {
    operations: oracledb.CQN_OPCODE_ALL_OPS,
    qos: oracledb.SUBSCR_QOS_ROWIDS,
    timeout: 60 * 60,
    clientInitiated: true,
  }
);

await db.unlistenNotify(channel);
```

Oracle генерирует subscription names internally. Когда CQN сообщает changed
ROWIDs, adapter fetches changed rows и передает эти rows в callback. Oracle
subscriptions мониторятся и восстанавливаются после CQN deregistration,
shutdown events, connection errors или silent connection loss.
Используйте `clientInitiated: false` с legacy `cqnPort` только для
server-initiated CQN setups, которым нужен database callback port.

### Dynamic package metadata refresh

Dynamic refresh включается только когда выполнены все условия:

- `packagesSettings` настроен;
- `packagesSettings.packages` не пустой;
- `packagesSettings.isNeedDynamicallyUpdatePackagesInfo` равно `true`.

PostgreSQL по умолчанию слушает `db_object_event`, если не настроен
`listenEventName`. Oracle запрашивает `SOLUTION_ROOT.DB_OBJECT_LOG` для package
changes.

`packagesSettings.procedureMetadataSql` и
`packagesSettings.metadataNotificationSql` — trusted developer SQL config, а не
runtime SQL builders. Держите их статичными или собирайте только из проверенных
констант; не формируйте их из user input.

`packagesSettings.procedureMetadataSql` может заменить default query загрузки
procedure metadata для обеих databases. SQL должен содержать `:PACKAGE_NAME` и
должен возвращать колонки, совместимые с `IProcedureArgumentBase` после
snake_case to camelCase conversion: `procedure_name`, `argument_name`,
`argument_type`, `order` и `mode`.

`packagesSettings.metadataNotificationSql` может заменить default SQL подписки
на metadata refresh. PostgreSQL ожидает полный `LISTEN ...` command. Oracle
ожидает полный CQN `SELECT ...` query.

## Сериализаторы

Включение built-in serializers:

```ts
const settings = {
  config: {
    // ...
    isNeedRegisterDefaultSerializers: true,
  },
};
```

Built-in serializers форматируют:

- `DATE` как `yyyy-MM-dd`
- `TIMESTAMP` как `yyyy-MM-dd HH:mm:ss Z`
- `TIMESTAMP_TZ` как `yyyy-MM-dd HH:mm:ss Z`

Регистрация и удаление custom serializers:

```ts
db.setSerializer({
  serializerType: 'JSON',
  strategy: (value) => JSON.parse(value.toString()),
});

const serializers = db.serializerReadOnlyMapping;

db.deleteSerializer({ serializerType: 'JSON' });
db.deleteAllSerializers();
```

Supported serializer keys: `DATE`, `TIMESTAMP`, `TIMESTAMP_TZ`, `BOOLEAN`,
`CHAR`, `VARCHAR`, `JSON`, `BINARY` и `XML`.

Runtime side effects:

- PostgreSQL serializer globally overrides `pg.Result.prototype.parseRow`;
- Oracle serializer globally sets `oracledb.fetchTypeHandler`;
- Oracle adapter sets `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT`.

## NestJS integration

```ts
import { Logger, Module } from '@nestjs/common';
import { TypeOrmProcedureKitNestModule } from 'typeorm-procedure-kit/nestjs';
import type { IModuleConfig } from 'typeorm-procedure-kit';

const config: IModuleConfig['config'] = {
  type: 'postgres',
  parseInt8AsBigInt: true,
  master: {
    host: 'localhost',
    port: 5432,
    username: 'app',
    password: 'secret',
    database: 'app_db',
  },
  poolSize: 10,
};

@Module({
  imports: [
    TypeOrmProcedureKitNestModule.forRoot({
      logger: { module: new Logger('TypeOrmProcedureKit') },
      config,
    }),
  ],
})
export class AppModule {}
```

Async setup:

```ts
TypeOrmProcedureKitNestModule.forRootAsync({
  isGlobal: true,
  useFactory: async (): Promise<IModuleConfig> => ({
    logger: { module: new Logger('TypeOrmProcedureKit') },
    config,
  }),
});
```

Для synchronous setup передайте `true` вторым аргументом `forRoot()`, чтобы
сделать module global. Nest service инициализирует database во время
`onModuleInit()` и вызывает `destroy()` при application shutdown.

NestJS entry point также экспортирует decorators для injection отдельных
methods и lazy-доступа к DataSource:

| Decorator                       | Делегирует в                               |
| ------------------------------- | ------------------------------------------ |
| `@InjectCallProcedure()`        | `TypeOrmProcedureKit.call()`               |
| `@InjectCallSql()`              | `TypeOrmProcedureKit.callSqlTransaction()` |
| `@InjectGetDataSource()`        | `() => TypeOrmProcedureKit.dataSource`     |
| `@InjectMakeNotify()`           | `TypeOrmProcedureKit.makeNotify()`         |
| `@InjectUnlistenNotify()`       | `TypeOrmProcedureKit.unlistenNotify()`     |
| `@InjectSetSerializer()`        | `TypeOrmProcedureKit.setSerializer()`      |
| `@InjectDeleteSerializer()`     | `TypeOrmProcedureKit.deleteSerializer()`   |
| `@InjectDeleteAllSerializers()` | `TypeOrmProcedureKit.deleteAllSerializers()` |

## Встроенный TypeORM-compatible API

Entry point `typeorm-procedure-kit/typeorm` экспортирует decorators,
DataSource, EntityManager, repositories, query builders и related types. Runtime
основан на maintained TypeORM-compatible fork, optimized for Oracle and
PostgreSQL workflows.

Используйте документированные entry points вместо deep imports во внутренние
файлы bundled TypeORM. В SQL tagged templates scalar values параметризуются
автоматически. `SqlTagUtils` больше не рассматривает TypeORM-compatible raw
function expressions как raw SQL path, поэтому callbacks, возвращающие SQL text,
намеренно отклоняются. Migration path: используйте `unsafeRawSql()` только для
проверенных trusted SQL fragments, `sqlIdentifier()` для dynamic identifiers и
`sqlParameterList()` для parameter lists. Callback, возвращающий непустой массив,
остается parameter-list expansion, а не raw SQL.

Enhancements include:

- более строгая типизация repositories, query builders и entity manager;
- generic-aware entity metadata в большем числе мест;
- типы `FindOptionsWhere`, `DeepPartial` и `QueryPartialEntity`, aligned with
  entity shape, exported by this package;
- `EntityMetadata.databasePropertiesMap`, который exposes database column names
  после explicit `@Column({ name })` options и naming strategy rules;
- `isQuotingDisabled: true` при инициализации kit DataSource, поэтому query
  builders по умолчанию не quote identifiers. Можно включить quoting через
  `enableEscaping()` или `escape(name, true)`.

## TypeORM extension decorators

`typeorm-procedure-kit/typeorm-extend` экспортирует:

- `ExtendEntity`
- `ExtendColumn`
- `ExtendPrimaryColumn`
- `ExtendPrimaryGeneratedColumn`
- `AbstractTypeormRepository`

Shared base entity:

```ts
import { Entity, PrimaryColumn } from 'typeorm-procedure-kit/typeorm';

@Entity()
export abstract class UserBase {
  @PrimaryColumn()
  public abstract readonly id: number;
}
```

Database-specific variants:

```ts
import {
  ExtendEntity,
  ExtendPrimaryColumn,
} from 'typeorm-procedure-kit/typeorm-extend';

@ExtendEntity()
export class UserOracle extends UserBase {
  @ExtendPrimaryColumn({ type: 'number' })
  declare public readonly id: number;
}

@ExtendEntity()
export class UserPostgres extends UserBase {
  @ExtendPrimaryColumn({ type: 'int8' })
  declare public readonly id: number;
}
```

Repository helper:

```ts
import type { DataSource, EntityTarget } from 'typeorm-procedure-kit/typeorm';
import { AbstractTypeormRepository } from 'typeorm-procedure-kit/typeorm-extend';

class UserRepository extends AbstractTypeormRepository<
  UserBase,
  EntityTarget<UserBase>
> {
  public constructor(getDataSource: () => DataSource) {
    super(
      getDataSource,
      AbstractTypeormRepository.createEntityTargetFactory({
        oracle: UserOracle,
        postgres: UserPostgres,
      })
    );
  }

  public findById(id: number): Promise<UserBase | null> {
    const { alias, builder, property } = this.buildBaseQueryContext('u');

    return builder
      .where(`${alias}.${property.id} = :id`, { id })
      .getOne();
  }
}
```

`property` object это `EntityMetadata.databasePropertiesMap`, поэтому manual
SQL fragments используют database column names после применения naming strategy
rules.

## Доступ к EntityManager и DataSource

```ts
const manager = await db.getEntityManager('master');

try {
  const rows = await manager.query('SELECT 1 AS value');
  console.log(rows);
} finally {
  await db.releaseEntityManager(manager);
}

const dataSource = db.dataSource;
const adapter = db.databaseAdapter;
```

`getEntityManager()` принимает `master` или `slave`. Если запрошен `slave`, но
configured slave отсутствует, будет logged warning и использована master
connection.

## Завершение работы

Вызывайте `destroy()`, когда application останавливается:

```ts
await db.destroy();
```

`destroy()` отписывает notifications, уничтожает DataSource pool, очищает
procedure and naming caches и бросает `AggregateError`, если часть cleanup
завершилась ошибкой. Установите `isRegisterShutdownHandlers: true`, чтобы
зарегистрировать process signal handlers автоматически, или вызовите
`db.registerShutdownHandlers()` самостоятельно.

## Частые ошибки

- `TypeOrmProcedureKit is not initialized`: вызовите `await initDatabase()`
  перед использованием runtime methods.
- `Procedure packages are not configured`: добавьте `config.packagesSettings`
  перед использованием `call()`.
- `Package "... " or process "... " not found`: проверьте package names,
  `procedureObjectList` и database metadata visibility.
- `Payload for call procedure must be an object or array or undefined or null`:
  не передавайте scalar payload в `call()`.
- `Unsafe SQL identifier for ...`: имена procedures, cursors или notification
  channels должны соответствовать supported identifier pattern.
- Database result objects с nonzero `error_code` или `err_code` преобразуются в
  `ServerError`.

## License

MIT.
