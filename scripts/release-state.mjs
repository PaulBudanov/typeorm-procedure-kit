import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fullShaPattern = /^[0-9a-f]{40}$/i;
const positiveIntegerPattern = /^[1-9][0-9]*$/;

function requireFullSha(value, description) {
  if (typeof value !== 'string' || !fullShaPattern.test(value)) {
    throw new Error(`${description} must be a full 40-character Git SHA`);
  }
  return value.toLowerCase();
}

function requirePositiveInteger(value, description) {
  const normalizedValue = String(value);
  if (!positiveIntegerPattern.test(normalizedValue)) {
    throw new Error(`${description} must be a positive integer`);
  }
  return Number(normalizedValue);
}

/**
 * Enforces the immutable association between a release dispatch and its CI run.
 */
export function assertVerifiedWorkflowRun(run, expected) {
  const expectedRunId = requirePositiveInteger(expected.runId, 'CI run ID');
  const expectedSha = requireFullSha(expected.sha, 'Verified SHA');
  const problems = [];

  if (run?.id !== expectedRunId) problems.push('run ID');
  if (run?.name !== 'CI') problems.push('workflow name');
  if (run?.path !== '.github/workflows/tests.yml')
    problems.push('workflow path');
  if (run?.event !== 'push') problems.push('event');
  if (run?.head_branch !== 'release') problems.push('branch');
  if (run?.head_sha?.toLowerCase() !== expectedSha) problems.push('commit SHA');
  if (run?.status !== 'completed') problems.push('status');
  if (run?.conclusion !== 'success') problems.push('conclusion');
  if (run?.head_repository?.full_name !== expected.repository) {
    problems.push('repository');
  }

  if (problems.length > 0) {
    throw new Error(
      `CI workflow run does not match release dispatch: ${problems.join(', ')}`
    );
  }
}

export function assertCurrentReleaseSha(actualSha, expectedSha) {
  const actual = requireFullSha(actualSha, 'Current release SHA');
  const expected = requireFullSha(expectedSha, 'Verified SHA');
  if (actual !== expected) {
    throw new Error(
      `release moved from verified commit ${expected} to ${actual}`
    );
  }
}

/**
 * Classifies whether the verified commit is an immutable release candidate.
 * An older tag for the same package version is a normal non-release state.
 */
export function classifyReleaseCandidate(state) {
  const expectedSha = requireFullSha(state.expectedSha, 'Verified SHA');
  const tagSha =
    state.tagSha === undefined || state.tagSha === null
      ? undefined
      : requireFullSha(state.tagSha, 'Release tag SHA');
  const hasExactTag = tagSha === expectedSha;

  if (hasExactTag) {
    if (!state.exactTagHasPublishedRelease) {
      throw new Error(
        'the exact release tag exists without a published GitHub Release'
      );
    }
    return { candidate: true };
  }

  if (state.actionReleaseCreated || state.hasMergedPendingReleasePr) {
    throw new Error(
      'Release Please identified a merged release but did not create the exact release tag'
    );
  }

  return { candidate: false };
}

/**
 * Treats only an explicit npm E404 as an unpublished version; all ambiguous
 * registry failures remain blocking so a retry cannot accidentally republish.
 */
export function classifyNpmVersionLookup(result, expectedVersion) {
  if (result.error) {
    throw new Error(`npm version lookup failed: ${result.error.message}`);
  }
  if (result.status === 0) {
    let publishedVersion;
    try {
      publishedVersion = JSON.parse(result.stdout.trim());
    } catch (error) {
      throw new Error('npm version lookup returned invalid JSON', {
        cause: error,
      });
    }
    if (publishedVersion !== expectedVersion) {
      throw new Error(
        `npm returned ${String(publishedVersion)} for requested version ${expectedVersion}`
      );
    }
    return { exists: true };
  }

  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (/\bE404\b/.test(diagnostic) || /\b404 Not Found\b/i.test(diagnostic)) {
    return { exists: false };
  }
  throw new Error(
    `npm version lookup failed with exit code ${String(result.status)}: ${diagnostic.trim()}`
  );
}

