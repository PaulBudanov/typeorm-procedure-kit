import assert from 'node:assert/strict';

import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { OracleNotify } = await server.ssrLoadModule('/src/adapters/oracle/oracle-notify.ts');
  const notify = new OracleNotify({
    createSingleConnection() {
      assert.fail('Invalid SQL must be rejected before opening a connection');
    },
  }, {});
  const whitespace = '\t'.repeat(100_000);
  for (const sql of [
    `select\t${whitespace}x`,
    `select\ta${whitespace}x`,
    `select\ta\tfrom\t_\twhere\t${whitespace}JOIN`,
  ]) {
    await assert.rejects(notify.listenNotify(sql, () => {}), /Oracle CQN SQL/);
  }
} finally {
  await server.close();
}
