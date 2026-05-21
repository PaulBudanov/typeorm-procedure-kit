<h1 align="center">typeorm-procedure-kit</h1>

<p align="center">
  Типобезопасный вызов процедур, SQL-транзакции, уведомления баз данных и
  встроенный TypeORM-совместимый API для Oracle и PostgreSQL.
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
  <a href="#краткая-сводка">Сводка</a>
  · <a href="#сценарии-использования">Сценарии</a>
  · <a href="#карта-api">Карта API</a>
  · <a href="#быстрый-старт">Быстрый старт</a>
  · <a href="#установка">Установка</a>
  · <a href="#точки-импорта">Точки импорта</a>
  · <a href="#конфигурация">Конфигурация</a>
  · <a href="#встроенная-case-strategy">Case strategy</a>
</p>

<p align="center">
  <a href="#установка">Установка</a>
  · <a href="#точки-импорта">Точки импорта</a>
  · <a href="#конфигурация">Конфигурация</a>
  · <a href="#встроенная-case-strategy">Case strategy</a>
  · <a href="#postgresql">PostgreSQL</a>
  · <a href="#oracle">Oracle</a>
  · <a href="#вызов-процедур">Процедуры</a>
  · <a href="#транзакции-с-sql-запросами-напрямую">SQL</a>
  · <a href="#уведомления">Уведомления</a>
  · <a href="#обновление-метаданных-packages">Metadata refresh</a>
  · <a href="#сериализаторы">Сериализаторы</a>
  · <a href="#nestjs">NestJS</a>
  · <a href="#встроенный-typeorm-compatible-api">TypeORM API</a>
  · <a href="#будущее-направление-orm">Будущая ORM</a>
  · <a href="#расширяющие-декораторы-typeorm">Extensions</a>
  · <a href="#завершение-работы">Завершение</a>
  · <a href="#частые-ошибки">Ошибки</a>
  · <a href="./README.md">English</a>
</p>

---

## Краткая сводка

`typeorm-procedure-kit` — TypeScript toolkit для Node.js сервисов, которые
работают с Oracle или PostgreSQL stored procedures, raw SQL transactions,
database notifications и TypeORM-style entity API.

| Поле                   | Значение                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| npm package            | `typeorm-procedure-kit`                                                                                          |
| Runtime                | Node.js `>=20`                                                                                                   |
| Module formats         | ESM и CommonJS                                                                                                   |
| Поддерживаемые базы    | PostgreSQL через `pg`; Oracle через `oracledb`                                                                   |
| Main API               | `TypeOrmProcedureKit`                                                                                            |
| NestJS API             | `typeorm-procedure-kit/nestjs`                                                                                   |
| TypeORM-compatible API | `typeorm-procedure-kit/typeorm`                                                                                  |
| Entity extension API   | `typeorm-procedure-kit/typeorm-extend`                                                                           |
| Основные темы          | stored procedures, raw SQL transactions, LISTEN/NOTIFY, Oracle CQN, serializers, TypeORM-compatible repositories |

## Сценарии использования

Используйте пакет, если сервису нужны одна или несколько возможностей:

- Вызов Oracle packages или PostgreSQL schema procedures с учетом database
  metadata.
- Выполнение raw SQL через тот же transaction и error-handling flow.
- Подписка на PostgreSQL `LISTEN/NOTIFY` или Oracle Continuous Query
  Notification с восстановлением subscriptions после обрыва соединения.
- Обновление procedure metadata во время работы через database change
  notifications.
- Нормализация регистра result keys для raw rows и TypeORM-compatible entity
  column names.
- Встроенный TypeORM-compatible API без установки upstream `typeorm`.
- Переиспользование базовой entity metadata между Oracle и PostgreSQL entity
  variants.

## Карта API

