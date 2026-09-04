import { describe, expect, it } from 'vitest';

import {
  assertCurrentReleaseSha,
  assertVerifiedWorkflowRun,
  classifyNpmVersionLookup,
  classifyReleaseCandidate,
} from '../../scripts/release-state.mjs';

const repository = 'PaulBudanov/typeorm-procedure-kit';
const verifiedSha = 'a'.repeat(40);

function createSuccessfulRun() {
  return {
    id: 123,
    name: 'CI',
    path: '.github/workflows/tests.yml',
    event: 'push',
    head_branch: 'release',
    head_sha: verifiedSha,
    status: 'completed',
    conclusion: 'success',
    head_repository: { full_name: repository },
  };
}

describe('release workflow run verification', (): void => {
  it('accepts the successful CI push associated with the release SHA', (): void => {
    expect(() =>
      assertVerifiedWorkflowRun(createSuccessfulRun(), {
        repository,
        runId: 123,
        sha: verifiedSha,
      })
    ).not.toThrow();
  });

  it.each([
    ['run ID', { id: 124 }],
    ['workflow name', { name: 'Tests' }],
    ['workflow path', { path: '.github/workflows/other.yml' }],
    ['event', { event: 'pull_request' }],
    ['branch', { head_branch: 'master' }],
    ['commit SHA', { head_sha: 'b'.repeat(40) }],
    ['status', { status: 'in_progress' }],
    ['conclusion', { conclusion: 'failure' }],
  ])('rejects a mismatched %s', (_description, override): void => {
    expect(() =>
      assertVerifiedWorkflowRun(
        { ...createSuccessfulRun(), ...override },
        { repository, runId: 123, sha: verifiedSha }
      )
    ).toThrow(/does not match release dispatch/);
  });

  it('rejects a release branch that moved after CI', (): void => {
    expect(() => assertCurrentReleaseSha('b'.repeat(40), verifiedSha)).toThrow(
      /release moved/
    );
  });
});

describe('release candidate classification', (): void => {
  const defaultState = {
    expectedSha: verifiedSha,
    exactTagHasPublishedRelease: false,
    actionReleaseCreated: false,
    hasMergedPendingReleasePr: false,
  };

  it('treats an old version tag on another commit as no release', (): void => {
    expect(
      classifyReleaseCandidate({
        ...defaultState,
        tagSha: 'b'.repeat(40),
      })
    ).toEqual({ candidate: false });
  });

  it('accepts a published GitHub Release tagged at the verified commit', (): void => {
    expect(
      classifyReleaseCandidate({
        ...defaultState,
        tagSha: verifiedSha,
        exactTagHasPublishedRelease: true,
      })
    ).toEqual({ candidate: true });
  });

  it('rejects an exact tag without a published GitHub Release', (): void => {
    expect(() =>
      classifyReleaseCandidate({
        ...defaultState,
        tagSha: verifiedSha,
      })
    ).toThrow(/without a published GitHub Release/);
  });

  it.each([
    ['action output', { actionReleaseCreated: true }],
    ['merged pending Release PR', { hasMergedPendingReleasePr: true }],
  ])(
    'rejects a release reported by %s without the exact tag',
    (_description, override): void => {
      expect(() =>
        classifyReleaseCandidate({ ...defaultState, ...override })
      ).toThrow(/did not create the exact release tag/);
    }
  );
});

describe('npm version lookup', (): void => {
  it('recognizes an already published exact version', (): void => {
    expect(
      classifyNpmVersionLookup(
        { status: 0, stdout: '"3.0.0"\n', stderr: '' },
        '3.0.0'
      )
    ).toEqual({ exists: true });
  });

  it('recognizes only an explicit E404 as an unpublished version', (): void => {
    expect(
      classifyNpmVersionLookup(
        { status: 1, stdout: '', stderr: 'npm error code E404' },
        '3.0.0'
      )
    ).toEqual({ exists: false });
  });

  it('blocks network and authentication failures', (): void => {
    expect(() =>
      classifyNpmVersionLookup(
        { status: 1, stdout: '', stderr: 'npm error code EAI_AGAIN' },
        '3.0.0'
      )
    ).toThrow(/lookup failed/);
  });

  it('rejects a successful response for another version', (): void => {
    expect(() =>
      classifyNpmVersionLookup(
        { status: 0, stdout: '"2.3.1"\n', stderr: '' },
        '3.0.0'
      )
    ).toThrow(/requested version/);
  });
});
