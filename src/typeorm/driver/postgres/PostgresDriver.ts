import type pg from 'pg';
import type { Pool, PoolClient } from 'pg';

import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import { DataSource } from '../../data-source/DataSource.js';
import { ConnectionIsNotSetError } from '../../error/ConnectionIsNotSetError.js';
import { DriverPackageNotInstalledError } from '../../error/DriverPackageNotInstalledError.js';
import { TypeORMError } from '../../error/TypeORMError.js';
import { ColumnMetadata } from '../../metadata/ColumnMetadata.js';
import { EntityMetadata } from '../../metadata/EntityMetadata.js';
import { PlatformTools } from '../../platform/PlatformTools.js';
import type { QueryRunner } from '../../query-runner/QueryRunner.js';
import { RdbmsSchemaBuilder } from '../../schema-builder/RdbmsSchemaBuilder.js';
import { Table } from '../../schema-builder/table/Table.js';
import { TableColumn } from '../../schema-builder/table/TableColumn.js';
import { TableForeignKey } from '../../schema-builder/table/TableForeignKey.js';
import { View } from '../../schema-builder/view/View.js';
import { ApplyValueTransformers } from '../../util/ApplyValueTransformers.js';
import { DateUtils } from '../../util/DateUtils.js';
import { InstanceChecker } from '../../util/InstanceChecker.js';
import { OrmUtils } from '../../util/OrmUtils.js';
import { VersionUtils } from '../../util/VersionUtils.js';
import type { Driver } from '../Driver.js';
import { DriverUtils } from '../DriverUtils.js';
import type { ColumnType } from '../types/ColumnTypes.js';
import type { CteCapabilities } from '../types/CteCapabilities.js';
import type { DataTypeDefaults } from '../types/DataTypeDefaults.js';
import type { MappedColumnTypes } from '../types/MappedColumnTypes.js';
import type { ReplicationMode } from '../types/ReplicationMode.js';
import type { UpsertType } from '../types/UpsertType.js';

import type { PostgresConnectionCredentialsOptions } from './PostgresConnectionCredentialsOptions.js';
import type { PostgresConnectionOptions } from './PostgresConnectionOptions.js';
import { PostgresQueryRunner } from './PostgresQueryRunner.js';

/**
 * Organizes communication with PostgreSQL DBMS.
 */
export class PostgresDriver implements Driver {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Connection used by driver.
   */
  public connection!: DataSource;

  /**
   * Postgres underlying library.
   */
  public postgres!: typeof pg;

  /**
   * Pool for master database.
   */
  public master: Pool | undefined;

  /**
   * Pool for slave databases.
   * Used in replication.
   */
  public slaves: Array<Pool> = [];

  /**
   * We store all created query runners because we need to release them.
   */
  public connectedQueryRunners: Array<QueryRunner> = [];

  // -------------------------------------------------------------------------
  // Public Implemented Properties
  // -------------------------------------------------------------------------

  /**
   * Connection options.
   */
  public options!: PostgresConnectionOptions;

  /**
   * Version of Postgres. Requires a SQL query to the DB, so it is set on the first
   * connection attempt.
   */
  public version?: string;

  /**
   * Database name used to perform all write queries.
   */
  public database?: string;

  /**
   * Schema name used to perform all write queries.
   */
  public schema?: string;

  /**
   * Schema that's used internally by Postgres for object resolution.
   *
   * Because we never set this we have to track it in separately from the `schema` so
   * we know when we have to specify the full schema or not.
   *
   * In most cases this will be `public`.
   */
  public searchSchema?: string;

  /**
   * Indicates if replication is enabled.
   */
  public isReplicated = false;

  /**
   * Indicates if tree tables are supported by this driver.
   */
  public treeSupport = true;

  /**
   * Represent transaction support by this driver
   */
  public transactionSupport = 'nested' as const;

  /**
   * Gets list of supported column data types by a driver.
   *
   * @see https://www.postgresql.org/docs/current/datatype.html
   */
  public supportedDataTypes: Array<ColumnType> = [
    'int',
    'int2',
    'int4',
    'int8',
    'smallint',
    'integer',
    'bigint',
    'decimal',
    'numeric',
    'real',
    'float',
    'float4',
    'float8',
    'double precision',
    'money',
    'character varying',
    'varchar',
    'character',
    'char',
    'text',
    'citext',
    'hstore',
    'bytea',
    'bit',
    'varbit',
    'bit varying',
    'timetz',
    'timestamptz',
    'timestamp',
    'timestamp without time zone',
    'timestamp with time zone',
    'date',
    'time',
    'time without time zone',
    'time with time zone',
    'interval',
    'bool',
    'boolean',
    'enum',
    'point',
    'line',
    'lseg',
    'box',
    'path',
    'polygon',
    'circle',
    'cidr',
    'inet',
    'macaddr',
    'macaddr8',
    'tsvector',
    'tsquery',
    'uuid',
    'xml',
    'json',
    'jsonb',
    'jsonpath',
    'int4range',
    'int8range',
    'numrange',
    'tsrange',
    'tstzrange',
    'daterange',
    'int4multirange',
    'int8multirange',
    'nummultirange',
    'tsmultirange',
    'tstzmultirange',
    'datemultirange',
    'geometry',
    'geography',
    'cube',
    'ltree',
    'vector',
    'halfvec',
  ];

  /**
   * Returns type of upsert supported by driver if any
   */
  public supportedUpsertTypes: Array<UpsertType> = ['on-conflict-do-update'];

  /**
   * Gets list of spatial column data types.
   */
  public spatialTypes: Array<ColumnType> = ['geometry', 'geography'];

  /**
   * Gets list of column data types that support length by a driver.
   */
  public withLengthColumnTypes: Array<ColumnType> = [
    'character varying',
    'varchar',
    'character',
    'char',
    'bit',
    'varbit',
    'bit varying',
    'vector',
    'halfvec',
  ];

