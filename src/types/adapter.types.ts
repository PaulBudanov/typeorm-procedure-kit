import type { OracleConnection } from '../adapters/oracle/oracle-connection.js';
import type { OracleNotify } from '../adapters/oracle/oracle-notify.js';
import type { OracleSerializer } from '../adapters/oracle/oracle-serializer.js';
import type { PostgreConnection } from '../adapters/postgres/postgre-connection.js';
import type { PostgreNotify } from '../adapters/postgres/postgre-notify.js';
import type { PostgreSerializer } from '../adapters/postgres/postgre-serializer.js';
import type {
  IDatabaseAdapterContract,
  IRegisteredFetchHandlerOptions,
} from '../interfaces/adapter.interfaces.js';
import type { OracleConnectionOptions } from '../typeorm/driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../typeorm/driver/postgres/PostgresConnectionOptions.js';
import type oracledb from 'oracledb';
import type { Client, PoolClient } from 'pg';

export type { IDatabaseAdapterContract, IRegisteredFetchHandlerOptions };

export type TSerializerClassTypes = OracleSerializer | PostgreSerializer;

export type TNotifyClassTypes = OracleNotify | PostgreNotify;

export type TConnectionClassTypes = OracleConnection | PostgreConnection;

export type TAdapterUtilsClassTypes = IDatabaseAdapterContract;

export type TPoolTypes = oracledb.Pool | PoolClient;

export type TConnectionTypes = oracledb.Connection | Client;

export type TConnectionOptions =
  | OracleConnectionOptions
  | PostgresConnectionOptions;
