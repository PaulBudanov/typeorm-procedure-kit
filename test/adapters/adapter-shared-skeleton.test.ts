import { createHash } from 'crypto';

import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { OracleSqlCommand } from '../../src/adapters/oracle/oracle-sql.js';
import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { PostgreSqlCommand } from '../../src/adapters/postgres/postgre-sql.js';
import { NO_ARGUMENT_SENTINEL } from '../../src/consts/procedure.consts.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

import type { IResourceLimits } from '../../src/types/config.types.js';
import type { IProcedureArgumentBase } from '../../src/types/procedure.types.js';

const MODERN_ORACLE_VERSION = '19.0.0.0.0';
const LEGACY_ORACLE_VERSION = '11.2.0.4.0';
const CUSTOM_ORACLE_SQL =
  'SELECT * FROM CUSTOM_ARGS WHERE PACKAGE_NAME = :PACKAGE_NAME\n  ';
const CUSTOM_POSTGRES_SQL =
  'select * from custom_args where schema_name = :PACKAGE_NAME and owner = :PACKAGE_NAME\n  ';

function createOracleAdapter(
  databaseVersion = MODERN_ORACLE_VERSION,
  resourceLimits?: Partial<IResourceLimits>
): OracleAdapter {
  return new OracleAdapter(
    {
      options: { replication: { master: {} } },
      driver: { version: databaseVersion, setFetchTypeHandler: vi.fn() },
    } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: { transformColumnName: (value: string): string => value },
      ...(resourceLimits
        ? { resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, ...resourceLimits } }
        : {}),
    }
  );
}

function createPostgreAdapter(
  resourceLimits?: Partial<IResourceLimits>
): PostgreAdapter {
  return new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: { transformColumnName: (value: string): string => value },
      ...(resourceLimits
        ? { resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, ...resourceLimits } }
        : {}),
    }
  );
}

function createVersionCountingOracleAdapter(databaseVersion: string): {
  adapter: OracleAdapter;
  countVersionReads: () => number;
} {
  let versionReads = 0;
  const driver = {
    setFetchTypeHandler: vi.fn(),
    get version(): string {
      versionReads += 1;
      return databaseVersion;
    },
  };
  const adapter = new OracleAdapter(
    { options: { replication: { master: {} } }, driver } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: { transformColumnName: (value: string): string => value },
    }
  );
  versionReads = 0;
  return { adapter, countVersionReads: (): number => versionReads };
}

function inlinePackageName(template: string, literal: string): string {
  return template.split(':PACKAGE_NAME').join(literal);
}

/**
 * Byte-exact fingerprints of the SQL produced by the pre-refactor adapters
 * (captured before `generatePackageInfoSql` became a template method).
 * A mismatch means the SQL sent to a real database changed: re-check the
 * change on purpose before re-pinning these values.
 */
const PINNED_FINGERPRINTS = {
  oracleModernDefault: {
    length: 3795,
    sha256: 'c7cc8d1aa52ec38e306d96a67606fefb968427451cb40cd5400e9803e80f50fa',
  },
  oracleModernCustom: {
    length: 55,
    sha256: '67d04589d3952f23b7515ee4b871263807531ed3e8b3592f87fcb0151e4b64b5',
  },
  oracleLegacyDefault: {
    length: 1491,
    sha256: '14328aea7e16956f3f83c933d04fa8eb59b693e1cd322db3d3323528753ca129',
  },
  oracleLegacyCustom: {
    length: 55,
    sha256: '67d04589d3952f23b7515ee4b871263807531ed3e8b3592f87fcb0151e4b64b5',
  },
  postgresDefault: {
    length: 3811,
    sha256: '10af752b6485ac4eaa50a072fd6e7e44d1a5a31f586f7c786030d6525d639d37',
  },
  postgresCustom: {
    length: 78,
    sha256: '1cabbd12a71d312badb322b2cd0bbf84062a35ac90eec55aac19a8198d6624c5',
  },
} as const;

function fingerprint(sql: string): { length: number; sha256: string } {
  return {
    length: sql.length,
    sha256: createHash('sha256').update(sql).digest('hex'),
  };
}

