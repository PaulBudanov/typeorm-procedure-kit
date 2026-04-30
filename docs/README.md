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
  <a href="#installation">Installation</a>
  · <a href="#import-entry-points">Entry points</a>
  · <a href="#procedure-calls">Procedures</a>
  · <a href="#raw-sql-transactions">Raw SQL</a>
  · <a href="#notifications">Notifications</a>
  · <a href="#nestjs-integration">NestJS</a>
  · <a href="./README.ru.md">Русский</a>
</p>

---

## At a glance

| Area          | What you get                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Procedures    | Metadata-aware stored procedure calls for Oracle and PostgreSQL packages/schemas.                      |
| SQL           | Raw SQL execution through the same transaction flow as procedure calls.                                |
| Notifications | PostgreSQL `LISTEN/NOTIFY` and Oracle Continuous Query Notification support.                           |
| Serialization | Built-in and custom serializers for database result values.                                            |
| NestJS        | Global dynamic module plus focused injection decorators for the public runtime methods.                 |
| TypeORM API   | Bundled TypeORM-compatible exports with stricter project-local types for repositories and query APIs.   |
| Identifiers   | TypeORM-compatible query builders keep identifiers unquoted by default to avoid unwanted double quotes. |

Maintained by Paul Budanov.

## What this package provides

- `TypeOrmProcedureKit` as the main runtime API for database initialization,
  stored procedure calls, raw SQL calls, notifications, serializers, and
  graceful shutdown.
- Oracle and PostgreSQL adapters with a common procedure execution contract.
- Automatic procedure metadata loading from database packages/schemas.
- Runtime package metadata refresh through database notifications.
- Configurable output key casing: `camelCase`, `lowerCase`, or `snakeCase`.
- Built-in and custom serializers for database result values.
- NestJS integration through a global dynamic module and decorators for
  injecting individual public methods.
- A bundled TypeORM-compatible export for Oracle/PostgreSQL projects; TypeORM
  is included in this package with type fixes for stricter TypeScript projects.
- `typeorm-extend` decorators for deriving database-specific entity metadata.
- Identifier quoting is disabled by default for the bundled TypeORM-compatible
  DataSource, so generated SQL avoids accidental double-quoted table and column
  names unless you explicitly enable escaping.

## Requirements

- Node.js `>=20`
- npm `>=10`
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

```bash
npm install typeorm-procedure-kit
```

Install the driver for the database you use:

```bash
npm install pg
```

or:

```bash
npm install oracledb
```

Install `pg-query-stream` only when you use PostgreSQL streaming:

```bash
npm install pg-query-stream
```

## Import entry points

```ts
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { IModuleConfig } from 'typeorm-procedure-kit';

import { TypeOrmProcedureKitNestModule } from 'typeorm-procedure-kit/nestjs';

import { Entity, Column, PrimaryColumn } from 'typeorm-procedure-kit/typeorm';

import {
  ExtendColumn,
  ExtendEntity,
} from 'typeorm-procedure-kit/typeorm-extend';
```

The root import exports the kit, public types, constants, and utilities. TypeORM
is already included in this package: decorators, DataSource, EntityManager,
repositories, query builders, and related classes are exported from the
`./typeorm` entry point. For entities managed by this kit, import TypeORM APIs
from `typeorm-procedure-kit/typeorm` instead of installing or importing the
upstream `typeorm` package separately.

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

`procedureObjectList` keys are labels for the configuration object. Calls are
resolved from the values, so use `db.call('billing.find_invoices')` or
`db.call('find_invoices')` when only one package is configured.

If `packagesSettings.packages` is present, `initDatabase()` also creates the
package-change notification subscription. Configure the database notification
source before using these examples unchanged.

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

The per-subscription `makeNotify()`/`createNotification()` Oracle option
`clientInitiated` can override this default for a single subscription.

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
- Pass `undefined` or `null` to bind all non-cursor values as `null`.
- Do not pass a scalar string or number as the procedure payload.

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
connection errors.

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

## Dynamic package metadata refresh

When `packagesSettings.packages` is configured, `initDatabase()` loads package
procedure metadata from the database and creates a package-change notification
subscription. Make sure the database user has access to the notification source:
PostgreSQL listens on `db_object_event` by default, and Oracle queries
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

The deprecated misspelling `isNeedDynamiclyUpdatePackagesInfo` is still
accepted for compatibility, but new code should use
`isNeedDynamicallyUpdatePackagesInfo`.

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
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (configService: ConfigService) => ({
    logger: new Logger('TypeOrmProcedureKit'),
    config: {
      type: 'postgres',
      parseInt8AsBigInt: true,
      master: {
        host: configService.getOrThrow('DB_HOST'),
        port: Number(configService.getOrThrow('DB_PORT')),
        username: configService.getOrThrow('DB_USER'),
        password: configService.getOrThrow('DB_PASSWORD'),
        database: configService.getOrThrow('DB_NAME'),
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

| Decorator | Injected function type | Delegates to |
| --- | --- | --- |
| `@InjectCallProcedure()` | `TCallProcedure` | `TypeOrmProcedureKit.call()` |
| `@InjectCallSql()` | `TCallSql` | `TypeOrmProcedureKit.callSqlTransaction()` |
| `@InjectMakeNotify()` | `TMakeNotify` | `TypeOrmProcedureKit.makeNotify()` |
| `@InjectUnlistenNotify()` | `TUnlistenNotify` | `TypeOrmProcedureKit.unlistenNotify()` |
| `@InjectSetSerializer()` | `TSetSerializer` | `TypeOrmProcedureKit.setSerializer()` |
| `@InjectDeleteSerializer()` | `TDeleteSerializer` | `TypeOrmProcedureKit.deleteSerializer()` |
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
```

`getEntityManager()` accepts `master` or `slave`.

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

## TypeORM extension decorators

`./typeorm-extend` exports decorators for reusing base entity metadata while
overriding options for database-specific variants.

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
