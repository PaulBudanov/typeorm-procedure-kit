# typeorm-procedure-kit

Универсальный набор TypeScript-инструментов для вызова хранимых процедур,
выполнения SQL-запросов напрямую, работы с уведомлениями баз данных и
использования встроенного TypeORM-совместимого API для Oracle и PostgreSQL.

Автор и сопровождающий: Paul Budanov.

## Что входит в пакет

- `TypeOrmProcedureKit` как основной API времени выполнения для инициализации
  базы, вызова процедур, SQL-запросов напрямую, уведомлений, сериализаторов и
  корректного завершения работы.
- Общий контракт адаптеров для Oracle и PostgreSQL.
- Автоматическая загрузка метаданных процедур из database packages/schemas.
- Обновление метаданных процедур во время работы через уведомления базы.
- Настраиваемый регистр ключей результата: `camelCase`, `lowerCase`,
  `snakeCase`.
- Встроенные и пользовательские сериализаторы значений из базы.
- Интеграция с NestJS через global dynamic module.
- Встроенный TypeORM-совместимый экспорт для Oracle/PostgreSQL проектов;
  TypeORM уже включен в пакет.
- `typeorm-extend` декораторы для наследования и переопределения метаданных
  entities.

## Требования

- Node.js `>=20`
- npm `>=10`
- TypeScript с включенными decorators, если используются entities
- Драйвер для целевой базы:
  - PostgreSQL: `pg`
  - Oracle: `oracledb`
- Опциональная streaming-зависимость для PostgreSQL: `pg-query-stream`; она
  нужна только при вызове публичных stream API, например
  `SelectQueryBuilder.stream()` или `QueryRunner.stream()`.
- Опционально для NestJS: `@nestjs/common` и `@nestjs/core`

## Установка

```bash
npm install typeorm-procedure-kit
```

Для PostgreSQL:

```bash
npm install pg
```

Для Oracle:

```bash
npm install oracledb
```

Установите `pg-query-stream` только если используете PostgreSQL streaming:

```bash
npm install pg-query-stream
```

## Точки импорта

```ts
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { IModuleConfig } from 'typeorm-procedure-kit';

import { TypeOrmProcedureKitNestModule } from 'typeorm-procedure-kit/nestjs';

import { Entity, Column, PrimaryColumn } from 'typeorm-procedure-kit/typeorm';

import { ExtendColumn, ExtendEntity } from 'typeorm-procedure-kit/typeorm-extend';
```

Root import экспортирует kit, публичные типы, constants и utilities. TypeORM
уже включен в этот пакет: decorators, DataSource, EntityManager, repositories,
query builders и связанные классы экспортируются из `./typeorm`. Для entities,
которыми управляет kit, импортируйте TypeORM API из
`typeorm-procedure-kit/typeorm`, а не из отдельного upstream-пакета `typeorm`.

## Конфигурация

Настройка выполняется через `IModuleConfig`:

```ts
import type { IModuleConfig, ILoggerModule } from 'typeorm-procedure-kit';

const logger: ILoggerModule = {
  error: (message, ...optionalParams) => console.error(message, ...optionalParams),
  log: (message, ...optionalParams) => console.log(message, ...optionalParams),
  warn: (message, ...optionalParams) => console.warn(message, ...optionalParams),
  debug: (message, ...optionalParams) => console.debug(message, ...optionalParams),
  verbose: (message, ...optionalParams) => console.debug(message, ...optionalParams),
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
- `slaves`: read replicas для TypeORM replication.
- `poolSize`: размер пула соединений.
- `appName`: имя приложения для драйвера, если он это поддерживает.
- `callTimeout`: порог логирования медленных запросов для TypeORM.
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

Ключи `procedureObjectList` являются метками внутри конфигурации. Вызовы
разрешаются по значениям, поэтому используйте `db.call('billing.find_invoices')`
или `db.call('find_invoices')`, если настроен только один package.

Если задан `packagesSettings.packages`, `initDatabase()` также создает подписку
на уведомления об изменении packages. Перед использованием этих примеров без
изменений настройте источник уведомлений в базе.

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

Oracle option `clientInitiated` в `makeNotify()`/`createNotification()` может
переопределить это значение для отдельной subscription.

## PostgreSQL

```ts
import { TypeOrmProcedureKit } from 'typeorm-procedure-kit';
import type { ILoggerModule, IModuleConfig } from 'typeorm-procedure-kit';

