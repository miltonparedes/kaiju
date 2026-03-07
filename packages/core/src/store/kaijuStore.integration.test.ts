import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDB } from './index.js';
import {
  KaijuStore,
  type CreateChunkInput,
  type CreateCommentInput,
  type CreateFileInput,
  type CreateFindingInput,
  type CreateImportInput,
  type CreateReviewInput,
} from './kaijuStore.js';

let tempBase: string;
let store: KaijuStore;

function makeReviewInput(overrides: Partial<CreateReviewInput> = {}): CreateReviewInput {
  return {
    key: 'github/acme/widgets/9999',
    provider: 'github',
    repo: 'acme/widgets',
    pr: 9999,
    title: 'Big PR',
    url: 'https://github.com/acme/widgets/pull/9999',
    base: 'main',
    head: 'feature/big-change',
    ...overrides,
  };
}

function makeFileInputs(): CreateFileInput[] {
  return [
    { path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 },
    { path: 'src/auth/jwt.ts', status: 'deleted', additions: 0, deletions: 85 },
    { path: 'src/auth/middleware.ts', status: 'modified', additions: 35, deletions: 12 },
  ];
}

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), 'kaiju-store-test-'));
  const db = createDB();
  store = new KaijuStore(db, tempBase);
});

afterEach(() => {
  store.close();
  rmSync(tempBase, { recursive: true, force: true });
});

// ─── VAL-STORE-004: Dual-layer write updates both files and SQLite ──────────

describe('dual-layer: createReview', () => {
  it('creates both directory structure and SQLite row', async () => {
    const review = await store.createReview(makeReviewInput());

    // SQLite layer
    expect(review.id).toBeGreaterThan(0);
    expect(review.key).toBe('github/acme/widgets/9999');
    expect(review.status).toBe('fetched');

    const dbReview = store.getReview('github/acme/widgets/9999');
    expect(dbReview).toBeDefined();
    expect(dbReview!.title).toBe('Big PR');

    // File layer
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    expect(existsSync(reviewDir)).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks'))).toBe(true);
    expect(existsSync(join(reviewDir, 'comments'))).toBe(true);
    expect(existsSync(join(reviewDir, 'findings'))).toBe(true);

    // manifest.json created
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);
    expect(manifest.source.provider).toBe('github');
    expect(manifest.source.repo).toBe('acme/widgets');
    expect(manifest.source.pr).toBe(9999);

    // files.json created (empty)
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);
    const filesContent = await readFile(join(reviewDir, 'files.json'), 'utf-8');
    const filesJson = JSON.parse(filesContent);
    expect(filesJson.files).toEqual([]);
  });
});

describe('dual-layer: addFiles', () => {
  it('adds files to both SQLite and files.json on disk', async () => {
    const review = await store.createReview(makeReviewInput());
    const fileInputs = makeFileInputs();

    const fileRows = await store.addFiles(review.key, fileInputs);

    // SQLite layer
    expect(fileRows).toHaveLength(3);
    const dbFiles = store.getFiles(review.key);
    expect(dbFiles).toHaveLength(3);
    expect(dbFiles.map((f) => f.path)).toContain('src/auth/session.ts');

    // File layer
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const filesContent = await readFile(join(reviewDir, 'files.json'), 'utf-8');
    const filesJson = JSON.parse(filesContent);
    expect(filesJson.files).toHaveLength(3);
    const filePaths = filesJson.files.map((f: { path: string }) => f.path);
    expect(filePaths).toContain('src/auth/session.ts');
    expect(filePaths).toContain('src/auth/jwt.ts');
    expect(filePaths).toContain('src/auth/middleware.ts');

    // manifest.json stats updated
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);
    expect(manifest.stats.total_files).toBe(3);
    expect(manifest.stats.total_additions).toBe(155);
    expect(manifest.stats.total_deletions).toBe(97);
  });
});

