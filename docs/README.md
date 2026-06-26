# typeorm-procedure-kit

Enterprise TypeORM toolkit for Oracle and PostgreSQL.

Strongly-typed repositories, stored procedures, multi-database entity
inheritance, raw SQL orchestration, database notifications, serializers, and an
enhanced bundled TypeORM-compatible runtime.

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

## Translations

- [English](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.md)
- [Русский](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.ru.md)
- [Deutsch](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.de.md)
- [中文](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.zh.md)

---

## Why this package exists

TypeORM works well for CRUD-oriented applications, but enterprise database
systems often need capabilities around stored procedures, package metadata,
Oracle/PostgreSQL dual deployments, notification-driven synchronization, and
database-specific entity variants.

`typeorm-procedure-kit` keeps a TypeORM-compatible developer experience while
adding:

- metadata-aware Oracle package and PostgreSQL schema procedure calls;
- raw SQL execution through the same transaction and error-handling flow;
- PostgreSQL `LISTEN/NOTIFY` and Oracle Continuous Query Notification;
- dynamic procedure metadata refresh after database object changes;
- shared naming/case rules for native rows and ORM column names;
- serializers for database result values;
- a bundled TypeORM-compatible API focused on Oracle and PostgreSQL;
- entity extension decorators and repository helpers for database-specific
  entity targets.

## Comparison with upstream TypeORM

| Capability                             | TypeORM        | typeorm-procedure-kit |
| -------------------------------------- | -------------- | --------------------- |
| Stored procedure metadata              | Partial/manual | Built-in              |
| Oracle + PostgreSQL enterprise support | Limited        | Focused               |
| Strict repository typing               | Partial        | Extended              |
| Multi-database entity inheritance      | No             | Yes                   |
| LISTEN/NOTIFY + Oracle CQN             | No             | Yes                   |
| Runtime metadata refresh               | No             | Yes                   |
| Database-specific repositories         | Manual         | Built-in              |

## Requirements

- Node.js `>=20`
- TypeScript with decorators enabled when using entity decorators
- PostgreSQL driver: `pg`
- Oracle driver: `oracledb`
- Optional PostgreSQL streaming dependency: `pg-query-stream`
- Optional NestJS peer dependencies: `@nestjs/common` and `@nestjs/core`

## Installation

```bash
npm install typeorm-procedure-kit
```

Install the driver for your database:

```bash
npm install pg
npm install oracledb
```

Install `pg-query-stream` only when using PostgreSQL streaming APIs such as
`SelectQueryBuilder.stream()` or `QueryRunner.stream()`.

```bash
npm install pg-query-stream
```

## Quick start

This minimal PostgreSQL example initializes the kit, calls one configured
procedure, and shuts down resources:

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

## Import entry points

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

| Import path                            | Use it for                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `typeorm-procedure-kit`                | `TypeOrmProcedureKit`, public types, constants, utilities                       |
| `typeorm-procedure-kit/nestjs`         | NestJS module, service, method injection decorators                             |
| `typeorm-procedure-kit/typeorm`        | Bundled TypeORM-compatible decorators, DataSource, repositories, query builders |
| `typeorm-procedure-kit/typeorm-extend` | Entity metadata extension decorators and database-specific repository helpers   |

For entities managed by this package, import TypeORM APIs from
`typeorm-procedure-kit/typeorm`. The package includes the TypeORM-compatible API
it uses internally.

## Migrating from TypeORM

Minimal migration path:

Replace imports:

```ts
// before
import { Entity, Column } from 'typeorm';

// after
import { Entity, Column } from 'typeorm-procedure-kit/typeorm';
```

Then gradually adopt advanced features:

- stored procedures;
- repository helpers;
- multi-database entity inheritance;
- notification infrastructure;
- serializer pipeline;
- database-specific repositories.

The package keeps a TypeORM-compatible developer experience while extending the
runtime with Oracle/PostgreSQL-focused workflows and stricter typing support.

## API map

| Task                               | API                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Initialize database access         | `new TypeOrmProcedureKit(settings)`, `initDatabase()`                      |
| Call a stored procedure            | `db.call<T>(name, params, options?)`                                       |
| Execute raw SQL transaction        | `db.callSqlTransaction<T>(sql, params?, options?)`                         |
| Subscribe to notifications         | `db.makeNotify<T>(options, oracleOptions?)`                                |
| Unsubscribe from notifications     | `db.unlistenNotify(channel)`                                               |
| Register serializers               | `db.setSerializer()`, `db.deleteSerializer()`, `db.deleteAllSerializers()` |
| Access DataSource or EntityManager | `db.dataSource`, `db.getEntityManager()`                                   |
| Graceful shutdown                  | `db.destroy()`, `db.registerShutdownHandlers()`                            |

