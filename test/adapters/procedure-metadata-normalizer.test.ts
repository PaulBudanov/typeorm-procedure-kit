import { describe, expect, it } from 'vitest';

import { ProcedureMetadataNormalizer } from '../../src/adapters/abstract/procedure-metadata-normalizer.js';

describe('ProcedureMetadataNormalizer', (): void => {
  const normalizer = new ProcedureMetadataNormalizer();
  const metadata = [
    {
      procedureName: 'Run',
      argumentName: 'second',
      argumentType: 'text',
      order: 2,
      mode: 'IN' as const,
      specificName: 'run_1',
    },
    {
      procedureName: 'Run',
      argumentName: 'first',
      argumentType: 'int4',
      order: 1,
      mode: 'IN' as const,
      specificName: 'run_1',
    },
    {
      procedureName: 'Skip',
      argumentName: 'value',
      argumentType: 'int4',
      order: 1,
      mode: 'IN' as const,
      specificName: 'skip_1',
    },
  ];

  it('can apply explicit procedure-list filtering for one package', (): void => {
    const result = normalizer.normalize(metadata, ['pkg.run'], 'pkg', 1, {
      vendor: 'PostgreSQL',
      getOverloadIdentity: ({ specificName }) => specificName,
    });

    expect(Object.keys(result)).toEqual(['run']);
    expect(result.run?.map(({ argumentName }) => argumentName)).toEqual([
      'first',
      'second',
    ]);
  });

  it('accepts an unqualified configured name only for one package', (): void => {
    expect(
      normalizer.normalize(metadata, ['run'], 'pkg', 1, {
        vendor: 'PostgreSQL',
      })
    ).toHaveProperty('run');
    expect(
      normalizer.normalize(metadata, ['run'], 'pkg', 2, {
        vendor: 'PostgreSQL',
      })
    ).toEqual({});
  });

  it('preserves the public single-package compatibility behavior', (): void => {
    expect(
      normalizer.normalize(metadata, ['pkg.run'], 'pkg', 1, {
        vendor: 'Database',
        includeAllWhenSinglePackage: true,
      })
    ).toHaveProperty('skip');
  });
});