describe('dual-layer: addImports', () => {
  it('adds imports to both SQLite and files.json', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    const importInputs: CreateImportInput[] = [
      { source: 'src/auth/session.ts', target: 'src/types/auth.ts' },
      { source: 'src/auth/middleware.ts', target: 'src/auth/session.ts' },
    ];
    await store.addImports(review.key, importInputs);

    // SQLite layer
    const dbImports = store.getImports(review.key);
    expect(dbImports).toHaveLength(2);

    // File layer
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const filesContent = await readFile(join(reviewDir, 'files.json'), 'utf-8');
    const filesJson = JSON.parse(filesContent);
    expect(filesJson.imports).toHaveLength(2);
    const sources = filesJson.imports.map((i: { source: string }) => i.source);
    expect(sources).toContain('src/auth/session.ts');
    expect(sources).toContain('src/auth/middleware.ts');
  });
});

describe('dual-layer: addChunk', () => {
  it('creates chunk in SQLite and writes .meta.json on disk', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    const chunkInput: CreateChunkInput = {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: 'Migrates from JWT to session-based auth',
      reviewPriority: 'high',
      estimatedTokens: 2800,
      fileIds: [], // will assign by path
      filePaths: ['src/auth/session.ts', 'src/auth/jwt.ts'],
      patchContent: `diff --git a/src/auth/session.ts b/src/auth/session.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/session.ts
@@ -0,0 +1,5 @@
+export class SessionManager {}
`,
    };

    const chunk = await store.addChunk(review.key, chunkInput);

    // SQLite layer
    expect(chunk.id).toBeGreaterThan(0);
    expect(chunk.slug).toBe('001-auth-refactor');
    const dbChunks = store.getChunks(review.key);
    expect(dbChunks).toHaveLength(1);

    // Files assigned to chunk in SQLite
    const dbFiles = store.getFiles(review.key);
    const assignedFiles = dbFiles.filter((f) => f.chunkId === chunk.id);
    expect(assignedFiles).toHaveLength(2);

    // File layer - .patch
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    expect(existsSync(join(reviewDir, 'chunks', '001-auth-refactor.patch'))).toBe(true);

    // File layer - .meta.json
    expect(existsSync(join(reviewDir, 'chunks', '001-auth-refactor.meta.json'))).toBe(true);
    const metaContent = await readFile(
      join(reviewDir, 'chunks', '001-auth-refactor.meta.json'),
      'utf-8',
    );
    const meta = JSON.parse(metaContent);
    expect(meta.id).toBe('001-auth-refactor');
    expect(meta.title).toBe('Auth system refactor');
    expect(meta.files).toHaveLength(2);

    // manifest.json updated with chunk
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);
    expect(manifest.chunks).toHaveLength(1);
    expect(manifest.chunks[0].id).toBe('001-auth-refactor');
    expect(manifest.stats.total_chunks).toBe(1);
  });
});

describe('dual-layer: addComment', () => {
  it('creates comment in SQLite and writes comment JSON on disk', async () => {
    const review = await store.createReview(makeReviewInput());

    const commentInput: CreateCommentInput = {
      threadId: 'gh-review-123',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 45,
      body: 'This needs session rotation after role change',
      author: 'github:alice',
      timestamp: '2026-03-07T09:00:00Z',
    };

    const comment = await store.addComment(review.key, commentInput);

    // SQLite layer
    expect(comment.id).toBeGreaterThan(0);
    const dbComments = store.getComments(review.key);
    expect(dbComments).toHaveLength(1);
    expect(dbComments[0]!.body).toBe('This needs session rotation after role change');

    // File layer
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    expect(existsSync(join(reviewDir, 'comments', 'gh-review-123.json'))).toBe(true);
    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-123.json'),
      'utf-8',
    );
    const commentFile = JSON.parse(commentContent);
    expect(commentFile.thread_id).toBe('gh-review-123');
    expect(commentFile.messages).toHaveLength(1);
    expect(commentFile.messages[0].body).toBe('This needs session rotation after role change');

    // manifest.json stats updated
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);
    expect(manifest.stats.total_comments).toBe(1);
  });

  it('appends messages to existing comment thread', async () => {
    const review = await store.createReview(makeReviewInput());

    await store.addComment(review.key, {
      threadId: 'gh-review-123',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 45,
      body: 'First message',
      author: 'github:alice',
      timestamp: '2026-03-07T09:00:00Z',
    });

    await store.addComment(review.key, {
      threadId: 'gh-review-123',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 45,
      body: 'Second message',
      author: 'github:bob',
      timestamp: '2026-03-07T09:15:00Z',
    });

    // SQLite has 2 separate rows
    const dbComments = store.getComments(review.key);
    expect(dbComments).toHaveLength(2);

    // File layer has 1 file with 2 messages
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-123.json'),
      'utf-8',
    );
    const commentFile = JSON.parse(commentContent);
    expect(commentFile.messages).toHaveLength(2);
    expect(commentFile.messages[0].body).toBe('First message');
    expect(commentFile.messages[1].body).toBe('Second message');
  });
});

