import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CommentFileJson, FilesJson, ManifestJson } from '../store/fileTypes.js';
import { createDB } from '../store/index.js';
import { KaijuStore } from '../store/kaijuStore.js';
import {
  type GhCliRunner,
  fetchGitHubPR,
  fetchLocalDiff,
  groupCommentsIntoThreads,
  parseGhPrViewJson,
} from './githubProvider.js';

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

const MOCK_PR_VIEW_JSON = JSON.stringify({
  title: 'Migrate auth to sessions',
  number: 9999,
  body: 'This PR migrates authentication from JWT tokens to session-based auth.',
  baseRefName: 'main',
  headRefName: 'feature/auth-sessions',
  url: 'https://github.com/acme/widgets/pull/9999',
});

const MOCK_PR_COMMENTS_JSON = JSON.stringify([
  {
    id: 101,
    path: 'src/auth/session.ts',
    line: 3,
    body: 'Consider using a secure random generator here.',
    user: { login: 'alice' },
    created_at: '2026-03-07T09:00:00Z',
    pull_request_review_id: 1001,
    in_reply_to_id: null,
  },
  {
    id: 102,
    path: 'src/auth/session.ts',
    line: 3,
    body: 'Agreed, I will switch to crypto.randomUUID()',
    user: { login: 'bob' },
    created_at: '2026-03-07T09:15:00Z',
    pull_request_review_id: 1001,
    in_reply_to_id: 101,
  },
  {
    id: 201,
    path: 'src/routes/api.ts',
    line: 5,
    body: 'Should we add validation middleware here?',
    user: { login: 'charlie' },
    created_at: '2026-03-07T10:00:00Z',
    pull_request_review_id: 1002,
    in_reply_to_id: null,
  },
]);

const MOCK_ISSUE_COMMENTS_JSON = JSON.stringify([
  {
    id: 301,
    body: 'Great PR overall, just a few comments inline.',
    user: { login: 'dave' },
    created_at: '2026-03-07T08:00:00Z',
  },
]);

// ─── Test setup ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let db: ReturnType<typeof createDB>;
let store: KaijuStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'kaiju-gh-'));
  db = createDB(':memory:');
  store = new KaijuStore(db, tmpDir);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── parseGhPrViewJson ─────────────────────────────────────────────────────────

describe('parseGhPrViewJson', () => {
  it('extracts title, body, base, head, url', () => {
    const result = parseGhPrViewJson(MOCK_PR_VIEW_JSON);
    expect(result.title).toBe('Migrate auth to sessions');
    expect(result.body).toBe(
      'This PR migrates authentication from JWT tokens to session-based auth.',
    );
    expect(result.base).toBe('main');
    expect(result.head).toBe('feature/auth-sessions');
    expect(result.url).toBe('https://github.com/acme/widgets/pull/9999');
  });
});

// ─── groupCommentsIntoThreads ───────────────────────────────────────────────────

describe('groupCommentsIntoThreads', () => {
  it('groups replies into the same thread', () => {
    const reviewComments = JSON.parse(MOCK_PR_COMMENTS_JSON);
    const issueComments = JSON.parse(MOCK_ISSUE_COMMENTS_JSON);
    const threads = groupCommentsIntoThreads(reviewComments, issueComments);

    // Should have 3 threads: 2 from review (thread with reply), 1 from issue
    // Actually: comment 101 and 102 share a thread, 201 is separate, and 301 is issue-level
    expect(threads.length).toBe(3);
  });

  it('preserves message order by timestamp within a thread', () => {
    const reviewComments = JSON.parse(MOCK_PR_COMMENTS_JSON);
    const threads = groupCommentsIntoThreads(reviewComments, []);

    const multiMessageThread = threads.find((t) => t.messages.length > 1);
    expect(multiMessageThread).toBeDefined();
    expect(multiMessageThread!.messages[0]!.author).toBe('github:alice');
    expect(multiMessageThread!.messages[1]!.author).toBe('github:bob');
  });

  it('sets file and line from the thread root comment', () => {
    const reviewComments = JSON.parse(MOCK_PR_COMMENTS_JSON);
    const threads = groupCommentsIntoThreads(reviewComments, []);

    const sessionThread = threads.find((t) => t.file === 'src/auth/session.ts');
    expect(sessionThread).toBeDefined();
    expect(sessionThread!.line).toBe(3);
  });

  it('issue-level comments have no file or line', () => {
    const issueComments = JSON.parse(MOCK_ISSUE_COMMENTS_JSON);
    const threads = groupCommentsIntoThreads([], issueComments);

    expect(threads.length).toBe(1);
    expect(threads[0]!.file).toBeNull();
    expect(threads[0]!.line).toBeNull();
  });
});

