<h1 align="center">typeorm-procedure-kit</h1>

<p align="center">
  Type-safe procedure execution, SQL transactions, database notifications, and
  a bundled TypeORM-compatible API for Oracle and PostgreSQL.
</p>

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

<p align="center">
  <a href="#package-summary">Summary</a>
  · <a href="#use-cases">Use cases</a>
  · <a href="#api-map">API map</a>
  · <a href="#quick-start">Quick start</a>
  · <a href="#installation">Installation</a>
  · <a href="#import-entry-points">Entry points</a>
  · <a href="#configuration-shape">Configuration</a>
  · <a href="#built-in-case-strategy">Case strategy</a>
</p>

<p align="center">
  <a href="#installation">Installation</a>
  · <a href="#import-entry-points">Entry points</a>
  · <a href="#configuration-shape">Configuration</a>
  · <a href="#built-in-case-strategy">Case strategy</a>
  · <a href="#postgresql-setup">PostgreSQL</a>
  · <a href="#oracle-setup">Oracle</a>
  · <a href="#procedure-calls">Procedures</a>
  · <a href="#raw-sql-transactions">Raw SQL</a>
  · <a href="#notifications">Notifications</a>
  · <a href="#dynamic-package-metadata-refresh">Metadata refresh</a>
  · <a href="#serializers">Serializers</a>
  · <a href="#nestjs-integration">NestJS</a>
  · <a href="#bundled-typeorm-compatible-api">TypeORM API</a>
  · <a href="#future-orm-direction">Future ORM</a>
  · <a href="#typeorm-extension-decorators">Extensions</a>
  · <a href="#shutdown">Shutdown</a>
  · <a href="#common-errors">Errors</a>
  · <a href="./README.ru.md">Русский</a>
</p>

---

## Package summary

`typeorm-procedure-kit` is a TypeScript database toolkit for Node.js services
that use Oracle or PostgreSQL stored procedures, raw SQL transactions, database
notifications, and TypeORM-style entity APIs.

| Field                  | Value                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| npm package            | `typeorm-procedure-kit`                                                                                          |
| Runtime                | Node.js `>=20`                                                                                                   |
| Module formats         | ESM and CommonJS                                                                                                 |
| Supported databases    | PostgreSQL through `pg`; Oracle through `oracledb`                                                               |
| Main API               | `TypeOrmProcedureKit`                                                                                            |
| NestJS API             | `typeorm-procedure-kit/nestjs`                                                                                   |
| TypeORM-compatible API | `typeorm-procedure-kit/typeorm`                                                                                  |
| Entity extension API   | `typeorm-procedure-kit/typeorm-extend`                                                                           |
| Primary topics         | stored procedures, raw SQL transactions, LISTEN/NOTIFY, Oracle CQN, serializers, TypeORM-compatible repositories |

## Use cases

Use this package when your service needs one or more of these capabilities:

- Call Oracle packages or PostgreSQL schema procedures with database metadata.
- Execute raw SQL through the same transaction and error-handling flow.
- Subscribe to PostgreSQL `LISTEN/NOTIFY` or Oracle Continuous Query
  Notification and restore subscriptions after connection loss.
- Keep procedure metadata fresh through database change notifications.
- Normalize result key casing for raw rows and TypeORM-compatible entity column
  names.
- Use a bundled TypeORM-compatible API without installing upstream `typeorm`.
- Share base entity metadata between Oracle and PostgreSQL entity variants.

## API map

| Task                                 | API                                                                                   | Import path                            |
| ------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------- |
| Initialize database access           | `new TypeOrmProcedureKit(config)`, `initDatabase()`                                   | `typeorm-procedure-kit`                |
| Call a stored procedure              | `db.call<T>(name, params, options?)`                                                  | `typeorm-procedure-kit`                |
| Execute raw SQL transaction          | `db.callSqlTransaction<T>(sql, params?, options?)`                                    | `typeorm-procedure-kit`                |
| Subscribe to database notifications  | `db.makeNotify<T>(options, oracleOptions?)`                                           | `typeorm-procedure-kit`                |
| Unsubscribe from notifications       | `db.unlistenNotify(channel)`                                                          | `typeorm-procedure-kit`                |
| Register serializers                 | `db.setSerializer()`, `db.deleteSerializer()`                                         | `typeorm-procedure-kit`                |
| Access DataSource or EntityManager   | `db.dataSource`, `db.getEntityManager()`                                              | `typeorm-procedure-kit`                |
| Use NestJS integration               | `TypeOrmProcedureKitNestModule` and injection decorators                              | `typeorm-procedure-kit/nestjs`         |
| Use TypeORM-compatible APIs          | `Entity`, `Column`, `DataSource`, `Repository`                                        | `typeorm-procedure-kit/typeorm`        |
| Extend entity metadata               | `ExtendEntity`, `ExtendColumn`, `ExtendPrimaryColumn`, `ExtendPrimaryGeneratedColumn` | `typeorm-procedure-kit/typeorm-extend` |
| Build database-specific repositories | `AbstractTypeormRepository`, `AbstractTypeormRepository.createEntityTargetFactory`    | `typeorm-procedure-kit/typeorm-extend` |

