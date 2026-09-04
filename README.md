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
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/tests.yml"><img alt="CI" src="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/tests.yml/badge.svg"></a>
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/release.yml"><img alt="release" src="https://github.com/PaulBudanov/typeorm-procedure-kit/actions/workflows/release.yml/badge.svg"></a>
  <a href="https://github.com/PaulBudanov/typeorm-procedure-kit"><img alt="last commit" src="https://img.shields.io/github/last-commit/PaulBudanov/typeorm-procedure-kit?color=64748b&logo=github"></a>
</p>

## Translations

- [English](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/README.md)
- [Русский](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/README.ru.md)
- [Deutsch](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/README.de.md)
- [中文](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/README.zh.md)

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
- Published ESM and CJS builds target ES2022. The npm package does not include
  source maps or declaration maps.
- TypeScript with decorators enabled when using entity decorators
- PostgreSQL driver: `pg`
- Oracle driver: `oracledb`
- Optional PostgreSQL streaming dependency: `pg-query-stream`
- Optional NestJS peer dependency: `@nestjs/common`
  (`^10.4.16 || ^11.0.16`).
  `@nestjs/core` is no longer a peer of this package; install it only when your
  application itself needs the Nest runtime.

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
    parseInt8AsNumber: true,
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
  const { rows: invoices, outBinds } = await db.call<{ invoiceId: number }>(
    'billing.find_invoices',
    { customerId: 42 }
  );
  console.log(invoices, outBinds);
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

## Upgrading to v3

Version 3 changes the stored-procedure result and serializer contracts, makes
temporal formatting explicit and opt-in, and configures a validated session
time zone on every physical pooled connection. Read the
[v3 migration guide](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/MIGRATION_V3.md)
before upgrading from v2.

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
    parseInt8AsNumber: true,
    master: {
      host: 'localhost',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'app_db',
    },
    poolSize: 10,
    appName: 'procedure-service',
    sessionTimeZone: 'UTC',
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
- `sessionTimeZone`: validated database session time zone, for example `UTC`,
  `Europe/Moscow`, or `+03:00`; it defaults to `UTC`. PostgreSQL includes it in
  every pool connection's startup options. Oracle applies it through the pool
  session callback when each physical connection is created. Reused pool
  connections retain that state unless application SQL changes it.
- `maxQueryExecutionTime`: slow-query threshold passed to the underlying
  DataSource; it logs slow queries without cancelling them.
- `logger.typeormLogLevels`: TypeORM log levels routed through `logger.module`.
  Supported values are `query`, `error`, `schema`, `info`, `warn`, `migration`,
  or `all`.
- `logger.bindingLogMode`: binding-value logging policy. The secure default,
  `metadata-only`, hides every value. `redact-by-name` is a less strict
  compatibility mode that exposes values whose names do not match its
  sensitive-name heuristic. `unsafe-values` is an explicit opt-in that may
  expose credentials and personal data.
- `queryTimeoutMs`: optional positive integer query timeout in milliseconds.
  PostgreSQL passes it to the `pg` pool as `statement_timeout`, a statement-level
  timeout. Oracle applies it to each acquired physical connection as `oracledb`
  `connection.callTimeout`; this limits each database round-trip, not the total
  statement duration. Invalid, fractional, or out-of-range values fail during
  configuration instead of silently disabling the timeout.
- `resourceLimits`: optional materialization bounds. Secure defaults are
  `maxProcedureRows: 100000`, `maxProcedureBytes: 67108864` (64 MiB),
  `maxMetadataRows: 10000`, `maxLobBytes: 16777216` (16 MiB),
  `maxNotificationQueue: 1000`, and `maxNotificationRows: 10000` distinct
  Oracle CQN ROWIDs per event. `maxProcedureBytes` uses approximate logical
  payload accounting; it is not an exact heap, wire, or driver-allocation
  measurement.
- `outKeyTransformCase`: `camelCase`, `lowerCase`, or `snakeCase`; defaults to
  `camelCase`.
- `isNeedRegisterDefaultSerializers`: opt-in flag for the default temporal
  serializers; it defaults to `false`.
- `entity`: entity discovery and optional synchronization settings.
- `migration`: migration discovery and optional startup execution settings.
- `isRegisterShutdownHandlers`: registers standalone-process signal handlers.
  The first signal removes the kit handlers, awaits `destroy()`, and re-sends
  the same signal so the process keeps its standard signal exit semantics.

