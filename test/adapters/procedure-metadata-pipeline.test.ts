import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { ProcedureListBase } from '../../src/core/procedure-list-base.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

function createAdapter(
  vendor: 'oracle' | 'postgres'
): OracleAdapter | PostgreAdapter {
  const options = {
    isNeedRegisterDefaultSerializers: false,
    caseStrategy: { transformColumnName: (name: string): string => name },
  };
  if (vendor === 'oracle') {
    const dataSource = new DataSource({ type: 'oracle' });
    dataSource.driver.version = '19.0.0.0.0';
    return new OracleAdapter(dataSource, createLogger(), options);
  }
  return new PostgreAdapter(
    new DataSource({ type: 'postgres' }),
    createLogger(),
    options
  );
}

describe.each(['oracle', 'postgres'] as const)(
  '%s metadata pipeline',
  (vendor) => {
    it.each(['constructor', '__proto__'] as const)(
      'loads and binds procedure %s without reading Object.prototype',
      async (procedureName): Promise<void> => {
        const adapter = createAdapter(vendor);
        const registry = new ProcedureListBase(
          createLogger(),
          adapter,
          {
            execute: vi.fn().mockResolvedValue([
              {
                procedure_name: procedureName,
                argument_name: 'p_id',
                argument_type: vendor === 'oracle' ? 'NUMBER' : 'int4',
                order: 1,
                mode: 'IN',
              },
              {
                procedure_name: 'ping',
                argument_name: '__TPK_NO_ARGUMENT__',
                argument_type: 'VOID',
                order: 0,
                mode: 'IN',
              },
            ]),
          } as never,
          {
            packages: ['pkg'],
            procedureObjectList: {
              run: `pkg.${procedureName}`,
              ping: 'pkg.ping',
            },
          }
        );
        try {
          await registry.initPackagesMap();
          const procedures = registry.packagesWithProceduresList.get('pkg');
          if (!procedures) throw new Error('Missing procedure snapshot');
          expect(Object.hasOwn(procedures, procedureName)).toBe(true);
          expect(Object.getPrototypeOf(procedures)).toBe(Object.prototype);
          expect(
            registry.parseProcedureName(`pkg.${procedureName}`, ['pkg'])
          ).toEqual({
            packageName: 'pkg',
            processName: procedureName,
          });
          const result = adapter.makeBindings(
            'pkg',
            procedureName,
            procedures,
            { id: 7 }
          );
          expect(result.bindings).toEqual(
            vendor === 'oracle'
              ? { p_id: expect.objectContaining({ val: 7 }) }
              : [7]
          );
          expect(
            adapter.makeBindings('pkg', 'ping', procedures).bindings
          ).toEqual(vendor === 'oracle' ? {} : []);
        } finally {
          await registry.destroy();
        }
      }
    );

    it.each(['constructor', '__proto__'] as const)(
      'rejects inherited property %s as an unconfigured procedure',
      (procedureName): void => {
        const adapter = createAdapter(vendor);
        expect(() => adapter.makeBindings('pkg', procedureName, {})).toThrow(
          ServerError
        );
        expect(() => adapter.makeBindings('pkg', procedureName, {})).toThrow(
          'not found'
        );
      }
    );
  }
);
