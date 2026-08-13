import { describe, expect, it, vi } from 'vitest';

describe('PlatformTools peer resolution', (): void => {
  it('resolves peers from the package when the application entry point is external', async (): Promise<void> => {
    const originalEntryPoint = process.argv[1];
    process.argv[1] = '/tmp/external-application/index.mjs';

    try {
      vi.resetModules();
      const { PlatformTools } =
        await import('../../src/typeorm/platform/PlatformTools.js');

      expect(PlatformTools.load('pg')).toBeDefined();
      expect(PlatformTools.load('pg-query-stream')).toBeDefined();
      expect(PlatformTools.load('oracledb')).toBeDefined();
    } finally {
      if (originalEntryPoint === undefined) process.argv.splice(1, 1);
      else process.argv[1] = originalEntryPoint;
    }
  });
});
