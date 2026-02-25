/**
 * Column types used for @PrimaryGeneratedColumn() decorator.
 */
export type PrimaryGeneratedColumnType =
  | 'int' //  oracle
  | 'int2' // postgres
  | 'int4' // postgres
  | 'int8' // postgres
  | 'integer' // postgres, oracle
  | 'smallint' // postgres, oracle,
  | 'bigint' // postgres
  | 'dec' // oracle
  | 'decimal' // postgres
  | 'numeric' // postgres
  | 'number'; // oracle

/**
 * Column types where spatial properties are used.
 */
export type SpatialColumnType =
  | 'geometry' // postgres
  | 'geography'; // postgres

/**
 * Column types where precision and scale properties are used.
 */
export type WithPrecisionColumnType =
  | 'float' // oracle
  | 'dec' // oracle
  | 'decimal' //  postgres
  | 'numeric' // postgres
  | 'real' // postgres, oracle
  | 'double precision' // postgres, oracle
  | 'number' // oracle
  | 'time' // postgres
  | 'time with time zone' // postgres
  | 'time without time zone' // postgres
  | 'timestamp' // postgres, oracle,
  | 'timestamp without time zone' // postgres
  | 'timestamp with time zone' // postgres, oracle
  | 'timestamp with local time zone'; // oracle

/**
 * Column types where column length is used.
 */
export type WithLengthColumnType =
  | 'character varying' // postgres
  | 'character' // postgres
  | 'varchar' // postgres
  | 'char' // postgres, oracle
  | 'nchar' // oracle
  | 'varchar2' // oracle
  | 'nvarchar2' // oracle
  | 'raw' // oracle
  | 'vector' //  postgres
  | 'halfvec'; // postgres

/**
 * Column types that can be unsigned. Works only for MySQL.
 */
export type UnsignedColumnType =
  | 'tinyint'
  | 'smallint'
  | 'mediumint'
  | 'int'
  | 'integer'
  | 'bigint'
  | 'float'
  | 'double'
  | 'decimal';

/**
 * All other regular column types.
 */
export type SimpleColumnType =
  | 'simple-array' // typeorm-specific, automatically mapped to string
  // |"string" // typeorm-specific, automatically mapped to varchar depend on platform
  | 'simple-json' // typeorm-specific, automatically mapped to string
  | 'simple-enum' // typeorm-specific, automatically mapped to string

  // numeric types
  | 'int' // postgres
  | 'int2' // postgres
  | 'integer' // postgres, oracle
  | 'int4' // postgres
  | 'int8' // postgres
  | 'float' // oracle
  | 'float4' // postgres
  | 'float8' // postgres
  | 'smallint' // postgres
  | 'bigint' // postgres
  | 'money' // postgres

  // boolean types
  | 'boolean' // postgres
  | 'bool' // postgres

  // text/binary types
  | 'blob' //  oracle
  | 'text' //postgres
  | 'citext' // postgres
  | 'hstore' // postgres
  | 'bytea' // postgres
  | 'long' // oracle
  | 'raw' // oracle
  | 'long raw' // oracle
  | 'bfile' // oracle
  | 'clob' // oracle
  | 'nclob' // oracle

  // date types
  | 'timetz' // postgres
  | 'timestamptz' // postgres
  | 'timestamp with local time zone' // oracle
  | 'date' // postgres, oracle
  | 'interval year to month' // oracle
  | 'interval day to second' // oracle
  | 'interval' // postgres

  // geometric types
  | 'point' // postgres
  | 'line' // postgres
  | 'lseg' // postgres
  | 'box' // postgres
  | 'circle' // postgres
  | 'path' // postgres
  | 'polygon' // postgres

  // range types
  | 'int4range' // postgres
  | 'int8range' // postgres
  | 'numrange' // postgres
  | 'tsrange' // postgres
  | 'tstzrange' // postgres
  | 'daterange' // postgres

  // multirange types
  | 'int4multirange' // postgres
  | 'int8multirange' // postgres
  | 'nummultirange' // postgres
  | 'tsmultirange' // postgres
  | 'tstzmultirange' // postgres
  | 'datemultirange' // postgres

  // other types
  | 'enum' // postgres
  | 'cidr' // postgres
  | 'inet' // postgres
  | 'macaddr' // postgres
  | 'macaddr8' // postgres
  | 'bit' // postgres
  | 'bit varying' // postgres
  | 'varbit' // postgres
  | 'tsvector' // postgres
  | 'tsquery' // postgres
  | 'uuid' // postgres
  | 'xml' //  postgres
  | 'json' // postgres
  | 'jsonb' // postgres
  | 'jsonpath' // postgres
  | 'rowid' // oracle
  | 'urowid' // oracle
  | 'cube' // postgres
  | 'ltree'; // postgres

/**
 * Any column type column can be.
 */
export type ColumnType =
  | WithPrecisionColumnType
  | WithLengthColumnType
  | SpatialColumnType
  | SimpleColumnType
  | BooleanConstructor
  | DateConstructor
  | NumberConstructor
  | StringConstructor;
// | ObjectConstructor
// | BigIntConstructor;
