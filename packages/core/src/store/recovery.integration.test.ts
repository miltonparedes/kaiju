import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDB, type KaijuDB } from './index.js';
import { KaijuStore, type CreateFileInput, type CreateReviewInput } from './kaijuStore.js';
import { rebuildIndex, regenerateFiles } from './recovery.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

let tempBase: string;
let store: KaijuStore;
let db: KaijuDB;

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

const PATCH_CONTENT = `diff --git a/src/auth/session.ts b/src/auth/session.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/session.ts
@@ -0,0 +1,5 @@
+export class SessionManager {}
`;

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), 'kaiju-recovery-test-'));
  db = createDB();
  store = new KaijuStore(db, tempBase);
});

afterEach(() => {
  store.close();
  rmSync(tempBase, { recursive: true, force: true });
});

// ─── Helper: populate a full review ─────────────────────────────────────────

async function populateFullReview() {
  const review = await store.createReview(makeReviewInput());
  await store.addFiles(review.key, makeFileInputs());
  await store.addImports(review.key, [
    { source: 'src/auth/session.ts', target: 'src/types/auth.ts' },
    { source: 'src/auth/middleware.ts', target: 'src/auth/session.ts' },
  ]);
  await store.addChunk(review.key, {
    slug: '001-auth-refactor',
    title: 'Auth system refactor',
    description: 'Migrates from JWT to session-based auth',
    reviewPriority: 'high',
    estimatedTokens: 2800,
    filePaths: ['src/auth/session.ts', 'src/auth/jwt.ts'],
    patchContent: PATCH_CONTENT,
  });
  await store.addChunk(review.key, {
    slug: '002-middleware',
    title: 'Middleware updates',
    description: 'Updated middleware',
    reviewPriority: 'medium',
    estimatedTokens: 500,
    filePaths: ['src/auth/middleware.ts'],
    patchContent:
      'diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts\n@@ -1,3 +1,5 @@\n+// updated\n',
  });
  await store.addComment(review.key, {
    threadId: 'gh-review-123',
    source: 'github',
    state: 'open',
    file: 'src/auth/session.ts',
    line: 45,
    body: 'This needs session rotation after role change',
    author: 'github:alice',
    timestamp: '2026-03-07T09:00:00Z',
    ghCommentId: 12345,
  });
  await store.addComment(review.key, {
    threadId: 'gh-review-123',
    source: 'github',
    state: 'open',
    file: 'src/auth/session.ts',
    line: 45,
    body: "Agreed, I'll fix this",
    author: 'github:bob',
    timestamp: '2026-03-07T09:15:00Z',
    ghCommentId: 12346,
  });
  await store.addFinding(review.key, {
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
    status: 'open',
    publish: false,
    inReplyTo: 'gh-review-123',
    timestamp: '2026-03-07T10:30:00Z',
  });

  // Update status to 'split'
  await store.updateReviewStatus(review.key, 'split');

  return review;
}

// ─── Snapshot helpers ───────────────────────────────────────────────────────

interface StoreSnapshot {
  reviews: ReturnType<KaijuStore['listReviews']>;
  files: ReturnType<KaijuStore['getFiles']>;
  imports: ReturnType<KaijuStore['getImports']>;
  chunks: ReturnType<KaijuStore['getChunks']>;
  comments: ReturnType<KaijuStore['getComments']>;
  findings: ReturnType<KaijuStore['getFindings']>;
}

function snapshotStore(s: KaijuStore, key: string): StoreSnapshot {
  return {
    reviews: s.listReviews(),
    files: s.getFiles(key),
    imports: s.getImports(key),
    chunks: s.getChunks(key),
    comments: s.getComments(key),
    findings: s.getFindings(key),
  };
}

// ─── VAL-STORE-007: rebuild-index reconstructs SQLite from files on disk ────