describe('dual-layer: addFinding', () => {
  it('creates finding in SQLite and writes finding JSON on disk', async () => {
    const review = await store.createReview(makeReviewInput());

    const findingInput: CreateFindingInput = {
      reviewer: 'claude-code',
      file: 'src/auth/session.ts',
      line: 45,
      endLine: 52,
      severity: 'critical',
      message: 'Session token is not rotated after privilege escalation',
      suggestion: 'Call rotateSession() after role change',
      codeSuggestion: 'await rotateSession(req.session);',
      rootCause:
        "When a user's role changes, the old session token remains valid with elevated privileges",
      impact: 'Privilege escalation vulnerability',
      timestamp: '2026-03-07T10:30:00Z',
    };

    const finding = await store.addFinding(review.key, findingInput);

    // SQLite layer
    expect(finding.id).toBeGreaterThan(0);
    const dbFindings = store.getFindings(review.key);
    expect(dbFindings).toHaveLength(1);
    expect(dbFindings[0]!.message).toBe('Session token is not rotated after privilege escalation');
    expect(dbFindings[0]!.severity).toBe('critical');

    // File layer
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const findingFiles = existsSync(join(reviewDir, 'findings'));
    expect(findingFiles).toBe(true);

    // manifest.json stats updated
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);
    expect(manifest.stats.total_findings).toBe(1);
  });
});

// ─── VAL-STORE-009: Empty review with zero files ────────────────────────────

describe('empty review', () => {
  it('creates a review with no files successfully', async () => {
    const review = await store.createReview(makeReviewInput());

    // SQLite layer
    expect(review).toBeDefined();
    const dbFiles = store.getFiles(review.key);
    expect(dbFiles).toEqual([]);

    // File layer
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const filesContent = await readFile(join(reviewDir, 'files.json'), 'utf-8');
    const filesJson = JSON.parse(filesContent);
    expect(filesJson.files).toEqual([]);

    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);
    expect(manifest.stats.total_files).toBe(0);
    expect(manifest.stats.total_additions).toBe(0);
    expect(manifest.stats.total_deletions).toBe(0);
    expect(manifest.stats.total_chunks).toBe(0);
  });
});

// ─── VAL-STORE-010: Files with special characters in paths ──────────────────

describe('special characters in file paths', () => {
  it('handles unicode, spaces, and parentheses in file paths', async () => {
    const review = await store.createReview(makeReviewInput());

    const files: CreateFileInput[] = [
      { path: 'src/日本語/file (copy).tsx', status: 'modified', additions: 10, deletions: 5 },
      { path: 'src/données/résumé.ts', status: 'added', additions: 20, deletions: 0 },
    ];

    await store.addFiles(review.key, files);

    // SQLite layer
    const dbFiles = store.getFiles(review.key);
    expect(dbFiles).toHaveLength(2);
    expect(dbFiles.map((f) => f.path)).toContain('src/日本語/file (copy).tsx');
    expect(dbFiles.map((f) => f.path)).toContain('src/données/résumé.ts');

    // File layer
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const filesContent = await readFile(join(reviewDir, 'files.json'), 'utf-8');
    const filesJson = JSON.parse(filesContent);
    const filePaths = filesJson.files.map((f: { path: string }) => f.path);
    expect(filePaths).toContain('src/日本語/file (copy).tsx');
    expect(filePaths).toContain('src/données/résumé.ts');
  });
});

// ─── VAL-STORE-011: Review status transitions ──────────────────────────────