  /**
   * Gets list of column data types that support precision by a driver.
   */
  public withPrecisionColumnTypes: Array<ColumnType> = [
    'numeric',
    'decimal',
    'interval',
    'time without time zone',
    'time with time zone',
    'timestamp without time zone',
    'timestamp with time zone',
  ];

  /**
   * Gets list of column data types that support scale by a driver.
   */
  public withScaleColumnTypes: Array<ColumnType> = ['numeric', 'decimal'];

  /**
   * Orm has special columns and we need to know what database column types should be for those types.
   * Column types are driver dependant.
   */
  public mappedDataTypes: MappedColumnTypes = {
    createDate: 'timestamp',
    createDateDefault: 'now()',
    updateDate: 'timestamp',
    updateDateDefault: 'now()',
    deleteDate: 'timestamp',
    deleteDateNullable: true,
    version: 'int4',
    treeLevel: 'int4',
    migrationId: 'int4',
    migrationName: 'varchar',
    migrationTimestamp: 'int8',
    cacheId: 'int4',
    cacheIdentifier: 'varchar',
    cacheTime: 'int8',
    cacheDuration: 'int4',
    cacheQuery: 'text',
    cacheResult: 'text',
    metadataType: 'varchar',
    metadataDatabase: 'varchar',
    metadataSchema: 'varchar',
    metadataTable: 'varchar',
    metadataName: 'varchar',
    metadataValue: 'text',
  };

  /**
   * The prefix used for the parameters
   */
  public parametersPrefix = '$';

  /**
   * Default values of length, precision and scale depends on column data type.
   * Used in the cases when length/precision/scale is not specified by user.
   */
  public dataTypeDefaults: DataTypeDefaults = {
    character: { length: 1 },
    bit: { length: 1 },
    interval: { precision: 6 },
    'time without time zone': { precision: 6 },
    'time with time zone': { precision: 6 },
    'timestamp without time zone': { precision: 6 },
    'timestamp with time zone': { precision: 6 },
  };

  /**
   * Max length allowed by Postgres for aliases.
   * @see https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS
   */
  public maxAliasLength = 63;

  public isGeneratedColumnsSupported = false;

  public cteCapabilities: CteCapabilities = {
    enabled: true,
    writable: true,
    requiresRecursiveHint: true,
    materializedHint: true,
  };

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(connection?: DataSource) {
    if (!connection) {
      return;
    }

    this.connection = connection;
    this.options = connection.options as PostgresConnectionOptions;
    this.isReplicated = this.options.replication ? true : false;
    if (this.options.useUTC) {
      process.env.PGTZ = 'UTC';
    }
    // load postgres package
    this.loadDependencies();

    this.database =
      DriverUtils.buildDriverOptions<PostgresConnectionCredentialsOptions>(
        this.options.replication
          ? this.options.replication.master
          : this.options
      ).database;
    this.schema = DriverUtils.buildDriverOptions(this.options).schema;
  }

  // -------------------------------------------------------------------------
  // Public Implemented Methods
  // -------------------------------------------------------------------------

  /**
   * Performs connection to the database.
   * Based on pooling options, it can either create connection immediately,
   * either create a pool and create connection when needed.
   */
  public async connect(): Promise<void> {
    if (this.options.replication) {
      this.slaves = await Promise.all(
        this.options.replication.slaves.map((slave) => {
          return this.createPool(this.options, slave);
        })
      );
      this.master = await this.createPool(
        this.options,
        this.options.replication.master
      );
    } else {
      this.master = await this.createPool(this.options, this.options);
    }

    if (!this.version || !this.database || !this.searchSchema) {
      const queryRunner = this.createQueryRunner('master');

      if (!this.version) {
        this.version = await (
          queryRunner as unknown as PostgresQueryRunner
        ).getVersion();
      }

      if (!this.database) {
        this.database = await queryRunner.getCurrentDatabase();
      }

      if (!this.searchSchema) {
        this.searchSchema = await queryRunner.getCurrentSchema();
      }

      await queryRunner.release();
    }

    if (!this.schema) {
      this.schema = this.searchSchema;
    }
  }

  /**
   * Makes any action after connection (e.g. create extensions in Postgres driver).
   */
  public async afterConnect(): Promise<void> {
    const extensionsMetadata = await this.checkMetadataForExtensions();
    const [connection, release] = await this.obtainMasterConnection();

    const installExtensions =
      this.options.installExtensions === undefined ||
      this.options.installExtensions;
    if (installExtensions && extensionsMetadata.hasExtensions) {
      await this.enableExtensions(extensionsMetadata, connection);
    }

    this.isGeneratedColumnsSupported = VersionUtils.isGreaterOrEqual(
      this.version,
      '12.0'
    );

    await release();
  }