PostgreSQL options:

- `parseInt8AsNumber`: required by the PostgreSQL config type and passed to the
  bundled driver as `parseInt8`. When `true`, `node-postgres` parses `int8`
  values as JavaScript numbers instead of strings; values above
  `Number.MAX_SAFE_INTEGER` can lose precision.
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
const result = await db.call<InvoiceRow>('billing.create_invoice', {
  customerId: 42,
  amount: 1000,
});

console.log(result.rows);
console.log(result.outBinds);
```

Procedure metadata is loaded from the configured database packages/schemas
during `initDatabase()`. The database user must be able to inspect the
configured packages/schemas. `call()` cannot be used without
`config.packagesSettings`.

Procedure payloads can be objects, arrays, `null`, or `undefined`. Scalar
strings and numbers are rejected at runtime.

Named structured arguments use plain objects. Oracle package-spec PL/SQL
`RECORD` arguments and PostgreSQL named composite/table-row arguments support
`IN`, `OUT`, and `INOUT`. Missing declared fields bind as SQL `NULL`; unknown or
conflicting field names are rejected. Structured outputs are plain objects in
`outBinds`, with field names transformed by `outKeyTransformCase`.

Oracle PL/SQL `RECORD` binding requires Oracle Database 12.1 or newer. Thick
mode also requires Oracle Client 12.1 or newer.

The first structured-type implementation excludes nested structured values,
structured arrays, Oracle collections, anonymous/local records and `%ROWTYPE`,
and dynamic PL/pgSQL `RECORD`/anonymous `ROW(...)`. PostgreSQL scalar arrays are
passed to the driver as native arrays; Oracle arrays are rejected until
collection binding is supported explicitly.

In v3, `call()` always resolves to an `IProcedureResult` envelope:

```ts
interface IProcedureResult<TRow, TOut extends Record<string, unknown>> {
  rows: Array<TRow>;
  outBinds: TOut;
}
```

`rows` concatenates all REF CURSOR rows in procedure metadata order. `outBinds`
preserves every cursor and scalar `OUT`/`INOUT` value under the configured
`outKeyTransformCase`; scalar-only procedures return an empty `rows` array.
`callSqlTransaction()` continues to return its row array directly.

For PostgreSQL `refcursor` parameters, missing `IN`/`INOUT` portal names are
generated automatically. A pure `OUT refcursor` is passed as `NULL`, as required
by PostgreSQL, so the stored procedure must assign and open an explicit portal
name. Any server result matching `<unnamed portal ...>` (including
`<unnamed portal 1>`) is rejected; all accepted names are safely quoted before
`FETCH` and `CLOSE` and must fit in 63 UTF-8 bytes. Cursor rows are fetched in
batches of at most 1,000 so row and byte limits are enforced incrementally.

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
  separators. PostgreSQL accepts `SET LOCAL ROLE`, `SET LOCAL search_path`,
  `SET LOCAL TIME ZONE`, namespaced `SET LOCAL app.*`, and supported
  `SET TRANSACTION` forms. Oracle accepts only the supported `NLS_*` format
  settings. Their original values are captured and restored before the pooled
  connection is released; a restoration failure drops that physical
  connection. Configure Oracle time zones with `sessionTimeZone`.
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
The refetch preserves the configured projection and predicate. To make ROWID
refetch deterministic and bounded, Oracle CQN SQL must be a single-table
`SELECT` with an optional alias and `WHERE`; joins, set operations, grouping,
ordering, and nested queries are rejected before a connection is created.
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
`order`, `mode`, and optional `size`. Overloaded PostgreSQL routines must also
return `specific_name`; Oracle routines should return `owner`, `subprogram_id`,
and `overload`. Ambiguous overload metadata is rejected instead of merging
signatures. Modes must be `IN`, `OUT`, or `INOUT`/`IN/OUT`; `order` and `size`
must be valid integers. Built-in metadata SQL fetches at most
`maxMetadataRows + 1` rows for overflow detection. A custom metadata query is
still rejected after that limit, but should include its own database-side limit
when it reads an unbounded source to avoid materializing an oversized result.

`packagesSettings.metadataNotificationSql` can replace the default metadata
refresh subscription SQL. PostgreSQL expects a full `LISTEN ...` command. Oracle
expects a CQN `SELECT ...` query subject to the single-table restrictions above.
An absent, empty, or whitespace-only value uses the adapter default; a non-empty
value is trimmed before use.

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

Default serializers are not registered unless
`isNeedRegisterDefaultSerializers` is `true`. Their v3 formats are:

- `DATE` as `yyyy-MM-dd HH:mm:ss` (whole-second precision)
- `TIMESTAMP` as `yyyy-MM-dd HH:mm:ss.SSS` (millisecond precision)
- `TIMESTAMP_TZ` as UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`
- `TIMESTAMP_LTZ` as UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`

Temporal strategies accept either the driver's native `Date` or a strict
SQL/ISO string. Zoned string values must include `Z` or a numeric offset.
Fractional input up to nanoseconds is validated, while JavaScript output is
intentionally normalized to milliseconds. DST and offset conversion use the
explicit input offset/session time zone; ambiguous unzoned values are not
silently treated as zoned timestamps.

Register and remove custom serializers:

```ts
db.setSerializer({
  serializerType: 'JSON',
  strategy: ({ serializerType, value, context }) => {
    console.log(serializerType, context?.source, context?.databaseType);
    return typeof value === 'string' ? JSON.parse(value) : value;
  },
});