describe('review lifecycle status tracking', () => {
  it('tracks status transitions: fetched → split → reviewed', async () => {
    const review = await store.createReview(makeReviewInput());
    expect(review.status).toBe('fetched');

    // Transition to split
    await store.updateReviewStatus(review.key, 'split');
    let dbReview = store.getReview(review.key);
    expect(dbReview!.status).toBe('split');

    // Transition to reviewed
    await store.updateReviewStatus(review.key, 'reviewed');
    dbReview = store.getReview(review.key);
    expect(dbReview!.status).toBe('reviewed');
  });
});

// ─── VAL-STORE-006: manifest.json stats are consistent ──────────────────────

describe('manifest stats consistency', () => {
  it('stats match actual data after full lifecycle', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    await store.addChunk(review.key, {
      slug: '001-auth',
      title: 'Auth',
      description: '',
      reviewPriority: 'high',
      estimatedTokens: 2000,
      filePaths: ['src/auth/session.ts', 'src/auth/jwt.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    await store.addComment(review.key, {
      threadId: 'gh-123',
      source: 'github',
      state: 'open',
      body: 'LGTM',
      author: 'github:alice',
      timestamp: '2026-03-07T10:00:00Z',
    });

    await store.addFinding(review.key, {
      reviewer: 'claude-code',
      file: 'src/auth/session.ts',
      line: 10,
      severity: 'suggestion',
      message: 'Add type annotation',
      timestamp: '2026-03-07T10:30:00Z',
    });

    // Verify manifest stats
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);

    expect(manifest.stats.total_files).toBe(3);
    expect(manifest.stats.total_additions).toBe(155);
    expect(manifest.stats.total_deletions).toBe(97);
    expect(manifest.stats.total_chunks).toBe(1);
    expect(manifest.stats.total_comments).toBe(1);
    expect(manifest.stats.total_findings).toBe(1);

    // Verify SQLite counts match
    const dbFiles = store.getFiles(review.key);
    expect(dbFiles).toHaveLength(manifest.stats.total_files);
    const dbChunks = store.getChunks(review.key);
    expect(dbChunks).toHaveLength(manifest.stats.total_chunks);
    const dbComments = store.getComments(review.key);
    expect(dbComments).toHaveLength(manifest.stats.total_comments);
    const dbFindings = store.getFindings(review.key);
    expect(dbFindings).toHaveLength(manifest.stats.total_findings);
  });
});

// ─── CRUD: delete operations ────────────────────────────────────────────────

describe('deleteReview', () => {
  it('removes review from SQLite and returns true', async () => {
    await store.createReview(makeReviewInput());
    const deleted = store.deleteReview('github/acme/widgets/9999');
    expect(deleted).toBe(true);

    const review = store.getReview('github/acme/widgets/9999');
    expect(review).toBeUndefined();
  });

  it('cascades deletes to all related entities', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());
    await store.addComment(review.key, {
      threadId: 'gh-123',
      source: 'github',
      state: 'open',
      body: 'Test',
      author: 'alice',
      timestamp: '2026-03-07T10:00:00Z',
    });
    await store.addFinding(review.key, {
      reviewer: 'claude-code',
      file: 'src/auth/session.ts',
      line: 1,
      severity: 'suggestion',
      message: 'Test',
      timestamp: '2026-03-07T10:30:00Z',
    });

    store.deleteReview(review.key);

    // All entities gone from SQLite
    expect(store.getFiles(review.key)).toEqual([]);
    expect(store.getComments(review.key)).toEqual([]);
    expect(store.getFindings(review.key)).toEqual([]);
  });
});

// ─── listReviews ────────────────────────────────────────────────────────────

describe('listReviews', () => {
  it('lists all reviews', async () => {
    await store.createReview(makeReviewInput({ key: 'github/acme/widgets/1', pr: 1 }));
    await store.createReview(makeReviewInput({ key: 'github/acme/widgets/2', pr: 2 }));

    const reviews = store.listReviews();
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.key)).toContain('github/acme/widgets/1');
    expect(reviews.map((r) => r.key)).toContain('github/acme/widgets/2');
  });
});

