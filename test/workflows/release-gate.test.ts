import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const projectFile = (relativePath: string): string =>
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

describe('release workflow wiring', (): void => {
  it('dispatches only successful release pushes from the unified CI run', async (): Promise<void> => {
    const dispatcher = await readFile(
      projectFile('.github/workflows/release-dispatch.yml'),
      'utf8'
    );

    expect(dispatcher).toContain('workflows:\n      - CI');
    expect(dispatcher).toContain("github.event.workflow_run.event == 'push'");
    expect(dispatcher).toContain(
      "github.event.workflow_run.head_branch == 'release'"
    );
    expect(dispatcher).toContain('verified_run_id="$VERIFIED_RUN_ID"');
    expect(dispatcher).toContain('verified_sha="$VERIFIED_SHA"');
    expect(dispatcher).not.toContain('actions/checkout');
  });

  it('uses a pinned Release Please action and a 2.3.1 manifest baseline', async (): Promise<void> => {
    const [workflow, configText, manifestText] = await Promise.all([
      readFile(projectFile('.github/workflows/release.yml'), 'utf8'),
      readFile(projectFile('release-please-config.json'), 'utf8'),
      readFile(projectFile('.release-please-manifest.json'), 'utf8'),
    ]);
    const config = JSON.parse(configText) as {
      'group-pull-request-title-pattern': string;
      packages: Record<string, Record<string, unknown>>;
    };
    const manifest = JSON.parse(manifestText) as Record<string, string>;

    expect(workflow).toContain(
      'googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7'
    );
    expect(workflow).toContain('target-branch: release');
    expect(config.packages['.']).toMatchObject({
      'release-type': 'node',
      'include-component-in-tag': false,
      'include-v-in-tag': true,
      'pull-request-title-pattern':
        'chore${scope}: release${component} ${version}',
    });
    expect(config['group-pull-request-title-pattern']).toBe(
      'chore${scope}: release${component} ${version}'
    );
    expect(manifest).toEqual({ '.': '2.3.1' });
  });

  it('separates release creation, npm publishing, and master synchronization', async (): Promise<void> => {
    const workflow = await readFile(
      projectFile('.github/workflows/release.yml'),
      'utf8'
    );

    expect(workflow).toMatch(/^ {2}release_please:/m);
    expect(workflow).toMatch(/^ {2}resolve_release:/m);
    expect(workflow).toMatch(/^ {2}publish:/m);
    expect(workflow).toMatch(/^ {2}sync_master:/m);
    expect(workflow).toContain('environment: npm-publish');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain(
      "needs.resolve_release.outputs.release_candidate == 'true'"
    );
    expect(workflow).toContain('result=already-published');
    expect(workflow).toContain('autorelease: pending');
    expect(workflow).toContain(
      'node scripts/release-state.mjs release-candidate'
    );
    expect(workflow).toContain('--base master');
    expect(workflow).toContain('sync_branch="release-sync/$TAG_NAME"');
    expect(workflow).toContain('-f sha="$EXPECTED_SHA"');
    expect(workflow).toContain('--head "$sync_branch"');
  });

  it('contains no legacy semantic-release or staged-artifact path', async (): Promise<void> => {
    const workflow = await readFile(
      projectFile('.github/workflows/release.yml'),
      'utf8'
    );

    expect(workflow).not.toContain('semantic-release');
    expect(workflow).not.toContain('release-package');
    expect(workflow).not.toContain('SBOM.cdx.json');
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).not.toContain('download-artifact');
  });
});