describe('adapter shared package-info skeleton', (): void => {
  it('reproduces the Oracle modern metadata SQL byte for byte', (): void => {
    const sql = createOracleAdapter().generatePackageInfoSql('pkg');

    expect(sql).toBe(
      `${inlinePackageName(
        OracleSqlCommand.SQL_GET_PACKAGE_INFO,
        "'PKG'"
      ).trimEnd()}\nFETCH FIRST 10001 ROWS ONLY`
    );
    expect(fingerprint(sql)).toEqual(PINNED_FINGERPRINTS.oracleModernDefault);
  });

  it('reproduces the Oracle legacy metadata SQL byte for byte', (): void => {
    const sql = createOracleAdapter(
      LEGACY_ORACLE_VERSION
    ).generatePackageInfoSql('pkg');

    expect(sql).toBe(
      `SELECT * FROM (\n${inlinePackageName(
        OracleSqlCommand.SQL_GET_PACKAGE_INFO_LEGACY,
        "'PKG'"
      ).trimEnd()}\n) WHERE ROWNUM <= 10001`
    );
    expect(fingerprint(sql)).toEqual(PINNED_FINGERPRINTS.oracleLegacyDefault);
  });

  it('reproduces the PostgreSQL metadata SQL byte for byte', (): void => {
    const sql = createPostgreAdapter().generatePackageInfoSql('Public');

    expect(sql).toBe(
      `${inlinePackageName(
        PostgreSqlCommand.SQL_GET_PACKAGE_INFO,
        "'public'"
      ).trimEnd()}\nLIMIT 10001`
    );
    expect(fingerprint(sql)).toEqual(PINNED_FINGERPRINTS.postgresDefault);
  });

  it.each([
    ['modern', MODERN_ORACLE_VERSION, 'oracleModernCustom'],
    ['legacy', LEGACY_ORACLE_VERSION, 'oracleLegacyCustom'],
  ] as const)(
    'returns caller supplied Oracle %s metadata SQL untouched and unlimited',
    (_label, databaseVersion, pinnedKey): void => {
      const sql = createOracleAdapter(databaseVersion).generatePackageInfoSql(
        'pkg',
        CUSTOM_ORACLE_SQL
      );

      expect(sql).toBe(inlinePackageName(CUSTOM_ORACLE_SQL, "'PKG'"));
      expect(sql.endsWith('\n  ')).toBe(true);
      expect(sql).not.toContain('FETCH FIRST');
      expect(sql).not.toContain('ROWNUM');
      expect(fingerprint(sql)).toEqual(PINNED_FINGERPRINTS[pinnedKey]);
    }
  );

  it('returns caller supplied PostgreSQL metadata SQL untouched and unlimited', (): void => {
    const sql = createPostgreAdapter().generatePackageInfoSql(
      'Public',
      CUSTOM_POSTGRES_SQL
    );

    expect(sql).toBe(inlinePackageName(CUSTOM_POSTGRES_SQL, "'public'"));
    expect(sql.endsWith('\n  ')).toBe(true);
    expect(sql).not.toContain('LIMIT');
    expect(fingerprint(sql)).toEqual(PINNED_FINGERPRINTS.postgresCustom);
  });

  it('derives one detection limit for every vendor row-limit form', (): void => {
    const resourceLimits = { maxMetadataRows: 25 };

    expect(
      createOracleAdapter(MODERN_ORACLE_VERSION, resourceLimits)
        .generatePackageInfoSql('pkg')
        .endsWith('\nFETCH FIRST 26 ROWS ONLY')
    ).toBe(true);
    expect(
      createOracleAdapter(LEGACY_ORACLE_VERSION, resourceLimits)
        .generatePackageInfoSql('pkg')
        .endsWith('\n) WHERE ROWNUM <= 26')
    ).toBe(true);
    expect(
      createPostgreAdapter(resourceLimits)
        .generatePackageInfoSql('public')
        .endsWith('\nLIMIT 26')
    ).toBe(true);
  });

  it('clamps the shared detection limit at the safe integer ceiling', (): void => {
    const resourceLimits = { maxMetadataRows: Number.MAX_SAFE_INTEGER };

    expect(
      createOracleAdapter(
        MODERN_ORACLE_VERSION,
        resourceLimits
      ).generatePackageInfoSql('pkg')
    ).toContain(`FETCH FIRST ${Number.MAX_SAFE_INTEGER} ROWS ONLY`);
    expect(
      createPostgreAdapter(resourceLimits).generatePackageInfoSql('public')
    ).toContain(`LIMIT ${Number.MAX_SAFE_INTEGER}`);
  });

  it('rejects metadata SQL without the package placeholder for both vendors', (): void => {
    expect((): void => {
      createOracleAdapter().generatePackageInfoSql('pkg', 'SELECT 1 FROM DUAL');
    }).toThrow(ServerError);
    expect((): void => {
      createPostgreAdapter().generatePackageInfoSql('public', 'select 1');
    }).toThrow(ServerError);
  });

  it.each([
    ['modern', MODERN_ORACLE_VERSION],
    ['legacy', LEGACY_ORACLE_VERSION],
  ] as const)(
    'reads the Oracle %s server version exactly once per default metadata build',
    (_label, databaseVersion): void => {
      const { adapter, countVersionReads } =
        createVersionCountingOracleAdapter(databaseVersion);

      adapter.generatePackageInfoSql('pkg');

      expect(countVersionReads()).toBe(1);
    }
  );

  it('never reads the Oracle server version for caller supplied metadata SQL', (): void => {
    const { adapter, countVersionReads } = createVersionCountingOracleAdapter(
      LEGACY_ORACLE_VERSION
    );

    adapter.generatePackageInfoSql('pkg', CUSTOM_ORACLE_SQL);

    expect(countVersionReads()).toBe(0);
  });

  it('shares one no-argument sentinel between both adapters', (): void => {
    expect(NO_ARGUMENT_SENTINEL).toBe('__tpk_no_argument__');

    const oracleRows: Array<IProcedureArgumentBase> = [
      {
        procedureName: 'PING',
        argumentName: NO_ARGUMENT_SENTINEL.toUpperCase(),
        argumentType: 'VOID',
        order: 0,
        mode: 'IN',
        subprogramId: 2,
      },
    ];
    const postgresRows: Array<IProcedureArgumentBase> = [
      {
        procedureName: 'ping',
        argumentName: NO_ARGUMENT_SENTINEL,
        argumentType: 'void',
        order: 0,
        mode: 'IN',
        specificName: 'ping_1',
      },
    ];

    expect(
      createOracleAdapter().sortArgumentsAlgorithm(
        oracleRows,
        ['ping'],
        'pkg',
        1
      )
    ).toEqual({ ping: [] });
    expect(
      createPostgreAdapter().sortArgumentsAlgorithm(
        postgresRows,
        ['ping'],
        'public',
        1
      )
    ).toEqual({ ping: [] });
  });
});