## Configuration shape

Every setup uses an `IModuleConfig` object:

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

Common options:

- `master`: primary database credentials.
- `slaves`: optional read replicas used by TypeORM replication.
- `poolSize`: connection pool size.
- `appName`: application name passed to supported drivers.
- `sessionTimeZone`: optional database session time zone passed to supported
  drivers, for example `UTC`, `Europe/Moscow`, or `+03:00`.
- `maxQueryExecutionTime`: slow-query threshold passed to the underlying
  DataSource; it logs slow queries without cancelling them.
- `logger.typeormLogLevels`: TypeORM log levels routed through `logger.module`.
  Supported values are `query`, `error`, `schema`, `info`, `warn`, `migration`,
  or `all`.
- `queryTimeoutMs`: optional positive integer query timeout in milliseconds.
  PostgreSQL passes it to the `pg` pool as `statement_timeout`, a statement-level
  timeout. Oracle applies it to each acquired physical connection as `oracledb`
  `connection.callTimeout`; this limits each database round-trip, not the total
  statement duration.
- `callTimeout`: deprecated alias for `maxQueryExecutionTime`.
- `outKeyTransformCase`: `camelCase`, `lowerCase`, or `snakeCase`; defaults to
  `camelCase`.
- `isNeedRegisterDefaultSerializers`: registers default date/time serializers.
- `entity`: entity discovery and optional synchronization settings.
- `migration`: migration discovery and optional startup execution settings.
- `isRegisterShutdownHandlers`: registers process signal handlers that call
  `destroy()`.

PostgreSQL options:

- `parseInt8AsBigInt`: required by the PostgreSQL config type and passed to the
  bundled driver as `parseInt8`. When `true`, `node-postgres` parses `int8`
  values as JavaScript numbers instead of strings; values above
  `Number.MAX_SAFE_INTEGER` can lose precision despite the option name.
- `packagesSettings.listenEventName`: required when
  `isNeedDynamicallyUpdatePackagesInfo` is `true`; overrides the package update
  notification channel.

Oracle options:

- `libraryPath`: optional Oracle Client library directory for thick mode.
- Oracle CQN options such as `clientInitiated` and legacy `cqnPort` are passed as
  the second `makeNotify()` argument, not as database config.

`packagesSettings.packages` contains real database package/schema names and
should use lowercase values. `procedureObjectList` values must be real
procedure names such as `billing.find_invoices`; keys are labels inside the
configuration object and are not call aliases.

`call()` can use `package.procedure` or `schema.procedure`. A bare `procedure`
name is accepted only when exactly one package/schema is configured.

## Built-in case strategy

The same case strategy is used for native result keys and bundled
TypeORM-compatible column naming. Configure it with `outKeyTransformCase`.

| Value       | Example database key            | Output key |
| ----------- | ------------------------------- | ---------- |
| `camelCase` | `USER_ID`, `user_id`, `user id` | `userId`   |
| `snakeCase` | `USER_ID`, `userId`, `User Id`  | `user_id`  |
| `lowerCase` | `USER_ID`, `User_Id`            | `user_id`  |

## Supported databases

| Database   | Adapter support                                      |
| ---------- | ---------------------------------------------------- |
| PostgreSQL | Procedure metadata, raw SQL, LISTEN/NOTIFY, ORM APIs |
| Oracle     | Package metadata, raw SQL, CQN, ORM APIs             |

The bundled TypeORM-compatible runtime is focused on Oracle and PostgreSQL
workflows. It is not a promise that every database-specific feature in either
database is wrapped by this package.

## Stored procedures

```ts
await db.call('billing.create_invoice', {
  customerId: 42,
  amount: 1000,
});
```

Procedure metadata is loaded from the configured database packages/schemas
during `initDatabase()`. The database user must be able to inspect the
configured packages/schemas. `call()` cannot be used without
`config.packagesSettings`.

Procedure payloads can be objects, arrays, `null`, or `undefined`. Scalar
strings and numbers are rejected at runtime.

## Raw SQL transactions

