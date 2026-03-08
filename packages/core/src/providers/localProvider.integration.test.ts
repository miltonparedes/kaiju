import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FilesJson, ManifestJson } from '../store/fileTypes.js';
import { createDB } from '../store/index.js';
import { KaijuStore } from '../store/kaijuStore.js';
import {
  type GitRunner,
  fetchLocalBranch,
  fetchWithErrorHandling,
  refetchReview,
} from './localProvider.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_DIFF = `diff --git a/src/auth/session.ts b/src/auth/session.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/session.ts
@@ -0,0 +1,5 @@
+import { token } from '../crypto';
+
+export function createSession() {
+  return token();
+}
diff --git a/src/routes/api.ts b/src/routes/api.ts
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -1,4 +1,6 @@
 import express from 'express';
+import { createSession } from '../auth/session';
+
 const router = express.Router();
-router.get('/hello', (req, res) => res.send('hi'));
+router.get('/hello', (req, res) => res.json({ ok: true }));
 export default router;
`;

const MOCK_DIFF_UPDATED = `diff --git a/src/auth/session.ts b/src/auth/session.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/session.ts
@@ -0,0 +1,7 @@
+import { token } from '../crypto';
+
+export function createSession() {
+  return token();
+}
+
+export function destroySession() {}
diff --git a/src/routes/api.ts b/src/routes/api.ts
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -1,4 +1,6 @@
 import express from 'express';
+import { createSession } from '../auth/session';
+
 const router = express.Router();
-router.get('/hello', (req, res) => res.send('hi'));
+router.get('/hello', (req, res) => res.json({ ok: true }));
 export default router;