## At a glance

| Area           | What you get                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Procedures     | Metadata-aware stored procedure calls for Oracle and PostgreSQL packages/schemas.                       |
| SQL            | Raw SQL execution through the same transaction flow as procedure calls.                                 |
| Notifications  | PostgreSQL `LISTEN/NOTIFY` and Oracle Continuous Query Notification support.                            |
| Case strategy  | Shared casing rules for native result keys and bundled TypeORM-compatible column names.                 |
| Serialization  | Built-in and custom serializers for database result values.                                             |
| NestJS         | Global dynamic module plus focused injection decorators for the public runtime methods.                 |
| TypeORM API    | Bundled TypeORM-compatible exports with stricter project-local types for repositories and query APIs.   |
| TypeORM Extend | Entity metadata extension decorators plus database-specific repository helpers.                         |
| Identifiers    | TypeORM-compatible query builders keep identifiers unquoted by default to avoid unwanted double quotes. |

Maintained by Paul Budanov.

## What this package provides

- `TypeOrmProcedureKit` as the main runtime API for database initialization,
  stored procedure calls, raw SQL calls, notifications, serializers, and
  graceful shutdown.
- Oracle and PostgreSQL adapters with a common procedure execution contract.
- Automatic procedure metadata loading from database packages/schemas.
- Runtime package metadata refresh through database notifications.
- A built-in case strategy for native result keys and bundled
  TypeORM-compatible column names: `camelCase`, `lowerCase`, or `snakeCase`.
- Built-in and custom serializers for database result values.
- NestJS integration through a global dynamic module and decorators for
  injecting individual public methods.
- A bundled TypeORM-compatible export for Oracle/PostgreSQL projects; TypeORM
  is included in this package with type fixes for stricter TypeScript projects.
- `typeorm-extend` decorators for deriving database-specific entity metadata,
  plus repository helpers for selecting the entity target from the active
  DataSource.
- Identifier quoting is disabled by default for the bundled TypeORM-compatible
  DataSource, so generated SQL avoids accidental double-quoted table and column
  names unless you explicitly enable escaping.

## Requirements

- Node.js `>=20`
- Any npm-registry package manager:
  - npm
  - Yarn
  - pnpm
- TypeScript with decorators enabled when using entities
- At least one database driver installed for your target database:
  - PostgreSQL: `pg`
  - Oracle: `oracledb`
- Optional PostgreSQL streaming dependency: `pg-query-stream`, needed only when
  calling public stream APIs such as `SelectQueryBuilder.stream()` or
  `QueryRunner.stream()`.
- Optional NestJS peer dependencies when using the NestJS module:
  `@nestjs/common` and `@nestjs/core`

## Installation

Use your package manager of choice:

| Package manager | Command                             |
| --------------- | ----------------------------------- |
| npm             | `npm install typeorm-procedure-kit` |
| Yarn            | `yarn add typeorm-procedure-kit`    |
| pnpm            | `pnpm add typeorm-procedure-kit`    |

Install the driver for the database you use.

PostgreSQL:

| Package manager | Command          |
| --------------- | ---------------- |
| npm             | `npm install pg` |
| Yarn            | `yarn add pg`    |
| pnpm            | `pnpm add pg`    |

Oracle:

| Package manager | Command                |
| --------------- | ---------------------- |
| npm             | `npm install oracledb` |
| Yarn            | `yarn add oracledb`    |
| pnpm            | `pnpm add oracledb`    |

Install `pg-query-stream` only when you use PostgreSQL streaming:

| Package manager | Command                       |
| --------------- | ----------------------------- |
| npm             | `npm install pg-query-stream` |
| Yarn            | `yarn add pg-query-stream`    |
| pnpm            | `pnpm add pg-query-stream`    |

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
  debug: console.debug,
  verbose: console.debug,
};

const settings: IModuleConfig = {
  logger,
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

The root import exports the kit, public types, constants, and utilities. TypeORM
is already included in this package: decorators, DataSource, EntityManager,
repositories, query builders, and related classes are exported from the
`./typeorm` entry point. For entities managed by this kit, import TypeORM APIs
from `typeorm-procedure-kit/typeorm` instead of installing or importing the
upstream `typeorm` package separately.

| Import path                            | Use it for                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `typeorm-procedure-kit`                | `TypeOrmProcedureKit`, public types, utilities, constants                       |
| `typeorm-procedure-kit/nestjs`         | NestJS module, service, method injection decorators                             |
| `typeorm-procedure-kit/typeorm`        | Bundled TypeORM-compatible decorators, DataSource, repositories, query builders |
| `typeorm-procedure-kit/typeorm-extend` | Entity metadata extension decorators and database-specific repository helpers   |

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
  debug: (message, ...optionalParams) =>
    console.debug(message, ...optionalParams),
  verbose: (message, ...optionalParams) =>
    console.debug(message, ...optionalParams),
};

