import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('RelationLoader lazy promise lifecycle', (): void => {
  it('does not create an unhandled rejected child promise', async (): Promise<void> => {
    const fixture = resolve(
      process.cwd(),
      'test/support/relation-loader-unhandled-child.mjs'
    );

    await expect(
      execFileAsync(process.execPath, [fixture], {
        cwd: process.cwd(),
        timeout: 10_000,
      })
    ).resolves.toMatchObject({ stderr: '' });
  });
});