  protected async enableExtensions(
    extensionsMetadata: unknown,
    connection: pg.PoolClient
  ): Promise<void> {
    const { logger } = this.connection;

    const metadata = extensionsMetadata as {
      hasUuidColumns: boolean;
      hasCitextColumns: boolean;
      hasHstoreColumns: boolean;
      hasCubeColumns: boolean;
      hasGeometryColumns: boolean;
      hasLtreeColumns: boolean;
      hasVectorColumns: boolean;
      hasExclusionConstraints: boolean;
    };

    const {
      hasUuidColumns,
      hasCitextColumns,
      hasHstoreColumns,
      hasCubeColumns,
      hasGeometryColumns,
      hasLtreeColumns,
      hasVectorColumns,
      hasExclusionConstraints,
    } = metadata;

    if (hasUuidColumns)
      try {
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "${
            this.options.uuidExtension || 'uuid-ossp'
          }"`
        );
      } catch (_) {
        logger.log(
          'warn',
          `At least one of the entities has uuid column, but the '${
            this.options.uuidExtension || 'uuid-ossp'
          }' extension cannot be installed automatically. Please install it manually using superuser rights, or select another uuid extension.`
        );
      }
    if (hasCitextColumns)
      try {
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "citext"`
        );
      } catch (_) {
        logger.log(
          'warn',
          "At least one of the entities has citext column, but the 'citext' extension cannot be installed automatically. Please install it manually using superuser rights"
        );
      }
    if (hasHstoreColumns)
      try {
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "hstore"`
        );
      } catch (_) {
        logger.log(
          'warn',
          "At least one of the entities has hstore column, but the 'hstore' extension cannot be installed automatically. Please install it manually using superuser rights"
        );
      }
    if (hasGeometryColumns)
      try {
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "postgis"`
        );
      } catch (_) {
        logger.log(
          'warn',
          "At least one of the entities has a geometry column, but the 'postgis' extension cannot be installed automatically. Please install it manually using superuser rights"
        );
      }
    if (hasCubeColumns)
      try {
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "cube"`
        );
      } catch (_) {
        logger.log(
          'warn',
          "At least one of the entities has a cube column, but the 'cube' extension cannot be installed automatically. Please install it manually using superuser rights"
        );
      }
    if (hasLtreeColumns)
      try {
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "ltree"`
        );
      } catch (_) {
        logger.log(
          'warn',
          "At least one of the entities has a ltree column, but the 'ltree' extension cannot be installed automatically. Please install it manually using superuser rights"
        );
      }
    if (hasVectorColumns)
      try {
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "vector"`
        );
      } catch (_) {
        logger.log(
          'warn',
          "At least one of the entities has a vector column, but the 'vector' extension (pgvector) cannot be installed automatically. Please install it manually using superuser rights"
        );
      }
    if (hasExclusionConstraints)
      try {
        // The btree_gist extension provides operator support in PostgreSQL exclusion constraints
        await this.executeQuery(
          connection,
          `CREATE EXTENSION IF NOT EXISTS "btree_gist"`
        );
      } catch (_) {
        logger.log(
          'warn',
          "At least one of the entities has an exclusion constraint, but the 'btree_gist' extension cannot be installed automatically. Please install it manually using superuser rights"
        );
      }
  }

  protected async checkMetadataForExtensions(): Promise<{
    hasUuidColumns: boolean;
    hasCitextColumns: boolean;
    hasHstoreColumns: boolean;
    hasCubeColumns: boolean;
    hasGeometryColumns: boolean;
    hasLtreeColumns: boolean;
    hasVectorColumns: boolean;
    hasExclusionConstraints: boolean;
    hasExtensions: boolean;
  }> {
    const hasUuidColumns = this.connection.entityMetadatas.some((metadata) => {
      return (
        metadata.generatedColumns.filter(
          (column) => column.generationStrategy === 'uuid'
        ).length > 0
      );
    });
    const hasCitextColumns = this.connection.entityMetadatas.some(
      (metadata) => {
        return (
          metadata.columns.filter((column) => column.type === 'citext').length >
          0
        );
      }
    );
    const hasHstoreColumns = this.connection.entityMetadatas.some(
      (metadata) => {
        return (
          metadata.columns.filter((column) => column.type === 'hstore').length >
          0
        );
      }
    );
    const hasCubeColumns = this.connection.entityMetadatas.some((metadata) => {
      return (
        metadata.columns.filter((column) => column.type === 'cube').length > 0
      );
    });
    const hasGeometryColumns = this.connection.entityMetadatas.some(
      (metadata) => {
        return (
          metadata.columns.filter(
            (column) => this.spatialTypes.indexOf(column.type) >= 0
          ).length > 0
        );
      }
    );
    const hasLtreeColumns = this.connection.entityMetadatas.some((metadata) => {
      return (
        metadata.columns.filter((column) => column.type === 'ltree').length > 0
      );
    });
    const hasVectorColumns = this.connection.entityMetadatas.some(
      (metadata) => {
        return metadata.columns.some(
          (column) => column.type === 'vector' || column.type === 'halfvec'
        );
      }
    );
    const hasExclusionConstraints = this.connection.entityMetadatas.some(
      (metadata) => {
        return metadata.exclusions.length > 0;
      }
    );

    return {
      hasUuidColumns,
      hasCitextColumns,
      hasHstoreColumns,
      hasCubeColumns,
      hasGeometryColumns,
      hasLtreeColumns,
      hasVectorColumns,
      hasExclusionConstraints,
      hasExtensions:
        hasUuidColumns ||
        hasCitextColumns ||
        hasHstoreColumns ||
        hasGeometryColumns ||
        hasCubeColumns ||
        hasLtreeColumns ||
        hasVectorColumns ||
        hasExclusionConstraints,
    };
  }

  /**
   * Closes connection with database.
   */
  public async disconnect(): Promise<void> {
    if (!this.master) {
      throw new ConnectionIsNotSetError('postgres');
    }

    await this.closePool(this.master);
    await Promise.all(this.slaves.map((slave) => this.closePool(slave)));
    this.master = undefined;
    this.slaves = [];
  }

  /**
   * Creates a schema builder used to build and sync a schema.
   */
  public createSchemaBuilder(): RdbmsSchemaBuilder {
    return new RdbmsSchemaBuilder(this.connection);
  }

  /**
   * Creates a query runner used to execute database queries.
   */
  public createQueryRunner(mode: ReplicationMode): QueryRunner {
    return new PostgresQueryRunner(this, mode) as unknown as QueryRunner;
  }

  /**
   * Prepares given value to a value to be persisted, based on its column type and metadata.
   */
  public preparePersistentValue(
    value: unknown,
    columnMetadata: ColumnMetadata
  ): unknown {
    if (columnMetadata.transformer)
      value = ApplyValueTransformers.transformTo(
        columnMetadata.transformer,
        value
      );

    if (value === null || value === undefined) return value;

    if (columnMetadata.type === Boolean) {
      return value === true ? 1 : 0;
    } else if (columnMetadata.type === 'date') {
      return DateUtils.mixedDateToDateString(value as string | Date, {
        utc: columnMetadata.utc,
      });
    } else if (columnMetadata.type === 'time') {
      return DateUtils.mixedDateToTimeString(value as string | Date);
    } else if (
      (columnMetadata.type as string) === 'datetime' ||
      columnMetadata.type === Date ||
      columnMetadata.type === 'timestamp' ||
      columnMetadata.type === 'timestamp with time zone' ||
      columnMetadata.type === 'timestamp without time zone'
    ) {
      return DateUtils.mixedDateToDate(value as string | Date);
    } else if (
      ['json', 'jsonb', ...this.spatialTypes].indexOf(columnMetadata.type) >= 0
    ) {
      return JSON.stringify(value);
    } else if (
      columnMetadata.type === 'vector' ||
      columnMetadata.type === 'halfvec'
    ) {
      if (Array.isArray(value)) {
        return `[${value.join(',')}]`;
      } else {
        return value;
      }
    } else if (columnMetadata.type === 'hstore') {
      if (typeof value === 'string') {
        return value;
      } else {
        // https://www.postgresql.org/docs/9.0/hstore.html
        const quoteString = (value: unknown): string => {
          // If a string to be quoted is `null` or `undefined`, we return a literal unquoted NULL.
          // This way, NULL values can be stored in the hstore object.
          if (value === null || typeof value === 'undefined') {
            return 'NULL';
          }
          // Convert non-null values to string since HStore only stores strings anyway.
          // To include a double quote or a backslash in a key or value, escape it with a backslash.
          return `"${`${value}`.replace(/(?=["\\])/g, '\\')}"`;
        };
        const recordValue = value as Record<string, unknown>;
        return Object.keys(recordValue)
          .map((key) => quoteString(key) + '=>' + quoteString(recordValue[key]))
          .join(',');
      }
    } else if (columnMetadata.type === 'simple-array') {
      return DateUtils.simpleArrayToString(value as string | Date);
    } else if (columnMetadata.type === 'simple-json') {
      return DateUtils.simpleJsonToString(value as string | Date);
    } else if (columnMetadata.type === 'cube') {
      if (columnMetadata.isArray) {
        return `{${(value as Array<Array<number>>)
          .map((cube: Array<number>) => `"(${cube.join(',')})"`)
          .join(',')}}`;
      }
      return `(${(value as Array<number>).join(',')})`;
    } else if (columnMetadata.type === 'ltree') {
      return String(value)
        .split('.')
        .filter(Boolean)
        .join('.')
        .replace(/[\s]+/g, '_');
    } else if (
      (columnMetadata.type === 'enum' ||
        columnMetadata.type === 'simple-enum') &&
      !columnMetadata.isArray
    ) {
      return '' + value;
    }

    return value;
  }

  /**
   * Prepares given value to a value to be persisted, based on its column type or metadata.
   */
  public prepareHydratedValue(
    value: unknown,
    columnMetadata: ColumnMetadata
  ): unknown {
    if (value === null || value === undefined)
      return columnMetadata.transformer
        ? ApplyValueTransformers.transformFrom(
            columnMetadata.transformer,
            value
          )
        : value;

    if (columnMetadata.type === Boolean) {
      value = value ? true : false;
    } else if (
      (columnMetadata.type as string) === 'datetime' ||
      columnMetadata.type === Date ||
      columnMetadata.type === 'timestamp' ||
      columnMetadata.type === 'timestamp with time zone' ||
      columnMetadata.type === 'timestamp without time zone'
    ) {
      value = DateUtils.normalizeHydratedDate(value as string | Date);
    } else if (columnMetadata.type === 'date') {
      value = DateUtils.mixedDateToDateString(value as string | Date, {
        utc: columnMetadata.utc,
      });
    } else if (columnMetadata.type === 'time') {
      value = DateUtils.mixedTimeToString(value as string | Date);
    } else if (
      columnMetadata.type === 'vector' ||
      columnMetadata.type === 'halfvec'
    ) {
      if (
        typeof value === 'string' &&
        value.startsWith('[') &&
        value.endsWith(']')
      ) {
        if (value === '[]') return [];
        return value.slice(1, -1).split(',').map(Number);
      }
    } else if (columnMetadata.type === 'hstore') {
      if (columnMetadata.hstoreType === 'object') {
        const unescapeString = (str: string): string =>
          str.replace(/\\./g, (m: string) => m[1]!);
        const regexp =
          /"([^"\\]*(?:\\.[^"\\]*)*)"=>(?:(NULL)|"([^"\\]*(?:\\.[^"\\]*)*)")(?:,|$)/g;
        const object: ObjectLiteral = {};
        `${value}`.replace(regexp, (_, key, nullValue, stringValue) => {
          const stringValueSafe = (stringValue as string) ?? '';
          object[unescapeString(key as string)] = nullValue
            ? null
            : unescapeString(stringValueSafe);
          return '';
        });
        value = object;
      }
    } else if (columnMetadata.type === 'simple-array') {
      value = DateUtils.stringToSimpleArray(value as string);
    } else if (columnMetadata.type === 'simple-json') {
      value = DateUtils.stringToSimpleJson(value as string);
    } else if (columnMetadata.type === 'cube') {
      value = String(value).replace(/[()\s]+/g, ''); // remove whitespace
      if (columnMetadata.isArray) {
        /**
         * Strips these groups from `{"1,2,3","",NULL}`:
         * 1. ["1,2,3", undefined]  <- cube of arity 3
         * 2. ["", undefined]         <- cube of arity 0
         * 3. [undefined, "NULL"]     <- NULL
         */
        const regexp = /(?:"((?:[\d\s.,])*)")|(?:(NULL))/g;
        const unparsedArrayString = value as string;

        value = [];
        let cube: RegExpExecArray | null = null;
        // Iterate through all regexp matches for cubes/null in array
        while ((cube = regexp.exec(unparsedArrayString)) !== null) {
          if (cube[1] !== undefined) {
            (value as Array<Array<number>>).push(
              cube[1]!.split(',').filter(Boolean).map(Number)
            );
          } else {
            (value as Array<Array<number>>).push(
              undefined as unknown as Array<number>
            );
          }
        }
      } else {
        value = (value as string).split(',').filter(Boolean).map(Number);
      }
    } else if (
      columnMetadata.type === 'enum' ||
      columnMetadata.type === 'simple-enum'
    ) {
      if (columnMetadata.isArray) {
        if (value === '{}') return [];

        // manually convert enum array to array of values (pg does not support, see https://github.com/brianc/node-pg-types/issues/56)
        value = (value as string)
          .slice(1, -1)
          .split(',')
          .map((val) => {
            // replace double quotes from the beginning and from the end
            if (val.startsWith(`"`) && val.endsWith(`"`))
              val = val.slice(1, -1);
            // replace escaped backslash and double quotes
            return val.replace(/\\(\\|")/g, '$1');
          });

        // convert to number if that exists in possible enum options
        value = (value as Array<string>).map((val: string) => {
          return !isNaN(+val) &&
            columnMetadata.enum!.indexOf(parseInt(val)) >= 0
            ? parseInt(val)
            : val;
        });
      } else {
        // convert to number if that exists in possible enum options
        value =
          !isNaN(+(value as string)) &&
          columnMetadata.enum!.indexOf(parseInt(value as string)) >= 0
            ? parseInt(value as string)
            : value;
      }
    } else if (columnMetadata.type === Number) {
      // convert to number if number
      value = !isNaN(+(value as string)) ? parseInt(value as string) : value;
    }

    if (columnMetadata.transformer)
      value = ApplyValueTransformers.transformFrom(
        columnMetadata.transformer,
        value
      );
    return value;
  }

  /**
   * Replaces parameters in the given sql with special escaping character
   * and an array of parameter names to be passed to a query.
   */
  public escapeQueryWithParameters(
    sql: string,
    parameters: ObjectLiteral,
    nativeParameters: ObjectLiteral
  ): [string, Array<unknown>] {
    const escapedParameters: Array<unknown> = Object.keys(nativeParameters).map(
      (key) => nativeParameters[key]
    );
    if (!parameters || !Object.keys(parameters).length)
      return [sql, escapedParameters];

    const parameterIndexMap = new Map<string, number>();
    sql = sql.replace(
      /:(\.\.\.)?([A-Za-z0-9_.]+)/g,
      (full, isArray: string, key: string): string => {
        if (!Object.prototype.hasOwnProperty.call(parameters, key)) {
          return full;
        }

        if (parameterIndexMap.has(key)) {
          return this.parametersPrefix + parameterIndexMap.get(key);
        }

        const value: unknown = parameters[key];

        if (isArray) {
          return (value as Array<unknown>)
            .map((v: unknown) => {
              escapedParameters.push(v);
              return this.createParameter(key, escapedParameters.length - 1);
            })
            .join(', ');
        }

        if (typeof value === 'function') {
          return (value as () => string)();
        }

        escapedParameters.push(value);
        parameterIndexMap.set(key, escapedParameters.length);
        return this.createParameter(key, escapedParameters.length - 1);
      }
    ); // todo: make replace only in value statements, otherwise problems
    return [sql, escapedParameters];
  }

  /**
   * Escapes a column name.
   */
  public escape(columnName: string): string {
    return '"' + columnName + '"';
  }

  /**
   * Build full table name with schema name and table name.
   * E.g. myDB.mySchema.myTable
   */
  public buildTableName(tableName: string, schema?: string): string {
    const tablePath = [tableName];

    if (schema) {
      tablePath.unshift(schema);
    }

    return tablePath.join('.');
  }

  /**
   * Parse a target table name or other types and return a normalized table definition.
   */
  public parseTableName(
    target: EntityMetadata | Table | View | TableForeignKey | string
  ): { database?: string; schema?: string; tableName: string } {
    const driverDatabase = this.database;
    const driverSchema = this.schema;

    if (InstanceChecker.isTable(target) || InstanceChecker.isView(target)) {
      const parsed = this.parseTableName(target.name);

      return {
        database: target.database || parsed.database || driverDatabase,
        schema: target.schema || parsed.schema || driverSchema,
        tableName: parsed.tableName,
      };
    }

    if (InstanceChecker.isTableForeignKey(target)) {
      const parsed = this.parseTableName(target.referencedTableName);

      return {
        database:
          target.referencedDatabase || parsed.database || driverDatabase,
        schema: target.referencedSchema || parsed.schema || driverSchema,
        tableName: parsed.tableName,
      };
    }

    if (InstanceChecker.isEntityMetadata(target)) {
      // EntityMetadata tableName is never a path

      return {
        database: target.database || driverDatabase,
        schema: target.schema || driverSchema,
        tableName: target.tableName,
      };
    }

    const parts = target.split('.');

    return {
      database: driverDatabase,
      schema: (parts.length > 1 ? parts[0] : undefined) || driverSchema,
      tableName: parts.length > 1 ? parts[1]! : parts[0]!,
    };
  }

  /**
   * Creates a database type from a given column metadata.
   */
  public normalizeType(column: {
    type?: ColumnType;
    length?: number | string;
    precision?: number | null;
    scale?: number;
    isArray?: boolean;
  }): string {
    if (
      column.type === Number ||
      column.type === 'int' ||
      column.type === 'int4'
    ) {
      return 'integer';
    } else if (column.type === String || column.type === 'varchar') {
      return 'character varying';
    } else if (column.type === Date || column.type === 'timestamp') {
      return 'timestamp without time zone';
    } else if (column.type === 'timestamptz') {
      return 'timestamp with time zone';
    } else if (column.type === 'time') {
      return 'time without time zone';
    } else if (column.type === 'timetz') {
      return 'time with time zone';
    } else if (column.type === Boolean || column.type === 'bool') {
      return 'boolean';
    } else if (column.type === 'simple-array') {
      return 'text';
    } else if (column.type === 'simple-json') {
      return 'text';
    } else if (column.type === 'simple-enum') {
      return 'enum';
    } else if (column.type === 'int2') {
      return 'smallint';
    } else if (column.type === 'int8') {
      return 'bigint';
    } else if (column.type === 'decimal') {
      return 'numeric';
    } else if (column.type === 'float8' || column.type === 'float') {
      return 'double precision';
    } else if (column.type === 'float4') {
      return 'real';
    } else if (column.type === 'char') {
      return 'character';
    } else if (column.type === 'varbit') {
      return 'bit varying';
    } else {
      return (column.type as string) || '';
    }
  }

  /**
   * Normalizes "default" value of the column.
   */
  public normalizeDefault(columnMetadata: ColumnMetadata): string | undefined {
    const defaultValue = columnMetadata.default;

    if (defaultValue === null || defaultValue === undefined) {
      return undefined;
    }

    if (columnMetadata.isArray && Array.isArray(defaultValue)) {
      return `'{${defaultValue.map((val) => String(val)).join(',')}}'`;
    }

    if (
      (columnMetadata.type === 'enum' ||
        columnMetadata.type === 'simple-enum' ||
        typeof defaultValue === 'number' ||
        typeof defaultValue === 'string') &&
      defaultValue !== undefined
    ) {
      return `'${defaultValue}'`;
    }

    if (typeof defaultValue === 'boolean') {
      return defaultValue ? 'true' : 'false';
    }

    if (typeof defaultValue === 'function') {
      const value = defaultValue() as unknown;

      return this.normalizeDatetime(value) as string | undefined;
    }

    if (typeof defaultValue === 'object') {
      return `'${JSON.stringify(defaultValue)}'`;
    }

    return defaultValue !== undefined ? String(defaultValue) : undefined;
  }

  /**
   * Compares "default" value of the column.
   * Postgres sorts json values before it is saved, so in that case a deep comparison has to be performed to see if has changed.
   */
  private defaultEqual(
    columnMetadata: ColumnMetadata,
    tableColumn: TableColumn
  ): boolean {
    if (
      ['json', 'jsonb'].includes(columnMetadata.type as string) &&
      !['function', 'undefined'].includes(typeof columnMetadata.default)
    ) {
      const tableColumnDefault =
        typeof tableColumn.default === 'string'
          ? (JSON.parse(
              tableColumn.default.substring(1, tableColumn.default.length - 1)
            ) as unknown)
          : tableColumn.default;

      return OrmUtils.deepCompare(columnMetadata.default, tableColumnDefault);
    }

    const columnDefault = this.lowerDefaultValueIfNecessary(
      this.normalizeDefault(columnMetadata)
    );
    return columnDefault === tableColumn.default;
  }

  /**
   * Normalizes "isUnique" value of the column.
   */
  public normalizeIsUnique(column: ColumnMetadata): boolean {
    return column.entityMetadata.uniques.some(
      (uq) => uq.columns.length === 1 && uq.columns[0] === column
    );
  }

  /**
   * Returns default column lengths, which is required on column creation.
   */
  public getColumnLength(column: ColumnMetadata): string {
    return column.length ? column.length.toString() : '';
  }

  /**
   * Creates column type definition including length, precision and scale
   */
  public createFullType(column: TableColumn): string {
    let type = column.type;

    if (column.length) {
      type += '(' + column.length + ')';
    } else if (
      column.precision !== null &&
      column.precision !== undefined &&
      column.scale !== null &&
      column.scale !== undefined
    ) {
      type += '(' + column.precision + ',' + column.scale + ')';
    } else if (column.precision !== null && column.precision !== undefined) {
      type += '(' + column.precision + ')';
    }

    if (column.type === 'time without time zone') {
      type =
        'TIME' +
        (column.precision !== null && column.precision !== undefined
          ? '(' + column.precision + ')'
          : '');
    } else if (column.type === 'time with time zone') {
      type =
        'TIME' +
        (column.precision !== null && column.precision !== undefined
          ? '(' + column.precision + ')'
          : '') +
        ' WITH TIME ZONE';
    } else if (column.type === 'timestamp without time zone') {
      type =
        'TIMESTAMP' +
        (column.precision !== null && column.precision !== undefined
          ? '(' + column.precision + ')'
          : '');
    } else if (column.type === 'timestamp with time zone') {
      type =
        'TIMESTAMP' +
        (column.precision !== null && column.precision !== undefined
          ? '(' + column.precision + ')'
          : '') +
        ' WITH TIME ZONE';
    } else if (this.spatialTypes.indexOf(column.type as ColumnType) >= 0) {
      if (column.spatialFeatureType != null && column.srid != null) {
        type = `${column.type}(${column.spatialFeatureType},${column.srid})`;
      } else if (column.spatialFeatureType != null) {
        type = `${column.type}(${column.spatialFeatureType})`;
      } else {
        type = column.type;
      }
    } else if (column.type === 'vector' || column.type === 'halfvec') {
      type = column.type + (column.length ? '(' + column.length + ')' : '');
    }

    if (column.isArray) type += ' array';

    return type;
  }

  /**
   * Obtains a new database connection to a master server.
   * Used for replication.
   * If replication is not setup then returns default connection's database connection.
   */
  public async obtainMasterConnection(): Promise<[PoolClient, () => void]> {
    if (!this.master) {
      throw new TypeORMError('Driver not Connected');
    }

    return new Promise<[PoolClient, () => void]>((resolve, reject) => {
      this.master!.connect(
        (
          err: Error | undefined,
          client: PoolClient | undefined,
          done: (release?: PoolClient['release']) => void
        ) => {
          if (err || !client) {
            reject(err);
          } else {
            resolve([client, done]);
          }
        }
      );
    });
  }

  /**
   * Obtains a new database connection to a slave server.
   * Used for replication.
   * If replication is not setup then returns master (default) connection's database connection.
   */
  public async obtainSlaveConnection(): Promise<[PoolClient, () => void]> {
    if (!this.slaves.length) {
      return this.obtainMasterConnection();
    }

    const random = Math.floor(Math.random() * this.slaves.length);
    const slavePool = this.slaves[random];

    if (!slavePool) {
      throw new TypeORMError('Slave connection not available');
    }

    return new Promise<[PoolClient, () => void]>((resolve, reject) => {
      void slavePool.connect(
        (
          err: Error | undefined,
          client: PoolClient | undefined,
          done: (release?: PoolClient['release']) => void
        ) => {
          if (err || !client) {
            reject(err);
          } else {
            resolve([client, done]);
          }
        }
      );
    });
  }

  /**
   * Creates generated map of values generated or returned by database after INSERT query.
   *
   * todo: slow. optimize Object.keys(), OrmUtils.mergeDeep and column.createValueMap parts
   */
  public createGeneratedMap(
    metadata: EntityMetadata,
    insertResult: ObjectLiteral
  ): ObjectLiteral | undefined {
    if (!insertResult) return undefined;

    return Object.keys(insertResult).reduce((map, key) => {
      const column = metadata.findColumnWithDatabaseName(key);
      if (column) {
        OrmUtils.mergeDeep(map, column.createValueMap(insertResult[key]));
        // OrmUtils.mergeDeep(map, column.createValueMap(this.prepareHydratedValue(insertResult[key], column))); // TODO: probably should be like there, but fails on enums, fix later
      }
      return map;
    }, {} as ObjectLiteral);
  }

  public findChangedColumns(
    tableColumns: Array<TableColumn>,
    columnMetadatas: Array<ColumnMetadata>
  ): Array<ColumnMetadata> {
    return columnMetadatas.filter((columnMetadata) => {
      const tableColumn = tableColumns.find(
        (c) => c.name === columnMetadata.databaseName
      );
      if (!tableColumn) return false; // we don't need new columns, we only need exist and changed

      const isColumnChanged =
        tableColumn.name !== columnMetadata.databaseName ||
        tableColumn.type !== this.normalizeType(columnMetadata) ||
        tableColumn.length !== columnMetadata.length ||
        tableColumn.isArray !== columnMetadata.isArray ||
        tableColumn.precision !== columnMetadata.precision ||
        (columnMetadata.scale !== undefined &&
          tableColumn.scale !== columnMetadata.scale) ||
        tableColumn.comment !== this.escapeComment(columnMetadata.comment) ||
        (!tableColumn.isGenerated &&
          !this.defaultEqual(columnMetadata, tableColumn)) || // we included check for generated here, because generated columns already can have default values
        tableColumn.isPrimary !== columnMetadata.isPrimary ||
        tableColumn.isNullable !== columnMetadata.isNullable ||
        tableColumn.isUnique !== this.normalizeIsUnique(columnMetadata) ||
        tableColumn.enumName !== columnMetadata.enumName ||
        (tableColumn.enum &&
          columnMetadata.enum &&
          !OrmUtils.isArraysEqual(
            tableColumn.enum,
            columnMetadata.enum.map((val) => val + '')
          )) || // enums in postgres are always strings
        tableColumn.isGenerated !== columnMetadata.isGenerated ||
        (tableColumn.spatialFeatureType || '').toLowerCase() !==
          (columnMetadata.spatialFeatureType || '').toLowerCase() ||
        tableColumn.srid !== columnMetadata.srid ||
        tableColumn.generatedType !== columnMetadata.generatedType ||
        (tableColumn.asExpression || '').trim() !==
          (columnMetadata.asExpression || '').trim() ||
        tableColumn.collation !== columnMetadata.collation;
      return isColumnChanged;
    });
  }

  private lowerDefaultValueIfNecessary(
    value: string | undefined
  ): string | undefined {
    // Postgres saves function calls in default value as lowercase #2733
    if (!value) {
      return value;
    }
    return value
      .split(`'`)
      .map((v, i) => {
        return i % 2 === 1 ? v : v.toLowerCase();
      })
      .join(`'`);
  }

  /**
   * Returns true if driver supports RETURNING / OUTPUT statement.
   */
  public isReturningSqlSupported(): boolean {
    return true;
  }

  /**
   * Returns true if driver supports uuid values generation on its own.
   */
  public isUUIDGenerationSupported(): boolean {
    return true;
  }

  /**
   * Returns true if driver supports fulltext indices.
   */
  public isFullTextColumnTypeSupported(): boolean {
    return false;
  }

  public get uuidGenerator(): string {
    return this.options.uuidExtension === 'pgcrypto'
      ? 'gen_random_uuid()'
      : 'uuid_generate_v4()';
  }

  /**
   * Creates an escaped parameter.
   */
  public createParameter(_parameterName: string, index: number): string {
    return this.parametersPrefix + (index + 1);
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * If driver dependency is not given explicitly, then try to load it via "require".
   */
  protected loadDependencies(): void {
    try {
      const postgres = (this.options.driver ??
        PlatformTools.load('pg')) as typeof pg;
      this.postgres = postgres;
      try {
        const pgNative =
          this.options.nativeDriver || PlatformTools.load('pg-native');
        if (pgNative && this.postgres.native)
          this.postgres = this.postgres.native;
      } catch {
        //nothing
      }
    } catch {
      // todo: better error for browser env
      throw new DriverPackageNotInstalledError('Postgres', 'pg');
    }
  }

  /**
   * Creates a new connection pool for a given database credentials.
   */
  protected async createPool(
    options: PostgresConnectionOptions,
    credentials: PostgresConnectionCredentialsOptions
  ): Promise<pg.Pool> {
    const { logger } = this.connection;
    credentials = Object.assign({}, credentials);

    // build connection options for the driver
    // See: https://github.com/brianc/node-postgres/tree/master/packages/pg-pool#create
    const connectionOptions = Object.assign(
      {},
      {
        connectionString: credentials.url,
        host: credentials.host,
        user: credentials.username,
        password: credentials.password,
        database: credentials.database,
        port: credentials.port,
        ssl: credentials.ssl,
        connectionTimeoutMillis: options.connectTimeoutMS,
        application_name:
          options.applicationName ?? credentials.applicationName,
        max: options.poolSize,
      }
    );

    if (options.parseInt8 !== undefined) {
      if (
        this.postgres?.defaults &&
        Object.getOwnPropertyDescriptor(this.postgres.defaults, 'parseInt8')
          ?.set
      ) {
        this.postgres.defaults.parseInt8 = options.parseInt8;
      } else {
        logger.log(
          'warn',
          'Attempted to set parseInt8 option, but the postgres driver does not support setting defaults.parseInt8. This option will be ignored.'
        );
      }
    }

    // create a connection pool
    const pool = new this.postgres.Pool(connectionOptions as pg.PoolConfig);

    const poolErrorHandler =
      options.poolErrorHandler ||
      ((error: unknown): unknown =>
        logger.log('warn', `Postgres pool raised an error. ${error}`));

    /*
          Attaching an error handler to pool errors is essential, as, otherwise, errors raised will go unhandled and
          cause the hosting app to crash.
         */
    pool.on('error', poolErrorHandler);

    return new Promise((ok, fail) => {
      pool.connect(
        (
          err: Error | undefined,
          client: pg.PoolClient | undefined,
          done: (release?: pg.PoolClient['release']) => void
        ) => {
          if (err || !client) return fail(err);

          if (options.logNotifications) {
            client.on('notice', (msg: unknown) => {
              const message = msg as Record<string, unknown>;
              if (message)
                this.connection.logger.log('info', message.message as string);
            });
            client.on('notification', (msg: unknown) => {
              const message = msg as Record<string, unknown>;
              if (message)
                this.connection.logger.log(
                  'info',
                  `Received NOTIFY on channel ${message.channel}: ${message.payload}.`
                );
            });
          }
          done();
          ok(pool);
        }
      );
    });
  }

  /**
   * Closes connection pool.
   */
  protected async closePool(pool: pg.Pool): Promise<void> {
    while (this.connectedQueryRunners.length) {
      await this.connectedQueryRunners[0]!.release();
    }

    return new Promise<void>((ok, fail) => {
      const end = pool.end as
        | ((callback?: (err?: Error) => void) => void)
        | undefined;
      if (end) {
        end.call(pool, (err?: Error) => (err ? fail(err) : ok()));
      } else {
        ok();
      }
    });
  }

  /**
   * Executes given query.
   */
  protected executeQuery(
    connection: pg.PoolClient,
    query: string
  ): Promise<pg.QueryResult> {
    this.connection.logger.logQuery(query);

    return new Promise((ok, fail) => {
      connection.query(
        query,
        (err: Error | undefined, result: pg.QueryResult) =>
          err ? fail(err) : ok(result)
      );
    });
  }

  /**
   * If parameter is a datetime function, e.g. "CURRENT_TIMESTAMP", normalizes it.
   * Otherwise returns original input.
   */
  protected normalizeDatetime(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }
    // check if input is datetime function
    const upperCaseValue = value.toUpperCase();
    const isDatetimeFunction =
      upperCaseValue.indexOf('CURRENT_TIMESTAMP') !== -1 ||
      upperCaseValue.indexOf('CURRENT_DATE') !== -1 ||
      upperCaseValue.indexOf('CURRENT_TIME') !== -1 ||
      upperCaseValue.indexOf('LOCALTIMESTAMP') !== -1 ||
      upperCaseValue.indexOf('LOCALTIME') !== -1;

    if (isDatetimeFunction) {
      // extract precision, e.g. "(3)"
      const precision = value.match(/\(\d+\)/);

      if (upperCaseValue.indexOf('CURRENT_TIMESTAMP') !== -1) {
        return precision
          ? `('now'::text)::timestamp${precision[0]} with time zone`
          : 'now()';
      } else if (upperCaseValue === 'CURRENT_DATE') {
        return "('now'::text)::date";
      } else if (upperCaseValue.indexOf('CURRENT_TIME') !== -1) {
        return precision
          ? `('now'::text)::time${precision[0]} with time zone`
          : "('now'::text)::time with time zone";
      } else if (upperCaseValue.indexOf('LOCALTIMESTAMP') !== -1) {
        return precision
          ? `('now'::text)::timestamp${precision[0]} without time zone`
          : "('now'::text)::timestamp without time zone";
      } else if (upperCaseValue.indexOf('LOCALTIME') !== -1) {
        return precision
          ? `('now'::text)::time${precision[0]} without time zone`
          : "('now'::text)::time without time zone";
      }
    }

    return value;
  }

  /**
   * Escapes a given comment.
   */
  protected escapeComment(comment?: string): string | undefined {
    if (!comment) return comment;

    // eslint-disable-next-line no-control-regex
    comment = comment.replace(/\u0000/g, ''); // Null bytes aren't allowed in comments

    return comment;
  }
}
