import { describe, expect, it, vi } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { EntityNotFoundError } from '../../src/typeorm/error/EntityNotFoundError.js';
import { QueryFailedError } from '../../src/typeorm/error/QueryFailedError.js';
import { replaceNamedParameters } from '../../src/typeorm/util/NamedParameterUtils.js';
import {
  buildSqlTag,
  sqlIdentifier,
  sqlParameterList,
  unsafeRawSql,
} from '../../src/typeorm/util/SqlTagUtils.js';

describe('SQL security hardening', (): void => {
  it('escapes embedded double quotes in driver identifiers', (): void => {
    const dataSource = new DataSource({ type: 'postgres' });

    expect(dataSource.driver.escape('x" FROM pg_sleep(5)--')).toBe(
      '"x"" FROM pg_sleep(5)--"'
    );
  });

  it('binds Postgres catalog lookup values instead of interpolating them', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'postgres' });
    const queryRunner = dataSource.createQueryRunner() as unknown as {
      getCurrentSchema(): Promise<string>;
      hasTable(tableName: string): Promise<boolean>;
      query: (
        sql: string,
        parameters?: Array<unknown>
      ) => Promise<Array<unknown>>;
    };
    vi.spyOn(queryRunner, 'getCurrentSchema').mockResolvedValue('public');
    const query = vi.spyOn(queryRunner, 'query').mockResolvedValue([]);

    await queryRunner.hasTable("users' OR pg_sleep(5) IS NULL --");

    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM "information_schema"."tables" WHERE "table_schema" = $1 AND "table_name" = $2',
      ['public', "users' OR pg_sleep(5) IS NULL --"]
    );
  });

  it('binds Oracle catalog lookup values instead of interpolating them', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'oracle' });
    const queryRunner = dataSource.createQueryRunner() as unknown as {
      hasColumn(tableName: string, columnName: string): Promise<boolean>;
      query: (
        sql: string,
        parameters?: Array<unknown>
      ) => Promise<Array<unknown>>;
    };
    const query = vi.spyOn(queryRunner, 'query').mockResolvedValue([]);

    await queryRunner.hasColumn("USERS' OR 1=1 --", "ID' OR 1=1 --");

    expect(query).toHaveBeenCalledWith(
      'SELECT "COLUMN_NAME" FROM "USER_TAB_COLS" WHERE "TABLE_NAME" = :1 AND "COLUMN_NAME" = :2',
      ["USERS' OR 1=1 --", "ID' OR 1=1 --"]
    );
  });

  it('keeps Oracle owner-qualified catalog binds in SQL occurrence order', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'oracle' });
    const queryRunner = dataSource.createQueryRunner() as unknown as {
      getCurrentDatabase(): Promise<string>;
      getCurrentSchema(): Promise<string>;
      loadTables(tableNames: Array<string>): Promise<Array<unknown>>;
      query: (
        sql: string,
        parameters?: Array<unknown>
      ) => Promise<Array<unknown>>;
    };
    vi.spyOn(queryRunner, 'getCurrentDatabase').mockResolvedValue('ORCL');
    vi.spyOn(queryRunner, 'getCurrentSchema').mockResolvedValue('CURRENT_USER');
    const query = vi.spyOn(queryRunner, 'query').mockResolvedValue([]);

    await queryRunner.loadTables(['APP.USERS']);

    expect(query).toHaveBeenCalledWith(
      'SELECT "TABLE_NAME", "OWNER" FROM "ALL_TABLES" WHERE ("OWNER" = :1 AND "TABLE_NAME" = :2)',
      ['APP', 'USERS']
    );
  });

  it('does not replace named parameters inside dialect-specific string literals', (): void => {
    const seenKeys: Array<string> = [];
    const sql = [
      "SELECT E'it\\'s :id'",
      "U&'value :id'",
      "q'[it's :id]'",
      ':id::uuid',
    ].join(', ');

    const rewritten = replaceNamedParameters(sql, ({ key }) => {
      seenKeys.push(key);
      return '?';
    });

    expect(seenKeys).toEqual(['id']);
    expect(rewritten).toBe(
      "SELECT E'it\\'s :id', U&'value :id', q'[it's :id]', ?::uuid"
    );
  });

  it('requires explicit raw SQL helpers in sql tagged templates', (): void => {
    const dataSource = new DataSource({ type: 'postgres' });
    const driver = dataSource.driver;

    expect(
      buildSqlTag({
        driver,
        strings: [
          'select * from ',
          ' where id in (',
          ') and ',
          ' = ',
          '',
        ] as never,
        expressions: [
          sqlIdentifier('public', 'users'),
          sqlParameterList([1, 2]),
          sqlIdentifier('status'),
          'active',
        ],
      })
    ).toEqual({
      query:
        'select * from "public"."users" where id in ($1, $2) and "status" = $3',
      parameters: [1, 2, 'active'],
    });

    expect(() =>
      buildSqlTag({
        driver,
        strings: ['select ', ''] as never,
        expressions: [(): string => '1'],
      })
    ).toThrow('Function expressions are not parameterized');

    expect(
      buildSqlTag({
        driver,
        strings: ['select ', ''] as never,
        expressions: [unsafeRawSql('count(*)')],
      })
    ).toEqual({ query: 'select count(*)', parameters: [] });
  });

  it('redacts criteria in entity not found errors', (): void => {
    const error = new EntityNotFoundError('User', {
      resetToken: 'secret-token',
    });

    expect(error.message).toContain('"resetToken":"[REDACTED]"');
    expect(error.message).not.toContain('secret-token');
  });

  it('keeps QueryFailedError raw parameters out of enumerable serialization', (): void => {
    const error = new QueryFailedError(
      'select * from users where password = $1',
      [{ password: 'secret-password' }],
      new Error('database failed')
    );

    expect(error.parameters).toEqual([{ password: 'secret-password' }]);
    expect(Object.keys(error)).not.toContain('parameters');
    expect(JSON.stringify(error)).toContain('[REDACTED]');
    expect(JSON.stringify(error)).not.toContain('secret-password');
  });
});
