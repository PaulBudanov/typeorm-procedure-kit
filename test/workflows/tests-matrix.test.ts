import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testsWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/tests.yml', import.meta.url)
);

describe('unified CI workflow', (): void => {
  it('runs every consumer scenario on every supported Node.js version', async (): Promise<void> => {
    const workflow = await readFile(testsWorkflowPath, 'utf8');

    expect(workflow).toMatch(/^name: CI$/m);
    expect(workflow).toContain('node-version: [20, 22, 24]');
    expect(workflow).toContain(
      'scenario: [vendor-neutral, postgres, oracle, nest10, nest11]'
    );
    expect(workflow).toContain(
      'name: Tarball consumer — Node ${{ matrix.node-version }} — ${{ matrix.scenario }}'
    );
  });

  it('keeps security, dependency, integration, and release-only Thick gates together', async (): Promise<void> => {
    const workflow = await readFile(testsWorkflowPath, 'utf8');

    expect(workflow).toMatch(/^ {2}codeql:/m);
    expect(workflow).toMatch(/^ {2}dependency-audit:/m);
    expect(workflow).toMatch(/^ {2}dependency-review:/m);
    expect(workflow).toMatch(/^ {2}integration:/m);
    expect(workflow).toMatch(/^ {2}oracle-thick:/m);
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
    expect(workflow).toContain(
      "if: github.event_name == 'push' && github.ref == 'refs/heads/release'"
    );
    expect(workflow).toMatch(/^ {2}ci:\n {4}name: CI$/m);
  });
});
