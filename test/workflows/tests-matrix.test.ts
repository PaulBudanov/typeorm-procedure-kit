import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

const testsWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/tests.yml', import.meta.url)
);

describe('package consumer workflow matrix', (): void => {
  it('runs every consumer scenario on every supported Node.js version', async (): Promise<void> => {
    const testsWorkflow = await readFile(testsWorkflowPath, 'utf8');

    expect(testsWorkflow).toContain('node-version: [20, 22, 24]');
    expect(testsWorkflow).toContain(
      'scenario: [vendor-neutral, postgres, oracle, nest10, nest11]'
    );
    expect(testsWorkflow).toContain(
      'name: Tarball consumer — Node ${{ matrix.node-version }} — ${{ matrix.scenario }}'
    );
    expect(testsWorkflow).toContain('node-version: ${{ matrix.node-version }}');
  });
});
