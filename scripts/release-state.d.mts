export interface IWorkflowRun {
  id?: number;
  name?: string;
  path?: string;
  event?: string;
  head_branch?: string;
  head_sha?: string;
  status?: string;
  conclusion?: string;
  head_repository?: {
    full_name?: string;
  };
}

export interface IWorkflowRunExpectation {
  repository: string;
  runId: number | string;
  sha: string;
}

export interface INpmVersionLookupResult {
  error?: Error;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface IReleaseCandidateState {
  expectedSha: string;
  tagSha?: string | null;
  exactTagHasPublishedRelease: boolean;
  actionReleaseCreated: boolean;
  hasMergedPendingReleasePr: boolean;
}

export function assertVerifiedWorkflowRun(
  run: IWorkflowRun,
  expected: IWorkflowRunExpectation
): void;

export function assertCurrentReleaseSha(
  actualSha: string,
  expectedSha: string
): void;

export function classifyReleaseCandidate(state: IReleaseCandidateState): {
  candidate: boolean;
};

export function classifyNpmVersionLookup(
  result: INpmVersionLookupResult,
  expectedVersion: string
): { exists: boolean };
