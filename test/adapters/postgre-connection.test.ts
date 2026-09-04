import { EventEmitter } from 'events';

import { describe, expect, it, vi } from 'vitest';

import { PostgreConnection } from '../../src/adapters/postgres/postgre-connection.js';
import { createLogger } from '../support/helpers.js';

describe('PostgreConnection', (): void => {
  it('handles a rejected async connection-loss callback once', async (): Promise<void> => {
    const client = new EventEmitter();
    const logger = createLogger();
    const callbackError = new Error('restore failed');
    const callback = vi.fn().mockRejectedValue(callbackError);
    const connection = new PostgreConnection({ options: {} } as never, logger);

    connection.registerConnectionErrorHandler(client as never, callback);
    client.emit('error', new Error('connection lost'));
    client.emit('end');

    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'Callback error: restore failed',
        callbackError.stack
      )
    );
  });
});
