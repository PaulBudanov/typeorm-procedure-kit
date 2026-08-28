# typeorm-procedure-kit

面向 Oracle 和 PostgreSQL 的企业级 TypeORM 工具包。

它提供严格类型化的仓储、存储过程调用、多数据库实体继承、raw SQL 编排、
数据库通知、序列化器，以及增强的内置 TypeORM 兼容运行时。

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

## 翻译

- [英语](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/README.md)
- [俄语](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/README.ru.md)
- [德语](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/README.de.md)
- [中文](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/README.zh.md)

---

## 为什么需要这个包

TypeORM 很适合以 CRUD 为主的应用，但企业级数据库系统通常还需要处理存储过程、
包元数据、Oracle/PostgreSQL 双数据库部署、基于通知的数据同步，以及面向不同
数据库的实体变体。

`typeorm-procedure-kit` 保留 TypeORM 兼容的开发体验，并补充以下能力：

- 基于元数据调用 Oracle 包过程和 PostgreSQL schema 过程；
- raw SQL 与过程调用共用同一套事务和错误处理流程；
- 支持 PostgreSQL `LISTEN/NOTIFY` 和 Oracle Continuous Query Notification；
- 数据库对象变更后动态刷新过程元数据；
- 为原生结果行和 ORM 列名提供统一的命名和大小写规则；
- 为数据库结果值提供序列化器；
- 提供聚焦 Oracle 和 PostgreSQL 的内置 TypeORM 兼容 API；
- 提供实体扩展装饰器和仓储辅助类，用于选择特定数据库的实体目标。

## 与 upstream TypeORM 的对比

| 能力                           | TypeORM       | typeorm-procedure-kit |
| ------------------------------ | ------------- | --------------------- |
| 存储过程元数据                 | 部分支持/手动 | 内置支持              |
| Oracle + PostgreSQL 企业级支持 | 有限          | 聚焦支持              |
| 严格的仓储类型                 | 部分支持      | 扩展支持              |
| 多数据库实体继承               | 不支持        | 支持                  |
| LISTEN/NOTIFY + Oracle CQN     | 不支持        | 支持                  |
| 运行时元数据刷新               | 不支持        | 支持                  |
| 数据库专用仓储                 | 手动实现      | 内置支持              |

## 要求

- Node.js `>=20`
- 发布的 ESM 和 CJS 构建以 ES2022 为 target；npm package 不包含 source map 或
  declaration map。
- 使用实体装饰器时，需要启用 TypeScript 装饰器
- PostgreSQL 驱动：`pg`
- Oracle 驱动：`oracledb`
- 可选的 PostgreSQL 流式查询依赖：`pg-query-stream`
- 可选的 NestJS 对等依赖：`@nestjs/common`（`^10.4.16 || ^11.0.16`）

## 安装

```bash
npm install typeorm-procedure-kit
```

为目标数据库安装对应驱动：

```bash
npm install pg
npm install oracledb
```

只有在使用 PostgreSQL 流式 API，例如 `SelectQueryBuilder.stream()` 或
`QueryRunner.stream()` 时，才需要安装 `pg-query-stream`。

```bash
npm install pg-query-stream
```

## 快速开始

下面的最小 PostgreSQL 示例会初始化 kit，调用一个已配置的过程，并在结束后释放资源：

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
  const result = await db.call<{ invoiceId: number }>('billing.find_invoices', {
    customerId: 42,
  });
  console.log(result.rows, result.outBinds);
} finally {
  await db.destroy();
}
```

## 导入入口

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

| 导入路径                               | 用途                                                  |
| -------------------------------------- | ----------------------------------------------------- |
| `typeorm-procedure-kit`                | `TypeOrmProcedureKit`、公共类型、常量和工具函数       |
| `typeorm-procedure-kit/nestjs`         | NestJS 模块、服务和方法注入装饰器                     |
| `typeorm-procedure-kit/typeorm`        | 内置 TypeORM 兼容装饰器、DataSource、仓储和查询构建器 |
| `typeorm-procedure-kit/typeorm-extend` | 实体元数据扩展装饰器和面向特定数据库实体的仓储辅助类  |

由本包管理的实体应从 `typeorm-procedure-kit/typeorm` 导入 TypeORM API。
该包已经内置自身使用的 TypeORM 兼容 API。

## 从 TypeORM 迁移

最小迁移路径：

替换导入：

```ts
// before
import { Entity, Column } from 'typeorm';