diff --git a/src/utils/helpers.ts b/src/utils/helpers.ts
new file mode 100644
--- /dev/null
+++ b/src/utils/helpers.ts
@@ -0,0 +1,3 @@
+export function noop() {
+  // nothing
+}
`;

// ─── Test setup ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let db: ReturnType<typeof createDB>;
let store: KaijuStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'kaiju-local-'));
  db = createDB(':memory:');
  store = new KaijuStore(db, tmpDir);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── fetchLocalBranch ───────────────────────────────────────────────────────────

describe('fetchLocalBranch', () => {
  it('creates a review from git diff between branches', async () => {
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main';
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) return MOCK_DIFF;
      throw new Error(`Unexpected git command: ${cmd}`);
    };

    const result = await fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunner);

    expect(result.reviewKey).toContain('local/');
    expect(result.fileCount).toBe(2);

    // Verify review in SQLite
    const review = store.getReview(result.reviewKey);
    expect(review).toBeDefined();
    expect(review!.provider).toBe('local');
    expect(review!.status).toBe('fetched');

    // Verify files in SQLite
    const fileEntries = store.getFiles(result.reviewKey);
    expect(fileEntries).toHaveLength(2);
    const paths = fileEntries.map((f) => f.path).sort();
    expect(paths).toEqual(['src/auth/session.ts', 'src/routes/api.ts']);
  });

  it('uses specified base branch instead of default', async () => {
    let capturedDiffArgs: string[] = [];
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main';
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) {
        capturedDiffArgs = args;
        return MOCK_DIFF;
      }
      throw new Error(`Unexpected git command: ${cmd}`);
    };

    await fetchLocalBranch(store, 'feature-branch', 'develop', mockGitRunner);

    // Should diff against 'develop', not 'main'
    expect(capturedDiffArgs.join(' ')).toContain('develop');
  });

  it('writes manifest.json and files.json to disk', async () => {
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main';
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) return MOCK_DIFF;
      throw new Error(`Unexpected git command: ${cmd}`);
    };

    const result = await fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunner);
    const review = store.getReview(result.reviewKey)!;

    const reviewDir = join(
      tmpDir,
      'reviews',
      'local',
      'local',
      review.repo.split('/')[1]!,
      String(review.pr),
    );
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'raw.diff'))).toBe(true);

    // Verify manifest content
    const manifest: ManifestJson = JSON.parse(
      await readFile(join(reviewDir, 'manifest.json'), 'utf-8'),
    );
    expect(manifest.source.provider).toBe('local');
    expect(manifest.stats.total_files).toBe(2);
  });

  it('falls back to repo default branch via symbolic-ref when no base specified', async () => {
    let capturedDiffArgs: string[] = [];
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD'))
        return 'refs/remotes/origin/develop';
      if (cmd.includes('diff')) {
        capturedDiffArgs = args;
        return MOCK_DIFF;
      }
      throw new Error(`Unexpected git command: ${cmd}`);
    };

    await fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunner);

    // Should diff against 'develop' (the repo default branch), not HEAD
    expect(capturedDiffArgs.join(' ')).toContain('develop...feature-branch');
  });

  it('falls back to HEAD when symbolic-ref fails (no origin/HEAD)', async () => {
    let capturedDiffArgs: string[] = [];
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD'))
        throw new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref');
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) {
        capturedDiffArgs = args;
        return MOCK_DIFF;
      }
      throw new Error(`Unexpected git command: ${cmd}`);
    };

    await fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunner);

    // Should fall back to HEAD (main) when symbolic-ref fails
    expect(capturedDiffArgs.join(' ')).toContain('main...feature-branch');
  });

  it('handles empty diff (no changes between branches)', async () => {
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main';
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) return '';
      throw new Error(`Unexpected git command: ${cmd}`);
    };

    const result = await fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunner);
    expect(result.fileCount).toBe(0);

    const review = store.getReview(result.reviewKey);
    expect(review).toBeDefined();
    const fileEntries = store.getFiles(result.reviewKey);
    expect(fileEntries).toHaveLength(0);
  });

  it('throws when not inside a git repo', async () => {
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) {
        throw new Error('fatal: not a git repository');
      }
      throw new Error(`Unexpected git command: ${cmd}`);
    };

    await expect(
      fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunner),
    ).rejects.toThrow('Not inside a git repository');
  });
});

// ─── Dual-layer consistency after fetch (VAL-FETCH-005) ─────────────────────────

describe('dual-layer consistency after local branch fetch', () => {
  it('files table count equals files.json entries', async () => {
    const mockGitRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main';
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) return MOCK_DIFF;
      throw new Error(`Unexpected: ${cmd}`);
    };

    const result = await fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunner);

    const dbFiles = store.getFiles(result.reviewKey);
    const review = store.getReview(result.reviewKey)!;

    const reviewDir = join(
      tmpDir,
      'reviews',
      'local',
      'local',
      review.repo.split('/')[1]!,
      String(review.pr),
    );
    const filesJson: FilesJson = JSON.parse(await readFile(join(reviewDir, 'files.json'), 'utf-8'));

    expect(dbFiles.length).toBe(filesJson.files.length);
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────────

describe('fetchWithErrorHandling', () => {
  it('returns error for invalid PR reference (nonexistent PR)', async () => {
    const mockGhRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('pr diff') || cmd.includes('pr view')) {
        throw new Error('GraphQL: Could not resolve to a PullRequest with the number of 99999999.');
      }
      throw new Error(`Unexpected: ${cmd}`);
    };

    const result = await fetchWithErrorHandling(
      store,
      'github',
      'acme/widgets#99999999',
      mockGhRunner,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe('invalid_pr');
    expect(result.error!.message).toContain('99999999');

    // No partial writes — no reviews in store
    expect(store.listReviews()).toHaveLength(0);
  });

  it('returns error for gh not authenticated', async () => {
    const mockGhRunner: GitRunner = async () => {
      throw new Error('gh auth login: error: not logged into any GitHub hosts. Run gh auth login.');
    };

    const result = await fetchWithErrorHandling(store, 'github', 'acme/widgets#42', mockGhRunner);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe('auth');
    expect(result.error!.message).toContain('gh auth');
  });

  it('returns error for invalid URL format', async () => {
    const result = await fetchWithErrorHandling(store, 'github', 'not-a-valid-ref');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe('invalid_url');
    expect(result.error!.message).toContain('Expected formats');
  });

  it('succeeds for valid PR reference with mock runner', async () => {
    const mockGhRunner: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('pr diff')) return MOCK_DIFF;
      if (cmd.includes('pr view')) {
        return JSON.stringify({
          title: 'Test PR',
          number: 42,
          baseRefName: 'main',
          headRefName: 'feature',
          url: 'https://github.com/acme/widgets/pull/42',
        });
      }
      if (cmd.includes('pulls/42/comments')) return '[]';
      if (cmd.includes('issues/42/comments')) return '[]';
      throw new Error(`Unexpected: ${cmd}`);
    };

    const result = await fetchWithErrorHandling(store, 'github', 'acme/widgets#42', mockGhRunner);

    expect(result.success).toBe(true);
    expect(result.reviewKey).toBeDefined();
    expect(result.fileCount).toBeGreaterThan(0);
  });
});

// ─── Re-fetch behavior (VAL-FETCH-007) ─────────────────────────────────────────

describe('refetchReview', () => {
  it('updates files and SQLite rows to reflect latest state', async () => {
    // First fetch
    const mockGhRunnerV1: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('pr diff')) return MOCK_DIFF;
      if (cmd.includes('pr view')) {
        return JSON.stringify({
          title: 'Initial Title',
          number: 42,
          baseRefName: 'main',
          headRefName: 'feature',
          url: 'https://github.com/acme/widgets/pull/42',
        });
      }
      if (cmd.includes('pulls/42/comments')) return '[]';
      if (cmd.includes('issues/42/comments')) return '[]';
      throw new Error(`Unexpected: ${cmd}`);
    };

    const result1 = await fetchWithErrorHandling(
      store,
      'github',
      'acme/widgets#42',
      mockGhRunnerV1,
    );
    expect(result1.success).toBe(true);

    const reviewBefore = store.getReview(result1.reviewKey!);
    expect(reviewBefore!.title).toBe('Initial Title');
    const filesBefore = store.getFiles(result1.reviewKey!);
    expect(filesBefore).toHaveLength(2);

    // Re-fetch with updated data (new file added, title changed)
    const mockGhRunnerV2: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('pr diff')) return MOCK_DIFF_UPDATED;
      if (cmd.includes('pr view')) {
        return JSON.stringify({
          title: 'Updated Title',
          number: 42,
          baseRefName: 'main',
          headRefName: 'feature',
          url: 'https://github.com/acme/widgets/pull/42',
        });
      }
      if (cmd.includes('pulls/42/comments')) return '[]';
      if (cmd.includes('issues/42/comments')) return '[]';
      throw new Error(`Unexpected: ${cmd}`);
    };

    const result2 = await refetchReview(store, 'acme/widgets#42', mockGhRunnerV2);
    expect(result2.success).toBe(true);
    expect(result2.reviewKey).toBe(result1.reviewKey);

    // Verify updated data
    const reviewAfter = store.getReview(result2.reviewKey!);
    expect(reviewAfter!.title).toBe('Updated Title');

    const filesAfter = store.getFiles(result2.reviewKey!);
    expect(filesAfter).toHaveLength(3); // was 2, now 3

    // Verify dual-layer consistency after re-fetch
    const reviewDir = join(tmpDir, 'reviews', 'github', 'acme', 'widgets', '42');
    const filesJson: FilesJson = JSON.parse(await readFile(join(reviewDir, 'files.json'), 'utf-8'));
    expect(filesAfter.length).toBe(filesJson.files.length);
  });

  it('re-fetch on local branch updates to latest diff', async () => {
    // First fetch
    const mockGitRunnerV1: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main';
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) return MOCK_DIFF;
      throw new Error(`Unexpected: ${cmd}`);
    };

    const result1 = await fetchLocalBranch(store, 'feature-branch', undefined, mockGitRunnerV1);
    expect(result1.fileCount).toBe(2);

    // Second fetch with more files
    const mockGitRunnerV2: GitRunner = async (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --git-dir')) return '.git';
      if (cmd.includes('symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main';
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main';
      if (cmd.includes('diff')) return MOCK_DIFF_UPDATED;
      throw new Error(`Unexpected: ${cmd}`);
    };

    // Re-fetch the same review key
    const result2 = await fetchLocalBranch(
      store,
      'feature-branch',
      undefined,
      mockGitRunnerV2,
      result1.reviewKey,
    );
    expect(result2.reviewKey).toBe(result1.reviewKey);
    expect(result2.fileCount).toBe(3);

    const filesAfter = store.getFiles(result1.reviewKey);
    expect(filesAfter).toHaveLength(3);
  });
});
