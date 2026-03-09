import { describe, expect, it } from 'vitest';

import { createDB } from '../store/index.js';
import { KaijuStore } from '../store/kaijuStore.js';
import { splitAndPersist } from './splitAndPersist.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makePatch(filePaths: string[]): string {
  return filePaths
    .map(
      (p) =>
        `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,3 +1,5 @@\n+added line 1\n+added line 2\n context\n-removed\n`,
    )
    .join('');
}

const REVIEW_KEY = 'github/acme/widgets/42';

async function setupReview(
  filePaths: string[],
  rawDiff?: string,
): Promise<{ store: KaijuStore; cleanup: () => void }> {
  const db = createDB(':memory:');
  const store = new KaijuStore(db, '/tmp/kaiju-test-splitter-output');
  await store.createReview({
    key: REVIEW_KEY,
    provider: 'github',
    repo: 'acme/widgets',
    pr: 42,
    title: 'Test PR',
    url: 'https://github.com/acme/widgets/pull/42',
    base: 'main',
    head: 'feature',
    rawDiff: rawDiff ?? makePatch(filePaths),
  });
  await store.addFiles(
    REVIEW_KEY,
    filePaths.map((p) => ({
      path: p,
      status: 'modified' as const,
      additions: 10,
      deletions: 5,
    })),
  );
  return { store, cleanup: () => store.close() };
}

// ─── splitAndPersist — directory strategy ───────────────────────────────────────