// ─── fetchGitHubPR (with mock gh CLI runner) ────────────────────────────────────

describe('fetchGitHubPR', () => {
  it('fetches diff, metadata, and comments and writes to store', async () => {
    const mockRunner: GhCliRunner = async (args: string[]) => {
      const command = args.join(' ');

      if (command.includes('pr diff')) {
        return MOCK_DIFF;
      }
      if (command.includes('pr view')) {
        return MOCK_PR_VIEW_JSON;
      }
      if (command.includes('pulls/9999/comments')) {
        return MOCK_PR_COMMENTS_JSON;
      }
      if (command.includes('issues/9999/comments')) {
        return MOCK_ISSUE_COMMENTS_JSON;
      }
      throw new Error(`Unexpected gh command: ${command}`);
    };

    await fetchGitHubPR(store, 'acme', 'widgets', 9999, mockRunner);

    // Verify review was created in SQLite
    const review = store.getReview('github/acme/widgets/9999');
    expect(review).toBeDefined();
    expect(review!.title).toBe('Migrate auth to sessions');
    expect(review!.provider).toBe('github');
    expect(review!.base).toBe('main');
    expect(review!.head).toBe('feature/auth-sessions');
    expect(review!.status).toBe('fetched');

    // Verify files were created
    const fileEntries = store.getFiles('github/acme/widgets/9999');
    expect(fileEntries).toHaveLength(2);
    const paths = fileEntries.map((f) => f.path).sort();
    expect(paths).toEqual(['src/auth/session.ts', 'src/routes/api.ts']);

    // Verify comments were created
    const commentRows = store.getComments('github/acme/widgets/9999');
    // 3 review comment messages (101, 102, 201) + 1 issue comment (301) = 4 rows
    expect(commentRows.length).toBe(4);

    // Verify files on disk
    const reviewDir = join(tmpDir, 'reviews', 'github', 'acme', 'widgets', '9999');
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);

    // Verify files.json content
    const filesJson: FilesJson = JSON.parse(await readFile(join(reviewDir, 'files.json'), 'utf-8'));
    expect(filesJson.files).toHaveLength(2);

    // Verify manifest.json content
    const manifest: ManifestJson = JSON.parse(
      await readFile(join(reviewDir, 'manifest.json'), 'utf-8'),
    );
    expect(manifest.source.provider).toBe('github');
    expect(manifest.source.repo).toBe('acme/widgets');
    expect(manifest.source.pr).toBe(9999);
    expect(manifest.source.title).toBe('Migrate auth to sessions');
    expect(manifest.stats.total_files).toBe(2);
    expect(manifest.stats.total_comments).toBe(4);

    // Verify raw.diff written
    expect(existsSync(join(reviewDir, 'raw.diff'))).toBe(true);
  });

  it('writes comment files with thread grouping', async () => {
    const mockRunner: GhCliRunner = async (args: string[]) => {
      const command = args.join(' ');
      if (command.includes('pr diff')) {
        return MOCK_DIFF;
      }
      if (command.includes('pr view')) {
        return MOCK_PR_VIEW_JSON;
      }
      if (command.includes('pulls/9999/comments')) {
        return MOCK_PR_COMMENTS_JSON;
      }
      if (command.includes('issues/9999/comments')) {
        return MOCK_ISSUE_COMMENTS_JSON;
      }
      throw new Error(`Unexpected: ${command}`);
    };

    await fetchGitHubPR(store, 'acme', 'widgets', 9999, mockRunner);

    const reviewDir = join(tmpDir, 'reviews', 'github', 'acme', 'widgets', '9999');
    const commentsDir = join(reviewDir, 'comments');
    expect(existsSync(commentsDir)).toBe(true);

    // The thread with 2 replies (101 + 102) should have 2 messages in one file
    // Find the thread file for the session.ts thread
    const { readdirSync } = await import('node:fs');
    const commentFiles = readdirSync(commentsDir).filter((f) => f.endsWith('.json'));
    expect(commentFiles.length).toBeGreaterThanOrEqual(2); // at least 2 thread files

    // Find the thread that has 2 messages
    let foundMultiMessage = false;
    for (const cf of commentFiles) {
      const content: CommentFileJson = JSON.parse(await readFile(join(commentsDir, cf), 'utf-8'));
      if (content.messages.length === 2) {
        foundMultiMessage = true;
        expect(content.file).toBe('src/auth/session.ts');
        expect(content.line).toBe(3);
        expect(content.messages[0]!.author).toBe('github:alice');
        expect(content.messages[1]!.author).toBe('github:bob');
      }
    }
    expect(foundMultiMessage).toBe(true);
  });
});

