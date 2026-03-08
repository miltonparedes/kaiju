import type { CreateFileInput, KaijuStore } from '../store/kaijuStore.js';
import type { GhCliRunner } from './githubProvider.js';
import { fetchGitHubPR, parseDiffIntoFiles, parsePRReference } from './githubProvider.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Parsed local branch reference. */
export interface ParsedBranchRef {
  branch: string;
  baseBranch?: string;
}

/** Fetch error with a typed category for structured handling. */
export interface FetchError {
  type: 'invalid_url' | 'invalid_pr' | 'auth' | 'git' | 'unknown';
  message: string;
}

/** Result of a fetch operation with error handling. */
export interface FetchResult {
  success: boolean;
  reviewKey?: string;
  fileCount?: number;
  commentCount?: number;
  error?: FetchError;
}

/**
 * Abstraction over git/gh CLI execution.
 * Accepts the argument array and returns stdout as a string.
 * Throws on non-zero exit code.
 */
export type GitRunner = (args: string[]) => Promise<string>;

// ─── parseLocalBranchRef ────────────────────────────────────────────────────────

/**
 * Parse a local branch reference.
 * Supports:
 * - "feature-branch" — diff against default branch
 * - "feature-branch..develop" — diff against specified base
 */
export function parseLocalBranchRef(ref: string): ParsedBranchRef {
  if (!ref || !ref.trim()) {
    throw new Error('Branch name cannot be empty');
  }

  const trimmed = ref.trim();

  // Check for explicit base: branch..base
  const doubleDotIdx = trimmed.indexOf('..');
  if (doubleDotIdx !== -1) {
    const branch = trimmed.slice(0, doubleDotIdx);
    const baseBranch = trimmed.slice(doubleDotIdx + 2);
    if (!branch || !baseBranch) {
      throw new Error(`Invalid branch reference "${ref}": both sides of ".." must be non-empty`);
    }
    return { branch, baseBranch };
  }

  return { branch: trimmed, baseBranch: undefined };
}

// ─── validatePRReference ────────────────────────────────────────────────────────

/**
 * Validate a PR reference format without actually fetching.
 * Returns null if valid, or a FetchError if invalid.
 */
export function validatePRReference(ref: string): FetchError | null {
  try {
    parsePRReference(ref);
    return null;
  } catch {
    return {
      type: 'invalid_url',
      message:
        `Invalid PR reference "${ref}". Expected formats:\n` +
        `  - https://github.com/org/repo/pull/N\n` +
        `  - org/repo#N`,
    };
  }
}

// ─── validateGhAuth ─────────────────────────────────────────────────────────────

/**
 * Check if gh CLI is authenticated by running `gh auth status`.
 * Returns null if authenticated, or a FetchError if not.
 */
export async function validateGhAuth(
  ghRunner: GitRunner = defaultGitRunner,
): Promise<FetchError | null> {
  try {
    await ghRunner(['auth', 'status']);
    return null;
  } catch {
    return {
      type: 'auth',
      message:
        'GitHub CLI is not authenticated. Run `gh auth login` to authenticate before fetching.',
    };
  }
}

// ─── Default git CLI runner ─────────────────────────────────────────────────────

/**
 * Execute `git` CLI and return stdout.
 * This is the real implementation; tests inject a mock runner.
 */
