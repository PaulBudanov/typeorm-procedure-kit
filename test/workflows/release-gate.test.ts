import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

const releaseWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/release.yml', import.meta.url)
);
const securityWorkflowPath = fileURLToPath(
  new URL('../../.github/workflows/security.yml', import.meta.url)
);

describe('release workflow verification gate', (): void => {
  it('associates workflow_run Security checks with the triggering SHA', async (): Promise<void> => {
    const securityWorkflow = await readFile(securityWorkflowPath, 'utf8');

    expect(securityWorkflow).toContain(
      "run-name: Security · ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}"
    );
  });

  it('requires successful Tests and Security runs for verified_sha', async (): Promise<void> => {
    const releaseWorkflow = await readFile(releaseWorkflowPath, 'utf8');

    expect(releaseWorkflow).toContain(
      '/actions/workflows/tests.yml/runs?head_sha=$CHECKED_SHA'
    );
    expect(releaseWorkflow).toContain('.head_sha == \\"$CHECKED_SHA\\"');
    expect(releaseWorkflow).toContain(
      '.event == \\"workflow_run\\" and .display_title == \\"Security · $CHECKED_SHA\\"'
    );
    expect(releaseWorkflow).toContain('.status == \\"completed\\"');
    expect(releaseWorkflow).toContain('.conclusion == \\"success\\"');
  });

  it('can only be dispatched manually from the release branch', async (): Promise<void> => {
    const releaseWorkflow = await readFile(releaseWorkflowPath, 'utf8');

    expect(releaseWorkflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(releaseWorkflow).toContain(
      "if: github.event_name == 'workflow_dispatch'"
    );
    expect(releaseWorkflow).toContain(
      'if [ "${{ github.ref_name }}" != "release" ]; then'
    );
  });

  it('requires a checksum-verified real Oracle Thick integration before publish', async (): Promise<void> => {
    const releaseWorkflow = await readFile(releaseWorkflowPath, 'utf8');

    expect(releaseWorkflow).toContain('oracle_thick_integration:');
    expect(releaseWorkflow).toContain(
      'needs: [prepare, oracle_thick_integration]'
    );
    expect(releaseWorkflow).toContain(
      "if: needs.prepare.outputs.ready == 'true' && needs.oracle_thick_integration.result == 'success'"
    );
    expect(releaseWorkflow).toContain(
      'https://download.oracle.com/otn_software/linux/instantclient/2326200v2/instantclient-basiclite-linux.x64-23.26.2.0.0.zip'
    );
    expect(releaseWorkflow).toContain("EXPECTED_CKSUM: '149323083'");
    expect(releaseWorkflow).toContain("EXPECTED_SIZE: '75797020'");
    expect(releaseWorkflow).toContain(
      'sudo apt-get install --yes --no-install-recommends libaio1t64 unzip'
    );
    expect(releaseWorkflow).toContain(
      'read -r actual_cksum actual_size _ < <(cksum "$archive")'
    );
    expect(releaseWorkflow).toContain(
      'sudo tee /etc/ld.so.conf.d/oracle-instant-client.conf'
    );
    expect(releaseWorkflow).toContain('sudo ldconfig');
    expect(releaseWorkflow).toContain(
      'npx vitest run test/integration/oracle.integration.test.ts'
    );
  });
});
