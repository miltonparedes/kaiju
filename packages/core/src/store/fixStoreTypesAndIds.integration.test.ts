import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDB } from './index.js';
import {
  KaijuStore,
  type CreateChunkInput,
  type CreateCommentInput,
  type CreateFileInput,
  type CreateFindingInput,
  type CreateReviewInput,
} from './kaijuStore.js';
import { regenerateFiles } from './recovery.js';

let tempBase: string;
let storeDb: ReturnType<typeof createDB>;
let store: KaijuStore;

// Review key used across tests (provider/org/repo/pr format)
const TEST_REVIEW_KEY = ['github', 'acme', 'widgets', '9999'].join('/');

function makeReviewInput(overrides: Partial<CreateReviewInput> = {}): CreateReviewInput {
  const reviewKey = TEST_REVIEW_KEY;
  return {
    key: reviewKey,
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
  tempBase = mkdtempSync(join(tmpdir(), 'kaiju-fix-test-'));
  storeDb = createDB();
  store = new KaijuStore(storeDb, tempBase);
});

afterEach(() => {
  store.close();
  rmSync(tempBase, { recursive: true, force: true });
});

// ─── Fix 1: createDB() creates tables for file-backed DBs ──────────────────

describe('Fix 1: file-backed DB table creation', () => {
  it('creates all tables for file-backed DB path', () => {
    const dbPath = join(tempBase, 'test.db');
    const fileDb = createDB(dbPath);

    // Query tables
    const tables = fileDb
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table'`)
      .map((r) => r.name);

    expect(tables).toContain('reviews');
    expect(tables).toContain('files');
    expect(tables).toContain('chunks');
    expect(tables).toContain('chunk_deps');
    expect(tables).toContain('comments');
    expect(tables).toContain('findings');
    expect(tables).toContain('imports');

    fileDb.close();
  });

  it('file-backed DB can perform full CRUD', async () => {
    const dbPath = join(tempBase, 'crud-test.db');
    const fileDb = createDB(dbPath);
    const fileStore = new KaijuStore(fileDb, tempBase);

    // Should not throw — tables exist
    const review = await fileStore.createReview(makeReviewInput());
    await fileStore.addFiles(review.key, makeFileInputs());

    const dbFiles = fileStore.getFiles(review.key);
    expect(dbFiles).toHaveLength(3);

    fileStore.close();
  });
});

// ─── Fix 3: addChunk() auto-transitions review status to 'split' ────────────

describe('Fix 3: addChunk auto-transitions status to split', () => {
  it('auto-transitions review status from fetched to split on first chunk', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    // Initially fetched
    expect(review.status).toBe('fetched');

    // Add a chunk
    await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: '',
      reviewPriority: 'high',
      estimatedTokens: 2800,
      filePaths: ['src/auth/session.ts', 'src/auth/jwt.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    // Status should now be 'split'
    const updatedReview = store.getReview(review.key);
    expect(updatedReview!.status).toBe('split');
  });

  it('status persists as split in manifest.json', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: '',
      reviewPriority: 'high',
      estimatedTokens: 2800,
      filePaths: ['src/auth/session.ts', 'src/auth/jwt.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // manifest.json should have status field set to 'split'
    expect(manifest.status).toBe('split');
  });

  it('does not downgrade status if already split', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    // First chunk — transitions to split
    await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: '',
      filePaths: ['src/auth/session.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    // Second chunk — should remain split
    await store.addChunk(review.key, {
      slug: '002-middleware',
      title: 'Middleware',
      description: '',
      filePaths: ['src/auth/middleware.ts'],
      patchContent: 'diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts\n+update\n',
    });

    const updatedReview = store.getReview(review.key);
    expect(updatedReview!.status).toBe('split');
  });
});

// ─── Fix 4: On-disk comment/finding files use chunk slugs, not numeric IDs ──

