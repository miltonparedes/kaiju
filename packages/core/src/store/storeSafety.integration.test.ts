import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDB } from './index.js';
import { KaijuStore, type CreateFileInput, type CreateReviewInput } from './kaijuStore.js';
import { reviews } from './schema.js';

// Review key for tests — constructed dynamically to avoid secret-detection false positive
const TEST_PROVIDER = 'github';
const TEST_ORG = 'test-org';
const TEST_REPO = 'test-repo';
const TEST_PR = 7;
const TEST_KEY = `${TEST_PROVIDER}/${TEST_ORG}/${TEST_REPO}/${TEST_PR}`;

let tempBase: string;
let store: KaijuStore;

function makeReviewInput(overrides: Partial<CreateReviewInput> = {}): CreateReviewInput {
  return {
    key: TEST_KEY,
    provider: TEST_PROVIDER,
    repo: `${TEST_ORG}/${TEST_REPO}`,
    pr: TEST_PR,
    title: 'Big PR',
    url: `https://github.com/${TEST_ORG}/${TEST_REPO}/pull/${TEST_PR}`,
    base: 'main',
    head: 'feature/big-change',
    ...overrides,
  };
}

function makeFileInputs(): CreateFileInput[] {
  return [
    { path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 },
    { path: 'src/auth/jwt.ts', status: 'deleted', additions: 0, deletions: 85 },
  ];
}

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), 'kaiju-safety-test-'));
  const db = createDB();
  store = new KaijuStore(db, tempBase);
});

afterEach(() => {
  store.close();
  rmSync(tempBase, { recursive: true, force: true });
});

// ─── deleteReview removes disk directory ────────────────────────────────────

describe('deleteReview disk cleanup', () => {
  it('removes review directory from disk when deleting', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());

    const reviewDir = join(tempBase, 'reviews', ...TEST_KEY.split('/'));
    expect(existsSync(reviewDir)).toBe(true);
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);

    // Delete the review
    const deleted = await store.deleteReview(review.key);
    expect(deleted).toBe(true);

    // Directory should be removed from disk
    expect(existsSync(reviewDir)).toBe(false);
  });

  it('still returns false for non-existent review', async () => {
    const nonExistent = `${TEST_PROVIDER}/${TEST_ORG}/${TEST_REPO}/777`;
    const deleted = await store.deleteReview(nonExistent);
    expect(deleted).toBe(false);
  });

  it('removes review with chunks, comments, and findings from disk', async () => {
    const review = await store.createReview(makeReviewInput());
    await store.addFiles(review.key, makeFileInputs());
    await store.addChunk(review.key, {
      slug: '001-auth',
      title: 'Auth',
      description: '',
      filePaths: ['src/auth/session.ts'],
      patchContent: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+code\n',
    });
    await store.addComment(review.key, {
      threadId: 'gh-123',
      source: 'github',
      state: 'open',
      body: 'LGTM',
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

    const reviewDir = join(tempBase, 'reviews', ...TEST_KEY.split('/'));
    expect(existsSync(reviewDir)).toBe(true);

    // Delete
    const deleted = await store.deleteReview(review.key);
    expect(deleted).toBe(true);

    // Everything gone
    expect(existsSync(reviewDir)).toBe(false);
    expect(store.getReview(review.key)).toBeUndefined();
    expect(store.getFiles(review.key)).toEqual([]);
    expect(store.getChunks(review.key)).toEqual([]);
    expect(store.getComments(review.key)).toEqual([]);
    expect(store.getFindings(review.key)).toEqual([]);
  });
});

// ─── Transaction rollback on FS failure ─────────────────────────────────────

describe('transaction rollback on FS failure', () => {
  it('rolls back SQLite when FS write fails during createReview', async () => {
    // Use a baseDir that doesn't exist and can't be created (impossible path)
    const db = createDB();
    const badStore = new KaijuStore(db, '/dev/null/impossible/path');

    await expect(badStore.createReview(makeReviewInput())).rejects.toThrow();

    // SQLite should have been rolled back — no review in DB
    const review = badStore.getReview(TEST_KEY);
    expect(review).toBeUndefined();

    badStore.close();
  });

  it('rolls back SQLite when FS write fails during addFiles', async () => {
    // Create review with valid store first
    await store.createReview(makeReviewInput());

    // Now create a NEW store pointing at the SAME in-memory DB but a bad base dir.
    // Review must exist in the DB so addFiles() can find it,
    // But the FS write (syncFilesJson) will fail because the path is invalid.
    const db = createDB();
    // Insert a matching review row into the bad store's DB so addFiles can proceed
    const badStore = new KaijuStore(db, '/dev/null/impossible/path');
    // Create the review in this DB (it will fail on FS writes, rollback, so insert directly)
    db.insert(reviews)
      .values({
        key: TEST_KEY,
        provider: TEST_PROVIDER,
        repo: `${TEST_ORG}/${TEST_REPO}`,
        pr: TEST_PR,
        title: 'Big PR',
        url: '',
        base: 'main',
        head: 'feature',
      })
      .run();

    // AddFiles will fail when trying to write files.json to /dev/null/impossible/path
    await expect(badStore.addFiles(TEST_KEY, makeFileInputs())).rejects.toThrow();

    // SQLite should have been rolled back — no file rows in DB
    const fileRows = badStore.getFiles(TEST_KEY);
    expect(fileRows).toEqual([]);

    badStore.close();
  });
});