// ─── rawDiff storage ────────────────────────────────────────────────────────

describe('rawDiff', () => {
  it('stores raw diff in the review', async () => {
    const rawDiff = 'diff --git a/file.ts b/file.ts\n+hello\n';
    const review = await store.createReview(makeReviewInput({ rawDiff }));

    const dbReview = store.getReview(review.key);
    expect(dbReview!.rawDiff).toBe(rawDiff);
  });
});

// ─── Multiple PRs coexistence ───────────────────────────────────────────────

describe('multiple PRs coexistence', () => {
  it('creates and queries multiple reviews independently', async () => {
    await store.createReview(
      makeReviewInput({ key: 'github/acme/widgets/1', pr: 1, title: 'PR 1' }),
    );
    await store.createReview(
      makeReviewInput({ key: 'github/acme/widgets/2', pr: 2, title: 'PR 2' }),
    );

    await store.addFiles('github/acme/widgets/1', [
      { path: 'src/a.ts', status: 'added', additions: 10, deletions: 0 },
    ]);
    await store.addFiles('github/acme/widgets/2', [
      { path: 'src/b.ts', status: 'modified', additions: 5, deletions: 3 },
      { path: 'src/c.ts', status: 'deleted', additions: 0, deletions: 20 },
    ]);

    const files1 = store.getFiles('github/acme/widgets/1');
    expect(files1).toHaveLength(1);
    expect(files1[0]!.path).toBe('src/a.ts');

    const files2 = store.getFiles('github/acme/widgets/2');
    expect(files2).toHaveLength(2);
  });
});

// ─── setRawDiff ─────────────────────────────────────────────────────────────

describe('setRawDiff', () => {
  it('stores and retrieves raw diff', async () => {
    const review = await store.createReview(makeReviewInput());
    const diff = 'diff --git a/file.ts b/file.ts\n+new line\n';
    store.setRawDiff(review.key, diff);

    const dbReview = store.getReview(review.key);
    expect(dbReview!.rawDiff).toBe(diff);
  });
});

// ─── VAL-STORE-005: Full directory structure matches spec ───────────────────

describe('full directory structure matches spec', () => {
  it('creates spec-compliant directory structure after full lifecycle', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: 'Migrates from JWT to session-based auth',
      reviewPriority: 'high',
      estimatedTokens: 2800,
      filePaths: ['src/auth/session.ts', 'src/auth/jwt.ts'],
      patchContent: `diff --git a/src/auth/session.ts b/src/auth/session.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/session.ts
@@ -0,0 +1,5 @@
+export class SessionManager {}
`,
    });

    await store.addComment(review.key, {
      threadId: 'gh-review-123',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 45,
      body: 'LGTM',
      author: 'github:alice',
      timestamp: '2026-03-07T10:00:00Z',
    });

    await store.addFinding(review.key, {
      reviewer: 'claude-code',
      file: 'src/auth/session.ts',
      line: 5,
      severity: 'suggestion',
      message: 'Consider adding type annotation',
      timestamp: '2026-03-07T10:30:00Z',
    });

    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');

    // Verify all expected files exist
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks', '001-auth-refactor.patch'))).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks', '001-auth-refactor.meta.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'comments', 'gh-review-123.json'))).toBe(true);

    // Finding file exists (named by ID pattern)
    const findingsDir = join(reviewDir, 'findings');
    expect(existsSync(findingsDir)).toBe(true);

    // Validate all JSON files are valid
    for (const file of ['manifest.json', 'files.json']) {
      const content = await readFile(join(reviewDir, file), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    }

    const metaContent = await readFile(
      join(reviewDir, 'chunks', '001-auth-refactor.meta.json'),
      'utf-8',
    );
    expect(() => JSON.parse(metaContent)).not.toThrow();

    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-123.json'),
      'utf-8',
    );
    expect(() => JSON.parse(commentContent)).not.toThrow();

    // Validate .patch starts with diff header
    const patchContent = await readFile(
      join(reviewDir, 'chunks', '001-auth-refactor.patch'),
      'utf-8',
    );
    expect(patchContent).toContain('diff --git');
  });
});
