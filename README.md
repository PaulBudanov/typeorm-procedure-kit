# TypeORM Procedure Kit

**Universal adapter for executing stored procedures and managing database notifications across Oracle and PostgreSQL with TypeORM integration**

[![npm version](https://img.shields.io/npm/v/typeorm-procedure-kit.svg)](https://www.npmjs.com/package/typeorm-procedure-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

---

## 🌟 Features

✨ **Multi-Database Support**

- Oracle Database with CQN (Continuous Query Notification)
- PostgreSQL with LISTEN/NOTIFY mechanism(uses pg notify)
- Easy to extend for additional databases

🔧 **Stored Procedure Management**

- Automatic parameter binding and type conversion
- Cursor result handling (REF CURSOR for Oracle, refcursor for PostgreSQL)
- Multiple cursor support
- Transaction support with custom SQL commands
- Error handling and logging

🔔 **Real-time Notifications**

- Subscribe to database changes
- Automatic reconnection on disconnect
- Callback-based event handling
- Package update notifications

🔄 **Data Transformation**

- Automatic case conversion (camelCase, lowerCase, snakeCase)
- Custom serializer registration
- Type-safe data mapping
- Native query result transformation

🏗️ **Framework Agnostic**

- Works with any Node.js framework
- Built-in NestJS module
- Dependency injection friendly
- Type-safe TypeScript API

---

## 📦 Installation

```bash
npm install typeorm-procedure-kit
```

Or with yarn:

```bash
yarn add typeorm-procedure-kit
```

---

## 🚀 Quick Start

### Basic Usage

```typescript
import { Database } from 'typeorm-procedure-kit';

// Create database instance
const db = new Database(
  {
    type: 'postgres', // or 'oracle'
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'password',
    database: 'mydb',
    dbPackages: ['my_package'],
    callTimeout: 30000,
    poolSize: 10,
    appName: 'my-app',
    outKeyTransformCase: 'camelCase',
    isNeedRegisterDefaultSerializers: false,
    libraryPath: undefined,
    cqn_config: {
      port: 1521,
    },
  },
  {
    myProcedure: 'my_package.my_procedure',
  },
  logger
);

// Initialize database
await db.initDataBase();

// Call stored procedure
const result = await db.call('my_package.my_procedure', {
  param1: 'value1',
  param2: 123,
});

console.log(result);
```

---

## 📖 Configuration

### TDbConfig Interface

```typescript
interface TDbConfig {
  type: 'oracle' | 'postgres'; // Database type
  host: string; // Database host
  port: number; // Database port
  username: string; // Database username
  password: string; // Database password
  database: string; // Database name
  dbPackages: Array<Lowercase<string>>; // List of packages/schemas
  callTimeout: number; // Query timeout in ms
  poolSize: number; // Connection pool size
  appName: string; // Application name
  outKeyTransformCase: 'camelCase' | 'lowerCase'; // Transform output keys
  isNeedRegisterDefaultSerializers: boolean; // Register default serializers
  libraryPath?: string; // Oracle library path (optional)
  cqn_config: {
    port: number; // Notification port (Oracle)
  };
}
```

### Entity and Migration Options (Optional)

```typescript
interface IEntityOptions {
  isNeedEntitySync: boolean; // Enable entity synchronization
  entityPath: string; // Path to entity files
}

interface IMigrationOptions {
  isNeedMigrationStart: boolean; // Enable migrations
  migrationPath: string; // Path to migration files
}
```

---

## 🛠️ Usage

### Calling Stored Procedures

```typescript
// Call procedure with object parameters
const result = await db.call('my_package.my_procedure', {
  p_param1: 'value1',
  p_param2: 123,
  p_param3: true,
});

// Call procedure with array parameters (positional)
const result = await db.call('my_package.my_procedure', ['value1', 123, true]);

// Call procedure with options (transaction commands)
const result = await db.call(
  'my_package.my_procedure',
  { param1: 'value' },
  {
    postgres: ['SET search_path TO myschema'],
    oracle: ['ALTER SESSION SET NLS_DATE_FORMAT = "YYYY-MM-DD"'],
  }
);
```

### Executing SQL Queries in Transaction

```typescript
// Execute SQL with parameters
const result = await db.callSqlTransaction(
  'SELECT * FROM users WHERE id = :id',
  { id: 123 }
);

// Execute SQL with transaction options
const result = await db.callSqlTransaction(
  'INSERT INTO users (name, email) VALUES (:name, :email)',
  { name: 'John', email: 'john@example.com' },
  {
    postgres: ['SET CONSTRAINTS ALL DEFERRED'],
    oracle: ['SAVEPOINT my_savepoint'],
  }
);
```

### Creating Notifications

```typescript
// Oracle CQN notification
const channel = await db.makeNotify({
  oracle: {
    sql: "SELECT * FROM my_table WHERE id = '123'",
    notifyCallback: (data) => {
      console.log('Table changed:', data);
    },
    options: {
      operations: oracledb.CQN_OPCODE_ALL_OPS,
      qos: oracledb.SUBSCR_QOS_ROWIDS,
      timeout: 60 * 60 * 12,
    },
  },
});

// PostgreSQL LISTEN/NOTIFY
const channel = await db.makeNotify({
  postgres: {
    sql: 'LISTEN my_channel',
    notifyCallback: (data) => {
      console.log('Notification received:', data);
    },
  },
});

// Unsubscribe from notification
await db.unlistenNotify(channel);
```

### Custom Serializers

```typescript
// Register custom serializer for DATE type
db.setSerializer({
  serializerType: 'DATE',
  strategy: (value: string | Buffer) => {
    return new Date(value.toString()).toISOString();
  },
});

// Delete specific serializer
db.deleteSerializer({ serializerType: 'DATE' });

// Delete all serializers
db.deleteAllSerializers();
```

### Readonly Serializer Mapping

```typescript
// Get readonly serializer mapping
const mapping = db.serializerReadOnlyMapping;

// Try to modify (will throw error)
mapping.set('DATE', { type: 1, strategy: () => {} }); // Error: Read-only map
```

---

## 🗄️ Supported Databases

### Oracle Database

**Features:**

- CQN (Continuous Query Notification)
- REF CURSOR support
- Automatic cursor result fetching
- Connection pooling with master/slave
- Thick mode support

**Configuration Example:**

```typescript
{
  type: 'oracle',
  host: 'localhost',
  port: 1521,
  username: 'system',
  password: 'oracle',
  database: 'xe',
  libraryPath: '/opt/oracle/instantclient_21_13', // Required for thick mode
  cqn_config: {
    port: 1521,
  },
}
```

### PostgreSQL

**Features:**

- LISTEN/NOTIFY mechanism
- refcursor support
- Automatic cursor result fetching
- Connection pooling with master/slave
- Custom type serializers

**Configuration Example:**

```typescript
{
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'postgres',
  database: 'mydb',
}
```

---

## 🏗️ NestJS Integration

### Installation

```bash
npm install typeorm-procedure-kit @nestjs/common @nestjs/core
```

### Module Setup

```typescript
// database.module.ts
import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from 'typeorm-procedure-kit/nest';

@Global()
@Module({
  imports: [
    DatabaseModule.forRoot({
      config: {
        type: 'postgres',
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT, 10),
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        dbPackages: ['my_package'],
        callTimeout: 30000,
        poolSize: 10,
        appName: 'my-nest-app',
        outKeyTransformCase: 'camelCase',
        isNeedRegisterDefaultSerializers: false,
        libraryPath: undefined,
        cqn_config: {
          port: 1521,
        },
      },
      procedureList: {
        myProcedure: 'my_package.my_procedure',
      },
    }),
  ],
})
export class AppModule {}
```

### Service Usage

```typescript
// user.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDatabase } from 'typeorm-procedure-kit/nest';
import { Database } from 'typeorm-procedure-kit';

@Injectable()
export class UserService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async getUser(id: number) {
    return this.db.call('my_package.get_user', { p_user_id: id });
  }

  async createUser(userData: { name: string; email: string }) {
    return this.db.call('my_package.create_user', userData);
  }

  async updateUser(id: number, userData: { name?: string; email?: string }) {
    return this.db.call('my_package.update_user', {
      p_user_id: id,
      ...userData,
    });
  }
}
```

### Custom Logger

```typescript
// custom-logger.ts
import { ILoggerModule } from 'typeorm-procedure-kit';

export class CustomLogger implements ILoggerModule {
  log(message: any, context?: string) {
    console.log(`[${context || 'Database'}]`, message);
  }

  error(message: any, stack?: string, context?: string) {
    console.error(`[${context || 'Database'}]`, message, stack);
  }

  warn(message: any, context?: string) {
    console.warn(`[${context || 'Database'}]`, message);
  }

  debug(message: any, context?: string) {
    console.debug(`[${context || 'Database'}]`, message);
  }

  verbose(message: any, context?: string) {
    console.info(`[${context || 'Database'}]`, message);
  }
}

// Usage
const db = new Database(config, procedureList, new CustomLogger());
```

---

## 📚 API Reference

### Database Class

#### `constructor(config, procedureList, logger, entity?, migration?)`

Creates a new Database instance.

#### `initDataBase(): Promise<void>`

Initializes the database connection and loads procedure metadata.

#### `call(executeString, params?, options?): Promise<Array<T>>`

Calls a stored procedure.

**Parameters:**

- `executeString`: Procedure name (e.g., 'package.procedure' or 'procedure')
- `params`: Parameters as object or array
- `options`: Transaction options

#### `callSqlTransaction(sql, params?, options?): Promise<Array<T>>`

Executes SQL query in transaction.

**Parameters:**

- `sql`: SQL query string
- `params`: Parameters object
- `options`: Transaction options

#### `makeNotify(options): Promise<string>`

Creates a notification listener.

**Parameters:**

- `options`: Notification configuration

#### `unlistenNotify(channel): Promise<void>`

Unsubscribes from a notification channel.

**Parameters:**

- `channel`: Channel name

#### `setSerializer(options): void`

Registers a custom serializer.

**Parameters:**

- `options`: Serializer configuration

#### `deleteSerializer(serializerType): void`

Deletes a specific serializer.

#### `deleteAllSerializers(): void`

Deletes all registered serializers.

#### `serializerReadOnlyMapping: Readonly<Map>`

Readonly map of registered serializers.

---

## 🎯 Examples

### Example 1: Basic Oracle Usage

```typescript
import { Database } from 'typeorm-procedure-kit';
import oracledb from 'oracledb';

const db = new Database(
  {
    type: 'oracle',
    host: 'localhost',
    port: 1521,
    username: 'hr',
    password: 'hr',
    database: 'xe',
    dbPackages: ['hr_package'],
    callTimeout: 30000,
    poolSize: 10,
    appName: 'my-app',
    outKeyTransformCase: 'camelCase',
    isNeedRegisterDefaultSerializers: false,
    libraryPath: '/opt/oracle/instantclient_21_13',
    cqn_config: {
      port: 1521,
    },
  },
  {
    getEmployee: 'hr_package.get_employee',
    createEmployee: 'hr_package.create_employee',
  },
  logger
);

await db.initDataBase();

// Call procedure with cursor
const employees = await db.call('hr_package.get_employee', {
  p_dept_id: 10,
});

console.log(employees);
```

### Example 2: PostgreSQL with Notifications

```typescript
import { Database } from 'typeorm-procedure-kit';

const db = new Database(
  {
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'postgres',
    database: 'mydb',
    dbPackages: ['public'],
    callTimeout: 30000,
    poolSize: 10,
    appName: 'my-app',
    outKeyTransformCase: 'camelCase',
    isNeedRegisterDefaultSerializers: false,
    libraryPath: undefined,
    cqn_config: {
      port: 1521,
    },
  },
  {
    getUsers: 'public.get_users',
  },
  logger
);

await db.initDataBase();

// Setup notification
const channel = await db.makeNotify({
  postgres: {
    sql: 'LISTEN user_updates',
    notifyCallback: (data) => {
      console.log('User updated:', data);
    },
  },
});

// Call procedure
const users = await db.call('public.get_users');

// Cleanup
await db.unlistenNotify(channel);
```

### Example 3: Custom Date Serializer

```typescript
import { Database } from 'typeorm-procedure-kit';

const db = new Database(config, procedureList, logger);

// Register custom DATE serializer
db.setSerializer({
  serializerType: 'DATE',
  strategy: (value: string | Buffer) => {
    const date = new Date(value.toString());
    return {
      iso: date.toISOString(),
      formatted: date.toLocaleDateString('en-US'),
    };
  },
});

// Use in procedure call
const result = await db.call('my_package.get_data');
console.log(result); // Dates will be transformed
```

### Example 4: Transaction with Multiple Commands

```typescript
const result = await db.call(
  'my_package.process_order',
  {
    p_order_id: 123,
    p_customer_id: 456,
  },
  {
    postgres: ['SET search_path TO myschema', 'SET CONSTRAINTS ALL DEFERRED'],
    oracle: [
      'ALTER SESSION SET NLS_DATE_FORMAT = "YYYY-MM-DD"',
      'SAVEPOINT order_processing',
    ],
  }
);
```

---

## 🔧 Advanced Configuration

### Case Transformation Strategies

```typescript
// camelCase (default)
{
  outKeyTransformCase: 'camelCase',
  // 'user_name' -> 'userName'
}

// lowerCase
{
  outKeyTransformCase: 'lowerCase',
  // 'USER_NAME' -> 'user_name'
}
```

### Connection Pooling

```typescript
{
  poolSize: 10,        // Maximum connections in pool
  callTimeout: 30000,  // Query timeout in milliseconds
}
```

### Oracle Thick Mode

```typescript
{
  type: 'oracle',
  libraryPath: '/opt/oracle/instantclient_21_13', // Path to Oracle Instant Client
  // Enables thick mode for better performance
}
```

---

## 🐛 Troubleshooting

### Common Issues

**1. Procedure not found error**

```typescript
// Make sure procedure is in procedureObjectList
{
  myProcedure: 'my_package.my_procedure', // Must match exactly
}
```

**2. Connection timeout**

```typescript
// Increase timeout
{
  callTimeout: 60000, // 60 seconds
}
```

**3. Oracle CQN not working**

```typescript
// Ensure CQN is enabled in Oracle
// Check notification port is correct
{
  cqn_config: {
    port: 1521, // Must match Oracle listener port
  },
}
```

**4. Type errors with serializers**

```typescript
// Ensure strategy returns correct type
db.setSerializer({
  serializerType: 'DATE',
  strategy: (value) => new Date(value.toString()), // Return Date object
});
```

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📧 Support

For issues and questions, please open an issue on GitHub.

---

## 📊 Roadmap

- [ ] Add MongoDB support
- [ ] Add MySQL support
- [ ] Add SQL Server support
- [ ] Implement connection pool monitoring
- [ ] Add query caching
- [ ] Add performance metrics

---

## 👥 Authors

- Paul Budanov

---

## 🙏 Acknowledgments

- TypeORM team for the excellent ORM
- Oracle and PostgreSQL communities
- All contributors and users

---

## 📚 Related Projects

- [TypeORM](https://typeorm.io/) - ORM for TypeScript and JavaScript
- [oracledb](https://oracle.github.io/node-oracledb/) - Oracle Database driver
- [pg](https://node-postgres.com/) - PostgreSQL client for Node.js

---

**Made with ❤️ for the Node.js community**
