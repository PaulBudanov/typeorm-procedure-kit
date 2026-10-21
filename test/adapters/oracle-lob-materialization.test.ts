import { Readable } from 'node:stream';

import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleProcedureResultMaterializer } from '../../src/adapters/oracle/oracle-result-materializer.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
import { ServerError } from '../../src/utils/server-error.js';
import { StringUtilities } from '../../src/utils/string-utilities.js';

import type { IOracleValueSerializer } from '../../src/interfaces/oracle-result-materializer.interfaces.js';
import type { ILoggerModule } from '../../src/types/logger.types.js';

/**
 * Draining an Oracle LOB OUT bind or LOB column into a value.
 *
 * A CLOB is read in pieces, and a piece boundary can fall between the two
 * halves of a surrogate pair. Encoding every piece on its own turns each half
 * into U+FFFD, so the pieces have to stay text until they are joined, and the
 * `resourceLimits.maxLobBytes` count has to be the UTF-8 length of the joined
 * text rather than the sum of the pieces' own encodings.
 */

const passthroughSerializer: IOracleValueSerializer = {
  serializeValue: (_serializerType: string, value: unknown): unknown => value,
};

function createMaterializer(
  maxLobBytes = DEFAULT_RESOURCE_LIMITS.maxLobBytes
): OracleProcedureResultMaterializer {
  const logger: ILoggerModule = {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
  return new OracleProcedureResultMaterializer(
    logger,
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string =>
          StringUtilities.toCamelCase(value),
      },
      resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxLobBytes },
    },
    passthroughSerializer
  );
}

/**
 * A LOB handle that hands out its chunks one at a time and records how many
 * it was asked for and how often it was destroyed. An `Error` in the chunk
 * list is thrown at that point, the way a failed read surfaces mid-stream.
 */
class ChunkedLob {
  public destroyCalls = 0;
  public pulledChunks = 0;

  public constructor(
    public readonly type: oracledb.DbType,
    private readonly chunks: Array<string | Buffer | Error>
  ) {}

  public get destroyed(): boolean {
    return this.destroyCalls > 0;
  }