const config: IModuleConfig = {
  logger,
  isRegisterShutdownHandlers: true,
  config: {
    type: 'postgres',
    master: {
      host: 'localhost',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'app_db',
    },
    poolSize: 10,
    parseInt8AsBigInt: true,
    appName: 'procedure-service',
    callTimeout: 30_000,
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

Common database options:

- `master`: credentials for the primary database connection.
- `slaves`: optional read replicas for TypeORM replication.
- `poolSize`: connection pool size.
- `appName`: application name passed to supported drivers.
- `callTimeout`: slow-query logging threshold passed to TypeORM.
- `parseInt8AsBigInt`: PostgreSQL-only option passed to the bundled driver as
  `parseInt8`. When `true`, `node-postgres` parses `int8` values as JavaScript
  numbers instead of strings; values above `Number.MAX_SAFE_INTEGER` can lose
  precision despite the option name.
- `outKeyTransformCase`: output key case, defaulting to `camelCase`.
- `isNeedRegisterDefaultSerializers`: registers default date/time serializers.
- `isNeedClientNotificationInit`: Oracle CQN default mode. Use `true` for
  client-initiated notifications, or `false` with `cqnPort` for server callback
  notifications.
- `packagesSettings`: packages/schemas and procedures that can be called by
  `call()`.

`packagesSettings.packages` must use lowercase names. Procedure call names are
resolved case-insensitively and normalized internally.

In PostgreSQL examples, "package" means the configured schema namespace used by
the kit. In Oracle examples, it means an Oracle package.

`procedureObjectList` is used to resolve configured procedure names and, when
several packages/schemas are configured, to skip procedures outside the current
package. Keys are labels for the configuration object only; values must be real
database procedure names. Use `package.procedure` or `schema.procedure` when
several packages are configured. A bare `procedure` name is accepted when there
is exactly one package. Runtime calls resolve against the loaded database names,
so use `db.call('billing.find_invoices')` or `db.call('find_invoices')` when
only one package is configured. Do not use `procedureObjectList` keys as call
aliases.

If `packagesSettings.packages` is present and the packages array is non-empty,
`initDatabase()` also creates the package-change notification subscription.
Configure the database notification source before using these examples
unchanged.

## Built-in case strategy

`typeorm-procedure-kit` has a built-in case strategy for the two places where
database names meet application code: native result objects and the bundled
TypeORM-compatible naming strategy. Configure it with
`config.outKeyTransformCase` inside the database config.

Supported values:

| Value       | Example database key            | Output key |
| ----------- | ------------------------------- | ---------- |
| `camelCase` | `USER_ID`, `user_id`, `user id` | `userId`   |
| `snakeCase` | `USER_ID`, `userId`, `User Id`  | `user_id`  |
| `lowerCase` | `USER_ID`, `User_Id`            | `user_id`  |

When `outKeyTransformCase` is omitted, `camelCase` is used. Unknown values also
fall back to `camelCase` at runtime.

The package creates one shared `OrmStrategy` from this setting. It is installed
as the DataSource naming strategy during initialization and is also passed to
driver fetch hooks as the raw result key transformer.

`OrmStrategy` transforms entity property names before delegating to the bundled
default naming strategy, so generated column names follow the configured
convention when a decorator does not provide an explicit name. The same
`transformColumnName` method is used for column names reported by `pg` or
`oracledb` metadata before native rows are returned from procedure calls and raw
SQL calls. SQL aliases are transformed too because drivers expose aliases as
result metadata.

TypeORM entity hydration uses the active `OrmStrategy` transform function when
reading raw results, so query builder aliases can be matched after driver-level
key transformation.

For TypeORM query builder selections that can be resolved through entity
metadata, raw result keys are normalized back to entity property names. For
example, selecting database columns such as `m.KEYID`, `m.STATUS`, and `m.TEXT`
can still return raw keys `keyId`, `status`, and `text`. In that case
`outKeyTransformCase` is only an intermediate driver-level transformation. It
still applies directly to native adapter results and to custom raw aliases that
cannot be mapped to entity metadata.

Partial selections can be written as `alias.propertyPath`,
`alias.databaseName`, or `alias.databasePath`. Resolvable selections hydrate
entities and normalize raw result keys by entity property path; custom raw
aliases are left unchanged.

Example:

```ts
const config: IModuleConfig = {
  logger,
  config: {
    type: 'postgres',
    master,
    poolSize: 10,
    parseInt8AsBigInt: true,
    outKeyTransformCase: 'snakeCase',
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

With this configuration a raw result column such as `USER_ID` or `userId`
becomes `user_id` in returned objects. With `camelCase`, the same value becomes
`userId`.

Important details:

- The strategy changes output object keys and generated ORM column names. It
  does not rewrite package names, procedure names, SQL text, bind placeholders,
  table names, relation names, or notification channel names.
- `packagesSettings.packages` should still be lowercase because procedure
  resolution normalizes configured package/schema names internally.
- Raw SQL bind placeholders still use the documented uppercase style such as
  `:USER_ID`.
- Explicit custom column names in decorators are honored by the bundled default
  naming strategy, preserving standard TypeORM override behavior.
- `lowerCase` only lowercases the incoming string. Use `snakeCase` when you need
  word splitting such as `User Id` -> `user_id`.
- Transformed names are cached for the lifetime of the kit instance and the
  cache is cleared during `destroy()`.

Oracle CQN can be configured in two modes. Server callback mode exposes a local
port for database notifications:

```ts
const oracleServerCallbackConfig: IModuleConfig['config'] = {
  type: 'oracle',
  master: {
    host: 'localhost',
    port: 1521,
    username: 'APP',
    password: 'secret',
    database: 'ORCLCDB',
  },
  poolSize: 10,
  libraryPath: '/opt/oracle/instantclient',
  cqnPort: 9090,
  isNeedClientNotificationInit: false,
};
```

Client-initiated mode does not require `cqnPort` and is often easier when the
database cannot connect back to the application host:

```ts
const oracleClientInitiatedConfig: IModuleConfig['config'] = {
  type: 'oracle',
  master: {
    host: 'localhost',
    port: 1521,
    username: 'APP',
    password: 'secret',
    database: 'ORCLCDB',
  },
  poolSize: 10,
  libraryPath: '/opt/oracle/instantclient',
  isNeedClientNotificationInit: true,
};
```

The per-subscription `makeNotify()` Oracle option `clientInitiated` can
override this default for a single subscription.

## PostgreSQL setup

```ts
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { ILoggerModule, IModuleConfig } from 'typeorm-procedure-kit';

const logger: ILoggerModule = {
  error: (message, ...optionalParams) =>
    console.error(message, ...optionalParams),
  log: (message, ...optionalParams) => console.log(message, ...optionalParams),
  warn: (message, ...optionalParams) =>
    console.warn(message, ...optionalParams),
  debug: (message, ...optionalParams) =>
    console.debug(message, ...optionalParams),
  verbose: (message, ...optionalParams) =>
    console.debug(message, ...optionalParams),
};

const settings: IModuleConfig = {
  logger,
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
      packages: ['api'],
      procedureObjectList: {
        getUser: 'api.get_user',
        searchUsers: 'api.search_users',
      },
    },
  },
};