describe('rebuildIndex', () => {
  it('reconstructs SQLite from files when DB is empty', async () => {
    const review = await populateFullReview();
    const key = review.key;

    // Snapshot the original state
    const originalSnapshot = snapshotStore(store, key);

    // Close the original DB and create a fresh empty one
    store.close();
    const freshDb = createDB();
    const freshStore = new KaijuStore(freshDb, tempBase);

    // Verify the fresh DB is empty
    expect(freshStore.listReviews()).toHaveLength(0);

    // Run rebuild-index
    await rebuildIndex(freshDb, tempBase);

    // Verify all tables are repopulated
    const rebuiltSnapshot = snapshotStore(freshStore, key);

    // Reviews
    expect(rebuiltSnapshot.reviews).toHaveLength(originalSnapshot.reviews.length);
    expect(rebuiltSnapshot.reviews[0]!.key).toBe(originalSnapshot.reviews[0]!.key);
    expect(rebuiltSnapshot.reviews[0]!.provider).toBe(originalSnapshot.reviews[0]!.provider);
    expect(rebuiltSnapshot.reviews[0]!.repo).toBe(originalSnapshot.reviews[0]!.repo);
    expect(rebuiltSnapshot.reviews[0]!.pr).toBe(originalSnapshot.reviews[0]!.pr);
    expect(rebuiltSnapshot.reviews[0]!.title).toBe(originalSnapshot.reviews[0]!.title);
    expect(rebuiltSnapshot.reviews[0]!.url).toBe(originalSnapshot.reviews[0]!.url);
    expect(rebuiltSnapshot.reviews[0]!.base).toBe(originalSnapshot.reviews[0]!.base);
    expect(rebuiltSnapshot.reviews[0]!.head).toBe(originalSnapshot.reviews[0]!.head);
    expect(rebuiltSnapshot.reviews[0]!.status).toBe(originalSnapshot.reviews[0]!.status);

    // Files
    expect(rebuiltSnapshot.files).toHaveLength(originalSnapshot.files.length);
    const rebuiltFilePaths = rebuiltSnapshot.files.map((f) => f.path).sort();
    const originalFilePaths = originalSnapshot.files.map((f) => f.path).sort();
    expect(rebuiltFilePaths).toEqual(originalFilePaths);

    // File statuses and stats
    for (const origFile of originalSnapshot.files) {
      const rebuiltFile = rebuiltSnapshot.files.find((f) => f.path === origFile.path);
      expect(rebuiltFile).toBeDefined();
      expect(rebuiltFile!.status).toBe(origFile.status);
      expect(rebuiltFile!.additions).toBe(origFile.additions);
      expect(rebuiltFile!.deletions).toBe(origFile.deletions);
    }

    // Imports
    expect(rebuiltSnapshot.imports).toHaveLength(originalSnapshot.imports.length);
    const rebuiltImportSources = rebuiltSnapshot.imports.map((i) => i.source).sort();
    const originalImportSources = originalSnapshot.imports.map((i) => i.source).sort();
    expect(rebuiltImportSources).toEqual(originalImportSources);

    // Chunks
    expect(rebuiltSnapshot.chunks).toHaveLength(originalSnapshot.chunks.length);
    const rebuiltChunkSlugs = rebuiltSnapshot.chunks.map((c) => c.slug).sort();
    const originalChunkSlugs = originalSnapshot.chunks.map((c) => c.slug).sort();
    expect(rebuiltChunkSlugs).toEqual(originalChunkSlugs);

    for (const origChunk of originalSnapshot.chunks) {
      const rebuiltChunk = rebuiltSnapshot.chunks.find((c) => c.slug === origChunk.slug);
      expect(rebuiltChunk).toBeDefined();
      expect(rebuiltChunk!.title).toBe(origChunk.title);
      expect(rebuiltChunk!.description).toBe(origChunk.description);
      expect(rebuiltChunk!.reviewPriority).toBe(origChunk.reviewPriority);
      expect(rebuiltChunk!.estimatedTokens).toBe(origChunk.estimatedTokens);
    }

    // Comments
    expect(rebuiltSnapshot.comments).toHaveLength(originalSnapshot.comments.length);
    const rebuiltCommentBodies = rebuiltSnapshot.comments.map((c) => c.body).sort();
    const originalCommentBodies = originalSnapshot.comments.map((c) => c.body).sort();
    expect(rebuiltCommentBodies).toEqual(originalCommentBodies);

    // Findings
    expect(rebuiltSnapshot.findings).toHaveLength(originalSnapshot.findings.length);
    expect(rebuiltSnapshot.findings[0]!.message).toBe(originalSnapshot.findings[0]!.message);
    expect(rebuiltSnapshot.findings[0]!.severity).toBe(originalSnapshot.findings[0]!.severity);
    expect(rebuiltSnapshot.findings[0]!.reviewer).toBe(originalSnapshot.findings[0]!.reviewer);

    freshStore.close();
  });

  it('rebuilds FTS5 indexes correctly', async () => {
    await populateFullReview();

    // Close original and rebuild
    store.close();
    const freshDb = createDB();

    await rebuildIndex(freshDb, tempBase);

    // Search findings FTS — finding message contains "privilege escalation"
    const findingsResults = freshDb.all<{ message: string }>(
      sql`SELECT message FROM findings_fts WHERE findings_fts MATCH 'escalation'`,
    );
    expect(findingsResults.length).toBeGreaterThan(0);

    // Search comments FTS — comment body contains "session rotation"
    const commentsResults = freshDb.all<{ body: string }>(
      sql`SELECT body FROM comments_fts WHERE comments_fts MATCH 'session'`,
    );
    expect(commentsResults.length).toBeGreaterThan(0);

    freshDb.close();
  });

  it('correctly assigns files to chunks after rebuild', async () => {
    await populateFullReview();
    const key = 'github/acme/widgets/9999';

    // Get original file-chunk assignments
    const origFiles = store.getFiles(key);
    const origChunks = store.getChunks(key);
    const origAssignments = new Map<string, string>();
    for (const f of origFiles) {
      if (f.chunkId) {
        const chunk = origChunks.find((c) => c.id === f.chunkId);
        if (chunk) origAssignments.set(f.path, chunk.slug);
      }
    }

    // Rebuild
    store.close();
    const freshDb = createDB();
    await rebuildIndex(freshDb, tempBase);
    const freshStore = new KaijuStore(freshDb, tempBase);

    // Verify file-chunk assignments
    const rebuiltFiles = freshStore.getFiles(key);
    const rebuiltChunks = freshStore.getChunks(key);
    for (const f of rebuiltFiles) {
      if (f.chunkId) {
        const chunk = rebuiltChunks.find((c) => c.id === f.chunkId);
        expect(chunk).toBeDefined();
        const origSlug = origAssignments.get(f.path);
        expect(chunk!.slug).toBe(origSlug);
      }
    }

    freshStore.close();
  });

  it('handles multiple reviews', async () => {
    await populateFullReview();

    // Create a second review
    const review2 = await store.createReview(
      makeReviewInput({
        key: 'github/other/project/42',
        repo: 'other/project',
        pr: 42,
        title: 'Second PR',
      }),
    );
    await store.addFiles(review2.key, [
      { path: 'index.ts', status: 'modified', additions: 5, deletions: 3 },
    ]);

    // Rebuild
    store.close();
    const freshDb = createDB();
    await rebuildIndex(freshDb, tempBase);
    const freshStore = new KaijuStore(freshDb, tempBase);

    // Both reviews present
    const reviews = freshStore.listReviews();
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.key).sort()).toEqual([
      'github/acme/widgets/9999',
      'github/other/project/42',
    ]);

    freshStore.close();
  });

  it('handles empty review directories gracefully', async () => {
    await store.createReview(makeReviewInput());

    // Rebuild
    store.close();
    const freshDb = createDB();
    await rebuildIndex(freshDb, tempBase);
    const freshStore = new KaijuStore(freshDb, tempBase);

    const reviews = freshStore.listReviews();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.key).toBe('github/acme/widgets/9999');

    const files = freshStore.getFiles('github/acme/widgets/9999');
    expect(files).toHaveLength(0);

    freshStore.close();
  });
});