async function fetchJson(url, token) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (error) {
    throw new Error(`GitHub API request failed for ${url}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed for ${url}: HTTP ${response.status}`
    );
  }
  return response.json();
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        'git command failed',
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
  return result.stdout.trim();
}

async function verifyWorkflowRun() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const runId = process.env.VERIFIED_RUN_ID;
  const sha = process.env.VERIFIED_SHA;
  const apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  if (!repository || !token || !runId || !sha) {
    throw new Error(
      'GITHUB_REPOSITORY, GITHUB_TOKEN, VERIFIED_RUN_ID, and VERIFIED_SHA are required'
    );
  }

  const normalizedRunId = requirePositiveInteger(runId, 'CI run ID');
  const normalizedSha = requireFullSha(sha, 'Verified SHA');
  const run = await fetchJson(
    `${apiUrl}/repos/${repository}/actions/runs/${normalizedRunId}`,
    token
  );
  assertVerifiedWorkflowRun(run, {
    repository,
    runId: normalizedRunId,
    sha: normalizedSha,
  });

  const releaseRef = await fetchJson(
    `${apiUrl}/repos/${repository}/git/ref/heads/release`,
    token
  );
  assertCurrentReleaseSha(releaseRef?.object?.sha, normalizedSha);
  assertCurrentReleaseSha(runGit(['rev-parse', 'HEAD']), normalizedSha);
  console.log(
    `Verified successful CI run ${normalizedRunId} for ${normalizedSha}.`
  );
}

function checkNpmVersion() {
  const packageName = process.env.PACKAGE_NAME;
  const packageVersion = process.env.PACKAGE_VERSION;
  if (!packageName || !packageVersion) {
    throw new Error('PACKAGE_NAME and PACKAGE_VERSION are required');
  }

  const result = spawnSync(
    'npm',
    [
      'view',
      `${packageName}@${packageVersion}`,
      'version',
      '--json',
      '--registry',
      'https://registry.npmjs.org/',
    ],
    { encoding: 'utf8', env: process.env }
  );
  const state = classifyNpmVersionLookup(result, packageVersion);
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error('GITHUB_OUTPUT is required');
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `exists=${String(state.exists)}\n`);
  console.log(
    state.exists
      ? `${packageName}@${packageVersion} is already published.`
      : `${packageName}@${packageVersion} is not published yet.`
  );
}

function requireBooleanEnvironmentValue(name) {
  const value = process.env[name];
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

function resolveReleaseCandidate() {
  const expectedSha = process.env.VERIFIED_SHA;
  if (!expectedSha) {
    throw new Error('VERIFIED_SHA is required');
  }

  const state = classifyReleaseCandidate({
    expectedSha,
    tagSha: process.env.TAG_SHA || undefined,
    exactTagHasPublishedRelease: requireBooleanEnvironmentValue(
      'EXACT_TAG_HAS_PUBLISHED_RELEASE'
    ),
    actionReleaseCreated: requireBooleanEnvironmentValue(
      'ACTION_RELEASE_CREATED'
    ),
    hasMergedPendingReleasePr: requireBooleanEnvironmentValue(
      'HAS_MERGED_PENDING_RELEASE_PR'
    ),
  });
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error('GITHUB_OUTPUT is required');
  }
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `release_candidate=${String(state.candidate)}\n`
  );
  process.stdout.write(String(state.candidate));
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const command = process.argv[2];
  if (command === 'verify-workflow-run') {
    await verifyWorkflowRun();
  } else if (command === 'npm-version') {
    checkNpmVersion();
  } else if (command === 'release-candidate') {
    resolveReleaseCandidate();
  } else {
    throw new Error(`Unknown release-state command: ${String(command)}`);
  }
}