const db = new TypeOrmProcedureKit(settings);

await db.initDatabase();

const users = await db.call<{ id: number; fullName: string }>(
  'api.search_users',
  {
    query: 'Paul',
  }
);

await db.destroy();
```

For PostgreSQL, procedure calls are generated as:

```sql
CALL "package"."procedure"($1, $2, ...)
```

PostgreSQL `refcursor` output arguments are fetched and closed inside the same
transaction.

## Oracle setup

```ts
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { ILoggerModule, IModuleConfig } from 'typeorm-procedure-kit';

const logger: ILoggerModule = {
  error: (message, ...optionalParams) =>
    console.error(message, ...optionalParams),
  log: (message, ...optionalParams) => console.log(message, ...optionalParams),
  warn: (message, ...optionalParams) =>
    console.warn(message, ...optionalParams),
  debug: (message, ...optionalParams) =>
    console.debug(message, ...optionalParams),
  verbose: (message, ...optionalParams) =>
    console.debug(message, ...optionalParams),
};

const settings: IModuleConfig = {
  logger,
  config: {
    type: 'oracle',
    master: {
      host: 'localhost',
      port: 1521,
      username: 'APP',
      password: 'secret',
      database: 'ORCLCDB',
    },
    poolSize: 10,
    libraryPath: '/opt/oracle/instantclient',
    cqnPort: 9090,
    isNeedClientNotificationInit: false,
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

const invoices = await db.call<{ invoiceId: number }>('billing.find_invoices', {
  customerId: 100,
});

await db.destroy();
```

For Oracle, procedure calls are generated as:

```sql
BEGIN PACKAGE.PROCEDURE(:arg1, :arg2); END;
```

Oracle `REF CURSOR` outputs are streamed and returned as result rows.

## Procedure calls

`call<T>()` requires `config.packagesSettings`.

```ts
const rows = await db.call<{ id: number; status: string }>(
  'billing.find_invoices',
  { customerId: 42, status: 'OPEN' }
);
```

If exactly one package is configured, you can omit the package name:

```ts
const rows = await db.call('find_invoices', { customerId: 42 });
```

Payload rules:

- Pass an object to bind by argument name. The adapters also try the same name
  without a leading `p_`, so `p_customer_id` can be supplied as `customer_id`.
- Pass an array to bind by procedure argument position.
- Omit the payload or pass `undefined`/`null` to bind all non-cursor values as
  `null`.
- Do not pass a scalar string or number as the procedure payload.

The public procedure payload types are exported as `TProcedurePayload` and
`TProcedurePayloadInput`. `call<T, U extends TProcedurePayload>()` accepts
object-like payloads, including arrays for positional binding, plus
`undefined`/`null`.

```ts
await db.call('billing.update_invoice', [42, 'PAID']);
```

The third argument is an array of SQL commands executed before the main call
inside the same transaction:

```ts
await db.call('billing.recalculate', { invoiceId: 42 }, [
  'SET LOCAL statement_timeout = 30000',
]);
```

## Raw SQL transactions

Use `callSqlTransaction<T>()` for a raw SQL statement that should use the same
transaction, logging, error handling, and connection release flow.

Parameters are detected only from uppercase `:PARAM_NAME` placeholders.

```ts
const rows = await db.callSqlTransaction<{ id: number; name: string }>(
  'SELECT id, name FROM users WHERE id = :USER_ID',
  { USER_ID: 7 }
);
```

PostgreSQL rewrites placeholders to `$1`, `$2`, and Oracle keeps `:PARAM`
placeholders.

## Notifications

### PostgreSQL LISTEN/NOTIFY

```ts
const channel = await db.makeNotify<{ event: string; object: string }>({
  sql: 'LISTEN package_changed',
  notifyCallback: (payload) => {
    console.log(payload.event, payload.object);
  },
});

await db.unlistenNotify(channel);
```

The PostgreSQL adapter validates the channel name, opens a dedicated `pg.Client`,
parses JSON payloads when possible, and attempts to restore the listener after
connection errors. It also runs a periodic connection health check, so a
listener can be restored after silent network drops where PostgreSQL does not
emit an explicit notification event.

Notification restore retry options can be passed as the second argument of
`makeNotify()` for Oracle, and as the adapter notification options for direct
adapter usage:

- `maxRetries`: number of restore attempts before the long retry delay,
  default `5`.
- `retryDelayMs`: delay between regular restore attempts, default `30000`.
- `retryAfterMaxDelayMs`: delay after `maxRetries` are exhausted before the
  counter starts again, default `1800000`.

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

Oracle generates an internal UUID subscription name. When row IDs are reported,
the adapter fetches changed rows and passes them to the callback.
Passing an `operations` array creates one CQN subscription per operation; the
returned channel string contains the generated subscription names and can be
passed back to `unlistenNotify()` unchanged.

Oracle notification defaults are:

- `operations`: `oracledb.CQN_OPCODE_ALL_OPS`
- `qos`: `oracledb.SUBSCR_QOS_ROWIDS`
- `timeout`: 12 hours
- `clientInitiated`: subscription option, then config default, then `false`

When `operations` is an array, it must contain fewer than four operation codes.
Use `oracledb.CQN_OPCODE_ALL_OPS` instead of listing every operation manually.
Oracle subscriptions are also monitored by a periodic connection health check
and restored after CQN deregistration, shutdown events, connection errors, or
silent connection loss.

## Dynamic package metadata refresh

When `packagesSettings.packages` is configured, `initDatabase()` loads package
procedure metadata from the database. It also creates a package-change
notification subscription whenever the packages array is non-empty, so make
sure the database user has access to the notification source. PostgreSQL
listens on `db_object_event` by default, and Oracle queries
`SOLUTION_ROOT.DB_OBJECT_LOG`.

For PostgreSQL, `listenEventName` can override the package-update notification
channel name when `isNeedDynamicallyUpdatePackagesInfo` is true:

```ts
packagesSettings: {
  packages: ['api'],
  procedureObjectList: {
    getUser: 'api.get_user',
  },
  isNeedDynamicallyUpdatePackagesInfo: true,
  listenEventName: 'package_changed',
}
```

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

Register a custom serializer:

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

## NestJS integration

```ts
import { Logger, Module } from '@nestjs/common';
import { TypeOrmProcedureKitNestModule } from 'typeorm-procedure-kit/nestjs';

@Module({
  imports: [
    TypeOrmProcedureKitNestModule.forRoot({
      logger: new Logger('TypeOrmProcedureKit'),
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
      },
    }),
  ],
})
export class AppModule {}
```

Async setup:

```ts
TypeOrmProcedureKitNestModule.forRootAsync({
  useFactory: async () => ({
    logger: new Logger('TypeOrmProcedureKit'),
    config: {
      type: 'postgres',
      parseInt8AsBigInt: true,
      master: {
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USER ?? 'app',
        password: process.env.DB_PASSWORD ?? 'secret',
        database: process.env.DB_NAME ?? 'app_db',
      },
      poolSize: 10,
    },
  }),
});
```

The Nest service extends `TypeOrmProcedureKit`, initializes the database in
`onModuleInit()`, and calls `destroy()` from `onApplicationShutdown()`.

The NestJS entry point also exports focused decorators for injecting individual
public methods instead of the full service:

| Decorator                       | Injected function type  | Delegates to                                 |
| ------------------------------- | ----------------------- | -------------------------------------------- |
| `@InjectCallProcedure()`        | `TCallProcedure`        | `TypeOrmProcedureKit.call()`                 |
| `@InjectCallSql()`              | `TCallSql`              | `TypeOrmProcedureKit.callSqlTransaction()`   |
| `@InjectMakeNotify()`           | `TMakeNotify`           | `TypeOrmProcedureKit.makeNotify()`           |
| `@InjectUnlistenNotify()`       | `TUnlistenNotify`       | `TypeOrmProcedureKit.unlistenNotify()`       |
| `@InjectSetSerializer()`        | `TSetSerializer`        | `TypeOrmProcedureKit.setSerializer()`        |
| `@InjectDeleteSerializer()`     | `TDeleteSerializer`     | `TypeOrmProcedureKit.deleteSerializer()`     |
| `@InjectDeleteAllSerializers()` | `TDeleteAllSerializers` | `TypeOrmProcedureKit.deleteAllSerializers()` |

```ts
import { Injectable } from '@nestjs/common';
import {
  InjectCallProcedure,
  InjectCallSql,
  type TCallProcedure,
  type TCallSql,
} from 'typeorm-procedure-kit/nestjs';

@Injectable()
export class BillingRepository {
  public constructor(
    @InjectCallProcedure()
    private readonly callProcedure: TCallProcedure,
    @InjectCallSql()
    private readonly callSql: TCallSql
  ) {}

  public findInvoices(customerId: number): Promise<Array<{ id: number }>> {
    return this.callProcedure<{ id: number }>('billing.find_invoices', {
      customerId,
    });
  }

  public countInvoices(customerId: number): Promise<Array<{ total: number }>> {
    return this.callSql<{ total: number }>(
      'SELECT COUNT(*) AS total FROM invoices WHERE customer_id = :CUSTOMER_ID',
      { CUSTOMER_ID: customerId }
    );
  }
}
```

## EntityManager and DataSource access

Use the underlying TypeORM-compatible objects when you need lower-level access:

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

`getEntityManager()` accepts `master` or `slave`.
`databaseAdapter` exposes the low-level adapter contract for diagnostics and
advanced integration code.

`isRegisterShutdownHandlers` registers shutdown handlers during construction.
If you need to attach them later, call `db.registerShutdownHandlers()`.

## Bundled TypeORM-compatible API

The bundled TypeORM-compatible API is customized for this kit. TypeORM is
included in the package as a maintained fork; the fork version used here is
`0.3.28`. Currently supported drivers are PostgreSQL and Oracle.

The TypeORM typing layer was reworked for stricter TypeScript projects:

- entity metadata is generic-aware in more places, so metadata operations keep
  better entity type information;
- repository, query builder, and entity manager methods have stricter generic
  return types;
- common repository inputs such as `FindOptionsWhere`, `FindManyOptions`,
  `FindOneOptions`, `DeepPartial`, and `QueryPartialEntity` are kept aligned
  with the entity shape exported by this package;
- decorator and metadata argument types are adjusted for database-specific
  entity variants;
- `Column`, `PrimaryColumn`, `PrimaryGeneratedColumn`, relation decorators, and
  entity schema options expose the database-specific surfaces used by the kit;
- Oracle/PostgreSQL column types and query-runner surfaces are narrowed for the
  supported drivers.

### Metadata property maps

`EntityMetadata.propertiesMap` is typed as `EntityPropertiesMap<T>` and keeps
TypeORM-compatible property-path semantics. Decorator callbacks for `Index`,
`Unique`, `RelationId`, `RelationCount`, and `EntityOptions.orderBy` receive
this map at runtime, so their values still resolve to entity property paths.
`orderBy` callbacks are evaluated after `propertiesMap` has been created.

`EntityMetadata.databasePropertiesMap` is a separate
`EntityDatabasePropertiesMap<T>`. It is column-only: leaf values contain
database column names or database paths after explicit `@Column({ name })`
options and naming strategy rules are applied. Relation virtual join columns
are intentionally excluded from this map.

```ts
import { Column, Entity, PrimaryColumn } from 'typeorm-procedure-kit/typeorm';

@Entity()
class User {
  @PrimaryColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: string;
}

// metadata.propertiesMap.userId === 'userId'
// metadata.databasePropertiesMap.userId === 'user_id'
```

For callback decorators, `user.userId` in `@Index((user) => [user.userId])`
continues to mean the property path `userId`; use `databasePropertiesMap` only
when database column names or paths are needed from metadata directly.

QueryBuilder replacement also resolves aliased property names to database
column names. For example, a condition like `m.lockStatus = :isLocked` is
rendered with the configured column name from metadata, such as
`m.LOCK_STATUS`, when `lockStatus` is declared with
`@Column({ name: 'LOCK_STATUS' })`.

The kit sets `isQuotingDisabled: true` during DataSource initialization. Query
builders keep identifiers unquoted by default, which avoids SQL like
`"USERS"` or `"CREATED_AT"` being generated accidentally when the database
schema expects plain uppercase identifiers. You can still opt into quoting when
you need it by calling `enableEscaping()` or by forcing a single identifier
through `escape(name, true)`.

This TypeORM quoting mode applies to generated entity, repository, and query
builder SQL. Procedure calls and notification channels use their own adapter
paths: identifiers are validated by `SqlIdentifier` and quoted or formatted
where the target database requires it.

## Future ORM direction

The current `typeorm-procedure-kit/typeorm` entry point is TypeORM-compatible
and remains the supported entity API for the package today. Future development
is planned to move the library toward its own ORM layer instead of depending on
the bundled TypeORM fork as the long-term foundation.

The goal of this direction is to keep the database workflow focused on the
features this package already owns: stored procedure metadata, Oracle and
PostgreSQL adapters, explicit identifier handling, repository/query APIs, and
strict TypeScript types. Any transition is expected to be incremental and
documented through the public entry points, without promising a specific
release date.

## TypeORM Extension API

`./typeorm-extend` exports decorators for reusing base entity metadata while
overriding options for database-specific variants:

- `ExtendEntity`
- `ExtendColumn`
- `ExtendPrimaryColumn`
- `ExtendPrimaryGeneratedColumn`

It also exports `AbstractTypeormRepository`, a base class for repositories that
need to choose an entity target from the active `DataSource`.

```ts
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm-procedure-kit/typeorm';

abstract class SoftDelete {
  @Column({
    type: Date,
    name: 'DELETED_AT',
    nullable: true,
    comment: 'Soft delete timestamp',
  })
  protected abstract readonly deletedAt: Date | null;

  @Column({
    type: Number,
    name: 'IS_DELETED',
    nullable: false,
    default: 0,
    comment: 'Soft delete flag',
  })
  protected abstract readonly isDeleted: number;
}

@Entity({
  name: 'OUTBOUND_MESSAGES',
  schema: 'APP_CORE',
  comment: 'Messages scheduled for external delivery',
})
export abstract class OutboundMessage extends SoftDelete {
  @PrimaryGeneratedColumn('uuid', {
    name: 'UUID',
    comment: 'Record identifier',
  })
  protected abstract readonly uuid: string | undefined | null;

  @Column({
    type: Date,
    name: 'CREATED_AT',
    nullable: false,
    comment: 'Creation timestamp',
  })
  protected abstract readonly createdAt: Date;

  @Column({
    type: Date,
    name: 'SEND_AT',
    nullable: true,
    comment: 'Planned send timestamp',
  })
  protected abstract readonly sendAt: Date | null;

  @Column({
    type: Number,
    name: 'RECIPIENT_ID',
    nullable: false,
    comment: 'Recipient identifier',
  })
  protected abstract readonly recipientId: number;

  @Column({
    type: String,
    name: 'CONTENT',
    length: 4000,
    nullable: true,
    comment: 'Message body',
  })
  protected abstract readonly content: string | null;

  @Column({
    type: String,
    name: 'DELIVERY_STATUS',
    default: 'CREATED',
    nullable: false,
    comment: 'Delivery status',
  })
  protected abstract readonly deliveryStatus: string;
}
```

```ts
import {
  ExtendColumn,
  ExtendEntity,
  ExtendPrimaryGeneratedColumn,
} from 'typeorm-procedure-kit/typeorm-extend';

import { OutboundMessage } from '../general/outbound-message.entity.js';

@ExtendEntity()
export class OutboundMessageOracle extends OutboundMessage {
  @ExtendPrimaryGeneratedColumn()
  declare public readonly uuid: string | null | undefined;

  @ExtendColumn({ type: 'date', default: 'SYSDATE' })
  declare public readonly createdAt: Date;

  @ExtendColumn({ type: 'date' })
  declare public readonly sendAt: Date | null;

  @ExtendColumn({ type: 'number' })
  declare public readonly recipientId: number;

  @ExtendColumn({ type: 'varchar2' })
  declare public readonly content: string | null;

  @ExtendColumn({ type: 'varchar2' })
  declare public readonly deliveryStatus: string;

  @ExtendColumn({ type: 'date' })
  declare public readonly deletedAt: Date | null;

  @ExtendColumn({ type: 'number' })
  declare public readonly isDeleted: number;
}
```

```ts
import {
  ExtendColumn,
  ExtendEntity,
  ExtendPrimaryGeneratedColumn,
} from 'typeorm-procedure-kit/typeorm-extend';

import { OutboundMessage } from '../general/outbound-message.entity.js';

@ExtendEntity()
export class OutboundMessagePostgres extends OutboundMessage {
  @ExtendPrimaryGeneratedColumn()
  declare public readonly uuid: string | null | undefined;

  @ExtendColumn({ type: 'timestamp', default: 'CURRENT_TIMESTAMP' })
  declare public readonly createdAt: Date;

  @ExtendColumn({ type: 'timestamp' })
  declare public readonly sendAt: Date | null;

  @ExtendColumn({ type: 'int8' })
  declare public readonly recipientId: number;

  @ExtendColumn({ type: 'varchar' })
  declare public readonly content: string | null;

  @ExtendColumn({ type: 'varchar' })
  declare public readonly deliveryStatus: string;

  @ExtendColumn({ type: 'timestamp' })
  declare public readonly deletedAt: Date | null;

  @ExtendColumn({ type: 'int2' })
  declare public readonly isDeleted: number;
}
```

`AbstractTypeormRepository` is a small base class for repositories that keep
separate Oracle and PostgreSQL entity classes. It accepts an entity target
factory and exposes a base query context with
`repository`, `builder`, `alias`, and `property`. The `property` object is
`EntityMetadata.databasePropertiesMap`, so `@Column({ name })` values and naming
strategy results are used when building SQL fragments manually.

`AbstractTypeormRepository.createEntityTargetFactory()` accepts a target map
keyed by `DataSourceOptions['type']` and returns a factory. The helper does not
hardcode driver names; it resolves the target with
`entityTargets[dataSource.options.type]`. With the current supported drivers,
the map contains `oracle` and `postgres` keys.

```ts
import type { DataSource, EntityTarget } from 'typeorm-procedure-kit/typeorm';
import { AbstractTypeormRepository } from 'typeorm-procedure-kit/typeorm-extend';

class ManRepository extends AbstractTypeormRepository<
  ManEntity,
  EntityTarget<ManEntity>
> {
  public constructor(getDataSource: () => DataSource) {
    super(
      getDataSource,
      AbstractTypeormRepository.createEntityTargetFactory({
        oracle: ManEntityOracle,
        postgres: ManEntityPostgres,
      })
    );
  }

  public loginMan(passwordHash: string): Promise<Pick<ManEntity, 'keyId'>> {
    const { builder, property, alias } = this.buildBaseQueryContext('m');

    return builder
      .select([`${alias}.${property.keyId}`])
      .where(`${alias}.${property.lockStatus} = :isLocked`, { isLocked: 0 })
      .andWhere(`${alias}.${property.passhash} = :passwordHash`, {
        passwordHash,
      })
      .getOneOrFail();
  }
}
```

The repository helper types are exported from `typeorm-procedure-kit` and
`typeorm-procedure-kit/typeorm-extend`: `IEntityTargets`,
`TEntityTargetFactory`, `IRepositoryContext`, and `IBuildBaseQueryContext`.

The base metadata must already exist through `@Entity`, `@Column`,
`@PrimaryColumn`, or `@PrimaryGeneratedColumn`.

## Shutdown

Call `destroy()` when the application stops:

```ts
await db.destroy();
```

`destroy()`:

- Unsubscribes notifications.
- Destroys the DataSource connection pool.
- Clears procedure and naming caches.
- Throws `AggregateError` if part of cleanup fails.

Set `isRegisterShutdownHandlers: true` to register process signal handlers that
call `destroy()` automatically.

## Important runtime notes

- The PostgreSQL serializer overrides `pg.Result.prototype.parseRow` globally.
- The Oracle serializer sets `oracledb.fetchTypeHandler` globally.
- The Oracle adapter sets `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT`.
- Package procedure metadata is loaded from the database during
  `initDatabase()`, so configured packages must exist and be visible to the
  database user.
- `call()` cannot be used without `packagesSettings`.
- Raw SQL parameter placeholders must be uppercase, for example `:USER_ID`.
- PostgreSQL `parseInt8AsBigInt` follows the bundled TypeORM/Postgres
  `parseInt8` behavior: `true` returns JavaScript numbers for `int8`, not
  native `bigint` values.

## Common errors

- `TypeOrmProcedureKit is not initialized`: call `await initDatabase()` before
  using runtime methods.
- `Procedure packages are not configured`: add `config.packagesSettings` before
  using `call()`.
- `Package "... " or process "... " not found`: this is the adapter error for an unknown procedure; check package names,
  `procedureObjectList`, and database metadata visibility.
- `Payload for call procedure must be an object or array or undefined or null`:
  do not pass a scalar payload to `call()`.
- `Unsafe SQL identifier for ...`: procedure, cursor, or notification channel
  names must match the supported identifier pattern before the adapter formats
  them into SQL.
- Database result objects with nonzero `error_code` or `err_code` are converted
  to `ServerError`.

## License

MIT.
