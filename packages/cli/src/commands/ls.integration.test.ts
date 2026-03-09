import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDB, fetchGitHubPR, KaijuStore, splitAndPersist } from '@kaiju/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatLsAllJson,
  formatLsAllTable,
  formatLsChunksJson,
  formatLsChunksTable,
  type LsAllEntry,
  type LsChunkEntry,
} from './ls.js';

describe('ls integration', () => {
  let tempDir: string;
  let store: KaijuStore;

  const sampleDiff = [
    'diff --git a/src/auth/session.ts b/src/auth/session.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/auth/session.ts',
    '@@ -0,0 +1,120 @@',
    ...Array.from({ length: 120 }, (_, i) => `+line ${i + 1}`),
    'diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts',
    'deleted file mode 100644',
    '--- a/src/auth/jwt.ts',
    '+++ /dev/null',
    '@@ -1,85 +0,0 @@',
    ...Array.from({ length: 85 }, (_, i) => `-line ${i + 1}`),
    'diff --git a/src/routes/api/users.ts b/src/routes/api/users.ts',
    '--- a/src/routes/api/users.ts',
    '+++ b/src/routes/api/users.ts',
    '@@ -1,30 +1,80 @@',
    ...Array.from({ length: 80 }, () => '+new line'),
    ...Array.from({ length: 30 }, () => '-old line'),
  ].join('\n');

  const mockGhRunner = (args: string[]): Promise<string> => {
    if (args[0] === 'pr' && args[1] === 'diff') {
      return Promise.resolve(sampleDiff);
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return Promise.resolve(
        JSON.stringify({
          title: 'Migrate auth',
          number: 9999,
          baseRefName: 'main',
          headRefName: 'feature/auth',
          url: 'https://github.com/org/repo/pull/9999',
        }),
      );
    }
    return Promise.resolve('[]');
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kaiju-cli-ls-'));
    const db = createDB(':memory:');
    store = new KaijuStore(db, tempDir);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('ls shows chunk id, diff stats, token estimate, status for each chunk', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    const allChunks = store.getChunks(reviewKey);
    const allFiles = store.getFiles(reviewKey);

    const chunkFileStats = new Map<number, { additions: number; deletions: number }>();
    for (const file of allFiles) {
      if (file.chunkId != null) {
        const existing = chunkFileStats.get(file.chunkId) ?? { additions: 0, deletions: 0 };
        existing.additions += file.additions;
        existing.deletions += file.deletions;
        chunkFileStats.set(file.chunkId, existing);
      }
    }

    const entries: LsChunkEntry[] = allChunks.map((c) => {
      const stats = chunkFileStats.get(c.id) ?? { additions: 0, deletions: 0 };
      return {
        id: c.slug,
        additions: stats.additions,
        deletions: stats.deletions,
        estimatedTokens: c.estimatedTokens,
        status: c.status,
      };
    });

    const output = formatLsChunksTable(entries);

    // Should contain each chunk ID
    for (const chunk of allChunks) {
      expect(output).toContain(chunk.slug);
    }

    // Should contain status
    expect(output).toContain('pending');

    // Should contain token estimates (at least one with ~)
    expect(output).toMatch(/~[\d.]+k? tok/);
  });

  it('ls --json outputs valid JSON with chunk data', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    const allChunks = store.getChunks(reviewKey);
    const allFiles = store.getFiles(reviewKey);

    const chunkFileStats = new Map<number, { additions: number; deletions: number }>();
    for (const file of allFiles) {
      if (file.chunkId != null) {
        const existing = chunkFileStats.get(file.chunkId) ?? { additions: 0, deletions: 0 };
        existing.additions += file.additions;
        existing.deletions += file.deletions;
        chunkFileStats.set(file.chunkId, existing);
      }
    }

    const entries: LsChunkEntry[] = allChunks.map((c) => {
      const stats = chunkFileStats.get(c.id) ?? { additions: 0, deletions: 0 };
      return {
        id: c.slug,
        additions: stats.additions,
        deletions: stats.deletions,
        estimatedTokens: c.estimatedTokens,
        status: c.status,
      };
    });

    const json = formatLsChunksJson(entries);
    const parsed = JSON.parse(json);

    expect(parsed.totalChunks).toBe(allChunks.length);
    expect(parsed.chunks).toBeInstanceOf(Array);
    expect(parsed.chunks.length).toBe(allChunks.length);

    for (const chunk of parsed.chunks) {
      expect(chunk.id).toBeTruthy();
      expect(typeof chunk.additions).toBe('number');
      expect(typeof chunk.deletions).toBe('number');
      expect(typeof chunk.estimatedTokens).toBe('number');
      expect(chunk.status).toBeTruthy();
    }
  });

  it('ls --all shows all reviews across repos with chunk count and state', async () => {
    // Fetch two different PRs
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey1 = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey1, { strategy: 'directory' });

    const mockGhRunner2 = (args: string[]): Promise<string> => {
      if (args[0] === 'pr' && args[1] === 'diff') {
        return Promise.resolve(sampleDiff);
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        return Promise.resolve(
          JSON.stringify({
            title: 'Add payment webhooks',
            number: 10001,
            baseRefName: 'main',
            headRefName: 'feature/payments',
            url: 'https://github.com/org/repo/pull/10001',
          }),
        );
      }
      return Promise.resolve('[]');
    };

    await fetchGitHubPR(store, 'org', 'repo', 10001, mockGhRunner2);

    const allReviews = store.listReviews();
    const entries: LsAllEntry[] = allReviews.map((review) => {
      const reviewChunks = store.getChunks(review.key);
      const reviewFiles = store.getFiles(review.key);
      const reviewedCount = reviewChunks.filter((c) => c.status === 'reviewed').length;

      return {
        key: review.key,
        repo: review.repo,
        pr: review.pr,
        chunkCount: reviewChunks.length,
        reviewedCount,
        totalChunks: reviewChunks.length,
        fileCount: reviewFiles.length,
        status: review.status,
      };
    });

    const output = formatLsAllTable(entries);

    // Should contain both reviews
    expect(output).toContain('org/repo#9999');
    expect(output).toContain('org/repo#10001');

    // First review (split) should show chunk count
    expect(output).toMatch(/\d+ chunks?/);

    // Second review (fetched) should show file count
    expect(output).toMatch(/\d+ files/);

    // Should show lifecycle state
    expect(output).toContain('split');
    expect(output).toContain('fetched');
  });

  it('ls --all --json outputs valid JSON with review data', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey1 = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey1, { strategy: 'directory' });

    const allReviews = store.listReviews();
    const entries: LsAllEntry[] = allReviews.map((review) => {
      const reviewChunks = store.getChunks(review.key);
      const reviewFiles = store.getFiles(review.key);
      const reviewedCount = reviewChunks.filter((c) => c.status === 'reviewed').length;

      return {
        key: review.key,
        repo: review.repo,
        pr: review.pr,
        chunkCount: reviewChunks.length,
        reviewedCount,
        totalChunks: reviewChunks.length,
        fileCount: reviewFiles.length,
        status: review.status,
      };
    });

    const json = formatLsAllJson(entries);
    const parsed = JSON.parse(json);

    expect(parsed.totalReviews).toBe(1);
    expect(parsed.reviews).toHaveLength(1);
    expect(parsed.reviews[0].key).toBe('github/org/repo/9999');
    expect(parsed.reviews[0].repo).toBe('org/repo');
    expect(parsed.reviews[0].pr).toBe(9999);
    expect(parsed.reviews[0].status).toBe('split');
    expect(parsed.reviews[0].chunkCount).toBeGreaterThan(0);
    expect(parsed.reviews[0].fileCount).toBe(3);
  });
});