// ─── VAL-STORE-008: regenerate-files reconstructs disk files from SQLite ────

describe('regenerateFiles', () => {
  it('recreates full directory structure from SQLite', async () => {
    const review = await populateFullReview();
    const key = review.key;

    // Snapshot original disk files
    const reviewDir = join(tempBase, 'reviews', key);

    // Delete all files on disk
    rmSync(join(tempBase, 'reviews'), { recursive: true, force: true });
    expect(existsSync(join(tempBase, 'reviews'))).toBe(false);

    // Run regenerate-files
    await regenerateFiles(db, tempBase);

    // Verify directory structure is recreated
    expect(existsSync(reviewDir)).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks'))).toBe(true);
    expect(existsSync(join(reviewDir, 'comments'))).toBe(true);
    expect(existsSync(join(reviewDir, 'findings'))).toBe(true);

    // Verify manifest.json
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);
    expect(manifest.source.provider).toBe('github');
    expect(manifest.source.repo).toBe('acme/widgets');
    expect(manifest.source.pr).toBe(9999);
    expect(manifest.stats.total_files).toBe(3);
    expect(manifest.stats.total_chunks).toBe(2);
    expect(manifest.stats.total_comments).toBe(2);
    expect(manifest.stats.total_findings).toBe(1);

    // Verify files.json
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);
    const filesContent = await readFile(join(reviewDir, 'files.json'), 'utf-8');
    const filesJson = JSON.parse(filesContent);
    expect(filesJson.files).toHaveLength(3);
    expect(filesJson.imports).toHaveLength(2);

    // Verify chunk patch files
    expect(existsSync(join(reviewDir, 'chunks', '001-auth-refactor.patch'))).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks', '002-middleware.patch'))).toBe(true);

    // Verify chunk meta files
    expect(existsSync(join(reviewDir, 'chunks', '001-auth-refactor.meta.json'))).toBe(true);
    const metaContent = await readFile(
      join(reviewDir, 'chunks', '001-auth-refactor.meta.json'),
      'utf-8',
    );
    const meta = JSON.parse(metaContent);
    expect(meta.id).toBe('001-auth-refactor');
    expect(meta.files).toHaveLength(2);

    // Verify comment files
    expect(existsSync(join(reviewDir, 'comments', 'gh-review-123.json'))).toBe(true);
    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-123.json'),
      'utf-8',
    );
    const commentFile = JSON.parse(commentContent);
    expect(commentFile.thread_id).toBe('gh-review-123');
    expect(commentFile.messages).toHaveLength(2);

    // Verify finding files exist
    const findingsDir = join(reviewDir, 'findings');
    const findingFiles = readdirSync(findingsDir);
    expect(findingFiles.length).toBeGreaterThan(0);
  });

  it('regenerated files are semantically equivalent to originals', async () => {
    const review = await populateFullReview();
    const key = review.key;
    const reviewDir = join(tempBase, 'reviews', key);

    // Snapshot originals
    const originalManifest = JSON.parse(await readFile(join(reviewDir, 'manifest.json'), 'utf-8'));
    const originalFiles = JSON.parse(await readFile(join(reviewDir, 'files.json'), 'utf-8'));

    // Delete and regenerate
    rmSync(join(tempBase, 'reviews'), { recursive: true, force: true });
    await regenerateFiles(db, tempBase);

    // Compare
    const regenManifest = JSON.parse(await readFile(join(reviewDir, 'manifest.json'), 'utf-8'));
    const regenFiles = JSON.parse(await readFile(join(reviewDir, 'files.json'), 'utf-8'));

    // Source and stats should match
    expect(regenManifest.source).toEqual(originalManifest.source);
    expect(regenManifest.stats).toEqual(originalManifest.stats);
    expect(regenManifest.version).toBe(originalManifest.version);

    // Files should match
    expect(regenFiles.files.length).toBe(originalFiles.files.length);
    const regenFilePaths = regenFiles.files.map((f: { path: string }) => f.path).sort();
    const origFilePaths = originalFiles.files.map((f: { path: string }) => f.path).sort();
    expect(regenFilePaths).toEqual(origFilePaths);
  });

  it('handles multiple reviews', async () => {
    await populateFullReview();
    const review2 = await store.createReview(
      makeReviewInput({
        key: 'github/other/project/42',
        repo: 'other/project',
        pr: 42,
        title: 'Second PR',
      }),
    );
    await store.addFiles(review2.key, [
      { path: 'index.ts', status: 'modified', additions: 5, deletions: 3 },
    ]);

    // Delete and regenerate
    rmSync(join(tempBase, 'reviews'), { recursive: true, force: true });
    await regenerateFiles(db, tempBase);

    // Both review directories recreated
    const dir1 = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const dir2 = join(tempBase, 'reviews', 'github/other/project/42');
    expect(existsSync(dir1)).toBe(true);
    expect(existsSync(dir2)).toBe(true);

    // Second review has files.json
    const filesContent = await readFile(join(dir2, 'files.json'), 'utf-8');
    const filesJson = JSON.parse(filesContent);
    expect(filesJson.files).toHaveLength(1);
    expect(filesJson.files[0].path).toBe('index.ts');
  });

  it('regenerates patch content from rawDiff stored in DB', async () => {
    await populateFullReview();
    const key = 'github/acme/widgets/9999';
    const reviewDir = join(tempBase, 'reviews', key);

    // Delete and regenerate
    rmSync(join(tempBase, 'reviews'), { recursive: true, force: true });
    await regenerateFiles(db, tempBase);

    // Patch should be restored (from rawDiff in review or from DB storage)
    expect(existsSync(join(reviewDir, 'chunks', '001-auth-refactor.patch'))).toBe(true);
  });
});

// ─── Round-trip: rebuild + regenerate ───────────────────────────────────────

describe('round-trip recovery', () => {
  it('rebuild → query → regenerate produces consistent results', async () => {
    const review = await populateFullReview();
    const key = review.key;
    const reviewDir = join(tempBase, 'reviews', key);

    // Snapshot original
    const originalSnapshot = snapshotStore(store, key);

    // Rebuild: close DB, create fresh, rebuild from files
    store.close();
    const freshDb = createDB();
    await rebuildIndex(freshDb, tempBase);
    const freshStore = new KaijuStore(freshDb, tempBase);

    // Delete files, regenerate from rebuilt DB
    rmSync(join(tempBase, 'reviews'), { recursive: true, force: true });
    await regenerateFiles(freshDb, tempBase);

    // Verify files exist
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);

    // Verify DB still has data
    const rebuiltSnapshot = snapshotStore(freshStore, key);
    expect(rebuiltSnapshot.files).toHaveLength(originalSnapshot.files.length);
    expect(rebuiltSnapshot.chunks).toHaveLength(originalSnapshot.chunks.length);

    freshStore.close();
  });
});