// after
import { Entity, Column } from 'typeorm-procedure-kit/typeorm';
```

然后逐步采用扩展能力：

- stored procedures;
- repository helpers;
- multi-database entity inheritance;
- notification infrastructure;
- serializer pipeline;
- database-specific repositories.

该包保留 TypeORM 兼容的开发体验，同时以 Oracle/PostgreSQL-focused workflows
和更严格的类型支持扩展运行时。

## 升级到 v3

升级前请阅读
[v3 迁移指南](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/MIGRATION_V3.md)。
主要 breaking changes：

- `call()` 返回 `{ rows, outBinds }`，而不是只返回 row array；
- serializer strategy 接收 `{ serializerType, value, context }`；
- 默认 temporal serializers 仍为 opt-in，并使用包含 `TIMESTAMP_LTZ` 的新格式；
- `sessionTimeZone` 会经过验证，默认值为 `UTC`；
- 本包不再要求 `@nestjs/core` peer dependency。

## API 映射

| 任务                             | API                                                                        |
| -------------------------------- | -------------------------------------------------------------------------- |
| 初始化数据库访问                 | `new TypeOrmProcedureKit(settings)`, `initDatabase()`                      |
| 调用存储过程                     | `db.call<T>(name, params, options?)`                                       |
| 执行 raw SQL 事务                | `db.callSqlTransaction<T>(sql, params?, options?)`                         |
| 订阅数据库通知                   | `db.makeNotify<T>(options, oracleOptions?)`                                |
| 取消订阅数据库通知               | `db.unlistenNotify(channel)`                                               |
| 注册序列化器                     | `db.setSerializer()`, `db.deleteSerializer()`, `db.deleteAllSerializers()` |
| 访问 DataSource 或 EntityManager | `db.dataSource`, `db.getEntityManager()`                                   |
| 优雅关闭                         | `db.destroy()`, `db.registerShutdownHandlers()`                            |

## 配置结构

每个设置都使用一个 `IModuleConfig` 对象：

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

通用选项：

- `master`：主数据库连接的凭据。
- `slaves`：TypeORM replication 使用的可选只读副本。
- `poolSize`：连接池大小。
- `appName`：传递给受支持驱动的应用名称。
- `sessionTimeZone`：经过验证的数据库会话时区，例如 `UTC`、
  `Europe/Moscow` 或 `+03:00`；默认值为 `UTC`。PostgreSQL 会在每个 pool
  connection 的 startup options 中设置该值。Oracle 会在创建 physical
  connection 时通过 session callback 设置；复用的 connection 会保留该状态，
  除非 application SQL 主动修改它。
- `maxQueryExecutionTime`：传递给底层 DataSource 的慢查询阈值；记录慢查询但不会取消。
- `logger.typeormLogLevels`：通过 `logger.module` 输出的 TypeORM 日志级别。
  支持 `query`、`error`、`schema`、`info`、`warn`、`migration` 或 `all`。
- `logger.bindingLogMode`：绑定值日志策略。安全默认值 `metadata-only` 隐藏全部值；
  `redact-by-name` 是兼容性较强但保护较弱的模式，会显示未被敏感名称启发式规则识别的
  值；`unsafe-values` 是可能暴露机密数据的显式 opt-in。
- `queryTimeoutMs`：可选的正整数 query timeout（毫秒）。PostgreSQL 会把它作为
  `statement_timeout` 传给 `pg` pool，这是 statement-level timeout。Oracle 会在每次
  获取 physical connection 后把它设置为 `oracledb` `connection.callTimeout`；它限制
  每个 database round-trip，而不是整个 statement 的总耗时。
- `resourceLimits`：可选资源上限；安全默认值为 100000 行、每次过程结果 64 MiB、
  10000 行 metadata、每个 LOB 16 MiB、1000 个待处理通知事件，以及每个事件 10000
  个不同的 Oracle CQN ROWID。`maxProcedureBytes` 使用近似的逻辑 payload 计数，
  不是 heap、wire size 或 database driver allocation 的精确测量。
- `callTimeout`：`maxQueryExecutionTime` 的 deprecated alias。
- `outKeyTransformCase`：`camelCase`、`lowerCase` 或 `snakeCase`；默认值为
  `camelCase`。
- `isNeedRegisterDefaultSerializers`：注册默认的日期和时间序列化器。
- `entity`：实体发现和可选的同步设置。
- `migration`：迁移发现和可选的启动时迁移执行设置。
- `isRegisterShutdownHandlers`：注册进程信号处理器，以便调用 `destroy()`。

PostgreSQL 选项：

- `parseInt8AsBigInt`：PostgreSQL 配置类型要求的选项，并作为 `parseInt8`
  传递给内置驱动。为 `true` 时，`node-postgres` 会把 `int8` 值解析为
  JavaScript number，而不是 string；超过 `Number.MAX_SAFE_INTEGER` 的值可能
  丢失精度，尽管该选项名称中包含 BigInt。
- `packagesSettings.listenEventName`：当
  `isNeedDynamicallyUpdatePackagesInfo` 为 `true` 时必填；用于覆盖包更新通知
  的 channel。

Oracle 选项：

- `libraryPath`：Oracle 厚模式使用的可选客户端库目录。
- Oracle CQN 选项（例如 `clientInitiated` 和 legacy `cqnPort`）通过
  `makeNotify()` 的第二个参数传入，而不是数据库配置。

`packagesSettings.packages` 包含真实的数据库 package/schema 名称，并应使用小写
值。`procedureObjectList` 的值必须是真实的过程名，例如
`billing.find_invoices`；其中的 key 只是配置对象内部的标签，并不是 `call()` 的别名。

`call()` 可以使用 `package.procedure` 或 `schema.procedure`。只有在恰好配置了一个
package 或 schema 时，才可以使用裸 `procedure` 名称。

## 内置大小写策略

同一套大小写策略会用于原生结果 key 和内置 TypeORM 兼容列命名。通过
`outKeyTransformCase` 配置。

| 值          | 示例数据库 key                  | 输出 key  |
| ----------- | ------------------------------- | --------- |
| `camelCase` | `USER_ID`, `user_id`, `user id` | `userId`  |
| `snakeCase` | `USER_ID`, `userId`, `User Id`  | `user_id` |
| `lowerCase` | `USER_ID`, `User_Id`            | `user_id` |

## 支持的数据库

| 数据库     | 适配器支持                                  |
| ---------- | ------------------------------------------- |
| PostgreSQL | 过程元数据、raw SQL、LISTEN/NOTIFY、ORM API |
| Oracle     | 包元数据、raw SQL、CQN、ORM API             |

内置 TypeORM 兼容运行时聚焦 Oracle 和 PostgreSQL 工作流。这并不表示该包会封装
这两种数据库的每一个数据库专有功能。

## 存储过程

```ts
const result = await db.call('billing.create_invoice', {
  customerId: 42,
  amount: 1000,
});

