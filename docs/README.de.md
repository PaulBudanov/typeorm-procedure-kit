# typeorm-procedure-kit

Enterprise-TypeORM-Toolkit fuer Oracle und PostgreSQL.

Streng typisierte Repositories, gespeicherte Prozeduren, Entity-Vererbung fuer
mehrere Datenbanken, Raw-SQL-Orchestrierung, Datenbank-Benachrichtigungen,
Serializer und eine erweiterte, gebuendelte TypeORM-kompatible Runtime.

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

## Uebersetzungen

- [English](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.md)
- [Русский](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.ru.md)
- [Deutsch](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.de.md)
- [中文](https://github.com/PaulBudanov/typeorm-procedure-kit/tree/master/docs/README.zh.md)

---

## Warum dieses Paket existiert

TypeORM funktioniert gut fuer CRUD-orientierte Anwendungen. Enterprise-
Datenbanksysteme brauchen aber oft zusaetzliche Funktionen rund um gespeicherte
Prozeduren, Package-Metadaten, Oracle/PostgreSQL-Dual-Deployments,
notification-driven Synchronisation und datenbankspezifische Entity-Varianten.

`typeorm-procedure-kit` erhaelt eine TypeORM-kompatible Developer Experience und
ergaenzt:

- metadata-aware Aufrufe von Oracle Packages und PostgreSQL Schema Procedures;
- Raw-SQL-Ausfuehrung ueber denselben Transaction- und Error-Handling-Flow;
- PostgreSQL `LISTEN/NOTIFY` und Oracle Continuous Query Notification;
- dynamic procedure metadata refresh nach Aenderungen an Database Objects;
- gemeinsame Naming/Case-Regeln fuer native rows und ORM column names;
- serializers fuer database result values;
- eine gebuendelte TypeORM-kompatible API mit Fokus auf Oracle und PostgreSQL;
- entity extension decorators und repository helpers fuer datenbankspezifische
  entity targets.

## Vergleich mit upstream TypeORM

| Faehigkeit                             | TypeORM           | typeorm-procedure-kit |
| -------------------------------------- | ----------------- | --------------------- |
| Stored procedure metadata              | Teilweise/manuell | Eingebaut             |
| Oracle + PostgreSQL enterprise support | Begrenzt          | Fokussiert            |
| Strenge repository typing              | Teilweise         | Erweitert             |
| Multi-database entity inheritance      | Nein              | Ja                    |
| LISTEN/NOTIFY + Oracle CQN             | Nein              | Ja                    |
| Runtime metadata refresh               | Nein              | Ja                    |
| Database-specific repositories         | Manuell           | Eingebaut             |

## Anforderungen

- Node.js `>=20`
- TypeScript mit aktivierten decorators bei Verwendung von entity decorators
- PostgreSQL driver: `pg`
- Oracle driver: `oracledb`
- Optionale PostgreSQL streaming dependency: `pg-query-stream`
- Optionale NestJS peer dependencies: `@nestjs/common` und `@nestjs/core`

## Installation

```bash
npm install typeorm-procedure-kit
```

Installieren Sie den driver fuer Ihre Datenbank:

```bash
npm install pg
npm install oracledb
```

Installieren Sie `pg-query-stream` nur, wenn Sie PostgreSQL streaming APIs wie
`SelectQueryBuilder.stream()` oder `QueryRunner.stream()` verwenden.

```bash
npm install pg-query-stream
```

## Schnellstart

Dieses minimale PostgreSQL-Beispiel initialisiert das Kit, ruft eine konfigurierte
procedure auf und gibt Ressourcen wieder frei:

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

## Import Entry Points

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

| Import path                            | Verwendung                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `typeorm-procedure-kit`                | `TypeOrmProcedureKit`, public types, constants, utilities                       |
| `typeorm-procedure-kit/nestjs`         | NestJS module, service, method injection decorators                             |
| `typeorm-procedure-kit/typeorm`        | Bundled TypeORM-compatible decorators, DataSource, repositories, query builders |
| `typeorm-procedure-kit/typeorm-extend` | Entity metadata extension decorators und database-specific repository helpers   |

Fuer Entities, die von diesem Paket verwaltet werden, importieren Sie TypeORM
APIs aus `typeorm-procedure-kit/typeorm`. Das Paket enthaelt die
TypeORM-kompatible API, die es intern verwendet.

## Migration von TypeORM

Minimaler Migrationspfad:

Imports ersetzen:

```ts
// before
import { Entity, Column } from 'typeorm';

// after
import { Entity, Column } from 'typeorm-procedure-kit/typeorm';
```

Danach schrittweise erweiterte Funktionen einsetzen:

- stored procedures;
- repository helpers;
- multi-database entity inheritance;
- notification infrastructure;
- serializer pipeline;
- database-specific repositories.

Das Paket erhaelt eine TypeORM-kompatible Developer Experience und erweitert die
Runtime um Oracle/PostgreSQL-fokussierte Workflows und strengere Typisierung.

## API-Uebersicht

| Aufgabe                              | API                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Datenbankzugriff initialisieren      | `new TypeOrmProcedureKit(settings)`, `initDatabase()`                      |
| Stored procedure aufrufen            | `db.call<T>(name, params, options?)`                                       |
| Raw SQL transaction ausfuehren       | `db.callSqlTransaction<T>(sql, params?, options?)`                         |
| Notifications abonnieren             | `db.makeNotify<T>(options, oracleOptions?)`                                |
| Notifications abbestellen            | `db.unlistenNotify(channel)`                                               |
| Serializers registrieren             | `db.setSerializer()`, `db.deleteSerializer()`, `db.deleteAllSerializers()` |
| DataSource oder EntityManager nutzen | `db.dataSource`, `db.getEntityManager()`                                   |
| Graceful shutdown                    | `db.destroy()`, `db.registerShutdownHandlers()`                            |

## Konfiguration

Jedes Setup verwendet ein `IModuleConfig`-Objekt:

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

Gemeinsame Optionen:

- `master`: credentials fuer die primaere database connection.
- `slaves`: optionale read replicas fuer TypeORM replication.
- `poolSize`: Groesse des connection pool.
- `appName`: application name, der an unterstuetzte drivers uebergeben wird.
- `maxQueryExecutionTime`: slow-query threshold fuer die underlying DataSource;
  langsame queries werden geloggt, aber nicht abgebrochen.
- `logger.typeormLogLevels`: TypeORM log levels, die ueber `logger.module`
  ausgegeben werden. Unterstuetzt werden `query`, `error`, `schema`, `info`,
  `warn`, `migration` oder `all`.
- `queryTimeoutMs`: optionaler positiver integer query timeout in Millisekunden.
  PostgreSQL gibt ihn als `statement_timeout` an den `pg` pool weiter, also als
  statement-level timeout. Oracle setzt ihn fuer jede erworbene physical
  connection als `oracledb` `connection.callTimeout`; dies begrenzt jeden
  database round-trip, nicht die gesamte statement duration.
- `callTimeout`: deprecated alias fuer `maxQueryExecutionTime`.
- `outKeyTransformCase`: `camelCase`, `lowerCase` oder `snakeCase`; default ist
  `camelCase`.
- `isNeedRegisterDefaultSerializers`: registriert default date/time serializers.
- `entity`: entity discovery und optionale synchronization settings.
- `migration`: migration discovery und optionale startup execution settings.
- `isRegisterShutdownHandlers`: registriert process signal handlers, die
  `destroy()` aufrufen.

PostgreSQL-Optionen:

- `parseInt8AsBigInt`: required by the PostgreSQL config type und wird an den
  bundled driver als `parseInt8` uebergeben. Bei `true` parst `node-postgres`
  `int8` values als JavaScript numbers statt strings; Werte oberhalb von
  `Number.MAX_SAFE_INTEGER` koennen trotz des Optionsnamens Praezision verlieren.
- `packagesSettings.listenEventName`: erforderlich, wenn
  `isNeedDynamicallyUpdatePackagesInfo` `true` ist; ueberschreibt den
  notification channel fuer package updates.

Oracle-Optionen:

- `libraryPath`: optionales Oracle Client library directory fuer thick mode.
- Oracle CQN options wie `clientInitiated` und legacy `cqnPort` werden als
  zweites `makeNotify()`-Argument uebergeben, nicht als database config.

`packagesSettings.packages` enthaelt echte database package/schema names und
sollte lowercase values verwenden. Werte in `procedureObjectList` muessen echte
procedure names wie `billing.find_invoices` sein; die keys sind labels im config
object und keine aliases fuer `call()`.

`call()` kann `package.procedure` oder `schema.procedure` verwenden. Ein bare
`procedure` name ist nur erlaubt, wenn genau ein package/schema konfiguriert ist.

## Eingebaute Case Strategy

Dieselbe case strategy wird fuer native result keys und bundled
TypeORM-compatible column naming verwendet. Sie wird mit `outKeyTransformCase`
konfiguriert.

| Wert        | Beispiel database key           | Output key |
| ----------- | ------------------------------- | ---------- |
| `camelCase` | `USER_ID`, `user_id`, `user id` | `userId`   |
| `snakeCase` | `USER_ID`, `userId`, `User Id`  | `user_id`  |
| `lowerCase` | `USER_ID`, `User_Id`            | `user_id`  |

## Unterstuetzte Datenbanken

| Database   | Adapter support                                      |
| ---------- | ---------------------------------------------------- |
| PostgreSQL | Procedure metadata, raw SQL, LISTEN/NOTIFY, ORM APIs |
| Oracle     | Package metadata, raw SQL, CQN, ORM APIs             |

Die gebuendelte TypeORM-compatible runtime ist auf Oracle- und PostgreSQL-
workflows fokussiert. Das ist kein Versprechen, dass jede database-specific
Funktion beider Datenbanken von diesem Paket gewrapped wird.

## Gespeicherte Prozeduren

```ts
await db.call('billing.create_invoice', {
  customerId: 42,
  amount: 1000,
});
```

Procedure metadata wird waehrend `initDatabase()` aus den konfigurierten
database packages/schemas geladen. Der database user muss diese packages/schemas
inspecten koennen. `call()` kann ohne `config.packagesSettings` nicht verwendet
werden.

Procedure payloads koennen objects, arrays, `null` oder `undefined` sein. Scalar
strings und numbers werden zur Laufzeit abgelehnt.

## Raw SQL Transactions

```ts
await db.callSqlTransaction<{ total: number }>(
  'SELECT COUNT(*) AS total FROM invoices WHERE customer_id = :CUSTOMER_ID',
  { CUSTOMER_ID: 42 },
  { mode: 'master' }
);
```

Raw-SQL-placeholders muessen uppercase named parameters wie `:USER_ID` sein.
PostgreSQL schreibt sie in positional `$1`, `$2` bindings um; Oracle behaelt
named placeholders und uebergibt binding values an den driver. Raw SQL verwendet
denselben execution, transaction, serializer und error-handling flow wie
procedure calls.

Execution options:

- `mode`: `master` oder `slave`, default `master`.
- `optionsCommands`: eingeschraenkte setup commands, die in derselben
  transaction vor dem main query ausgefuehrt werden. Jeder Eintrag muss genau
  einen sicheren command ohne comments oder separators enthalten. PostgreSQL
  akzeptiert unterstuetzte `SET`, `SET LOCAL` und `SET TRANSACTION` forms;
  Oracle akzeptiert `ALTER SESSION SET name = value`.
- `queryId`: custom id fuer logs und wrapped database errors.

## Benachrichtigungen

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

Der PostgreSQL adapter parst JSON payloads, wenn moeglich. Wenn parsing
fehlschlaegt, erhaelt der callback den raw string; ein empty payload wird als
`{}` uebergeben. Listeners verwenden dedicated connections, periodic health
checks und guarded restore attempts nach connection loss.

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

Oracle erzeugt subscription names intern. Wenn CQN changed ROWIDs meldet, holt
der adapter changed rows und uebergibt diese rows an den callback. Oracle
subscriptions werden ueberwacht und nach CQN deregistration, shutdown events,
connection errors oder silent connection loss wiederhergestellt.
Verwenden Sie `clientInitiated: false` mit legacy `cqnPort` nur fuer
server-initiated CQN setups, die einen database callback port benoetigen.

### Dynamic Package Metadata Refresh

Dynamic refresh ist nur aktiv, wenn alle Bedingungen erfuellt sind:

- `packagesSettings` ist konfiguriert;
- `packagesSettings.packages` ist nicht leer;
- `packagesSettings.isNeedDynamicallyUpdatePackagesInfo` ist `true`.

PostgreSQL hoert standardmaessig auf `db_object_event`, ausser `listenEventName`
ist konfiguriert. Oracle fragt `SOLUTION_ROOT.DB_OBJECT_LOG` nach package
changes ab.

`packagesSettings.procedureMetadataSql` und
`packagesSettings.metadataNotificationSql` sind trusted developer SQL config,
keine runtime SQL builders. Halten Sie sie statisch oder setzen Sie sie nur aus
geprueften Konstanten zusammen; bauen Sie sie nicht aus user input.

`packagesSettings.procedureMetadataSql` kann die default procedure metadata
query fuer beide databases ersetzen. Die SQL muss `:PACKAGE_NAME` enthalten und
muss Spalten liefern, die nach snake_case to camelCase conversion zu
`IProcedureArgumentBase` passen: `procedure_name`, `argument_name`,
`argument_type`, `order` und `mode`.

`packagesSettings.metadataNotificationSql` kann die default SQL fuer metadata
refresh subscriptions ersetzen. PostgreSQL erwartet einen vollstaendigen
`LISTEN ...` command. Oracle erwartet eine vollstaendige CQN `SELECT ...` query.

## Serializers

Built-in serializers aktivieren:

```ts
const settings = {
  config: {
    // ...
    isNeedRegisterDefaultSerializers: true,
  },
};
```

Built-in serializers formatieren:

- `DATE` als `yyyy-MM-dd`
- `TIMESTAMP` als `yyyy-MM-dd HH:mm:ss Z`
- `TIMESTAMP_TZ` als `yyyy-MM-dd HH:mm:ss Z`

Custom serializers registrieren und entfernen:

```ts
db.setSerializer({
  serializerType: 'JSON',
  strategy: (value) => JSON.parse(value.toString()),
});

const serializers = db.serializerReadOnlyMapping;

db.deleteSerializer({ serializerType: 'JSON' });
db.deleteAllSerializers();
```

Supported serializer keys sind `DATE`, `TIMESTAMP`, `TIMESTAMP_TZ`, `BOOLEAN`,
`CHAR`, `VARCHAR`, `JSON`, `BINARY` und `XML`.

Runtime side effects:

- der PostgreSQL serializer ueberschreibt global `pg.Result.prototype.parseRow`;
- der Oracle serializer setzt global `oracledb.fetchTypeHandler`;
- der Oracle adapter setzt `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT`.

## NestJS Integration

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

Fuer synchronous setup uebergeben Sie `true` als zweiten `forRoot()`-Parameter,
damit das module global wird. Der Nest service initialisiert die database in
`onModuleInit()` und ruft `destroy()` beim application shutdown auf.

Der NestJS entry point exportiert auch decorators fuer injection einzelner
methods und lazy DataSource-Zugriff:

| Decorator                       | Delegiert an                                 |
| ------------------------------- | -------------------------------------------- |
| `@InjectCallProcedure()`        | `TypeOrmProcedureKit.call()`                 |
| `@InjectCallSql()`              | `TypeOrmProcedureKit.callSqlTransaction()`   |
| `@InjectGetDataSource()`        | `() => TypeOrmProcedureKit.dataSource`       |
| `@InjectMakeNotify()`           | `TypeOrmProcedureKit.makeNotify()`           |
| `@InjectUnlistenNotify()`       | `TypeOrmProcedureKit.unlistenNotify()`       |
| `@InjectSetSerializer()`        | `TypeOrmProcedureKit.setSerializer()`        |
| `@InjectDeleteSerializer()`     | `TypeOrmProcedureKit.deleteSerializer()`     |
| `@InjectDeleteAllSerializers()` | `TypeOrmProcedureKit.deleteAllSerializers()` |

## Gebuendelte TypeORM-kompatible API

Der entry point `typeorm-procedure-kit/typeorm` exportiert decorators,
DataSource, EntityManager, repositories, query builders und related types. Die
runtime basiert auf einem maintained TypeORM-compatible fork, optimiert fuer
Oracle- und PostgreSQL-workflows.

Verwenden Sie die dokumentierten entry points statt deep imports in interne
bundled-TypeORM-Dateien. In SQL tagged templates werden scalar values automatisch
parametrisiert. `SqlTagUtils` behandelt TypeORM-compatible raw function
expressions nicht mehr als raw SQL path; callbacks, die SQL text zurueckgeben,
werden daher abgelehnt. Migration path: Verwenden Sie `unsafeRawSql()` nur fuer
gepruefte trusted SQL fragments, `sqlIdentifier()` fuer dynamic identifiers und
`sqlParameterList()` fuer Parameterlisten. Ein callback mit einem nicht leeren
Array bleibt parameter-list expansion, nicht raw SQL.

Enhancements include:

- strengere Typisierung fuer repositories, query builders und entity manager;
- generic-aware entity metadata an mehr Stellen;
- `FindOptionsWhere`, `DeepPartial` und `QueryPartialEntity` types aligned with
  the entity shape exported by this package;
- `EntityMetadata.propertiesMap` fuer TypeORM property paths inklusive
  relations, und `EntityMetadata.databasePropertiesMap` fuer database column
  names nach explicit `@Column({ name })` options und naming strategy rules;
- `isQuotingDisabled: true` bei der Initialisierung der kit DataSource, sodass
  query builders identifiers standardmaessig nicht quoten. Quoting kann mit
  `enableEscaping()` oder `escape(name, true)` aktiviert werden.

## TypeORM Extension Decorators

`typeorm-procedure-kit/typeorm-extend` exportiert:

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

Das `propertyPaths` object ist eine relation-aware TypeORM property path map aus
entity metadata. Verwenden Sie es fuer QueryBuilder property expressions wie
`where`, `leftJoin`, `orderBy`, `take` und `skip`; relation fields sind per dot
access verfuegbar, zum Beispiel liefert
`propertyPaths.additionalMessage.isDeleted` den Wert
`additionalMessage.isDeleted`.

Das `property` object ist eine database column path map, compatible with
`EntityMetadata.databasePropertiesMap`. Verwenden Sie es nur fuer raw SQL
fragments, die echte database column names brauchen; relation fields sind per dot
access fuer joined aliases verfuegbar, zum Beispiel liefert
`property.additionalMessage.isDeleted` den Wert `IS_DELETED`.

Migration note: Dies ist ein breaking repository API behavior change fuer Code,
der QueryBuilder property paths in `property` oder database column names in
`databaseProperty` erwartet hat. Verschieben Sie QueryBuilder usages auf
`propertyPaths` und raw SQL column usages auf `property`.

## Zugriff auf EntityManager und DataSource

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

`getEntityManager()` akzeptiert `master` oder `slave`. Wenn `slave` angefordert
wird, aber kein slave konfiguriert ist, wird eine warning geloggt und die master
connection verwendet.

## Shutdown

Rufen Sie `destroy()` auf, wenn die application stoppt:

```ts
await db.destroy();
```

`destroy()` meldet notifications ab, zerstoert den DataSource pool, leert
procedure and naming caches und wirft `AggregateError`, wenn ein Teil des
cleanup fehlschlaegt. Setzen Sie `isRegisterShutdownHandlers: true`, um process
signal handlers automatisch zu registrieren, oder rufen Sie
`db.registerShutdownHandlers()` selbst auf.

## Haeufige Fehler

- `TypeOrmProcedureKit is not initialized`: rufen Sie `await initDatabase()` auf,
  bevor runtime methods verwendet werden.
- `Procedure packages are not configured`: setzen Sie `config.packagesSettings`,
  bevor `call()` verwendet wird.
- `Package "... " or process "... " not found`: pruefen Sie package names,
  `procedureObjectList` und database metadata visibility.
- `Payload for call procedure must be an object or array or undefined or null`:
  uebergeben Sie keinen scalar payload an `call()`.
- `Unsafe SQL identifier for ...`: procedure, cursor oder notification channel
  names muessen dem supported identifier pattern entsprechen.
- Database result objects mit nonzero `error_code` oder `err_code` werden in
  `ServerError` umgewandelt.

## License

MIT.
