import { Readable } from 'stream';

import { describe, expect, it, vi } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';

import type { QueryRunner } from '../../src/typeorm/query-runner/QueryRunner.js';

describe('SelectQueryBuilder stream lifecycle', (): void => {
  it('commits and releases an owned runner only after stream finalization', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'postgres' });
    const returnedStream = Readable.from([], { objectMode: true });
    let onEnd!: () => void | Promise<void>;
    const {
      commitTransaction,
      queryRunner,
      release,
      rollbackTransaction,
      startTransaction,
    } = createStreamQueryRunner(returnedStream, (end): void => {
      onEnd = end;
    });
    vi.spyOn(dataSource, 'createQueryRunner').mockReturnValue(queryRunner);

    const stream = await dataSource
      .createQueryBuilder()
      .select('1')
      .from('items', 'item')
      .useTransaction(true)
      .stream();

    expect(stream).toBe(returnedStream);
    expect(startTransaction).toHaveBeenCalledOnce();
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();

    await onEnd();

    expect(commitTransaction).toHaveBeenCalledOnce();
    expect(rollbackTransaction).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('rolls back and invalidates an owned runner on stream failure', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'postgres' });
    const returnedStream = Readable.from([], { objectMode: true });
    let onError!: (error: Error) => void | Promise<void>;
    const { commitTransaction, queryRunner, release, rollbackTransaction } =
      createStreamQueryRunner(returnedStream, (_end, error): void => {
        onError = error;
      });
    vi.spyOn(dataSource, 'createQueryRunner').mockReturnValue(queryRunner);
    await dataSource
      .createQueryBuilder()
      .select('1')
      .from('items', 'item')
      .useTransaction(true)
      .stream();
    const streamError = new Error('stream failed');

    await onError(streamError);

    expect(rollbackTransaction).toHaveBeenCalledOnce();
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(streamError);
  });
});

function createStreamQueryRunner(
  stream: Readable,
  capture: (
    onEnd: () => void | Promise<void>,
    onError: (error: Error) => void | Promise<void>
  ) => void
): {
  commitTransaction: ReturnType<typeof vi.fn>;
  queryRunner: QueryRunner;
  release: ReturnType<typeof vi.fn>;
  rollbackTransaction: ReturnType<typeof vi.fn>;
  startTransaction: ReturnType<typeof vi.fn>;
} {
  const startTransaction = vi.fn().mockResolvedValue(undefined);
  const commitTransaction = vi.fn().mockResolvedValue(undefined);
  const rollbackTransaction = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn().mockResolvedValue(undefined);
  const queryRunner = {
    isReleased: false,
    isTransactionActive: false,
    startTransaction,
    commitTransaction,
    rollbackTransaction,
    release,
    stream: vi.fn(
      (
        _query: string,
        _parameters?: Array<unknown>,
        onEnd?: () => void | Promise<void>,
        onError?: (error: Error) => void | Promise<void>
      ): Promise<Readable> => {
        capture(onEnd!, onError!);
        return Promise.resolve(stream);
      }
    ),
  } as unknown as QueryRunner;
  return {
    commitTransaction,
    queryRunner,
    release,
    rollbackTransaction,
    startTransaction,
  };
}