console.log(result.rows);
console.log(result.outBinds);
```

`initDatabase()` 会从已配置的数据库 package 或 schema 加载过程元数据。数据库用户必须
有权限查看这些已配置的 package 或 schema。没有 `config.packagesSettings` 时不能使用
`call()`。

过程负载可以是对象、数组、`null` 或 `undefined`。运行时会拒绝 string 和 number
这类标量负载。

`rows` 按 metadata 顺序包含所有 REF CURSOR rows。`outBinds` 使用
`outKeyTransformCase` 转换后的 key 保留每个 cursor 和 scalar `OUT`/`INOUT`
值。只有 scalar output 的过程返回 `rows: []`。`callSqlTransaction()` 仍直接返回
row array。

PostgreSQL `IN`/`INOUT refcursor` 缺少 portal 名称时会自动生成。纯
`OUT refcursor` 必须由存储过程自行命名。包括 `<unnamed portal 1>` 在内的所有
`<unnamed portal ...>` 结果都会被拒绝；有效名称最多为 63 个 UTF-8 字节。Cursor
rows 每批最多读取 1000 行，因此会增量执行 row/byte limit 检查。

## Raw SQL 事务

```ts
await db.callSqlTransaction<{ total: number }>(
  'SELECT COUNT(*) AS total FROM invoices WHERE customer_id = :CUSTOMER_ID',
  { CUSTOMER_ID: 42 },
  { mode: 'master' }
);
```

Raw SQL 占位符必须是大写命名参数，例如 `:USER_ID`。PostgreSQL 会把它们重写为
positional `$1`、`$2` 绑定；Oracle 会保留命名占位符，并把绑定值传给驱动。
Raw SQL 与过程调用使用同一套执行、事务、序列化和错误处理流程。

执行选项：

- `mode`：`master` 或 `slave`，默认值为 `master`。
- `optionsCommands`：在同一事务中、主查询之前执行的受限 setup 命令。每个元素必须是
  一条不含注释或分隔符的安全命令。PostgreSQL 只支持文档列出的 transaction-local
  `SET LOCAL` 和 `SET TRANSACTION` 形式。Oracle 只支持允许的 `NLS_*` 格式设置；
  原值会在连接返回池前恢复。Oracle 时区必须通过 `sessionTimeZone` 配置。
- `queryId`：用于日志和封装后的数据库错误的自定义 id。

## 通知

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

PostgreSQL 适配器会尽可能解析 JSON 负载。解析失败时，回调会收到原始字符串；
空负载会作为 `{}` 传入。监听器使用独立连接、定期健康检查，并在连接丢失后执行
受保护的恢复尝试。

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

适配器会生成 UUID 订阅名。当 CQN 报告 changed ROWIDs 时，适配器会获取变更行，
并把这些行传给回调。Oracle 订阅会被监控，并在 CQN 注销、关闭事件、连接错误或
refetch 会保留配置的 projection 和 predicate。为确保 ROWID refetch 可预测且有界，
Oracle CQN SQL 必须是 single-table `SELECT`，可带 alias 和 `WHERE`；join、set
operation、grouping、ordering 和 nested query 会在创建 connection 前被拒绝。
静默连接丢失后恢复。
只有需要数据库回调端口的 server-initiated CQN setup 才应同时使用
`clientInitiated: false` 和 legacy `cqnPort`。

### 动态刷新 package 元数据

只有满足以下全部条件时，才会启用动态刷新：

- 已配置 `packagesSettings`；
- `packagesSettings.packages` 非空；
- `packagesSettings.isNeedDynamicallyUpdatePackagesInfo` 为 `true`。

PostgreSQL 默认监听 `db_object_event`，除非配置了 `listenEventName`。Oracle 会查询
`SOLUTION_ROOT.DB_OBJECT_LOG` 以获取 package 变更。

`packagesSettings.procedureMetadataSql` 和
`packagesSettings.metadataNotificationSql` 是 trusted developer SQL config，
不是 runtime SQL builder。它们应保持静态，或只由经过审查的常量组合；不要从
user input 构造。

`packagesSettings.procedureMetadataSql` 可以替换两个数据库的默认 procedure metadata
查询。SQL 必须包含 `:PACKAGE_NAME`，并且必须返回 snake_case 到 camelCase 转换后兼容
`IProcedureArgumentBase` 的列：`procedure_name`、`argument_name`、
`argument_type`、`order`、`mode`，以及可选的 `size`。PostgreSQL overload 还需
`specific_name`；Oracle 还需 `owner`、`subprogram_id` 和 `overload`；不明确的签名
会被拒绝。`mode` 必须是 `IN`、`OUT` 或 `INOUT`/`IN/OUT`；`order` 和 `size`
必须是有效整数。Built-in metadata SQL 最多读取 `maxMetadataRows + 1` 行用于 overflow
检测。Custom metadata query 超出限制时也会被拒绝；若 source 可能无界，还应在 SQL
中设置 database-side limit，以避免先物化过大的结果。

`packagesSettings.metadataNotificationSql` 可以替换默认 metadata refresh 订阅 SQL。
PostgreSQL 需要完整的 `LISTEN ...` 命令。Oracle 需要符合上述 single-table 限制的
CQN `SELECT ...` 查询。未提供、空白或仅包含空格的值会使用 adapter 默认 SQL；
非空值会在使用前去除首尾空白。

## 序列化器

启用内置序列化器：

```ts
const settings = {
  config: {
    // ...
    isNeedRegisterDefaultSerializers: true,
  },
};
```

只有设置 `isNeedRegisterDefaultSerializers: true` 才会注册默认 serializers。
v3 格式为：

- `DATE`：`yyyy-MM-dd HH:mm:ss`，精确到秒；
- `TIMESTAMP`：`yyyy-MM-dd HH:mm:ss.SSS`，精确到毫秒；
- `TIMESTAMP_TZ`：UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`；
- `TIMESTAMP_LTZ`：UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`。

Temporal strategy 接受驱动返回的原生 `Date` 或严格 SQL/ISO string。
带时区的 string 必须包含 `Z` 或 numeric offset。

注册和删除自定义序列化器：

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

每个 strategy 接收 `{ serializerType, value, context? }`。Nullish database
value 会跳过 custom code，并统一为 `null`。支持的 keys 包括 `DATE`、
`TIMESTAMP`、`TIMESTAMP_TZ`、`TIMESTAMP_LTZ`、`BOOLEAN`、`CHAR`、
`VARCHAR`、`JSON`、`BINARY` 和 `XML`。

运行时作用域：

- PostgreSQL type parser 绑定到每个 package-created pool；
- Oracle fetch handler 绑定到当前 DataSource execution path；REF CURSOR rows
  根据 ResultSet metadata 执行大小写转换和 temporal serialization；
- Oracle 适配器会设置 `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT`。

## NestJS 集成

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

异步设置：

```ts
TypeOrmProcedureKitNestModule.forRootAsync({
  isGlobal: true,
  useFactory: async (): Promise<IModuleConfig> => ({
    logger: { module: new Logger('TypeOrmProcedureKit') },
    config,
  }),
});
```

同步设置时，将 `true` 作为 `forRoot()` 的第二个参数传入即可让 module 成为全局模块。
Nest service 会在 `onModuleInit()` 中初始化数据库，并在应用关闭期间调用
`destroy()`。

NestJS 入口还导出用于注入单个方法和 lazy DataSource access 的装饰器：

| 装饰器                          | 委托给                                       |
| ------------------------------- | -------------------------------------------- |
| `@InjectCallProcedure()`        | `TypeOrmProcedureKit.call()`                 |
| `@InjectCallSql()`              | `TypeOrmProcedureKit.callSqlTransaction()`   |
| `@InjectGetDataSource()`        | `() => TypeOrmProcedureKit.dataSource`       |
| `@InjectMakeNotify()`           | `TypeOrmProcedureKit.makeNotify()`           |
| `@InjectUnlistenNotify()`       | `TypeOrmProcedureKit.unlistenNotify()`       |
| `@InjectSetSerializer()`        | `TypeOrmProcedureKit.setSerializer()`        |
| `@InjectDeleteSerializer()`     | `TypeOrmProcedureKit.deleteSerializer()`     |
| `@InjectDeleteAllSerializers()` | `TypeOrmProcedureKit.deleteAllSerializers()` |

## 内置 TypeORM 兼容 API

`typeorm-procedure-kit/typeorm` 入口导出装饰器、DataSource、EntityManager、
仓储、查询构建器和相关类型。运行时基于一个维护中的 TypeORM 兼容 fork，
并针对 Oracle 和 PostgreSQL 工作流进行了优化。

其 baseline、本地 patch families 和强制 upstream sync 流程记录在
[fork provenance and synchronization policy](https://github.com/PaulBudanov/typeorm-procedure-kit/blob/master/docs/TYPEORM_FORK.md)。

请使用文档列出的入口点，不要 deep import 内置 TypeORM 的内部文件。SQL tagged
template 会自动参数化 scalar value。`SqlTagUtils` 不再把 TypeORM-compatible raw
function expressions 当作 raw SQL path，因此返回 SQL text 的 callback 会被拒绝。
Migration path：`unsafeRawSql()` 仅用于经过审查的 trusted SQL fragment，
`sqlIdentifier()` 用于动态标识符，`sqlParameterList()` 用于 parameter lists。返回
非空数组的 callback 仍只是 parameter-list expansion，不是 raw SQL。

增强内容包括：

- 更严格的仓储、查询构建器和 entity manager 类型；
- 更多位置支持泛型感知的实体元数据；
- `FindOptionsWhere`、`DeepPartial` 和 `QueryPartialEntity` 类型与本包导出的
  实体结构对齐；
- `EntityMetadata.propertiesMap` 用于 TypeORM property paths（包括
  relations），`EntityMetadata.databasePropertiesMap` 用于显式
  `@Column({ name })` options 和命名策略规则之后的数据库列名；
- 物理 database、schema、table 和 column 名称默认使用
  `identifierQuoting: 'disabled'`，生成的 alias 始终加引号。可以在 kit
  配置或直接 `DataSource` 中设置 `identifierQuoting: 'enabled'`，也可以对
  单个 query builder 调用 `setIdentifierQuoting('enabled')`。`escape(name)`
  始终执行显式加引号，不受该策略影响。

## TypeORM 扩展装饰器

`typeorm-procedure-kit/typeorm-extend` 导出：

- `ExtendEntity`
- `ExtendColumn`
- `ExtendPrimaryColumn`
- `ExtendPrimaryGeneratedColumn`
- `AbstractTypeormRepository`

共享基础实体：

```ts
import { Entity, PrimaryColumn } from 'typeorm-procedure-kit/typeorm';