const serializers = db.serializerReadOnlyMapping;

db.deleteSerializer({ serializerType: 'JSON' });
db.deleteAllSerializers();
```

Every strategy receives `{ serializerType, value, context? }`. Context can
identify `source` (`fetch`, `scalar-out`, or `manual`), database, column/output
name, and native database type. `null`/`undefined` values bypass the strategy
and normalize to `null`.

Supported serializer keys are `DATE`, `TIMESTAMP`, `TIMESTAMP_TZ`,
`TIMESTAMP_LTZ`, `BOOLEAN`, `CHAR`, `VARCHAR`, `JSON`, `BINARY`, and `XML`.

Runtime scope:

- PostgreSQL type parsers are attached to each package-created pool;
- Oracle fetch handlers are attached to the package DataSource execution path;
- the Oracle adapter sets `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT`.

## NestJS integration

```ts
import { Logger, Module } from '@nestjs/common';
import { TypeOrmProcedureKitNestModule } from 'typeorm-procedure-kit/nestjs';
import type { IModuleConfig } from 'typeorm-procedure-kit';

const config: IModuleConfig['config'] = {
  type: 'postgres',
  parseInt8AsNumber: true,
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
Use Nest's `app.enableShutdownHooks()` and leave `isRegisterShutdownHandlers`
disabled in Nest applications; enabling both lifecycle owners can terminate the
process before unrelated Nest providers finish cleanup.

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
PostgreSQL workflows. See the
[fork provenance and synchronization policy](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/TYPEORM_FORK.md);
the 0.3.28 baseline is inferred from the parent manifest because the original
import did not record an exact upstream SHA.

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
- `identifierQuoting: 'disabled'` by default for physical database, schema,
  table, and column names, while generated aliases remain quoted. Set
  `identifierQuoting: 'enabled'` on the kit config or direct `DataSource`, or
  call `setIdentifierQuoting('enabled')` on one query builder. `escape(name)`
  always performs explicit quoting regardless of this policy.

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
These handlers are intended for standalone processes: after cleanup the
original signal is re-sent, while a second signal during cleanup uses Node.js's
default termination behavior. Framework-managed applications should call
`destroy()` from their own lifecycle hook instead.

## Manual materialization benchmark

Run `npm run benchmark:postgre-materialization` manually after closing noisy
background workloads. The JSON output includes the median, raw samples,
nanoseconds per row, and the Node.js version, platform, and architecture. It is
a diagnostic tool and is intentionally outside CI; there is no built-in
baseline.

Comparison is enabled only when both positive, non-zero values are explicit:

```bash
npm run benchmark:postgre-materialization -- \
  --baseline-ns 20000 \
  --max-regression-percent 10
```

The command exits unsuccessfully when the measured median exceeds the permitted
regression.

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
- A top-level procedure error envelope containing a code key
  (`error_code`/`err_code` or case-transformed `errorCode`/`errCode`) and a text
  key (`error_text`/`err_text` or `errorText`/`errText`), with a nonzero code,
  is converted to `ServerError`. Business rows and nested objects are not
  recursively scanned.

## License

MIT.
