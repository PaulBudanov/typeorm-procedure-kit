import { describe, expect, it } from 'vitest';

import { DatabaseErrorHandler } from '../../src/utils/database-error-handler.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

interface IRowsCase {
  name: string;
  rows: Array<Record<string, unknown>>;
}

const captureError = (operation: () => void): unknown => {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('DatabaseErrorHandler', (): void => {
  it('ignores primitive and Buffer values', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError('ok');
      DatabaseErrorHandler.checkForDatabaseError(Buffer.from('ok'));
      DatabaseErrorHandler.checkForDatabaseError(null);
    }).not.toThrow();
  });

  it('throws ServerError for database error objects and preserves query id', (): void => {
    const logger = createLogger();

    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        { error_code: 500, error_text: 'broken' },
        'query-1',
        logger
      );
    }).toThrow(ServerError);

    try {
      DatabaseErrorHandler.checkForDatabaseError(
        { err_code: 500, err_text: 'broken' },
        'query-1'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ServerError);
      expect((error as ServerError).errorId).toBe('query-1');
    }
    expect(logger.error).toHaveBeenCalledWith(
      'Detected database error: Database error: broken'
    );
  });

  it('recognizes a case-strategy-transformed procedure error envelope', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError({
        errorCode: 500,
        errorText: 'transformed failure',
      });
    }).toThrow('Database error: transformed failure');

    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError({
        errCode: 500,
        errText: 'short transformed failure',
      });
    }).toThrow('Database error: short transformed failure');
  });

  it('preserves query id and optional logging for a single-row envelope', (): void => {
    const logger = createLogger();
    const operation = (): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        [{ error_code: 500, error_text: 'broken' }],
        'array-query',
        logger
      );
    };

    expect(operation).toThrow(
      expect.objectContaining({ errorId: 'array-query' })
    );
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Detected database error: Database error: broken'
    );
  });

  it('does not scan business rows or nested objects for error fields', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError([
        { error_code: 0, error_text: 'ok' },
        { err_code: 1, err_text: 'bad' },
      ]);
      DatabaseErrorHandler.checkForDatabaseError({
        payload: { error_code: 500, error_text: 'business value' },
      });
    }).not.toThrow();
  });

  it('requires both a code key and a text key in the top-level envelope', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError({
        error_code: 500,
        description: 'business status',
      });
      DatabaseErrorHandler.checkForDatabaseError({
        error_text: 'business status',
      });
    }).not.toThrow();
  });

  it('throws when the first row of a multi-row result is an error envelope', (): void => {
    const logger = createLogger();

    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        [{ error_code: 500, error_text: 'broken' }, { id: 1 }, { id: 2 }],
        'multi-row-query',
        logger
      );
    }).toThrow(
      expect.objectContaining({
        errorId: 'multi-row-query',
        message: 'Database error: broken',
      })
    );
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Detected database error: Database error: broken'
    );
  });

  it('throws for a single row with a nonzero code, as in 3.x', (): void => {
    const logger = createLogger();

    const error = captureError((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        [{ error_code: 1, error_text: 'x' }],
        'single-row-query',
        logger
      );
    });

    expect(error).toBeInstanceOf(ServerError);
    expect(error).toMatchObject({
      errorId: 'single-row-query',
      message: 'Database error: x',
    });
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Detected database error: Database error: x'
    );
  });

  it.each<IRowsCase>([
    {
      name: 'data rows with other column names follow the envelope',
      rows: [
        { error_code: 1, error_text: 'x' },
        { id: 1, name: 'a' },
      ],
    },
    {
      name: 'the second row adds a column to the envelope columns',
      rows: [
        { error_code: 1, error_text: 'x' },
        { error_code: 0, error_text: 'y', id: 1 },
      ],
    },
  ])(
    'throws when the first row keys differ from the second row: $name',
    ({ rows }): void => {
      const error = captureError((): void => {
        DatabaseErrorHandler.checkForDatabaseError(rows, 'envelope-query');
      });

      expect(error).toBeInstanceOf(ServerError);
      expect(error).toMatchObject({
        errorId: 'envelope-query',
        message: 'Database error: x',
      });
    }
  );

  it.each<IRowsCase>([
    {
      name: 'a status batch',
      rows: [
        { error_code: 1, error_text: 'a' },
        { error_code: 0, error_text: 'b' },
      ],
    },
    {
      name: 'a journal with extra columns',
      rows: [
        { error_code: 1, error_text: 'a', id: 1 },
        { error_code: 2, error_text: 'b', id: 2 },
      ],
    },
    {
      name: 'rows whose keys come in another order',
      rows: [
        { error_text: 'x', error_code: 1 },
        { error_code: 0, error_text: 'y' },
      ],
    },
  ])(
    'returns a homogeneous multi-row result with error fields: $name',
    ({ rows }): void => {
      const logger = createLogger();

      expect((): void => {
        DatabaseErrorHandler.checkForDatabaseError(rows, 'journal', logger);
      }).not.toThrow();
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it('keeps an empty configured code key list switching off array checks', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        [{ error_code: 1, error_text: 'x' }],
        'audit-query',
        undefined,
        { errorCodeKeys: [] }
      );
      DatabaseErrorHandler.checkForDatabaseError(
        [
          { error_code: 1, error_text: 'x' },
          { id: 1, name: 'a' },
        ],
        'audit-query',
        undefined,
        { errorCodeKeys: [] }
      );
    }).not.toThrow();
  });

  it('accepts an empty result', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError([], 'empty-query');
    }).not.toThrow();
  });

  it('still returns a multi-row result whose first row is a business row', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError([
        { id: 1 },
        { error_code: 500, error_text: 'not an envelope' },
      ]);
    }).not.toThrow();
  });

  it('ignores envelope keys inherited from the prototype chain', (): void => {
    const inherited = Object.create({
      error_code: 500,
      error_text: 'inherited envelope',
    }) as Record<string, unknown>;
    inherited.id = 1;

    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(inherited);
    }).not.toThrow();
  });

  it('does not resolve configured envelope keys through Object.prototype', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        { id: 1 },
        'query-1',
        undefined,
        {
          errorCodeKeys: ['constructor'],
          errorTextKeys: ['toString'],
        }
      );
    }).not.toThrow();
  });

  it('recognizes an envelope described by configured key names', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        { status_code: 7, status_text: 'configured failure' },
        'configured-query',
        undefined,
        {
          errorCodeKeys: ['status_code'],
          errorTextKeys: ['status_text'],
        }
      );
    }).toThrow('Database error: configured failure');
  });

  it('replaces the built-in key names when they are configured', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        { error_code: 500, error_text: 'business column' },
        'configured-query',
        undefined,
        {
          errorCodeKeys: ['status_code'],
          errorTextKeys: ['status_text'],
        }
      );
    }).not.toThrow();
  });

  it('keeps the built-in key names that configuration leaves out', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        { status_code: 7, error_text: 'half configured' },
        'configured-query',
        undefined,
        { errorCodeKeys: ['status_code'] }
      );
    }).toThrow('Database error: half configured');
  });

  it('disables envelope detection for an empty configured key list', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError(
        { error_code: 500, error_text: 'plain business row' },
        'audit-query',
        undefined,
        { errorCodeKeys: [] }
      );
    }).not.toThrow();
  });

  it('treats numeric and string zero codes as success', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError({
        error_code: '0',
        error_text: 'ok',
      });
      DatabaseErrorHandler.checkForDatabaseError({
        error_code: '00000',
        error_text: 'ok',
      });
      DatabaseErrorHandler.checkForDatabaseError({
        error_code: '  ',
        error_text: 'ok',
      });
    }).not.toThrow();
  });
});