| Задача                                | API                                                                                   | Import path                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| Инициализация доступа к базе          | `new TypeOrmProcedureKit(config)`, `initDatabase()`                                   | `typeorm-procedure-kit`                |
| Вызов stored procedure                | `db.call<T>(name, params, options?)`                                                  | `typeorm-procedure-kit`                |
| Выполнение raw SQL transaction        | `db.callSqlTransaction<T>(sql, params?, options?)`                                    | `typeorm-procedure-kit`                |
| Подписка на database notifications    | `db.makeNotify<T>(options, oracleOptions?)`                                           | `typeorm-procedure-kit`                |
| Отписка от notifications              | `db.unlistenNotify(channel)`                                                          | `typeorm-procedure-kit`                |
| Регистрация serializers               | `db.setSerializer()`, `db.deleteSerializer()`                                         | `typeorm-procedure-kit`                |
| Доступ к DataSource или EntityManager | `db.dataSource`, `db.getEntityManager()`                                              | `typeorm-procedure-kit`                |
| NestJS integration                    | `TypeOrmProcedureKitNestModule` и injection decorators                                | `typeorm-procedure-kit/nestjs`         |
| TypeORM-compatible APIs               | `Entity`, `Column`, `DataSource`, `Repository`                                        | `typeorm-procedure-kit/typeorm`        |
| Расширение entity metadata            | `ExtendEntity`, `ExtendColumn`, `ExtendPrimaryColumn`, `ExtendPrimaryGeneratedColumn` | `typeorm-procedure-kit/typeorm-extend` |
| Database-specific repositories        | `AbstractTypeormRepository`, `AbstractTypeormRepository.createEntityTargetFactory`    | `typeorm-procedure-kit/typeorm-extend` |

## Кратко

| Область        | Что входит                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------- |
| Процедуры      | Вызов хранимых процедур с учетом метаданных для Oracle и PostgreSQL packages/schemas.         |
| SQL            | Выполнение SQL через тот же транзакционный поток, что и вызовы процедур.                      |
| Уведомления    | Поддержка PostgreSQL `LISTEN/NOTIFY` и Oracle Continuous Query Notification.                  |
| Case strategy  | Общие правила регистра для native result keys и встроенных TypeORM-compatible column names.   |
| Сериализация   | Встроенные и пользовательские сериализаторы значений из базы.                                 |
| NestJS         | Dynamic module с опциональной global-регистрацией и точечные injection decorators.            |
| TypeORM API    | Встроенные TypeORM-совместимые экспорты со строгими локальными типами repository и query API. |
| TypeORM Extend | Entity metadata extension decorators и database-specific repository helpers.                  |
| Идентификаторы | TypeORM-compatible query builders по умолчанию не оборачивают identifiers в двойные кавычки.  |

Автор и сопровождающий: Paul Budanov.

## Что входит в пакет

- `TypeOrmProcedureKit` как основной API времени выполнения для инициализации
  базы, вызова процедур, SQL-запросов напрямую, уведомлений, сериализаторов и
  корректного завершения работы.
- Общий контракт адаптеров для Oracle и PostgreSQL.
- Автоматическая загрузка метаданных процедур из database packages/schemas.
- Обновление метаданных процедур во время работы через уведомления базы.
- Встроенная case-strategy для native result keys и TypeORM-compatible column
  names: `camelCase`, `lowerCase`, `snakeCase`.
- Встроенные и пользовательские сериализаторы значений из базы.
- Интеграция с NestJS через dynamic module с опциональной global-регистрацией
  и decorators для инжекта отдельных публичных методов.
- Встроенный TypeORM-совместимый экспорт для Oracle/PostgreSQL проектов;
  TypeORM уже включен в пакет с type fixes для строгих TypeScript-проектов.
- `typeorm-extend` декораторы для наследования и переопределения метаданных
  entities, а также repository helpers для выбора entity target из активного
  DataSource.
- Экранирование identifiers отключено по умолчанию для встроенного
  TypeORM-compatible DataSource, поэтому generated SQL избегает случайных
  двойных кавычек вокруг table и column names, пока вы явно не включите
  escaping.

## Требования

- Node.js `>=20`
- Любой package manager, работающий с npm registry:
  - npm
  - Yarn
  - pnpm
- TypeScript с включенными decorators, если используются entities
- Драйвер для целевой базы:
  - PostgreSQL: `pg`
  - Oracle: `oracledb`
- Опциональная streaming-зависимость для PostgreSQL: `pg-query-stream`; она
  нужна только при вызове публичных stream API, например
  `SelectQueryBuilder.stream()` или `QueryRunner.stream()`.
- Опционально для NestJS: `@nestjs/common` и `@nestjs/core`

## Установка

Используйте удобный package manager:

| Package manager | Команда                             |
| --------------- | ----------------------------------- |
| npm             | `npm install typeorm-procedure-kit` |
| Yarn            | `yarn add typeorm-procedure-kit`    |
| pnpm            | `pnpm add typeorm-procedure-kit`    |

Установите драйвер для нужной базы.

PostgreSQL:

| Package manager | Команда          |
| --------------- | ---------------- |
| npm             | `npm install pg` |
| Yarn            | `yarn add pg`    |
| pnpm            | `pnpm add pg`    |

Oracle:

| Package manager | Команда                |
| --------------- | ---------------------- |
| npm             | `npm install oracledb` |
| Yarn            | `yarn add oracledb`    |
| pnpm            | `pnpm add oracledb`    |

Установите `pg-query-stream` только если используете PostgreSQL streaming:

| Package manager | Команда                       |
| --------------- | ----------------------------- |
| npm             | `npm install pg-query-stream` |
| Yarn            | `yarn add pg-query-stream`    |
| pnpm            | `pnpm add pg-query-stream`    |

## Быстрый старт

Минимальный PostgreSQL пример инициализирует kit, вызывает одну настроенную
процедуру и освобождает ресурсы:

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

Root import экспортирует kit, публичные типы, constants и utilities. TypeORM
уже включен в этот пакет: decorators, DataSource, EntityManager, repositories,
query builders и связанные классы экспортируются из `./typeorm`. Для entities,
которыми управляет kit, импортируйте TypeORM API из
`typeorm-procedure-kit/typeorm`, а не из отдельного upstream-пакета `typeorm`.

| Import path                            | Для чего использовать                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `typeorm-procedure-kit`                | `TypeOrmProcedureKit`, публичные типы, utilities, constants                        |
| `typeorm-procedure-kit/nestjs`         | NestJS module, service, method injection decorators                                |
| `typeorm-procedure-kit/typeorm`        | Встроенные TypeORM-compatible decorators, DataSource, repositories, query builders |
| `typeorm-procedure-kit/typeorm-extend` | Entity metadata extension decorators и database-specific repository helpers        |

## Конфигурация

Настройка выполняется через `IModuleConfig`:

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

Общие параметры:

- `master`: учетные данные основного подключения к базе.
- `slaves`: read replicas для TypeORM replication. Публичные методы kit падают
  сразу, если явно запрошен `mode: 'slave'`, но не настроена ни одна slave-БД.
- `poolSize`: размер пула соединений.
- `appName`: имя приложения для драйвера, если он это поддерживает.
- `callTimeout`: порог логирования медленных запросов для TypeORM.
- `parseInt8AsBigInt`: PostgreSQL-only параметр, который передается во
  встроенный драйвер как `parseInt8`. Когда значение равно `true`,
  `node-postgres` разбирает `int8` как JavaScript numbers вместо strings;
  значения выше `Number.MAX_SAFE_INTEGER` могут потерять точность, несмотря на
  название параметра.
- `outKeyTransformCase`: регистр ключей результата, по умолчанию `camelCase`.
- `isNeedRegisterDefaultSerializers`: включает стандартные date/time serializers.
- `isNeedClientNotificationInit`: режим Oracle CQN по умолчанию. `true`
  включает client-initiated notifications, `false` используется вместе с
  `cqnPort` для server callback notifications.
- `packagesSettings`: packages/schemas и процедуры, доступные через `call()`.

`packagesSettings.packages` нужно указывать в lowercase. Имена процедур при
вызове нормализуются внутри библиотеки.

В примерах для PostgreSQL слово "package" означает настроенное namespace schema,
которое использует kit. В примерах для Oracle это Oracle package.

`procedureObjectList` используется для разрешения настроенных процедур и, когда
настроено несколько packages/schemas, для пропуска процедур вне текущего
package. Ключи служат только метками внутри конфигурации; значения должны быть
реальными именами процедур. Используйте формат `package.procedure` или
`schema.procedure`, когда настроено несколько packages. Bare-имя `procedure`
допустимо, когда настроен ровно один package. Runtime вызовы разрешаются по
загруженным database names, поэтому используйте
`db.call('billing.find_invoices')` или `db.call('find_invoices')`, если настроен
только один package. Не используйте ключи `procedureObjectList` как aliases для
`call()`.

