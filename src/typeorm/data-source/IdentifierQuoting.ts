import { TypeORMError } from '../error/TypeORMError.js';

import type { DataSource } from './DataSource.js';
import type { TIdentifierQuoting } from './DataSourceOptions.js';

const POSTGRES_RESERVED_WORDS = new Set([
  'ALL',
  'ANALYSE',
  'ANALYZE',
  'AND',
  'ANY',
  'ARRAY',
  'AS',
  'ASC',
  'ASYMMETRIC',
  'AUTHORIZATION',
  'BINARY',
  'BOTH',
  'CASE',
  'CAST',
  'CHECK',
  'COLLATE',
  'COLLATION',
  'COLUMN',
  'CONCURRENTLY',
  'CONSTRAINT',
  'CREATE',
  'CROSS',
  'CURRENT_CATALOG',
  'CURRENT_DATE',
  'CURRENT_ROLE',
  'CURRENT_SCHEMA',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'CURRENT_USER',
  'DEFAULT',
  'DEFERRABLE',
  'DESC',
  'DISTINCT',
  'DO',
  'ELSE',
  'END',
  'EXCEPT',
  'FALSE',
  'FETCH',
  'FOR',
  'FOREIGN',
  'FREEZE',
  'FROM',
  'FULL',
  'GRANT',
  'GROUP',
  'HAVING',
  'ILIKE',
  'IN',
  'INITIALLY',
  'INNER',
  'INTERSECT',
  'INTO',
  'IS',
  'ISNULL',
  'JOIN',
  'LATERAL',
  'LEADING',
  'LEFT',
  'LIKE',
  'LIMIT',
  'LOCALTIME',
  'LOCALTIMESTAMP',
  'NATURAL',
  'NOT',
  'NOTNULL',
  'NULL',
  'OFFSET',
  'ON',
  'ONLY',
  'OR',
  'ORDER',
  'OUTER',
  'OVERLAPS',
  'PLACING',
  'PRIMARY',
  'REFERENCES',
  'RETURNING',
  'RIGHT',
  'SELECT',
  'SESSION_USER',
  'SIMILAR',
  'SOME',
  'SYMMETRIC',
  'TABLE',
  'TABLESAMPLE',
  'THEN',
  'TO',
  'TRAILING',
  'TRUE',
  'UNION',
  'UNIQUE',
  'USER',
  'USING',
  'VARIADIC',
  'VERBOSE',
  'WHEN',
  'WHERE',
  'WINDOW',
  'WITH',
]);

const ORACLE_RESERVED_WORDS = new Set([
  'ACCESS',
  'ADD',
  'ALL',
  'ALTER',
  'AND',
  'ANY',
  'ARRAYLEN',
  'AS',
  'ASC',
  'AUDIT',
  'BETWEEN',
  'BY',
  'CHAR',
  'CHECK',
  'CLUSTER',
  'COLUMN',
  'COLUMN_VALUE',
  'COMMENT',
  'COMPRESS',
  'CONNECT',
  'CREATE',
  'CURRENT',
  'DATE',
  'DECIMAL',
  'DEFAULT',
  'DELETE',
  'DESC',
  'DISTINCT',
  'DROP',
  'ELSE',
  'EXCLUSIVE',
  'EXISTS',
  'FILE',
  'FLOAT',
  'FOR',
  'FROM',
  'GRANT',
  'GROUP',
  'HAVING',
  'IDENTIFIED',
  'IMMEDIATE',
  'IN',
  'INCREMENT',
  'INDEX',
  'INITIAL',
  'INSERT',
  'INTEGER',
  'INTERSECT',
  'INTO',
  'IS',
  'LEVEL',
  'LIKE',
  'LOCK',
  'LONG',
  'MAXEXTENTS',
  'MINUS',
  'MLSLABEL',
  'MODE',
  'MODIFY',
  'NOAUDIT',
  'NOCOMPRESS',
  'NESTED_TABLE_ID',
  'NOT',
  'NOTFOUND',
  'NOWAIT',
  'NULL',
  'NUMBER',
  'OF',
  'OFFLINE',
  'ON',
  'ONLINE',
  'OPTION',
  'OR',
  'ORDER',
  'PCTFREE',
  'PRIOR',
  'PRIVILEGES',
  'PUBLIC',
  'RAW',
  'RENAME',
  'RESOURCE',
  'REVOKE',
  'ROW',
  'ROWID',
  'ROWLABEL',
  'ROWNUM',
  'ROWS',
  'SELECT',
  'SESSION',
  'SET',
  'SHARE',
  'SIZE',
  'SMALLINT',
  'SQLBUF',
  'START',
  'SUCCESSFUL',
  'SYNONYM',
  'SYSDATE',
  'TABLE',
  'THEN',
  'TO',
  'TRIGGER',
  'UID',
  'UNION',
  'UNIQUE',
  'UPDATE',
  'USER',
  'VALIDATE',
  'VALUES',
  'VARCHAR',
  'VARCHAR2',
  'VIEW',
  'WHENEVER',
  'WHERE',
  'WITH',
]);

const POSTGRES_UNQUOTED_IDENTIFIER_PATTERN = /^[\p{L}_][\p{L}\p{N}_$]*$/u;
const ORACLE_UNQUOTED_IDENTIFIER_PATTERN = /^\p{L}[\p{L}\p{N}_$#]*$/u;

export function resolveIdentifierQuoting(value: unknown): TIdentifierQuoting {
  if (value === undefined) return 'disabled';
  if (value === 'disabled' || value === 'enabled') return value;

  throw new TypeORMError(
    `DataSource option "identifierQuoting" must be either "disabled" or "enabled".`
  );
}

export function validateUnquotedIdentifier(
  identifier: string,
  databaseType: 'oracle' | 'postgres'
): string {
  const identifierPattern =
    databaseType === 'oracle'
      ? ORACLE_UNQUOTED_IDENTIFIER_PATTERN
      : POSTGRES_UNQUOTED_IDENTIFIER_PATTERN;
  if (!identifierPattern.test(identifier)) {
    throw new TypeORMError(
      `Unsafe unquoted SQL identifier "${identifier}". Use identifierQuoting: "enabled" for identifiers that cannot be emitted without quoting.`
    );
  }

  const reservedWords =
    databaseType === 'oracle' ? ORACLE_RESERVED_WORDS : POSTGRES_RESERVED_WORDS;
  if (reservedWords.has(identifier.toUpperCase())) {
    throw new TypeORMError(
      `Reserved SQL word "${identifier}" cannot be used as an unquoted ${databaseType} identifier. Use identifierQuoting: "enabled".`
    );
  }

  return identifier;
}

export function formatDatabaseIdentifier(
  identifier: string,
  quoting: TIdentifierQuoting,
  databaseType: 'oracle' | 'postgres',
  quote: (value: string) => string
): string {
  return quoting === 'enabled'
    ? quote(identifier)
    : validateUnquotedIdentifier(identifier, databaseType);
}

export function formatDataSourceIdentifier(
  identifier: string,
  dataSource: DataSource
): string {
  return formatDatabaseIdentifier(
    identifier,
    dataSource.identifierQuoting,
    dataSource.options.type,
    (value) => dataSource.driver.escape(value)
  );
}
