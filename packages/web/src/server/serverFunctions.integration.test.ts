import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, chunks as chunksTable, createDB } from '@kaiju/core';
import type { KaijuDB } from '@kaiju/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getChunkFromStore,
  getChunksFromStore,
  getCommentsFromStore,
  getDashboardReviewsFromStore,
  getFilesFromStore,
  getFindingsFromStore,
  getReviewFromStore,
} from './dataAccess.js';

// ─── Test helpers ────────────────────────────────────────────────────────────────

/**
 * Create a temporary KaijuStore for testing.
 * Returns the store and cleanup function.
 */
function createTestStore() {
  const dir = join(tmpdir(), `kaiju-web-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const db = createDB(':memory:');
  const store = new KaijuStore(db, dir);
  return {
    store,
    dir,
    db,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Populate a review with chunks, files, comments, and findings for testing.
 */
async function seedTestData(store: KaijuStore) {
  const review = await store.createReview({
    key: 'github/acme/widgets/42',
    provider: 'github',
    repo: 'acme/widgets',
    pr: 42,
    title: 'Add dark mode',
    url: 'https://github.com/acme/widgets/pull/42',
    base: 'main',
    head: 'feature/dark-mode',
    rawDiff: 'diff --git a/src/theme.ts b/src/theme.ts\n',
  });

  await store.addFiles('github/acme/widgets/42', [
    { path: 'src/theme.ts', status: 'modified', additions: 20, deletions: 5 },
    { path: 'src/colors.ts', status: 'added', additions: 30, deletions: 0 },
    { path: 'src/utils.ts', status: 'modified', additions: 3, deletions: 1 },
  ]);

  const chunk1 = await store.addChunk('github/acme/widgets/42', {
    slug: '001-theme',
    title: 'Theme changes',
    description: 'Dark mode theme implementation',
    reviewPriority: 'high',
    estimatedTokens: 500,
    filePaths: ['src/theme.ts', 'src/colors.ts'],
    patchContent: 'diff --git a/src/theme.ts b/src/theme.ts\n@@ -1,5 +1,20 @@\n',
  });

  const chunk2 = await store.addChunk('github/acme/widgets/42', {
    slug: '002-utils',
    title: 'Utility updates',
    description: 'Minor utility changes',
    reviewPriority: 'low',
    estimatedTokens: 100,
    filePaths: ['src/utils.ts'],
    patchContent: 'diff --git a/src/utils.ts b/src/utils.ts\n@@ -1,1 +1,3 @@\n',
  });

  await store.addComment('github/acme/widgets/42', {
    threadId: 'thread-1',
    source: 'github',
    state: 'open',
    chunkId: chunk1.id,
    file: 'src/theme.ts',
    line: 10,
    body: 'Should this use CSS variables?',
    author: 'reviewer1',
    timestamp: '2024-01-01T00:00:00Z',
  });

  await store.addFinding('github/acme/widgets/42', {
    chunkId: chunk1.id,
    reviewer: 'agent',
    file: 'src/theme.ts',
    line: 5,
    severity: 'suggestion',
    message: 'Consider using CSS custom properties',
    suggestion: 'Use var(--color-bg) instead of hardcoded values',
    rootCause: 'Hardcoded colors',
    impact: 'Reduces maintainability',
  });

  return { review, chunk1, chunk2 };
}

// ─── Tests for data-access functions used by server functions ─────────────────

describe('Data access: getDashboardReviewsFromStore', () => {
  let store: KaijuStore;
  let cleanup: () => void;

  beforeEach(() => {
    const ctx = createTestStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns empty array when no reviews exist', () => {
    const reviews = getDashboardReviewsFromStore(store);
    expect(reviews).toEqual([]);
  });

  it('enriches a review with file, chunk, and finding counts', async () => {
    await seedTestData(store);
    const reviews = getDashboardReviewsFromStore(store);
    expect(reviews).toHaveLength(1);

    const r = reviews[0]!;
    expect(r.key).toBe('github/acme/widgets/42');
    expect(r.fileCount).toBe(3);
    expect(r.chunkCount).toBe(2);
    expect(r.findingCount).toBe(1);
    expect(r.reviewedChunkCount).toBe(0);
    expect(r.title).toBe('Add dark mode');
  });

  it('tracks reviewed chunk count after marking chunk reviewed', async () => {
    await seedTestData(store);

    const chunks = store.getChunks('github/acme/widgets/42');
    const chunk = chunks[0]!;
    const db = (store as unknown as { db: KaijuDB }).db;
    db.update(chunksTable).set({ status: 'reviewed' }).where(eq(chunksTable.id, chunk.id)).run();

    const reviews = getDashboardReviewsFromStore(store);
    expect(reviews[0]!.reviewedChunkCount).toBe(1);
  });

  it('handles multiple reviews independently', async () => {
    await seedTestData(store);

    await store.createReview({
      key: 'github/acme/other/10',
      provider: 'github',
      repo: 'acme/other',
      pr: 10,
      title: 'Another PR',
    });

    const reviews = getDashboardReviewsFromStore(store);
    expect(reviews).toHaveLength(2);

    const first = reviews.find((r) => r.key === 'github/acme/widgets/42')!;
    const second = reviews.find((r) => r.key === 'github/acme/other/10')!;

    expect(first.fileCount).toBe(3);
    expect(first.chunkCount).toBe(2);
    expect(second.fileCount).toBe(0);
    expect(second.chunkCount).toBe(0);
  });
});

describe('Data access: getReviewFromStore', () => {
  let store: KaijuStore;
  let cleanup: () => void;

  beforeEach(() => {
    const ctx = createTestStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns review by key', async () => {
    await store.createReview({
      key: 'github/acme/widgets/42',
      provider: 'github',
      repo: 'acme/widgets',
      pr: 42,
      title: 'Test PR',
    });

    const review = getReviewFromStore(store, 'github/acme/widgets/42');
    expect(review.pr).toBe(42);
    expect(review.title).toBe('Test PR');
  });

  it('throws for missing key', () => {
    expect(() => getReviewFromStore(store, 'github/nonexistent/repo/999')).toThrow(
      'Review not found',
    );
  });
});

describe('Data access: getChunksFromStore / getChunkFromStore', () => {
  let store: KaijuStore;
  let cleanup: () => void;

  beforeEach(async () => {
    const ctx = createTestStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
    await seedTestData(store);
  });

  afterEach(() => {
    cleanup();
  });

  it('getChunksFromStore returns all chunks for a review', () => {
    const chunks = getChunksFromStore(store, 'github/acme/widgets/42');
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.slug)).toContain('001-theme');
    expect(chunks.map((c) => c.slug)).toContain('002-utils');
  });

  it('getChunksFromStore returns empty for missing review', () => {
    const chunks = getChunksFromStore(store, 'github/nonexistent/repo/999');
    expect(chunks).toEqual([]);
  });

  it('getChunkFromStore returns chunk with files', () => {
    const chunk = getChunkFromStore(store, 'github/acme/widgets/42', '001-theme');
    expect(chunk.title).toBe('Theme changes');
    expect(chunk.files).toHaveLength(2);
    expect(chunk.files.map((f) => f.path)).toContain('src/theme.ts');
    expect(chunk.files.map((f) => f.path)).toContain('src/colors.ts');
  });

  it('getChunkFromStore throws for missing chunk slug', () => {
    expect(() => getChunkFromStore(store, 'github/acme/widgets/42', 'nonexistent')).toThrow(
      'Chunk not found',
    );
  });
});

describe('Data access: getFindingsFromStore', () => {
  let store: KaijuStore;
  let cleanup: () => void;

  beforeEach(async () => {
    const ctx = createTestStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
    await seedTestData(store);
  });

  afterEach(() => {
    cleanup();
  });

  it('returns all findings for a review', () => {
    const findings = getFindingsFromStore(store, 'github/acme/widgets/42');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Consider using CSS custom properties');
  });

  it('filters by chunk slug', () => {
    const themeFindings = getFindingsFromStore(store, 'github/acme/widgets/42', '001-theme');
    expect(themeFindings).toHaveLength(1);

    const utilsFindings = getFindingsFromStore(store, 'github/acme/widgets/42', '002-utils');
    expect(utilsFindings).toHaveLength(0);
  });

  it('returns empty for nonexistent chunk slug', () => {
    const findings = getFindingsFromStore(store, 'github/acme/widgets/42', 'nonexistent');
    expect(findings).toEqual([]);
  });
});

describe('Data access: getCommentsFromStore', () => {
  let store: KaijuStore;
  let cleanup: () => void;

  beforeEach(async () => {
    const ctx = createTestStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
    await seedTestData(store);
  });

  afterEach(() => {
    cleanup();
  });

  it('returns all comments for a review', () => {
    const comments = getCommentsFromStore(store, 'github/acme/widgets/42');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe('Should this use CSS variables?');
  });

  it('filters by chunk slug', () => {
    const themeComments = getCommentsFromStore(store, 'github/acme/widgets/42', '001-theme');
    expect(themeComments).toHaveLength(1);

    const utilsComments = getCommentsFromStore(store, 'github/acme/widgets/42', '002-utils');
    expect(utilsComments).toHaveLength(0);
  });

  it('returns empty for nonexistent chunk slug', () => {
    const comments = getCommentsFromStore(store, 'github/acme/widgets/42', 'nonexistent');
    expect(comments).toEqual([]);
  });
});

describe('Data access: getFilesFromStore', () => {
  let store: KaijuStore;
  let cleanup: () => void;

  beforeEach(async () => {
    const ctx = createTestStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
    await seedTestData(store);
  });

  afterEach(() => {
    cleanup();
  });

  it('returns all files for a review', () => {
    const files = getFilesFromStore(store, 'github/acme/widgets/42');
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toContain('src/theme.ts');
    expect(files.map((f) => f.path)).toContain('src/colors.ts');
    expect(files.map((f) => f.path)).toContain('src/utils.ts');
  });

  it('returns empty for missing review', () => {
    const files = getFilesFromStore(store, 'github/nonexistent/repo/999');
    expect(files).toEqual([]);
  });
});

describe('Cross-layer consistency: CLI writes, data access functions read', () => {
  let store: KaijuStore;
  let cleanup: () => void;

  beforeEach(async () => {
    const ctx = createTestStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
    await seedTestData(store);
  });

  afterEach(() => {
    cleanup();
  });

  it('review data from getReviewFromStore matches expected fields', () => {
    const review = getReviewFromStore(store, 'github/acme/widgets/42');
    expect(review.key).toBe('github/acme/widgets/42');
    expect(review.provider).toBe('github');
    expect(review.repo).toBe('acme/widgets');
    expect(review.pr).toBe(42);
    expect(review.title).toBe('Add dark mode');
    expect(review.status).toBe('split');
  });

  it('chunks from getChunkFromStore include all expected data fields', () => {
    const chunk = getChunkFromStore(store, 'github/acme/widgets/42', '001-theme');
    expect(chunk.title).toBe('Theme changes');
    expect(chunk.description).toBe('Dark mode theme implementation');
    expect(chunk.reviewPriority).toBe('high');
    expect(chunk.estimatedTokens).toBe(500);
    expect(chunk.status).toBe('pending');
    expect(chunk.patch).toContain('diff --git');
  });

  it('files are correctly associated with chunks via getChunkFromStore', () => {
    const themeChunk = getChunkFromStore(store, 'github/acme/widgets/42', '001-theme');
    const utilsChunk = getChunkFromStore(store, 'github/acme/widgets/42', '002-utils');

    expect(themeChunk.files).toHaveLength(2);
    expect(utilsChunk.files).toHaveLength(1);
    expect(utilsChunk.files[0]!.path).toBe('src/utils.ts');
  });

  it('findings are correctly filtered by chunk via getFindingsFromStore', () => {
    const themeFindings = getFindingsFromStore(store, 'github/acme/widgets/42', '001-theme');
    expect(themeFindings).toHaveLength(1);
    expect(themeFindings[0]!.severity).toBe('suggestion');
    expect(themeFindings[0]!.file).toBe('src/theme.ts');
    expect(themeFindings[0]!.line).toBe(5);
  });

  it('comments are correctly filtered by chunk via getCommentsFromStore', () => {
    const themeComments = getCommentsFromStore(store, 'github/acme/widgets/42', '001-theme');
    expect(themeComments).toHaveLength(1);
    expect(themeComments[0]!.author).toBe('reviewer1');
    expect(themeComments[0]!.file).toBe('src/theme.ts');
    expect(themeComments[0]!.line).toBe(10);
  });

  it('route parameter parsing works for review key construction', () => {
    const params = { provider: 'github', org: 'acme', repo: 'widgets', pr: '42' };
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    expect(reviewKey).toBe('github/acme/widgets/42');

    const review = getReviewFromStore(store, reviewKey);
    expect(review.pr).toBe(42);
  });
});