  public destroy(): void {
    this.destroyCalls += 1;
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<string | Buffer> {
    for (const chunk of this.chunks) {
      this.pulledChunks += 1;
      if (chunk instanceof Error) throw chunk;
      yield chunk;
    }
  }
}

/** The slice of node-oracledb's internal LOB implementation `Lob` calls. */
interface IDriverLobImpl {
  getType(): oracledb.DbType;
  read(offset: number): Promise<string | Buffer | null>;
  close(): Promise<void>;
  _getConnImpl(): {
    _acquireLock(): Promise<void>;
    _releaseLock(): void;
  };
}

type TDriverLob = oracledb.Lob & {
  _setup(impl: IDriverLobImpl, autoCloseLob: boolean): void;
};

/**
 * A node-oracledb `Lob` (the class the driver wraps every LOB in) over an
 * implementation that returns the given reads in order, as the thin driver's
 * `LobImpl.read` returns one piece per round trip: a string for a CLOB, a
 * Buffer for a BLOB. `Lob._read` pushes each read into its Readable side
 * as it is, so whatever the stream does to a string piece is what the
 * materializer receives.
 */
function createDriverLob(
  type: oracledb.DbType,
  reads: Array<string | Buffer>
): TDriverLob {
  const { Lob } = oracledb as unknown as { Lob: new () => TDriverLob };
  const lob = new Lob();
  let next = 0;
  lob._setup(
    {
      getType: (): oracledb.DbType => type,
      read: (): Promise<string | Buffer | null> =>
        Promise.resolve(reads[next++] ?? null),
      close: (): Promise<void> => Promise.resolve(),
      _getConnImpl: () => ({
        _acquireLock: (): Promise<void> => Promise.resolve(),
        _releaseLock: (): void => undefined,
      }),
    },
    true
  );
  return lob;
}

async function materializeOut(
  lob: unknown,
  databaseType: string,
  maxLobBytes?: number
): Promise<unknown> {
  const result = await createMaterializer(maxLobBytes).materialize(
    [],
    [{ name: 'P_DOC', type: 'lob', databaseType }],
    { P_DOC: lob }
  );
  return result.outBinds.pDoc;
}

function materializeClob(
  chunks: Array<string | Buffer | Error>,
  maxLobBytes?: number
): Promise<unknown> {
  return materializeOut(
    new ChunkedLob(oracledb.DB_TYPE_CLOB, chunks),
    'CLOB',
    maxLobBytes
  );
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

function expectLobLimitError(error: unknown, maxLobBytes: number): void {
  expect(error).toBeInstanceOf(ServerError);
  expect((error as Error).message).toBe(
    `Oracle LOB exceeds resourceLimits.maxLobBytes (${maxLobBytes})`
  );
}

/** One character of each UTF-8 width, two of them outside the BMP. */
const MIXED_WIDTH_TEXT = 'a\u00e9\u{1F600}\u4e2d\u{1D11E}z';

describe('Oracle CLOB materialization', (): void => {
  it('joins a surrogate pair split across two chunks', async (): Promise<void> => {
    await expect(materializeClob(['a\uD83D', '\uDE00b'])).resolves.toBe(
      'a\u{1F600}b'
    );
  });

  it('joins a surrogate pair split across two reads of a driver Lob', async (): Promise<void> => {
    const lob = createDriverLob(oracledb.DB_TYPE_CLOB, ['a\uD83D', '\uDE00b']);

    await expect(materializeOut(lob, 'CLOB')).resolves.toBe('a\u{1F600}b');
    expect(lob.destroyed).toBe(true);
  });

  it('joins a surrogate pair split across two chunks of a cursor CLOB column', async (): Promise<void> => {
    const cursor = {
      metaData: [{ name: 'doc' }],
      toQueryStream: (): Readable =>
        Readable.from(
          [
            {
              doc: new ChunkedLob(oracledb.DB_TYPE_CLOB, [
                'a\uD83D',
                '\uDE00b',
              ]),
            },
          ],
          { objectMode: true }
        ),
      close: (): Promise<void> => Promise.resolve(),
    };

    const result = await createMaterializer().materialize(
      ['P_CUR'],
      [{ name: 'P_CUR', type: 'cursor' }],
      { P_CUR: cursor }
    );

    expect(result.rows).toEqual([{ doc: 'a\u{1F600}b' }]);
  });

  it('decodes Buffer chunks that split a UTF-8 sequence', async (): Promise<void> => {
    const bytes = Buffer.from('a\u{1F600}b');

    await expect(
      materializeClob([
        bytes.subarray(0, 2),
        bytes.subarray(2, 4),
        bytes.subarray(4),
      ])
    ).resolves.toBe('a\u{1F600}b');
  });

  it('still replaces a surrogate that no chunk completes with U+FFFD', async (): Promise<void> => {
    await expect(materializeClob(['a\uD83D'])).resolves.toBe('a\uFFFD');
    await expect(materializeClob(['\uD83D', 'b'])).resolves.toBe('\uFFFDb');
    await expect(materializeClob(['a', '\uDE00b'])).resolves.toBe('a\uFFFDb');
  });

  it('counts a surrogate pair split across two chunks as one four-byte character', async (): Promise<void> => {
    await expect(materializeClob(['a\uD83D', '\uDE00b'], 6)).resolves.toBe(
      'a\u{1F600}b'
    );
  });

  it('rejects a CLOB one byte over the limit with the limit message', async (): Promise<void> => {
    const error = await captureRejection(
      materializeClob(['a\uD83D', '\uDE00b'], 5)
    );

    expectLobLimitError(error, 5);
  });

  it('counts UTF-8 bytes rather than UTF-16 code units', async (): Promise<void> => {
    const error = await captureRejection(materializeClob(['\u{1F600}'], 3));

    expectLobLimitError(error, 3);
  });

  it('counts a surrogate that ends the last chunk', async (): Promise<void> => {
    const error = await captureRejection(materializeClob(['a\uD83D'], 3));

    expectLobLimitError(error, 3);
  });

  it('counts exactly the UTF-8 length of the text wherever the chunks split it', async (): Promise<void> => {
    const limit = Buffer.byteLength(MIXED_WIDTH_TEXT);
    const chunkings: Array<Array<string>> = [MIXED_WIDTH_TEXT.split('')];
    for (let index = 0; index <= MIXED_WIDTH_TEXT.length; index += 1) {
      chunkings.push([
        MIXED_WIDTH_TEXT.slice(0, index),
        MIXED_WIDTH_TEXT.slice(index),
      ]);
    }

    for (const chunks of chunkings) {
      await expect(materializeClob(chunks, limit)).resolves.toBe(
        MIXED_WIDTH_TEXT
      );
      expectLobLimitError(
        await captureRejection(materializeClob(chunks, limit - 1)),
        limit - 1
      );
    }
  });

  it('stops reading at the chunk that crosses the limit and destroys the LOB', async (): Promise<void> => {
    const lob = new ChunkedLob(oracledb.DB_TYPE_CLOB, ['ab', 'cd', 'ef']);

    const error = await captureRejection(materializeOut(lob, 'CLOB', 3));

    expectLobLimitError(error, 3);
    expect(lob.pulledChunks).toBe(2);
    expect(lob.destroyCalls).toBe(1);
  });

  it('destroys the LOB once it has been drained', async (): Promise<void> => {
    const lob = new ChunkedLob(oracledb.DB_TYPE_CLOB, ['hello', ' world']);

    await expect(materializeOut(lob, 'CLOB')).resolves.toBe('hello world');
    expect(lob.destroyCalls).toBe(1);
  });

  it('destroys the LOB when a read fails part-way through', async (): Promise<void> => {
    const readError = new Error('ORA-22922: nonexistent LOB value');
    const lob = new ChunkedLob(oracledb.DB_TYPE_CLOB, [
      'a\uD83D',
      readError,
      '\uDE00b',
    ]);

    await expect(materializeOut(lob, 'CLOB')).rejects.toBe(readError);
    expect(lob.pulledChunks).toBe(2);
    expect(lob.destroyCalls).toBe(1);
  });

  // A LOB inside a RECORD is not one of the top-level out binds the call
  // registers for cleanup, so only the drain itself can destroy it.
  it('destroys a RECORD field LOB whose limit is crossed part-way through', async (): Promise<void> => {
    const lob = new ChunkedLob(oracledb.DB_TYPE_CLOB, ['ab', 'cd', 'ef']);

    const error = await captureRejection(
      createMaterializer(3).materialize(
        [],
        [
          {
            name: 'P_ROW',
            type: 'object',
            structuredType: {
              kind: 'oracle-record',
              typeName: 'PKG.T_ROW',
              fields: [{ name: 'DOC', argumentType: 'CLOB', order: 1 }],
            },
          },
        ],
        { P_ROW: { DOC: lob } }
      )
    );

    expectLobLimitError(error, 3);
    expect(lob.pulledChunks).toBe(2);
    expect(lob.destroyCalls).toBe(1);
  });
});

describe('Oracle BLOB materialization', (): void => {
  it('joins Buffer chunks byte for byte without decoding them', async (): Promise<void> => {
    const lob = new ChunkedLob(oracledb.DB_TYPE_BLOB, [
      Buffer.from([0xf0, 0x9f]),
      Buffer.from([0x98, 0x80, 0xff]),
    ]);

    await expect(materializeOut(lob, 'BLOB')).resolves.toEqual(
      Buffer.from([0xf0, 0x9f, 0x98, 0x80, 0xff])
    );
    expect(lob.destroyCalls).toBe(1);
  });

  it('returns the bytes of a driver BLOB Lob as a Buffer', async (): Promise<void> => {
    const lob = createDriverLob(oracledb.DB_TYPE_BLOB, [
      Buffer.from([0xff, 0x00]),
      Buffer.from([0xd8, 0x3d]),
    ]);

    await expect(materializeOut(lob, 'BLOB')).resolves.toEqual(
      Buffer.from([0xff, 0x00, 0xd8, 0x3d])
    );
    expect(lob.destroyed).toBe(true);
  });

  it('counts raw bytes against the limit and destroys the LOB', async (): Promise<void> => {
    const lob = new ChunkedLob(oracledb.DB_TYPE_BLOB, [
      Buffer.from([1, 2]),
      Buffer.from([3, 4]),
      Buffer.from([5]),
    ]);

    const error = await captureRejection(materializeOut(lob, 'BLOB', 3));

    expectLobLimitError(error, 3);
    expect(lob.pulledChunks).toBe(2);
    expect(lob.destroyCalls).toBe(1);
  });

  it('destroys the LOB when a read fails part-way through', async (): Promise<void> => {
    const readError = new Error('ORA-22922: nonexistent LOB value');
    const lob = new ChunkedLob(oracledb.DB_TYPE_BLOB, [
      Buffer.from([1]),
      readError,
    ]);

    await expect(materializeOut(lob, 'BLOB')).rejects.toBe(readError);
    expect(lob.destroyCalls).toBe(1);
  });
});