// ─── fetchLocalDiff (--diff flag) ───────────────────────────────────────────────

describe('fetchLocalDiff', () => {
  it('creates a review from a local patch file', async () => {
    // Write a diff file to tmpDir
    const { writeFile } = await import('node:fs/promises');
    const diffPath = join(tmpDir, 'changes.patch');
    await writeFile(diffPath, MOCK_DIFF, 'utf-8');

    await fetchLocalDiff(store, diffPath);

    // Verify review was created
    const allReviews = store.listReviews();
    expect(allReviews).toHaveLength(1);
    const review = allReviews[0]!;
    expect(review.provider).toBe('local');
    expect(review.status).toBe('fetched');

    // Verify files
    const fileEntries = store.getFiles(review.key);
    expect(fileEntries).toHaveLength(2);

    // Verify files on disk
    const reviewDir = join(tmpDir, 'reviews', 'local', 'local', 'patch', String(review.pr));
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'raw.diff'))).toBe(true);
  });

  it('stores correct file stats from local diff', async () => {
    const { writeFile } = await import('node:fs/promises');
    const diffPath = join(tmpDir, 'test.patch');
    await writeFile(diffPath, MOCK_DIFF, 'utf-8');

    await fetchLocalDiff(store, diffPath);

    const allReviews = store.listReviews();
    const review = allReviews[0]!;
    const fileEntries = store.getFiles(review.key);

    const session = fileEntries.find((f) => f.path === 'src/auth/session.ts');
    expect(session).toBeDefined();
    expect(session!.status).toBe('added');
    expect(session!.additions).toBe(5);

    const api = fileEntries.find((f) => f.path === 'src/routes/api.ts');
    expect(api).toBeDefined();
    expect(api!.status).toBe('modified');
    expect(api!.additions).toBe(3);
    expect(api!.deletions).toBe(1);
  });
});

// ─── Dual-layer consistency (VAL-FETCH-005) ─────────────────────────────────────

describe('dual-layer consistency after fetch', () => {
  it('files table count equals files.json entries', async () => {
    const mockRunner: GhCliRunner = async (args: string[]) => {
      const command = args.join(' ');
      if (command.includes('pr diff')) {
        return MOCK_DIFF;
      }
      if (command.includes('pr view')) {
        return MOCK_PR_VIEW_JSON;
      }
      if (command.includes('pulls/9999/comments')) {
        return MOCK_PR_COMMENTS_JSON;
      }
      if (command.includes('issues/9999/comments')) {
        return MOCK_ISSUE_COMMENTS_JSON;
      }
      throw new Error(`Unexpected: ${command}`);
    };

    await fetchGitHubPR(store, 'acme', 'widgets', 9999, mockRunner);

    const review = store.getReview('github/acme/widgets/9999');
    expect(review).toBeDefined();

    const dbFiles = store.getFiles('github/acme/widgets/9999');

    const reviewDir = join(tmpDir, 'reviews', 'github', 'acme', 'widgets', '9999');
    const filesJson: FilesJson = JSON.parse(await readFile(join(reviewDir, 'files.json'), 'utf-8'));

    expect(dbFiles.length).toBe(filesJson.files.length);
  });
});
