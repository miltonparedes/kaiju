import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, createDB, parsePRReference } from '@kaiju/core';

// ─── Store factory ──────────────────────────────────────────────────────────────

/**
 * Create a KaijuStore instance with auto-bootstrapping.
 * Ensures the ~/.kaiju/ directory exists before opening the SQLite database,
 * so fresh installs work without manual mkdir.
 */
export function createStore(): KaijuStore {
  const baseDir = join(homedir(), '.kaiju');
  mkdirSync(baseDir, { recursive: true });
  const dbPath = join(baseDir, 'kaiju.db');
  const db = createDB(dbPath);
  return new KaijuStore(db, baseDir);
}

// ─── Context detection ──────────────────────────────────────────────────────────

/**
 * Detect the current git repo's remote origin URL and extract org/repo.
 * Returns null if not inside a git repo or remote not parseable.
 */
export function detectGitRepo(): { org: string; repo: string } | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Parse SSH format: git@github.com:org/repo.git
    const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { org: sshMatch[1]!, repo: sshMatch[2]! };
    }

    // Parse HTTPS format: https://github.com/org/repo.git
    const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { org: httpsMatch[1]!, repo: httpsMatch[2]! };
    }

    return null;
  } catch {
    // Not inside a git repo or git not available
    return null;
  }
}

/**
 * Filter review keys by the current git repo context.
 * If inside a git repo, only returns reviews matching that repo.
 * If not inside a repo, returns all reviews.
 */
export function filterReviewsByContext(
  store: KaijuStore,
  overrideAll: boolean,
): ReturnType<KaijuStore['listReviews']> {
  const allReviews = store.listReviews();

  if (overrideAll) {
    return allReviews;
  }

  const gitRepo = detectGitRepo();
  if (!gitRepo) {
    return allReviews;
  }

  return allReviews.filter((r) => r.repo === `${gitRepo.org}/${gitRepo.repo}`);
}

// ─── Review key resolution ──────────────────────────────────────────────────────

/**
 * Resolve a review key from a PR reference or find the most recent review.
 * Validates that the review exists in the store and prints a clear error if not.
 *
 * When no prRef is given and useContext is true (default), applies git repo context
 * detection to prefer reviews matching the current repository.
 *
 * Returns null and sets process.exitCode = 1 on failure.
 */
export function resolveReviewKey(
  store: KaijuStore,
  prRef?: string,
  useContext = true,
): string | null {
  if (prRef) {
    // Try parsing as a PR reference (shorthand or URL)
    try {
      const parsed = parsePRReference(prRef);
      const key = `github/${parsed.owner}/${parsed.repo}/${parsed.pr}`;
      const review = store.getReview(key);
      if (!review) {
        console.error(
          `Error: Review for ${parsed.owner}/${parsed.repo}#${parsed.pr} not found. Run 'kaiju fetch ${parsed.owner}/${parsed.repo}#${parsed.pr}' first.`,
        );
        process.exitCode = 1;
        return null;
      }
      return key;
    } catch {
      // Not a valid PR ref — maybe it's a raw review key
      const review = store.getReview(prRef);
      if (review) {
        return prRef;
      }

      console.error(
        `Error: Invalid PR reference "${prRef}". Expected formats:\n` +
          '  - org/repo#N\n' +
          '  - https://github.com/org/repo/pull/N',
      );
      process.exitCode = 1;
      return null;
    }
  }

  // No ref given — use context detection to find the most recent review
  let candidates = store.listReviews();
  if (candidates.length === 0) {
    return null;
  }

  // Apply context filtering if inside a git repo
  if (useContext) {
    const gitRepo = detectGitRepo();
    if (gitRepo) {
      const contextFiltered = candidates.filter((r) => r.repo === `${gitRepo.org}/${gitRepo.repo}`);
      if (contextFiltered.length > 0) {
        candidates = contextFiltered;
      }
    }
  }

  // Sort by most recent (highest updatedAt)
  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0]!.key;
}