const logger: ILoggerModule = {
  error: (message, ...optionalParams) => console.error(message, ...optionalParams),
  log: (message, ...optionalParams) => console.log(message, ...optionalParams),
  warn: (message, ...optionalParams) => console.warn(message, ...optionalParams),
  debug: (message, ...optionalParams) => console.debug(message, ...optionalParams),
  verbose: (message, ...optionalParams) => console.debug(message, ...optionalParams),
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

const users = await db.call<{ id: number; fullName: string }>('api.search_users', {
  query: 'Paul',
});

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
  error: (message, ...optionalParams) => console.error(message, ...optionalParams),
  log: (message, ...optionalParams) => console.log(message, ...optionalParams),
  warn: (message, ...optionalParams) => console.warn(message, ...optionalParams),
  debug: (message, ...optionalParams) => console.debug(message, ...optionalParams),
  verbose: (message, ...optionalParams) => console.debug(message, ...optionalParams),
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
- `undefined` или `null` превращаются в `null` для всех non-cursor значений.
- Scalar string/number нельзя передавать как payload процедуры.

```ts
await db.call('billing.update_invoice', [42, 'PAID']);
```

Третий аргумент — массив SQL-команд, которые выполняются перед основным
вызовом внутри той же транзакции:

```ts
await db.call('billing.recalculate', { invoiceId: 42 }, [
  'SET LOCAL statement_timeout = 30000',
]);
```

## Транзакции с SQL-запросами напрямую

`callSqlTransaction<T>()` выполняет SQL-запрос напрямую через тот же поток
транзакции, логирование, обработку ошибок и освобождение соединения.

Параметры находятся только по плейсхолдерам в верхнем регистре:
`:PARAM_NAME`.

```ts
const rows = await db.callSqlTransaction<{ id: number; name: string }>(
  'SELECT id, name FROM users WHERE id = :USER_ID',
  { USER_ID: 7 }
);
```

PostgreSQL переписывает плейсхолдеры в `$1`, `$2`, а Oracle оставляет
`:PARAM`.

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
соединения.

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

## Обновление метаданных packages

Если настроен `packagesSettings.packages`, `initDatabase()` загружает
метаданные процедур из базы и создает подписку на уведомления об изменении
packages. У пользователя базы должен быть доступ к источнику уведомлений:
PostgreSQL по умолчанию слушает `db_object_event`, а Oracle читает
`SOLUTION_ROOT.DB_OBJECT_LOG`.

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

Устаревшая опечатка `isNeedDynamiclyUpdatePackagesInfo` все еще поддерживается
для совместимости. В новом коде используйте
`isNeedDynamicallyUpdatePackagesInfo`.

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

Nest service наследует `TypeOrmProcedureKit`, вызывает `initDatabase()` в
`onModuleInit()` и `destroy()` в `onApplicationShutdown()`.

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
```

`getEntityManager()` принимает `master` или `slave`.

## Встроенный TypeORM-compatible API

Встроенный TypeORM-совместимый API адаптирован для этой библиотеки. TypeORM
уже включен в пакет как поддерживаемый fork; версия fork здесь — `0.3.28`.
Сейчас поддерживаются PostgreSQL и Oracle.

Слой типизации TypeORM был переработан для проектов со строгим TypeScript:

- entity metadata лучше сохраняет generic-типы сущностей;
- repository, query builder и entity manager методы имеют более строгие
  generic return types;
- decorator и metadata argument types адаптированы для database-specific
  вариантов entity;
- Oracle/PostgreSQL column types и query-runner API сужены под поддерживаемые
  драйверы.

Kit устанавливает `isQuotingDisabled: true` при инициализации DataSource.
Query builder по умолчанию не экранирует идентификаторы, но можно вызвать
`enableEscaping()` или принудительно экранировать отдельный identifier через
`escape(name, true)`.

## Расширяющие декораторы TypeORM

`./typeorm-extend` экспортирует decorators для переиспользования базовых
метаданных entity и переопределения options для database-specific вариантов.

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

## Частые ошибки

- `TypeOrmProcedureKit is not initialized`: вызовите `await initDatabase()`.
- `Procedure packages are not configured`: настройте `config.packagesSettings`
  перед использованием `call()`.
- `Package "... " or process "... " not found`: это ошибка адаптера для
  неизвестной процедуры; проверьте имена packages, `procedureObjectList` и
  доступность метаданных в базе.
- `Payload for call procedure must be an object or array or undefined or null`:
  не передавайте скалярный payload в `call()`.
- Результаты базы с nonzero `error_code` или `err_code` превращаются в
  `ServerError`.

## Лицензия

MIT.