Если задан `packagesSettings.packages` и packages array не пустой,
`initDatabase()` также создает подписку на уведомления об изменении packages.
Перед использованием этих примеров без изменений настройте источник
уведомлений в базе.

## Встроенная case-strategy

`typeorm-procedure-kit` включает встроенную case-strategy для двух мест, где
имена из базы встречаются с application code: native result objects и
встроенная TypeORM-compatible naming strategy. Настройка задается через
`config.outKeyTransformCase` внутри database config.

Поддерживаемые значения:

| Значение    | Ключ из базы                    | Ключ на выходе |
| ----------- | ------------------------------- | -------------- |
| `camelCase` | `USER_ID`, `user_id`, `user id` | `userId`       |
| `snakeCase` | `USER_ID`, `userId`, `User Id`  | `user_id`      |
| `lowerCase` | `USER_ID`, `User_Id`            | `user_id`      |

Если `outKeyTransformCase` не задан, используется `camelCase`. Неизвестные
значения во время выполнения также откатываются к `camelCase`.

Пакет создает один общий `OrmStrategy` из этой настройки. Он устанавливается как
DataSource naming strategy при инициализации и также передается в driver fetch
hooks как transformer ключей raw results.

`OrmStrategy` преобразует имена свойств entity перед передачей во встроенную
default naming strategy, поэтому generated column names следуют выбранному
формату, если decorator не задает explicit name. Тот же метод
`transformColumnName` используется для имен колонок, которые приходят из
metadata `pg` или `oracledb`, перед возвратом native rows из вызовов процедур и
raw SQL. SQL aliases тоже преобразуются, потому что drivers отдают aliases как
result metadata.

TypeORM entity hydration использует transform-функцию активной `OrmStrategy` при
чтении raw results, поэтому query builder aliases корректно сопоставляются после
driver-level преобразования ключей.

Для TypeORM query builder selections, которые можно сопоставить с entity
metadata, raw result keys нормализуются обратно в имена свойств entity.
Например, выбор database columns `m.KEYID`, `m.STATUS` и `m.TEXT` может вернуть
raw keys `keyId`, `status` и `text`. В этом случае `outKeyTransformCase`
остается только промежуточным driver-level преобразованием. Он по-прежнему
напрямую применяется к native adapter results и к custom raw aliases, которые
нельзя сопоставить с entity metadata.

Partial selections можно писать как `alias.propertyPath`, `alias.databaseName`
или `alias.databasePath`. Selections, которые можно сопоставить с metadata,
гидратируют entities и нормализуют raw result keys по property path entity;
custom raw aliases остаются без изменений.

Пример:

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

При такой настройке колонка raw result `USER_ID` или `userId` вернется как
`user_id`. При `camelCase` тот же ключ будет возвращен как `userId`.

Важные детали:

- Стратегия меняет output object keys и generated ORM column names. Она не
  переписывает package names, procedure names, SQL text, bind placeholders,
  table names, relation names или notification channel names.
- `packagesSettings.packages` по-прежнему нужно указывать в lowercase, потому
  что procedure resolution нормализует configured package/schema names внутри.
- Raw SQL bind placeholders по-прежнему используют документированный uppercase
  стиль, например `:USER_ID`.
- Явно заданные custom column names в decorators учитываются встроенной default
  naming strategy, поэтому стандартное TypeORM override behavior сохраняется.
- `lowerCase` только приводит входную строку к нижнему регистру. Используйте
  `snakeCase`, если нужно разбиение слов, например `User Id` -> `user_id`.
- Преобразованные имена кэшируются на время жизни kit instance, а cache
  очищается при `destroy()`.

Oracle CQN можно настроить в двух режимах. Server callback mode открывает
локальный порт для уведомлений от базы:

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

Client-initiated mode не требует `cqnPort` и обычно удобнее, когда база не
может подключиться обратно к application host:

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

Oracle option `clientInitiated` в `makeNotify()` может переопределить это
значение для отдельной subscription.

## PostgreSQL

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

Для PostgreSQL вызов процедуры формируется так:

```sql
CALL "package"."procedure"($1, $2, ...)
```

Выходные аргументы PostgreSQL типа `refcursor` читаются и закрываются внутри
той же транзакции.

## Oracle

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

Для Oracle вызов процедуры формируется так:

```sql
BEGIN PACKAGE.PROCEDURE(:arg1, :arg2); END;
```

Результаты Oracle `REF CURSOR` считываются потоково и возвращаются как строки
результата.

## Вызов процедур

`call<T>()` требует `config.packagesSettings`.

```ts
const rows = await db.call<{ id: number; status: string }>(
  'billing.find_invoices',
  { customerId: 42, status: 'OPEN' }
);
```

Если настроен только один package, имя package можно опустить:

```ts
const rows = await db.call('find_invoices', { customerId: 42 });
```

Правила payload:

- Object bind выполняется по имени аргумента. Адаптеры также пробуют имя без
  префикса `p_`, поэтому `p_customer_id` можно передать как `customer_id`.
- Array bind выполняется по позиции аргумента.
- Если payload не передан или передан `undefined`/`null`, все non-cursor
  значения будут привязаны как `null`.
- Scalar string/number нельзя передавать как payload процедуры.

Публичные procedure payload types экспортируются как `TProcedurePayload` и
`TProcedurePayloadInput`. `call<T, U extends TProcedurePayload>()` принимает
object-like payload, включая arrays для positional binding, а также
`undefined`/`null`.

```ts
await db.call('billing.update_invoice', [42, 'PAID']);
```

Третий аргумент — объект execution options. Используйте `optionsCommands` для
SQL-команд, которые выполняются перед основным вызовом внутри той же
транзакции, и `mode` для выбора режима соединения `master` или `slave`.
Режим по умолчанию — `master`.

```ts
await db.call('billing.recalculate', { invoiceId: 42 }, {
  mode: 'master',
  optionsCommands: ['SET LOCAL statement_timeout = 30000'],
});
```

## Транзакции с SQL-запросами напрямую

`callSqlTransaction<T>()` выполняет SQL-запрос напрямую через тот же поток
транзакции, логирование, обработку ошибок и освобождение соединения.

Параметры находятся только по плейсхолдерам в верхнем регистре:
`:PARAM_NAME`.

```ts
const rows = await db.callSqlTransaction<{ id: number; name: string }>(
  'SELECT id, name FROM users WHERE id = :USER_ID',
  { USER_ID: 7 },
  { mode: 'slave' }
);
```

PostgreSQL переписывает плейсхолдеры в `$1`, `$2`, а Oracle оставляет
`:PARAM`.

Используйте `slave` только для read-only операций. Вызовы процедур и SQL,
которые пишут данные, должны использовать режим `master` по умолчанию. Если
явно передан `mode: 'slave'`, а `slaves` пустой или не настроен, публичный flow
выполнения kit бросит ошибку вместо тихого fallback на master.

## Уведомления

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

PostgreSQL adapter проверяет имя channel, открывает отдельный `pg.Client`,
пытается разобрать JSON payload и восстанавливает listener после ошибок
соединения. Также выполняется периодический health-check соединения, поэтому
listener может быть восстановлен после тихого сетевого обрыва, когда
PostgreSQL не прислал явное событие.

Retry options для восстановления notification subscriptions можно передать
вторым аргументом `makeNotify()` для Oracle, а при прямом использовании adapter
API — как notification options адаптера:

- `maxRetries`: число попыток восстановления до длинной задержки, default `5`.
- `retryDelayMs`: задержка между обычными попытками восстановления, default
  `30000`.
- `retryAfterMaxDelayMs`: задержка после исчерпания `maxRetries` перед новым
  циклом попыток, default `1800000`.

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

Oracle создает внутреннее UUID-имя subscription. Когда Oracle возвращает ROWID,
adapter читает измененные строки и передает их в callback.
Если передать `operations` как array, создается отдельная CQN subscription на
каждую operation; возвращенная строка channel содержит сгенерированные имена
subscriptions, и ее можно без изменений передать в `unlistenNotify()`.

Дефолты Oracle notifications:

- `operations`: `oracledb.CQN_OPCODE_ALL_OPS`
- `qos`: `oracledb.SUBSCR_QOS_ROWIDS`
- `timeout`: 12 часов
- `clientInitiated`: option конкретной subscription, затем общий config, затем
  `false`

