import { describe, expect, it } from 'vitest';

import type { TDBMapStructure } from '../../src/types/procedure.types.js';
import { procedureNameParser } from '../../src/utils/procedure-name-parser.js';
import { ServerError } from '../../src/utils/server-error.js';

describe('procedureNameParser', (): void => {
  const procedures: TDBMapStructure = new Map([
    ['pkg', { run: [] }],
    ['other', { refresh: [] }],
  ] as Array<
    [
      Lowercase<string>,
      TDBMapStructure extends Map<Lowercase<string>, infer U> ? U : never,
    ]
  >);

  it('parses package-qualified names and caches results', (): void => {
    const first = procedureNameParser.parse(' PKG.RUN ', procedures, [
      'pkg',
      'other',
    ]);
    const second = procedureNameParser.parse(' PKG.RUN ', procedures, [
      'pkg',
      'other',
    ]);

    expect(first).toEqual({ packageName: 'pkg', processName: 'run' });
    expect(second).toBe(first);
  });

  it('parses bare procedure names when only one package exists', (): void => {
    expect(procedureNameParser.parse('RUN', procedures, ['pkg'])).toStrictEqual(
      {
        packageName: 'pkg',
        processName: 'run',
      }
    );
  });

  it('rejects unknown procedures and invalid package context', (): void => {
    expect((): void => {
      procedureNameParser.parse('missing', procedures, ['pkg', 'other']);
    }).toThrow(ServerError);
  });

  it('normalizes and extracts name parts', (): void => {
    expect(procedureNameParser.validateFormat('pkg.run')).toBe(true);
    expect(procedureNameParser.validateFormat('a.b.c')).toBe(false);
    expect(procedureNameParser.extractPackageName(' PKG.RUN ')).toBe('pkg');
    expect(procedureNameParser.extractProcedureName(' PKG.RUN ')).toBe('run');
    expect(procedureNameParser.extractProcedureName(' RUN ')).toBe('run');
    expect(procedureNameParser.normalize(' RUN ')).toBe('run');
    expect(procedureNameParser.formatDisplayName('pkg', 'run')).toBe('pkg.run');
  });
});
