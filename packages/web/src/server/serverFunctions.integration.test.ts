import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, chunks as chunksTable, createDB } from '@kaiju/core';
import type { KaijuDB } from '@kaiju/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

// ─── Tests for store-based server function logic ─────────────────────────────────

describe('Server function logic: reviews', () => {
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

  it('listReviews returns empty array when no reviews exist', () => {
    const reviews = store.listReviews();
    expect(reviews).toEqual([]);
  });

  it('listReviews returns all reviews', async () => {
    await store.createReview({
      key: 'github/acme/widgets/1',
      provider: 'github',
      repo: 'acme/widgets',
      pr: 1,
      title: 'PR 1',
    });
    await store.createReview({
      key: 'github/acme/widgets/2',
      provider: 'github',
      repo: 'acme/widgets',
      pr: 2,
      title: 'PR 2',
    });

    const reviews = store.listReviews();
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.pr)).toEqual([1, 2]);
  });

  it('getReview returns review by key', async () => {
    await store.createReview({
      key: 'github/acme/widgets/42',
      provider: 'github',
      repo: 'acme/widgets',
      pr: 42,
      title: 'Test PR',
    });

    const review = store.getReview('github/acme/widgets/42');
    expect(review).toBeDefined();
    expect(review!.pr).toBe(42);
    expect(review!.title).toBe('Test PR');
  });

  it('getReview returns undefined for missing key', () => {
    const review = store.getReview('github/nonexistent/repo/999');
    expect(review).toBeUndefined();
  });
});

describe('Server function logic: chunks', () => {
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

  it('getChunks returns all chunks for a review', () => {
    const chunks = store.getChunks('github/acme/widgets/42');
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.slug)).toContain('001-theme');
    expect(chunks.map((c) => c.slug)).toContain('002-utils');
  });

  it('getChunks returns empty for missing review', () => {
    const chunks = store.getChunks('github/nonexistent/repo/999');
    expect(chunks).toEqual([]);
  });

  it('getChunk returns chunk with files', () => {
    const chunks = store.getChunks('github/acme/widgets/42');
    const chunk = chunks.find((c) => c.slug === '001-theme');
    expect(chunk).toBeDefined();
    expect(chunk!.title).toBe('Theme changes');

    const allFiles = store.getFiles('github/acme/widgets/42');
    const chunkFiles = allFiles.filter((f) => f.chunkId === chunk!.id);
    expect(chunkFiles).toHaveLength(2);
    expect(chunkFiles.map((f) => f.path)).toContain('src/theme.ts');
    expect(chunkFiles.map((f) => f.path)).toContain('src/colors.ts');
  });

  it('markChunkReviewed updates chunk status', () => {
    const chunks = store.getChunks('github/acme/widgets/42');
    const chunk = chunks.find((c) => c.slug === '001-theme')!;

    expect(chunk.status).toBe('pending');

    // Simulate what markChunkReviewed does
    const db = (store as unknown as { db: KaijuDB }).db;
    db.update(chunksTable).set({ status: 'reviewed' }).where(eq(chunksTable.id, chunk.id)).run();

    const updated = store.getChunks('github/acme/widgets/42');
    const updatedChunk = updated.find((c) => c.slug === '001-theme')!;
    expect(updatedChunk.status).toBe('reviewed');
  });
});

describe('Server function logic: findings', () => {
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

  it('getFindings returns all findings for a review', () => {
    const findings = store.getFindings('github/acme/widgets/42');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Consider using CSS custom properties');
  });

  it('getFindings filters by chunk slug', () => {
    const allFindings = store.getFindings('github/acme/widgets/42');
    const chunks = store.getChunks('github/acme/widgets/42');
    const themeChunk = chunks.find((c) => c.slug === '001-theme')!;
    const utilsChunk = chunks.find((c) => c.slug === '002-utils')!;

    // Filter for theme chunk
    const themeFindings = allFindings.filter((f) => f.chunkId === themeChunk.id);
    expect(themeFindings).toHaveLength(1);

    // Filter for utils chunk
    const utilsFindings = allFindings.filter((f) => f.chunkId === utilsChunk.id);
    expect(utilsFindings).toHaveLength(0);
  });
});

describe('Server function logic: comments', () => {
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

  it('getComments returns all comments for a review', () => {
    const comments = store.getComments('github/acme/widgets/42');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe('Should this use CSS variables?');
  });

  it('getComments filters by chunk slug', () => {
    const allComments = store.getComments('github/acme/widgets/42');
    const chunks = store.getChunks('github/acme/widgets/42');
    const themeChunk = chunks.find((c) => c.slug === '001-theme')!;
    const utilsChunk = chunks.find((c) => c.slug === '002-utils')!;

    // Filter for theme chunk
    const themeComments = allComments.filter((c) => c.chunkId === themeChunk.id);
    expect(themeComments).toHaveLength(1);

    // Filter for utils chunk
    const utilsComments = allComments.filter((c) => c.chunkId === utilsChunk.id);
    expect(utilsComments).toHaveLength(0);
  });
});