describe('Fix 4: chunk_id uses slug in on-disk files', () => {
  it('comment files write chunk slug instead of numeric ID', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    // Add a chunk first
    const chunk = await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: '',
      filePaths: ['src/auth/session.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    // Add comment referencing that chunk
    await store.addComment(review.key, {
      threadId: 'gh-review-100',
      source: 'github',
      state: 'open',
      chunkId: chunk.id, // numeric SQLite ID
      file: 'src/auth/session.ts',
      line: 10,
      body: 'Fix this',
      author: 'alice',
      timestamp: '2026-03-07T10:00:00Z',
    });

    // Read the on-disk comment file
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-100.json'),
      'utf-8',
    );
    const commentFile = JSON.parse(commentContent);

    // chunk_id should be the slug, not the numeric ID
    expect(commentFile.chunk_id).toBe('001-auth-refactor');
    // NOT the numeric ID:
    expect(commentFile.chunk_id).not.toBe(String(chunk.id));
  });

  it('finding files write chunk slug instead of numeric ID', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    // Add a chunk first
    const chunk = await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: '',
      filePaths: ['src/auth/session.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    // Add finding referencing that chunk
    await store.addFinding(review.key, {
      chunkId: chunk.id, // numeric SQLite ID
      reviewer: 'claude-code',
      file: 'src/auth/session.ts',
      line: 10,
      severity: 'critical',
      message: 'Session token not rotated',
      timestamp: '2026-03-07T10:30:00Z',
    });

    // Read the on-disk finding file
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const findingsDir = join(reviewDir, 'findings');
    const findingFileName = readdirSync(findingsDir).find((f) => f.endsWith('.json'));
    expect(findingFileName).toBeDefined();

    const findingContent = await readFile(join(findingsDir, findingFileName!), 'utf-8');
    const findingFile = JSON.parse(findingContent);

    // chunk_id should be the slug, not the numeric ID
    expect(findingFile.chunk_id).toBe('001-auth-refactor');
    expect(findingFile.chunk_id).not.toBe(String(chunk.id));
  });

  it('comment without chunkId writes null chunk_id on disk', async () => {
    const review = await store.createReview(makeReviewInput());

    await store.addComment(review.key, {
      threadId: 'gh-review-200',
      source: 'github',
      state: 'open',
      body: 'General comment',
      author: 'alice',
      timestamp: '2026-03-07T10:00:00Z',
    });

    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-200.json'),
      'utf-8',
    );
    const commentFile = JSON.parse(commentContent);
    expect(commentFile.chunk_id).toBeNull();
  });
});

// ─── Fix 4b: regenerateFiles uses chunk slugs ───────────────────────────────

describe('Fix 4b: regenerateFiles uses chunk slugs for comment/finding files', () => {
  it('regenerated comment files have chunk slug, not numeric ID', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    const chunk = await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: '',
      filePaths: ['src/auth/session.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    await store.addComment(review.key, {
      threadId: 'gh-review-100',
      source: 'github',
      state: 'open',
      chunkId: chunk.id,
      file: 'src/auth/session.ts',
      line: 10,
      body: 'Fix this',
      author: 'alice',
      timestamp: '2026-03-07T10:00:00Z',
    });

    // Delete disk files
    rmSync(join(tempBase, 'reviews'), { recursive: true, force: true });

    // Regenerate from DB
    await regenerateFiles(storeDb, tempBase);

    // Read regenerated comment file
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-100.json'),
      'utf-8',
    );
    const commentFile = JSON.parse(commentContent);

    // Should be slug, not numeric ID
    expect(commentFile.chunk_id).toBe('001-auth-refactor');
    expect(commentFile.chunk_id).not.toBe(String(chunk.id));
  });

  it('regenerated finding files have chunk slug, not numeric ID', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    const chunk = await store.addChunk(review.key, {
      slug: '001-auth-refactor',
      title: 'Auth system refactor',
      description: '',
      filePaths: ['src/auth/session.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });

    await store.addFinding(review.key, {
      chunkId: chunk.id,
      reviewer: 'claude-code',
      file: 'src/auth/session.ts',
      line: 10,
      severity: 'critical',
      message: 'Session token not rotated',
      timestamp: '2026-03-07T10:30:00Z',
    });

    // Delete disk files
    rmSync(join(tempBase, 'reviews'), { recursive: true, force: true });

    // Regenerate from DB
    await regenerateFiles(storeDb, tempBase);

    // Read regenerated finding file
    const reviewDir = join(tempBase, 'reviews', 'github/acme/widgets/9999');
    const findingsDir = join(reviewDir, 'findings');
    const findingFileName = readdirSync(findingsDir).find((f) => f.endsWith('.json'));
    expect(findingFileName).toBeDefined();

    const findingContent = await readFile(join(findingsDir, findingFileName!), 'utf-8');
    const findingFile = JSON.parse(findingContent);

    // Should be slug, not numeric ID
    expect(findingFile.chunk_id).toBe('001-auth-refactor');
    expect(findingFile.chunk_id).not.toBe(String(chunk.id));
  });
});