Если `operations` передан как array, в нем должно быть меньше четырех operation
codes. Для подписки на все операции используйте
`oracledb.CQN_OPCODE_ALL_OPS`, а не ручной список всех операций. Oracle
subscriptions также проверяются периодическим health-check и восстанавливаются
после CQN deregistration, shutdown events, ошибок соединения или тихого обрыва
соединения.

## Обновление метаданных packages

Если настроен `packagesSettings.packages`, `initDatabase()` загружает
метаданные процедур из базы. Также создается подписка на уведомления об
изменении packages всякий раз, когда packages array не пустой. У пользователя
базы должен быть доступ к источнику уведомлений: PostgreSQL по умолчанию слушает
`db_object_event`, а Oracle читает `SOLUTION_ROOT.DB_OBJECT_LOG`.

Для PostgreSQL можно переопределить notification channel, когда
`isNeedDynamicallyUpdatePackagesInfo` равен `true`:

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

## Сериализаторы

Включение встроенных serializers:

```ts
const settings = {
  config: {
    // ...
    isNeedRegisterDefaultSerializers: true,
  },
};
```

Стандартные serializers форматируют:

- `DATE` как `yyyy-MM-dd`
- `TIMESTAMP` как `yyyy-MM-dd HH:mm:ss Z`
- `TIMESTAMP_TZ` как `yyyy-MM-dd HH:mm:ss Z`

Пользовательский serializer:

```ts
db.setSerializer({
  serializerType: 'JSON',
  strategy: (value) => JSON.parse(value.toString()),
});

const serializers = db.serializerReadOnlyMapping;

db.deleteSerializer({ serializerType: 'JSON' });
db.deleteAllSerializers();
```

Поддерживаемые ключи: `DATE`, `TIMESTAMP`, `TIMESTAMP_TZ`, `BOOLEAN`, `CHAR`,
`VARCHAR`, `JSON`, `BINARY`, `XML`.

## NestJS

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

По умолчанию Nest module доступен только в модуле, который его импортировал.
Чтобы зарегистрировать его как global Nest module, передайте `true` вторым
аргументом в `forRoot()`:

```ts
TypeOrmProcedureKitNestModule.forRoot(
  {
    logger: new Logger('TypeOrmProcedureKit'),
    config,
  },
  true
);
```

Для async-регистрации используйте `isGlobal: true`:

```ts
TypeOrmProcedureKitNestModule.forRootAsync({
  isGlobal: true,
  useFactory: async () => ({
    logger: new Logger('TypeOrmProcedureKit'),
    config,
  }),
});
```

Несколько non-global регистраций безопасны только когда они изолированы в
разных feature module scopes. Не импортируйте две регистрации
`TypeOrmProcedureKitNestModule` в один Nest module и не реэкспортируйте две
по-разному настроенные регистрации в третий module. Nest providers используют
одни и те же injection tokens (`CALL_SQL`, `CALL_PROCEDURE`,
`DATABASE_SERVICE_TOKEN` и связанные method tokens), поэтому текущий API не
может надежно выбрать одну из двух БД в одном Nest scope.

Nest service наследует `TypeOrmProcedureKit`, вызывает `initDatabase()` в
`onModuleInit()` и `destroy()` в `onApplicationShutdown()`.

NestJS entry point также экспортирует точечные decorators для инжекта
отдельных публичных методов вместо всего service:

| Decorator                       | Тип injected function   | Делегирует в                                 |
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

## EntityManager и DataSource

Для низкоуровневой работы можно получить TypeORM-compatible объекты:

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

`getEntityManager()` принимает `master` или `slave`. Для запроса `slave` нужна
минимум одна настроенная slave-БД; иначе метод бросит ошибку до создания query
runner.
`databaseAdapter` открывает низкоуровневый adapter contract для диагностики и
расширенной интеграции.

`isRegisterShutdownHandlers` регистрирует shutdown handlers в constructor. Если
нужно подключить их позже, вызовите `db.registerShutdownHandlers()`.

## Встроенный TypeORM-compatible API

Встроенный TypeORM-совместимый API адаптирован для этой библиотеки. TypeORM
уже включен в пакет как поддерживаемый fork; версия fork здесь — `0.3.28`.
Сейчас поддерживаются PostgreSQL и Oracle.

Слой типизации TypeORM был переработан для проектов со строгим TypeScript:

- entity metadata лучше сохраняет generic-типы сущностей;
- repository, query builder и entity manager методы имеют более строгие
  generic return types;
- common repository inputs вроде `FindOptionsWhere`, `FindManyOptions`,
  `FindOneOptions`, `DeepPartial` и `QueryPartialEntity` согласованы с формой
  entity, которую экспортирует этот пакет;
- decorator и metadata argument types адаптированы для database-specific
  вариантов entity;
- `Column`, `PrimaryColumn`, `PrimaryGeneratedColumn`, relation decorators и
  entity schema options раскрывают database-specific surfaces, которые
  использует kit;
- Oracle/PostgreSQL column types и query-runner API сужены под поддерживаемые
  драйверы.

### Карты свойств metadata

`EntityMetadata.propertiesMap` типизирована как `EntityPropertiesMap<T>` и
сохраняет TypeORM-compatible property-path семантику. Callback decorators для
`Index`, `Unique`, `RelationId`, `RelationCount` и `EntityOptions.orderBy`
получают эту карту на runtime, поэтому их значения по-прежнему резолвятся в
property paths сущности. `orderBy` callbacks вычисляются после создания
`propertiesMap`.

`EntityMetadata.databasePropertiesMap` — отдельная
`EntityDatabasePropertiesMap<T>`. Это column-only карта: leaf values содержат
database column names или database paths после применения явных
`@Column({ name })` options и правил naming strategy. Relation virtual join
columns намеренно исключены из этой карты.

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

Для callback decorators `user.userId` в `@Index((user) => [user.userId])`
по-прежнему означает property path `userId`; используйте
`databasePropertiesMap` только там, где из metadata напрямую нужны database
column names или paths.

QueryBuilder replacement также резолвит aliased property names в database
column names. Например, условие `m.lockStatus = :isLocked` будет сгенерировано
с именем колонки из metadata, например `m.LOCK_STATUS`, если `lockStatus`
объявлен как `@Column({ name: 'LOCK_STATUS' })`.

Kit устанавливает `isQuotingDisabled: true` при инициализации DataSource.
Query builder по умолчанию не экранирует identifiers, поэтому generated SQL не
получает случайные `"USERS"` или `"CREATED_AT"`, когда схема базы ожидает
обычные uppercase identifiers. При необходимости quoting можно включить через
`enableEscaping()` или принудительно экранировать отдельный identifier через
`escape(name, true)`.

Этот режим quoting относится к SQL, который генерируют entity, repository и
query builder. Вызовы процедур и notification channels проходят через отдельные
adapter paths: identifiers валидируются через `SqlIdentifier` и экранируются
или форматируются там, где этого требует целевая база.

## Будущее направление ORM

Текущая точка входа `typeorm-procedure-kit/typeorm` остается TypeORM-compatible
и сегодня является поддерживаемым entity API пакета. Дальнейшее развитие
планируется вести в сторону собственной ORM-системы библиотеки вместо
долгосрочной опоры на встроенный fork TypeORM.

Цель этого направления — сохранить database workflow вокруг возможностей,
которые уже контролирует пакет: metadata хранимых процедур, адаптеры Oracle и
PostgreSQL, явную работу с identifiers, repository/query API и строгие
TypeScript-типы. Такой переход предполагается делать постепенно и описывать
через публичные точки входа, без обещаний конкретной даты релиза.

## TypeORM Extension API

`./typeorm-extend` экспортирует decorators для переиспользования базовых
метаданных entity и переопределения options для database-specific вариантов:

- `ExtendEntity`
- `ExtendColumn`
- `ExtendPrimaryColumn`
- `ExtendPrimaryGeneratedColumn`

Также entry point экспортирует `AbstractTypeormRepository` — базовый класс для
repositories, которым нужно выбирать entity target из активного `DataSource`.

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
    comment: 'Дата мягкого удаления',
  })
  protected abstract readonly deletedAt: Date | null;

  @Column({
    type: Number,
    name: 'IS_DELETED',
    nullable: false,
    default: 0,
    comment: 'Флаг мягкого удаления',
  })
  protected abstract readonly isDeleted: number;
}

@Entity({
  name: 'OUTBOUND_MESSAGES',
  schema: 'APP_CORE',
  comment: 'Сообщения для внешней доставки',
})
export abstract class OutboundMessage extends SoftDelete {
  @PrimaryGeneratedColumn('uuid', {
    name: 'UUID',
    comment: 'Идентификатор записи',
  })
  protected abstract readonly uuid: string | undefined | null;