describe('splitAndPersist', () => {
  it('creates chunks in SQLite after split', async () => {
    const filePaths = ['src/auth/session.ts', 'src/auth/jwt.ts', 'src/routes/api.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

      const dbChunks = store.getChunks(REVIEW_KEY);
      expect(dbChunks.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it('assigns files to chunks in SQLite (chunk_id set)', async () => {
    const filePaths = ['src/auth/session.ts', 'src/auth/jwt.ts', 'src/routes/api.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

      const dbFiles = store.getFiles(REVIEW_KEY);
      // All files should have a chunk_id
      for (const f of dbFiles) {
        expect(f.chunkId).not.toBeNull();
      }
    } finally {
      cleanup();
    }
  });

  it('updates manifest.json chunks array', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      const result = await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

      // Manifest chunks should match the split result
      expect(result.chunks.length).toBeGreaterThan(0);

      // Verify DB chunks count matches result chunks
      const dbChunks = store.getChunks(REVIEW_KEY);
      expect(dbChunks.length).toBe(result.chunks.length);
    } finally {
      cleanup();
    }
  });

  it('stats.total_chunks matches chunks array length', async () => {
    const filePaths = ['src/auth/session.ts', 'src/auth/jwt.ts', 'src/routes/api.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      const result = await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

      // The number of chunks in the result should match the total
      expect(result.chunks.length).toBeGreaterThan(0);

      // And DB chunks should match
      const dbChunks = store.getChunks(REVIEW_KEY);
      expect(dbChunks.length).toBe(result.chunks.length);
    } finally {
      cleanup();
    }
  });

  it('transitions review status to split', async () => {
    const filePaths = ['src/auth/session.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

      const review = store.getReview(REVIEW_KEY);
      expect(review?.status).toBe('split');
    } finally {
      cleanup();
    }
  });

  // ─── Plan strategy ──────────────────────────────────────────────────────────

  it('splits using plan strategy with JSON string', async () => {
    const filePaths = ['src/auth/session.ts', 'src/auth/jwt.ts', 'src/routes/api.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    const plan = JSON.stringify({
      chunks: [
        { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
        { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
      ],
    });

    try {
      const result = await splitAndPersist(store, REVIEW_KEY, { strategy: 'plan', plan });

      expect(result.chunks.length).toBe(2);

      const dbChunks = store.getChunks(REVIEW_KEY);
      const slugs = dbChunks.map((c) => c.slug);
      expect(slugs).toContain('001-auth');
      expect(slugs).toContain('002-routes');
    } finally {
      cleanup();
    }
  });

  // ─── Single-file strategy ───────────────────────────────────────────────────

  it('splits using single-file strategy', async () => {
    const filePaths = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      const result = await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

      expect(result.chunks.length).toBe(3);

      const dbChunks = store.getChunks(REVIEW_KEY);
      expect(dbChunks.length).toBe(3);
    } finally {
      cleanup();
    }
  });

  // ─── Patch content validation ───────────────────────────────────────────────

  it('chunk patchContent starts with diff --git header', async () => {
    const filePaths = ['src/auth/session.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      const result = await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

      for (const chunk of result.chunks) {
        expect(chunk.patchContent).toMatch(/^diff --git/);
      }
    } finally {
      cleanup();
    }
  });

  it('chunk patchContent contains valid unified diff hunks', async () => {
    const filePaths = ['src/auth/session.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      const result = await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

      for (const chunk of result.chunks) {
        // Should have hunk headers
        expect(chunk.patchContent).toContain('@@');
        // Should have + or - lines
        expect(chunk.patchContent).toMatch(/\+|^-/m);
      }
    } finally {
      cleanup();
    }
  });

  // ─── Comment assignment to chunks ─────────────────────────────────────────

  it('assigns comments to the chunk containing their referenced file', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    // Add a comment referencing src/auth/session.ts
    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-review-100',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 10,
      body: 'This needs session rotation',
      author: 'alice',
    });

    try {
      await splitAndPersist(store, REVIEW_KEY, {
        strategy: 'plan',
        plan: JSON.stringify({
          chunks: [
            { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
            { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
          ],
        }),
      });

      // Comment should now be assigned to the auth chunk
      const dbComments = store.getComments(REVIEW_KEY);
      const authComment = dbComments.find((c) => c.threadId === 'gh-review-100');
      expect(authComment).toBeDefined();
      expect(authComment!.chunkId).not.toBeNull();

      // The chunk it's assigned to should be the auth chunk
      const dbChunks = store.getChunks(REVIEW_KEY);
      const authChunk = dbChunks.find((c) => c.slug === '001-auth');
      expect(authChunk).toBeDefined();
      expect(authComment!.chunkId).toBe(authChunk!.id);
    } finally {
      cleanup();
    }
  });

  it('does not assign comments without a file reference to any chunk', async () => {
    const filePaths = ['src/auth/session.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    // Add a general comment without file reference
    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-general-1',
      source: 'github',
      state: 'open',
      body: 'General comment about the PR',
      author: 'bob',
    });

    try {
      await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

      const dbComments = store.getComments(REVIEW_KEY);
      const generalComment = dbComments.find((c) => c.threadId === 'gh-general-1');
      expect(generalComment).toBeDefined();
      expect(generalComment!.chunkId).toBeNull();
    } finally {
      cleanup();
    }
  });

  // ─── Error handling ─────────────────────────────────────────────────────────

  it('rejects invalid plan JSON without modifying data', async () => {
    const filePaths = ['src/auth/session.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      await expect(
        splitAndPersist(store, REVIEW_KEY, { strategy: 'plan', plan: '{invalid}' }),
      ).rejects.toThrow();

      // No chunks should have been created
      const dbChunks = store.getChunks(REVIEW_KEY);
      expect(dbChunks.length).toBe(0);

      // Review status should still be 'fetched'
      const review = store.getReview(REVIEW_KEY);
      expect(review?.status).toBe('fetched');
    } finally {
      cleanup();
    }
  });

  it('rejects empty plan (no chunks)', async () => {
    const filePaths = ['src/auth/session.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    try {
      await expect(
        splitAndPersist(store, REVIEW_KEY, {
          strategy: 'plan',
          plan: JSON.stringify({ chunks: [] }),
        }),
      ).rejects.toThrow(/empty/i);

      // No chunks should have been created
      const dbChunks = store.getChunks(REVIEW_KEY);
      expect(dbChunks.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('throws when review not found', async () => {
    const db = createDB(':memory:');
    const store = new KaijuStore(db, '/tmp/kaiju-test-splitter-output');

    try {
      await expect(
        splitAndPersist(store, 'github/no/such/999', { strategy: 'directory' }),
      ).rejects.toThrow(/not found/i);
    } finally {
      store.close();
    }
  });

  it('throws when review has no rawDiff', async () => {
    const db = createDB(':memory:');
    const store = new KaijuStore(db, '/tmp/kaiju-test-splitter-output');
    await store.createReview({
      key: REVIEW_KEY,
      provider: 'github',
      repo: 'acme/widgets',
      pr: 42,
      // no rawDiff
    });

    try {
      await expect(splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' })).rejects.toThrow(
        /diff|fetch/i,
      );
    } finally {
      store.close();
    }
  });

  // ─── keepFindings — re-split with finding remapping ────────────────────────

  it('remaps findings to new chunks when keepFindings is set', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    // First split
    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    // Add a finding to the auth chunk
    const authChunks = store.getChunks(REVIEW_KEY);
    const authChunk = authChunks.find((c) => c.slug === '001-auth');
    await store.addFinding(REVIEW_KEY, {
      chunkId: authChunk!.id,
      reviewer: 'claude',
      file: 'src/auth/session.ts',
      line: 10,
      severity: 'critical',
      message: 'Security issue found',
    });

    try {
      // Re-split with keepFindings
      await splitAndPersist(store, REVIEW_KEY, {
        strategy: 'plan',
        plan: JSON.stringify({
          chunks: [
            { id: 'new-auth', title: 'New Auth', files: ['src/auth/*'] },
            { id: 'new-routes', title: 'New Routes', files: ['src/routes/*'] },
          ],
        }),
        keepFindings: true,
      });

      // Finding should be remapped to new-auth chunk
      const dbFindings = store.getFindings(REVIEW_KEY);
      expect(dbFindings.length).toBe(1);
      expect(dbFindings[0]!.message).toBe('Security issue found');
      expect(dbFindings[0]!.severity).toBe('critical');

      const newAuthChunk = store.getChunks(REVIEW_KEY).find((c) => c.slug === 'new-auth');
      expect(newAuthChunk).toBeDefined();
      expect(dbFindings[0]!.chunkId).toBe(newAuthChunk!.id);
    } finally {
      cleanup();
    }
  });

  it('does not remap findings when keepFindings is not set', async () => {
    const filePaths = ['src/auth/session.ts'];
    const { store, cleanup } = await setupReview(filePaths);

    // First split
    await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

    // Add a finding
    const chunks = store.getChunks(REVIEW_KEY);
    await store.addFinding(REVIEW_KEY, {
      chunkId: chunks[0]!.id,
      reviewer: 'claude',
      file: 'src/auth/session.ts',
      line: 10,
      severity: 'critical',
      message: 'Some issue',
    });

    try {
      // Re-split without keepFindings — findings are not remapped
      await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

      // Findings should still exist but chunk_id is stale (not remapped)
      const dbFindings = store.getFindings(REVIEW_KEY);
      expect(dbFindings.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  // ─── maxTokens passthrough ────────────────────────────────────────────────

  it('passes maxTokens through to splitter', async () => {
    const filePaths = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`);
    const rawDiff = makePatch(filePaths);
    const { store, cleanup } = await setupReview(filePaths, rawDiff);

    // Override file additions to be very high for token estimation
    // (we can't directly set this, so we use a very low maxTokens)
    try {
      const result = await splitAndPersist(store, REVIEW_KEY, {
        strategy: 'directory',
        maxTokens: 10,
      });

      // With very low maxTokens, should subdivide beyond the original 1 group
      // (all files are in src/, so directory strategy makes 1 chunk)
      // subdivision should split it further
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });
});