describe('Cross-layer consistency: CLI writes, server functions read', () => {
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

  it('review data from store matches expected fields', () => {
    const review = store.getReview('github/acme/widgets/42');
    expect(review).toBeDefined();
    expect(review!.key).toBe('github/acme/widgets/42');
    expect(review!.provider).toBe('github');
    expect(review!.repo).toBe('acme/widgets');
    expect(review!.pr).toBe(42);
    expect(review!.title).toBe('Add dark mode');
    expect(review!.status).toBe('split');
  });

  it('chunks include all expected data fields', () => {
    const chunks = store.getChunks('github/acme/widgets/42');
    const chunk = chunks.find((c) => c.slug === '001-theme')!;
    expect(chunk.title).toBe('Theme changes');
    expect(chunk.description).toBe('Dark mode theme implementation');
    expect(chunk.reviewPriority).toBe('high');
    expect(chunk.estimatedTokens).toBe(500);
    expect(chunk.status).toBe('pending');
    expect(chunk.patch).toContain('diff --git');
  });

  it('files are correctly associated with chunks', () => {
    const chunks = store.getChunks('github/acme/widgets/42');
    const files = store.getFiles('github/acme/widgets/42');

    const themeChunk = chunks.find((c) => c.slug === '001-theme')!;
    const utilsChunk = chunks.find((c) => c.slug === '002-utils')!;

    const themeFiles = files.filter((f) => f.chunkId === themeChunk.id);
    const utilsFiles = files.filter((f) => f.chunkId === utilsChunk.id);

    expect(themeFiles).toHaveLength(2);
    expect(utilsFiles).toHaveLength(1);
    expect(utilsFiles[0]!.path).toBe('src/utils.ts');
  });

  it('findings are correctly associated with chunks', () => {
    const chunks = store.getChunks('github/acme/widgets/42');
    const findings = store.getFindings('github/acme/widgets/42');

    const themeChunk = chunks.find((c) => c.slug === '001-theme')!;
    const findingsForTheme = findings.filter((f) => f.chunkId === themeChunk.id);

    expect(findingsForTheme).toHaveLength(1);
    expect(findingsForTheme[0]!.severity).toBe('suggestion');
    expect(findingsForTheme[0]!.file).toBe('src/theme.ts');
    expect(findingsForTheme[0]!.line).toBe(5);
  });

  it('comments are correctly associated with chunks', () => {
    const chunks = store.getChunks('github/acme/widgets/42');
    const comments = store.getComments('github/acme/widgets/42');

    const themeChunk = chunks.find((c) => c.slug === '001-theme')!;
    const commentsForTheme = comments.filter((c) => c.chunkId === themeChunk.id);

    expect(commentsForTheme).toHaveLength(1);
    expect(commentsForTheme[0]!.author).toBe('reviewer1');
    expect(commentsForTheme[0]!.file).toBe('src/theme.ts');
    expect(commentsForTheme[0]!.line).toBe(10);
  });

  it('route parameter parsing works for review key construction', () => {
    // Simulate what route loaders do: construct key from URL params
    const params = { provider: 'github', org: 'acme', repo: 'widgets', pr: '42' };
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    expect(reviewKey).toBe('github/acme/widgets/42');

    const review = store.getReview(reviewKey);
    expect(review).toBeDefined();
    expect(review!.pr).toBe(42);
  });
});

// ─── Dashboard data enrichment ──────────────────────────────────────────────────

describe('Dashboard review enrichment', () => {
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
    const reviews = store.listReviews();
    expect(reviews).toEqual([]);
  });

  it('enriches a review with file, chunk, and finding counts', async () => {
    await seedTestData(store);
    const reviews = store.listReviews();
    expect(reviews).toHaveLength(1);

    const r = reviews[0]!;
    const files = store.getFiles(r.key);
    const chunks = store.getChunks(r.key);
    const findings = store.getFindings(r.key);
    const reviewedChunkCount = chunks.filter((c) => c.status === 'reviewed').length;

    expect(files.length).toBe(3);
    expect(chunks.length).toBe(2);
    expect(findings.length).toBe(1);
    expect(reviewedChunkCount).toBe(0);
  });

  it('tracks reviewed chunk count after marking chunk reviewed', async () => {
    await seedTestData(store);
    const chunks = store.getChunks('github/acme/widgets/42');
    const chunk = chunks[0]!;

    // Mark chunk as reviewed
    const db = (store as unknown as { db: KaijuDB }).db;
    db.update(chunksTable).set({ status: 'reviewed' }).where(eq(chunksTable.id, chunk.id)).run();

    const updatedChunks = store.getChunks('github/acme/widgets/42');
    const reviewedCount = updatedChunks.filter((c) => c.status === 'reviewed').length;
    expect(reviewedCount).toBe(1);
  });

  it('handles multiple reviews independently', async () => {
    await seedTestData(store); // github/acme/widgets/42

    await store.createReview({
      key: 'github/acme/other/10',
      provider: 'github',
      repo: 'acme/other',
      pr: 10,
      title: 'Another PR',
    });

    const reviews = store.listReviews();
    expect(reviews).toHaveLength(2);

    // Second review has no files/chunks/findings
    const files2 = store.getFiles('github/acme/other/10');
    const chunks2 = store.getChunks('github/acme/other/10');
    const findings2 = store.getFindings('github/acme/other/10');
    expect(files2.length).toBe(0);
    expect(chunks2.length).toBe(0);
    expect(findings2.length).toBe(0);

    // First review still has data
    const files1 = store.getFiles('github/acme/widgets/42');
    expect(files1.length).toBe(3);
  });
});