export async function defaultGitRunner(args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${exitCode}):\n${stderr}`);
  }

  return stdout.trim();
}

// ─── fetchLocalBranch ───────────────────────────────────────────────────────────

/**
 * Fetch a local git diff between branches and write to KaijuStore.
 *
 * @param store - KaijuStore instance
 * @param branch - The branch to diff (the head/feature branch)
 * @param baseBranch - The base branch to diff against (defaults to current branch)
 * @param gitRunner - Optional mock git CLI runner for testing
 * @param existingReviewKey - If provided, re-fetches into existing review (for re-fetch)
 */
export async function fetchLocalBranch(
  store: KaijuStore,
  branch: string,
  baseBranch?: string,
  gitRunner: GitRunner = defaultGitRunner,
  existingReviewKey?: string,
): Promise<{ reviewKey: string; fileCount: number }> {
  // Verify we're inside a git repo
  try {
    await gitRunner(['rev-parse', '--git-dir']);
  } catch {
    throw new Error(
      'Not inside a git repository. The --branch flag must be used from within a git repo.',
    );
  }

  // Determine base branch if not specified
  const base = baseBranch ?? (await gitRunner(['rev-parse', '--abbrev-ref', 'HEAD']));

  // Run git diff
  const diff = await gitRunner(['diff', `${base}...${branch}`]);

  // Parse diff into files
  const diffFiles = parseDiffIntoFiles(diff);

  // Build a stable review key for local branches
  const repoName = 'local-branch';
  // Use a hash of the branch name for stable PR numbering
  const prNumber = hashBranchName(branch);
  const reviewKey = existingReviewKey ?? `local/local/${repoName}/${prNumber}`;

  // If re-fetching, delete old review first
  if (existingReviewKey) {
    const existing = store.getReview(existingReviewKey);
    if (existing) {
      await store.deleteReview(existingReviewKey);
    }
  }

  await store.createReview({
    key: reviewKey,
    provider: 'local',
    repo: `local/${repoName}`,
    pr: prNumber,
    title: `Local diff: ${branch} vs ${base}`,
    url: '',
    base,
    head: branch,
    rawDiff: diff,
  });

  // Add files
  const fileInputs: CreateFileInput[] = diffFiles.map((f) => ({
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));
  if (fileInputs.length > 0) {
    await store.addFiles(reviewKey, fileInputs);
  }

  return {
    reviewKey,
    fileCount: diffFiles.length,
  };
}

// ─── fetchWithErrorHandling ─────────────────────────────────────────────────────

/**
 * Fetch a PR with structured error handling for all failure scenarios:
 * - Invalid PR reference format → FetchError { type: 'invalid_url' }
 * - Nonexistent PR → FetchError { type: 'invalid_pr' }
 * - gh not authenticated → FetchError { type: 'auth' }
 * - Other errors → FetchError { type: 'unknown' }
 *
 * On error, no partial writes occur (no files or DB rows created).
 */
export async function fetchWithErrorHandling(
  store: KaijuStore,
  provider: string,
  ref: string,
  ghRunner?: GitRunner,
): Promise<FetchResult> {
  // 1. Validate URL format first (no I/O needed)
  if (provider === 'github') {
    const urlError = validatePRReference(ref);
    if (urlError) {
      return { success: false, error: urlError };
    }
  }

  try {
    if (provider === 'github') {
      const parsed = parsePRReference(ref);
      const result = await fetchGitHubPR(
        store,
        parsed.owner,
        parsed.repo,
        parsed.pr,
        ghRunner as GhCliRunner,
      );
      return {
        success: true,
        reviewKey: result.reviewKey,
        fileCount: result.fileCount,
        commentCount: result.commentCount,
      };
    }

    return {
      success: false,
      error: { type: 'unknown', message: `Unsupported provider: ${provider}` },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Classify the error
    if (isAuthError(message)) {
      return {
        success: false,
        error: {
          type: 'auth',
          message:
            'GitHub CLI is not authenticated. Run `gh auth login` to authenticate before fetching.',
        },
      };
    }

    if (isInvalidPRError(message)) {
      const parsed = parsePRReference(ref);
      return {
        success: false,
        error: {
          type: 'invalid_pr',
          message:
            `Pull request #${parsed.pr} not found in ${parsed.owner}/${parsed.repo}. ` +
            'Verify the PR number exists and you have access to the repository.',
        },
      };
    }

    return {
      success: false,
      error: { type: 'unknown', message },
    };
  }
}

// ─── refetchReview ──────────────────────────────────────────────────────────────

/**
 * Re-fetch an existing review — deletes old data and fetches fresh.
 * Works for GitHub PRs. The review key is reused so references stay stable.
 *
 * @param store - KaijuStore instance
 * @param ref - PR reference (org/repo#N or URL)
 * @param ghRunner - Optional mock gh CLI runner for testing
 */
export async function refetchReview(
  store: KaijuStore,
  ref: string,
  ghRunner?: GitRunner,
): Promise<FetchResult> {
  // Validate first
  const urlError = validatePRReference(ref);
  if (urlError) {
    return { success: false, error: urlError };
  }

  const parsed = parsePRReference(ref);
  const reviewKey = `github/${parsed.owner}/${parsed.repo}/${parsed.pr}`;

  // Delete existing review if present
  const existing = store.getReview(reviewKey);
  if (existing) {
    await store.deleteReview(reviewKey);
  }

  // Re-fetch
  try {
    const result = await fetchGitHubPR(
      store,
      parsed.owner,
      parsed.repo,
      parsed.pr,
      ghRunner as GhCliRunner,
    );
    return {
      success: true,
      reviewKey: result.reviewKey,
      fileCount: result.fileCount,
      commentCount: result.commentCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (isAuthError(message)) {
      return {
        success: false,
        error: {
          type: 'auth',
          message:
            'GitHub CLI is not authenticated. Run `gh auth login` to authenticate before fetching.',
        },
      };
    }

    if (isInvalidPRError(message)) {
      return {
        success: false,
        error: {
          type: 'invalid_pr',
          message:
            `Pull request #${parsed.pr} not found in ${parsed.owner}/${parsed.repo}. ` +
            'Verify the PR number exists and you have access to the repository.',
        },
      };
    }

    return {
      success: false,
      error: { type: 'unknown', message },
    };
  }
}

// ─── Error classification helpers ───────────────────────────────────────────────

function isAuthError(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes('not logged in') ||
    lowerMsg.includes('auth login') ||
    lowerMsg.includes('authentication') ||
    lowerMsg.includes('not authenticated') ||
    lowerMsg.includes('401')
  );
}

function isInvalidPRError(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes('could not resolve to a pullrequest') ||
    lowerMsg.includes('pull request not found') ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('404')
  );
}

/**
 * Simple hash of a branch name to produce a stable numeric identifier.
 */
function hashBranchName(branch: string): number {
  let hash = 0;
  for (let i = 0; i < branch.length; i++) {
    const ch = branch.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  // Ensure positive and within a reasonable range
  return Math.abs(hash) % 1_000_000;
}
