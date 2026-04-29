import { describe, expect, it } from 'vitest';

import { DatabaseErrorHandler } from '../../src/utils/database-error-handler.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

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

  it('recursively checks arrays', (): void => {
    expect((): void => {
      DatabaseErrorHandler.checkForDatabaseError([
        { error_code: 0, error_text: 'ok' },
        { err_code: 1, err_text: 'bad' },
      ]);
    }).toThrow('Database error: bad');
  });
});
