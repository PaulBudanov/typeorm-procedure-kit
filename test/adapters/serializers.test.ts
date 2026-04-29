import oracledb from 'oracledb';
import { types as pgTypes } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

const caseNativeStrategy = {
  transformColumnName: (value: string): string => value.toLowerCase(),
  destroy: (): void => undefined,
};

describe('database serializers', (): void => {
  afterEach((): void => {
    oracledb.fetchTypeHandler = undefined as never;
  });

  it('registers, overrides, and deletes PostgreSQL serializers', (): void => {
    const logger = createLogger();
    const serializer = new PostgreSerializer(logger, {
      isNeedRegisterDefaultSerializers: false,
      caseNativeStrategy,
    });
    const strategy = vi.fn((value: string | Buffer): string =>
      value.toString().toUpperCase()
    );

    serializer.setSerializer({ serializerType: 'DATE', strategy });
    serializer.setSerializer({ serializerType: 'DATE', strategy });

    expect(serializer.serializerMapping.get('DATE')?.strategy).toBe(strategy);
    expect(logger.warn).toHaveBeenCalledWith(
      'Serializer with type DATE already exists, overriding...'
    );
    expect(pgTypes.getTypeParser(pgTypes.builtins.DATE)('abc')).toBe('ABC');

    serializer.deleteSerializer({ serializerType: 'DATE' });
    expect(serializer.serializerMapping.has('DATE')).toBe(false);
    expect((): void => {
      serializer.setSerializer({ serializerType: 'WRONG' as never, strategy });
    }).toThrow(ServerError);
  });

  it('registers, uses, and deletes Oracle serializers', (): void => {
    const serializer = new OracleSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseNativeStrategy,
    });
    const strategy = vi.fn((value: string | Buffer): string => `v:${value}`);

    serializer.setSerializer({ serializerType: 'DATE', strategy });
    serializer.registerFetchHandlerHook();

    const response = oracledb.fetchTypeHandler?.({
      name: 'CREATED_AT',
      dbType: oracledb.DB_TYPE_DATE,
    } as never);

    expect(response?.converter?.('2024-01-01')).toBe('v:2024-01-01');
    expect(serializer.serializerMapping.has('DATE')).toBe(true);

    serializer.deleteSerializer({ serializerType: 'DATE' });
    expect(serializer.serializerMapping.has('DATE')).toBe(false);
    serializer.deleteAllSerializers();
    expect(serializer.serializerMapping.size).toBe(0);
  });
});