  @Column({
    type: Date,
    name: 'CREATED_AT',
    nullable: false,
    comment: 'Дата создания',
  })
  protected abstract readonly createdAt: Date;

  @Column({
    type: Date,
    name: 'SEND_AT',
    nullable: true,
    comment: 'Плановая дата отправки',
  })
  protected abstract readonly sendAt: Date | null;

  @Column({
    type: Number,
    name: 'RECIPIENT_ID',
    nullable: false,
    comment: 'Идентификатор получателя',
  })
  protected abstract readonly recipientId: number;

  @Column({
    type: String,
    name: 'CONTENT',
    length: 4000,
    nullable: true,
    comment: 'Текст сообщения',
  })
  protected abstract readonly content: string | null;

  @Column({
    type: String,
    name: 'DELIVERY_STATUS',
    default: 'CREATED',
    nullable: false,
    comment: 'Статус доставки',
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

`AbstractTypeormRepository` — базовый класс для repositories, которые держат
отдельные Oracle и PostgreSQL entity classes. Он принимает фабрику выбора entity
target и предоставляет базовый query context с `repository`, `builder`, `alias`
и `property`. `property` — это `EntityMetadata.databasePropertiesMap`, поэтому
при ручной сборке SQL используются значения `@Column({ name })` и результат
naming strategy.

`AbstractTypeormRepository.createEntityTargetFactory()` принимает map target'ов,
ключи которой совпадают с `DataSourceOptions['type']`, и возвращает фабрику.
Helper не хардкодит имена драйверов: target выбирается через
`entityTargets[dataSource.options.type]`. Для текущих поддерживаемых драйверов
map содержит ключи `oracle` и `postgres`.

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

Repository helper types экспортируются из `typeorm-procedure-kit` и
`typeorm-procedure-kit/typeorm-extend`: `IEntityTargets`,
`TEntityTargetFactory`, `IRepositoryContext` и `IBuildBaseQueryContext`.

Базовые метаданные должны уже существовать через `@Entity`, `@Column`,
`@PrimaryColumn` или `@PrimaryGeneratedColumn`.

## Завершение работы

```ts
await db.destroy();
```

`destroy()`:

- отписывает notifications;
- уничтожает пул соединений DataSource;
- очищает procedure и naming caches;
- выбрасывает `AggregateError`, если часть очистки завершилась ошибкой.

`isRegisterShutdownHandlers: true` регистрирует обработчики сигналов процесса,
которые автоматически вызывают `destroy()`.

## Важные runtime особенности

- PostgreSQL serializer глобально переопределяет `pg.Result.prototype.parseRow`.
- Oracle serializer глобально устанавливает `oracledb.fetchTypeHandler`.
- Oracle adapter устанавливает `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT`.
- Метаданные процедур загружаются из базы во время `initDatabase()`, поэтому
  packages должны существовать и быть видимыми пользователю базы.
- `call()` нельзя использовать без `packagesSettings`.
- Плейсхолдеры для SQL-запросов напрямую должны быть в верхнем регистре,
  например `:USER_ID`.
- PostgreSQL `parseInt8AsBigInt` следует поведению bundled TypeORM/Postgres
  `parseInt8`: `true` возвращает JavaScript numbers для `int8`, а не native
  `bigint`.

## Частые ошибки

- `TypeOrmProcedureKit is not initialized`: вызовите `await initDatabase()`.
- `Procedure packages are not configured`: настройте `config.packagesSettings`
  перед использованием `call()`.
- `Package "... " or process "... " not found`: это ошибка адаптера для
  неизвестной процедуры; проверьте имена packages, `procedureObjectList` и
  доступность метаданных в базе.
- `Payload for call procedure must be an object or array or undefined or null`:
  не передавайте скалярный payload в `call()`.
- `Unsafe SQL identifier for ...`: имена процедур, cursors или notification
  channels должны соответствовать поддерживаемому identifier pattern до того,
  как adapter встроит их в SQL.
- Результаты базы с nonzero `error_code` или `err_code` превращаются в
  `ServerError`.

## Лицензия

MIT.
