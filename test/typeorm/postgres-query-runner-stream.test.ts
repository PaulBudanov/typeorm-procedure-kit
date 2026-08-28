import { once } from 'events';
import { Readable } from 'stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PostgresQueryRunner } from '../../src/typeorm/driver/postgres/PostgresQueryRunner.js';
import { PlatformTools } from '../../src/typeorm/platform/PlatformTools.js';

describe('PostgresQueryRunner stream result isolation', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('transforms each streamed row with instance driver result handling', async (): Promise<void> => {
    let releaseSecondRow!: () => void;
    const secondRowReady = new Promise<void>((resolve) => {
      releaseSecondRow = resolve;
    });
    const source = Readable.from(
      (async function* (): AsyncGenerator<Record<string, number>> {
        yield { CREATED_AT: 1 };
        await secondRowReady;
        yield { CREATED_AT: 2 };
      })(),
      { objectMode: true }
    );
    const fields = [
      {
        name: 'CREATED_AT',
        tableID: 0,
        columnID: 0,
        dataTypeID: 23,
        dataTypeSize: 4,
        dataTypeModifier: -1,
        format: 'text',
      },
    ];
    class FakeQueryStream {
      public readonly ['_result'] = { fields };
    }
    vi.spyOn(PlatformTools, 'load').mockResolvedValue(FakeQueryStream);

    const databaseConnection = {
      query: vi.fn(() => source),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const transformResultRows = vi.fn(
      (rows: Array<unknown>): Array<unknown> =>
        rows.map((row) => {
          const record = row as Record<string, unknown>;
          return { createdAt: record.CREATED_AT };
        })
    );
    const dataSource = {
      logger: { logQuery: vi.fn() },
      subscribers: [],
    };
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
      transformResultRows,
    };
    Object.assign(dataSource, { driver });
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');

    const stream = await queryRunner.stream('select created_at from events');
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { createdAt: 1 },
    });
    expect(transformResultRows).toHaveBeenCalledOnce();
    expect(transformResultRows).toHaveBeenLastCalledWith(
      [{ CREATED_AT: 1 }],
      fields
    );

    releaseSecondRow();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { createdAt: 2 },
    });
    expect(transformResultRows).toHaveBeenCalledTimes(2);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('validates private query metadata once for a many-row stream', async (): Promise<void> => {
    const rowCount = 250;
    const source = Readable.from(
      Array.from({ length: rowCount }, (_, value) => ({ VALUE: value })),
      { objectMode: true }
    );
    let resultMetadataReads = 0;
    let fieldValidationReads = 0;
    const result = {
      fields: [
        {
          name: 'VALUE',
          get dataTypeID(): number {
            fieldValidationReads += 1;
            return 23;
          },
        },
      ],
    };
    class FakeQueryStream {
      public get ['_result'](): typeof result {
        resultMetadataReads += 1;
        return result;
      }
    }
    vi.spyOn(PlatformTools, 'load').mockResolvedValue(FakeQueryStream);

    const databaseConnection = {
      query: vi.fn(() => source),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const transformResultRows = vi.fn(
      (rows: Array<unknown>): Array<unknown> => rows
    );
    const dataSource = { logger: { logQuery: vi.fn() }, subscribers: [] };
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
      transformResultRows,
    };
    Object.assign(dataSource, { driver });
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');
    const stream = await queryRunner.stream('select value from events');
    const rows: Array<unknown> = [];

    for await (const row of stream) rows.push(row);

    expect(rows).toHaveLength(rowCount);
    expect(transformResultRows).toHaveBeenCalledTimes(rowCount);
    expect(resultMetadataReads).toBe(1);
    expect(fieldValidationReads).toBe(1);
  });

  it('cancels the source and finalizes once when consumption stops early', async (): Promise<void> => {
    const source = new Readable({
      objectMode: true,
      read: (): void => undefined,
    });
    source.push({ VALUE: 1 });
    source.push({ VALUE: 2 });
    class FakeQueryStream {
      public readonly ['_result'] = {
        fields: [{ name: 'VALUE', dataTypeID: 23 }],
      };
    }
    vi.spyOn(PlatformTools, 'load').mockResolvedValue(FakeQueryStream);
    const release = vi.fn();
    const databaseConnection = {
      query: vi.fn(() => source),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const dataSource = { logger: { logQuery: vi.fn() }, subscribers: [] };
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
      transformResultRows: (rows: Array<unknown>): Array<unknown> => rows,
    };
    Object.assign(dataSource, { driver });
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');
    const stream = await queryRunner.stream(
      'select value from events',
      [],
      release,
      release
    );

    for await (const _row of stream) {
      break;
    }
    if (!stream.closed) await once(stream, 'close');

    expect(source.destroyed).toBe(true);
    expect(source.readableEnded).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it('propagates source errors and finalizes once across error and close', async (): Promise<void> => {
    const source = new Readable({
      objectMode: true,
      read: (): void => undefined,
    });
    class FakeQueryStream {
      public readonly ['_result'] = {
        fields: [{ name: 'VALUE', dataTypeID: 23 }],
      };
    }
    vi.spyOn(PlatformTools, 'load').mockResolvedValue(FakeQueryStream);
    const release = vi.fn();
    const databaseConnection = {
      query: vi.fn(() => source),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const dataSource = { logger: { logQuery: vi.fn() }, subscribers: [] };
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
      transformResultRows: (rows: Array<unknown>): Array<unknown> => rows,
    };
    Object.assign(dataSource, { driver });
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');
    const stream = await queryRunner.stream(
      'select value from events',
      [],
      release,
      release
    );
    const streamError = once(stream, 'error');

    source.destroy(new Error('source failed'));

    await expect(streamError).resolves.toEqual([expect.any(Error)]);
    if (!stream.closed) await once(stream, 'close');
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('normalizes unknown transformation failures into Error instances', async (): Promise<void> => {
    const source = Readable.from([{ VALUE: 1 }], { objectMode: true });
    class FakeQueryStream {
      public readonly ['_result'] = {
        fields: [{ name: 'VALUE', dataTypeID: 23 }],
      };
    }
    vi.spyOn(PlatformTools, 'load').mockResolvedValue(FakeQueryStream);
    const unknownFailure = (function* (): Generator<void> {
      yield;
    })();
    unknownFailure.next();
    const databaseConnection = {
      query: vi.fn(() => source),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const dataSource = { logger: { logQuery: vi.fn() }, subscribers: [] };
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
      transformResultRows: (): never => {
        unknownFailure.throw('transform failed');
        throw new Error('Unreachable transformation result');
      },
    };
    Object.assign(dataSource, { driver });
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');
    const stream = await queryRunner.stream('select value from events');

    await expect(async (): Promise<void> => {
      for await (const _row of stream) {
        // The transform fails before yielding a row.
      }
    }).rejects.toMatchObject({ message: 'transform failed' });
  });

  it('waits for asynchronous finalization before ending the consumer stream', async (): Promise<void> => {
    const source = Readable.from([{ VALUE: 1 }], { objectMode: true });
    class FakeQueryStream {
      public readonly ['_result'] = {
        fields: [{ name: 'VALUE', dataTypeID: 23 }],
      };
    }
    vi.spyOn(PlatformTools, 'load').mockResolvedValue(FakeQueryStream);
    const databaseConnection = {
      query: vi.fn(() => source),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const dataSource = { logger: { logQuery: vi.fn() }, subscribers: [] };
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
      transformResultRows: (rows: Array<unknown>): Array<unknown> => rows,
    };
    Object.assign(dataSource, { driver });
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');
    let completeFinalization!: () => void;
    const onEnd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeFinalization = resolve;
        })
    );
    const stream = await queryRunner.stream(
      'select value from events',
      [],
      onEnd
    );
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    const completion = iterator.next();
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    let isSettled = false;
    void completion.then(() => {
      isSettled = true;
    });
    await Promise.resolve();
    expect(isSettled).toBe(false);

    completeFinalization();
    await expect(completion).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
