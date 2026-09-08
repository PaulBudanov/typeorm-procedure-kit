import { describe, expect, it } from 'vitest';

import * as typeormRuntime from '../../src/typeorm/index.js';

describe('vendored TypeORM migration generation surface', (): void => {
  it('does not expose the migration generation CLI affected by GHSA-2rp8-mm9q-fp49', (): void => {
    expect(typeormRuntime).not.toHaveProperty('MigrationGenerateCommand');
    expect(typeormRuntime).not.toHaveProperty('CommandUtils');
  });
});