@Entity()
export abstract class UserBase {
  @PrimaryColumn()
  public abstract readonly id: number;
}
```

数据库专用变体：

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

仓储辅助类：

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

`propertyPaths` 对象是从 entity metadata 构建的 relation-aware TypeORM
property path map。将它用于 QueryBuilder property expressions，例如
`where`、`leftJoin`、`orderBy`、`take` 和 `skip`；relation fields 可以通过 dot
access 访问，例如 `propertyPaths.additionalMessage.isDeleted` 会返回
`additionalMessage.isDeleted`。

`property` 对象是与 `EntityMetadata.databasePropertiesMap` 兼容的 database
column path map。只在 raw SQL fragments 需要真实数据库列名时使用它；relation
fields 可以通过 dot access 用于 joined aliases，例如
`property.additionalMessage.isDeleted` 会返回 `IS_DELETED`。

Migration note：这对曾经期望 `property` 返回数据库列名的代码是 breaking
repository API behavior change。QueryBuilder usages 应迁移到
`propertyPaths`，raw SQL column usages 应迁移到 `property`。

## 访问 EntityManager 和 DataSource

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

`getEntityManager()` 接受 `master` 或 `slave`。如果请求 `slave` 但没有配置 slave，
会记录警告并使用 master connection。

## 关闭

应用停止时调用 `destroy()`：

```ts
await db.destroy();
```

`destroy()` 会取消通知订阅、销毁 DataSource pool、清理过程缓存和命名缓存。如果
部分清理失败，会抛出 `AggregateError`。设置
`isRegisterShutdownHandlers: true` 可自动注册进程信号处理器，或者手动调用
`db.registerShutdownHandlers()`。

## 手动 materialization benchmark

请在没有明显后台负载时手动运行 `npm run benchmark:postgre-materialization`。
JSON output 包含 median、raw samples、每行 nanoseconds，以及 Node.js version、
platform 和 architecture。它是 CI 之外的诊断工具，不含内置 baseline。

只有同时显式提供两个正数且非零的值时才启用 comparison：

```bash
npm run benchmark:postgre-materialization -- \
  --baseline-ns 20000 \
  --max-regression-percent 10
```

如果测得的 median 超出允许的 regression，命令会以失败状态退出。

## 常见错误

- `TypeOrmProcedureKit is not initialized`：使用运行时方法前先调用
  `await initDatabase()`。
- `Procedure packages are not configured`：使用 `call()` 前添加
  `config.packagesSettings`。
- `Package "... " or process "... " not found`：检查 package names、
  `procedureObjectList` 和数据库元数据可见性。
- `Payload for call procedure must be an object or array or undefined or null`：
  不要向 `call()` 传入标量负载。
- `Unsafe SQL identifier for ...`：procedure、cursor 或 notification channel
  names 必须匹配 supported identifier pattern。
- 仅当顶层 procedure error envelope 同时包含非零 code key
  (`error_code`/`err_code` 或 `errorCode`/`errCode`) 和 text key
  (`error_text`/`err_text` 或 `errorText`/`errText`) 时，才会转换为
  `ServerError`；business rows 和 nested objects 不会被递归扫描。

## 许可证

MIT.