```ts
await db.callSqlTransaction<{ total: number }>(
  'SELECT COUNT(*) AS total FROM invoices WHERE customer_id = :CUSTOMER_ID',
  { CUSTOMER_ID: 42 },
  { mode: 'master' }
);
```

Raw SQL placeholders must be uppercase named parameters such as `:USER_ID`.
PostgreSQL rewrites them to positional `$1`, `$2` bindings; Oracle keeps named
placeholders and passes binding values to the driver. Raw SQL uses the same
execution, transaction, serializer, and error-handling flow as procedure calls.

Execution options:

- `mode`: `master` or `slave`, default `master`.
- `optionsCommands`: restricted setup commands executed in the same transaction
  before the main query. Each item must be one safe command without comments or
  separators. PostgreSQL accepts supported `SET`, `SET LOCAL`, and
  `SET TRANSACTION` forms; Oracle accepts `ALTER SESSION SET name = value`.
- `queryId`: custom id used in logs and wrapped database errors.

## Notifications

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

The PostgreSQL adapter parses JSON payloads when possible. If parsing fails it
passes the raw string to the callback; an empty payload is passed as `{}`.
Listeners use dedicated connections, periodic health checks, and guarded
restore attempts after connection loss.

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

Oracle generates subscription names internally. When CQN reports changed
ROWIDs, the adapter fetches changed rows and passes those rows to the callback.
Oracle subscriptions are monitored and restored after CQN deregistration,
shutdown events, connection errors, or silent connection loss.
Use `clientInitiated: false` with legacy `cqnPort` only for server-initiated CQN
setups that require a database callback port.

### Dynamic package metadata refresh

Dynamic refresh is enabled only when all of these are true:

- `packagesSettings` is configured;
- `packagesSettings.packages` is non-empty;
- `packagesSettings.isNeedDynamicallyUpdatePackagesInfo` is `true`.

PostgreSQL listens on `db_object_event` by default unless `listenEventName` is
configured. Oracle queries `SOLUTION_ROOT.DB_OBJECT_LOG` for package changes.

`packagesSettings.procedureMetadataSql` and
`packagesSettings.metadataNotificationSql` are trusted developer SQL config, not
runtime SQL builders. Keep them static or assemble them only from reviewed
constants; never build them from user input.

`packagesSettings.procedureMetadataSql` can replace the default procedure
metadata query for both databases. The SQL must contain `:PACKAGE_NAME` and
must return columns compatible with `IProcedureArgumentBase` after snake_case to
camelCase conversion: `procedure_name`, `argument_name`, `argument_type`,
`order`, and `mode`.

`packagesSettings.metadataNotificationSql` can replace the default metadata
refresh subscription SQL. PostgreSQL expects a full `LISTEN ...` command. Oracle
expects a full CQN `SELECT ...` query.

## Serializers

Enable built-in serializers:

```ts
const settings = {
  config: {
    // ...
    isNeedRegisterDefaultSerializers: true,
  },
};
```

Built-in serializers format:

- `DATE` as `yyyy-MM-dd`
- `TIMESTAMP` as `yyyy-MM-dd HH:mm:ss Z`
- `TIMESTAMP_TZ` as `yyyy-MM-dd HH:mm:ss Z`

Register and remove custom serializers:

```ts
db.setSerializer({
  serializerType: 'JSON',
  strategy: (value) => JSON.parse(value.toString()),
});

const serializers = db.serializerReadOnlyMapping;

db.deleteSerializer({ serializerType: 'JSON' });
db.deleteAllSerializers();
```

Supported serializer keys are `DATE`, `TIMESTAMP`, `TIMESTAMP_TZ`, `BOOLEAN`,
`CHAR`, `VARCHAR`, `JSON`, `BINARY`, and `XML`.

Runtime side effects:

- the PostgreSQL serializer overrides `pg.Result.prototype.parseRow` globally;
- the Oracle serializer sets `oracledb.fetchTypeHandler` globally;
- the Oracle adapter sets `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT`.

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

For synchronous setup, pass `true` as the second `forRoot()` argument to make
the module global. The Nest service initializes the database during
`onModuleInit()` and calls `destroy()` during application shutdown.

The NestJS entry point also exports decorators for injecting individual methods
and lazy DataSource access:

| Decorator                       | Delegates to                                 |
| ------------------------------- | -------------------------------------------- |
| `@InjectCallProcedure()`        | `TypeOrmProcedureKit.call()`                 |
| `@InjectCallSql()`              | `TypeOrmProcedureKit.callSqlTransaction()`   |
| `@InjectGetDataSource()`        | `() => TypeOrmProcedureKit.dataSource`       |
| `@InjectMakeNotify()`           | `TypeOrmProcedureKit.makeNotify()`           |
| `@InjectUnlistenNotify()`       | `TypeOrmProcedureKit.unlistenNotify()`       |
| `@InjectSetSerializer()`        | `TypeOrmProcedureKit.setSerializer()`        |
| `@InjectDeleteSerializer()`     | `TypeOrmProcedureKit.deleteSerializer()`     |
| `@InjectDeleteAllSerializers()` | `TypeOrmProcedureKit.deleteAllSerializers()` |

## Bundled TypeORM-compatible API

The `typeorm-procedure-kit/typeorm` entry point exports decorators, DataSource,
EntityManager, repositories, query builders, and related types. The runtime is
based on a maintained TypeORM-compatible fork optimized for Oracle and
PostgreSQL workflows.

Use the documented entry points instead of deep imports into bundled TypeORM
files. For SQL tagged templates, scalar values are parameterized automatically.
`SqlTagUtils` no longer treats TypeORM-compatible raw function expressions as a
raw SQL path, so callbacks returning SQL text are rejected. Migration path: use
`unsafeRawSql()` only for reviewed trusted SQL fragments, `sqlIdentifier()` for
dynamic identifiers, and `sqlParameterList()` for parameter lists. A callback
returning a non-empty array remains parameter-list expansion, not raw SQL.

Enhancements include:

- stricter repository, query builder, and entity manager typing;
- generic-aware entity metadata in more places;
- `FindOptionsWhere`, `DeepPartial`, and `QueryPartialEntity` types aligned
  with the entity shape exported by this package;
- `EntityMetadata.propertiesMap` for TypeORM property paths, including
  relations, and `EntityMetadata.databasePropertiesMap` for database column
  names after explicit `@Column({ name })` options and naming strategy rules;
- `isQuotingDisabled: true` during kit DataSource initialization, so query
  builders keep identifiers unquoted by default. You can opt into quoting with
  `enableEscaping()` or `escape(name, true)`.

## TypeORM extension decorators

`typeorm-procedure-kit/typeorm-extend` exports:

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
    const { alias, builder, propertyPaths } = this.buildBaseQueryContext('u');

    return builder.where(`${alias}.${propertyPaths.id} = :id`, { id }).getOne();
  }
}
```

`propertyPaths` is a relation-aware TypeORM property path map built from entity
metadata. Use it for QueryBuilder property expressions such as `where`,
`leftJoin`, `orderBy`, `take`, and `skip`; relation fields are available through
dot access, for example `propertyPaths.additionalMessage.isDeleted` resolves to
`additionalMessage.isDeleted`.

`property` is a database column path map compatible with
`EntityMetadata.databasePropertiesMap`. Use it only for raw SQL fragments that
need real database column names; relation fields are available through dot
access for joined aliases, for example `property.additionalMessage.isDeleted`
resolves to `IS_DELETED`.

Migration note: this is a breaking repository API behavior change for code that
expected QueryBuilder property paths in `property` or database column names in
`databaseProperty`. Move QueryBuilder usages to `propertyPaths` and raw SQL
column usages to `property`.

## EntityManager and DataSource access

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

`getEntityManager()` accepts `master` or `slave`. Requesting `slave` without a
configured slave logs a warning and uses the master connection.

## Shutdown

Call `destroy()` when the application stops:

```ts
await db.destroy();
```

`destroy()` unsubscribes notifications, destroys the DataSource pool, clears
procedure and naming caches, and throws `AggregateError` if part of cleanup
fails. Set `isRegisterShutdownHandlers: true` to register process signal
handlers automatically, or call `db.registerShutdownHandlers()` yourself.

## Common errors

- `TypeOrmProcedureKit is not initialized`: call `await initDatabase()` before
  using runtime methods.
- `Procedure packages are not configured`: add `config.packagesSettings` before
  using `call()`.
- `Package "... " or process "... " not found`: check package names,
  `procedureObjectList`, and database metadata visibility.
- `Payload for call procedure must be an object or array or undefined or null`:
  do not pass a scalar payload to `call()`.
- `Unsafe SQL identifier for ...`: procedure, cursor, or notification channel
  names must match the supported identifier pattern.
- Database result objects with nonzero `error_code` or `err_code` are converted
  to `ServerError`.

## License

MIT.
