import { types as pgTypes } from 'pg';
import { describe, expect, it } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { QueryLogContextBuilder } from '../../src/utils/query-log-context-builder.js';
import { QueryLogContextStorage } from '../../src/utils/query-log-context.js';
import { QueryTimer } from '../../src/utils/query-timer.js';
import { createLogger } from '../support/helpers.js';

import type {
  IProcedureStructuredType,
  TProcedureArgumentList,
} from '../../src/types/procedure.types.js';

const profileStructuredType = {
  kind: 'postgres-composite',
  schema: 'pkg',
  typeName: 'profile_type',
  typeOid: 16_384,
  fields: [
    {
      name: 'first_name',
      argumentType: 'text',
      order: 1,
      typeOid: pgTypes.builtins.TEXT,
    },
  ],
} satisfies IProcedureStructuredType;

function createPostgreAdapter(): PostgreAdapter {
  return new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: { transformColumnName: (value: string): string => value },
    }
  );
}

/**
 * Mirrors `TypeOrmProcedureKit.call`: build the driver bindings, derive the log
 * context from `logBindings ?? bindings`, then run a real `QueryTimer` inside
 * that context so the assertions read the line an operator would actually see.
 */
function logProcedureCall(
  procedures: TProcedureArgumentList,
  processName: Lowercase<string>,
  payload: object
): string {
  const adapter = createPostgreAdapter();
  const {
    paramExecuteString,
    bindings,
    logBindings,
    cursorsNames = [],
  } = adapter.makeBindings('pkg', processName, procedures, payload);
  const logContext = QueryLogContextBuilder.createProcedureContext(
    'pkg',
    processName,
    procedures[processName],
    logBindings ?? bindings,
    cursorsNames
  );
  const logger = createLogger();
  const timer = QueryLogContextStorage.run(
    logContext,
    () =>
      new QueryTimer(
        paramExecuteString,
        logger,
        'query-1',
        bindings,
        'redact-by-name'
      )
  );
  timer.start();
  return logger.log.mock.calls.at(-1)?.[0] as string;
}

describe('QueryLogContextBuilder', (): void => {
  it('keeps PostgreSQL binding values under their own argument name when a composite OUT consumes no binding', (): void => {
    const message = logProcedureCall(
      {
        run: [
          {
            argumentName: 'out_profile',
            argumentType: 'pkg.profile_type',
            order: 1,
            mode: 'OUT',
            structuredType: profileStructuredType,
          },
          { argumentName: 'p_id', argumentType: 'int', order: 2, mode: 'IN' },
          {
            argumentName: 'p_password',
            argumentType: 'varchar',
            order: 3,
            mode: 'IN',
          },
        ],
      },
      'run',
      { id: 7, password: 'secret-value' }
    );

    expect(message).toContain('p_id=7 (int IN)');
    expect(message).toContain('p_password=[REDACTED] (varchar IN)');
    expect(message).not.toContain('secret-value');
  });

  it('logs every PostgreSQL argument under its own name across cursors and composites', (): void => {
    const message = logProcedureCall(
      {
        mixed: [
          {
            argumentName: 'out_profile',
            argumentType: 'pkg.profile_type',
            order: 1,
            mode: 'OUT',
            structuredType: profileStructuredType,
          },
          {
            argumentName: 'p_profile',
            argumentType: 'pkg.profile_type',
            order: 2,
            mode: 'IN',
            structuredType: profileStructuredType,
          },
          {
            argumentName: 'out_cursor',
            argumentType: 'refcursor',
            order: 3,
            mode: 'OUT',
          },
          {
            argumentName: 'p_token',
            argumentType: 'varchar',
            order: 4,
            mode: 'IN',
          },
          {
            argumentName: 'p_count',
            argumentType: 'int',
            order: 5,
            mode: 'IN',
          },
        ],
      },
      'mixed',
      {
        profile: { first_name: 'Ada' },
        token: 'secret-token',
        count: 42,
      }
    );

    expect(message).toContain('out_profile=<out>');
    expect(message).toContain('out_cursor=<cursor>');
    expect(message).toContain('p_token=[REDACTED]');
    expect(message).toContain('p_count=42 (int IN)');
    expect(message).not.toContain('secret-token');
  });

  it('never resolves a named argument against a positional binding list', (): void => {
    const context = QueryLogContextBuilder.createProcedureContext(
      'pkg',
      'run',
      [
        { argumentName: 'p_id', argumentType: 'int', order: 1, mode: 'IN' },
        {
          argumentName: 'p_password',
          argumentType: 'varchar',
          order: 2,
          mode: 'IN',
        },
      ],
      ['positional-secret', 7],
      []
    );

    expect(context).toMatchObject({
      kind: 'procedure',
      bindings: [
        { name: 'p_id', value: undefined },
        { name: 'p_password', value: undefined },
      ],
    });
  });

  it('unwraps driver bind parameters and marks cursors', (): void => {
    const context = QueryLogContextBuilder.createProcedureContext(
      'pkg',
      'run',
      [
        { argumentName: 'p_id', argumentType: 'NUMBER', order: 1, mode: 'IN' },
        {
          argumentName: 'out_cursor',
          argumentType: 'REF CURSOR',
          order: 2,
          mode: 'OUT',
        },
      ],
      { p_id: { val: 7 }, out_cursor: { dir: 3003 } },
      ['out_cursor']
    );

    expect(context).toEqual({
      kind: 'procedure',
      packageName: 'pkg',
      procedureName: 'run',
      bindings: [
        {
          name: 'p_id',
          type: 'NUMBER',
          mode: 'IN',
          value: 7,
          isCursor: false,
        },
        {
          name: 'out_cursor',
          type: 'REF CURSOR',
          mode: 'OUT',
          value: undefined,
          isCursor: true,
        },
      ],
    });
  });
});
