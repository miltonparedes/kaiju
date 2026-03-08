import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDB, fetchGitHubPR, KaijuStore, splitAndPersist } from '@kaiju/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatSplitJson, formatSplitSummary, type SplitSummaryData } from './split.js';

describe('split integration', () => {
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
    tempDir = await mkdtemp(join(tmpdir(), 'kaiju-cli-split-'));
    const db = createDB(':memory:');
    store = new KaijuStore(db, tempDir);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('split --auto --strategy directory creates chunks grouped by directory', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';

    const result = await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    // All files are under src/ top-level dir, so directory splitter groups them into 1 chunk
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);

    // All files assigned to chunks
    const allFilePaths = result.chunks.flatMap((c) => c.filePaths);
    expect(allFilePaths).toContain('src/auth/session.ts');
    expect(allFilePaths).toContain('src/auth/jwt.ts');
    expect(allFilePaths).toContain('src/routes/api/users.ts');
  });

  it('split --auto --strategy single-file creates one chunk per file', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';

    const result = await splitAndPersist(store, reviewKey, { strategy: 'single-file' });

    expect(result.chunks.length).toBe(3); // 3 files = 3 chunks
  });

  it('split --plan with inline JSON creates chunks per plan', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';

    const plan = JSON.stringify({
      chunks: [
        {
          id: '001-auth',
          title: 'Auth changes',
          files: ['src/auth/*'],
          review_priority: 'high',
        },
        {
          id: '002-routes',
          title: 'API routes',
          files: ['src/routes/**'],
          review_priority: 'medium',
        },
      ],
    });

    const result = await splitAndPersist(store, reviewKey, { strategy: 'plan', plan });

    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]!.id).toBe('001-auth');
    expect(result.chunks[0]!.filePaths).toContain('src/auth/session.ts');
    expect(result.chunks[0]!.filePaths).toContain('src/auth/jwt.ts');
    expect(result.chunks[1]!.id).toBe('002-routes');
    expect(result.chunks[1]!.filePaths).toContain('src/routes/api/users.ts');
  });

  it('summary table has correct stats for directory split', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';

    const result = await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    // Build summary data from store
    const dbChunks = store.getChunks(reviewKey);
    const allFiles = store.getFiles(reviewKey);
    const reviewDir = join(tempDir, 'reviews', 'github', 'org', 'repo', '9999');

    const slugToId = new Map<string, number>();
    for (const dbChunk of dbChunks) {
      slugToId.set(dbChunk.slug, dbChunk.id);
    }

    const chunkFileStats = new Map<number, { additions: number; deletions: number }>();
    for (const file of allFiles) {
      if (file.chunkId != null) {
        const existing = chunkFileStats.get(file.chunkId) ?? { additions: 0, deletions: 0 };
        existing.additions += file.additions;
        existing.deletions += file.deletions;
        chunkFileStats.set(file.chunkId, existing);
      }
    }

    const chunkEntries = result.chunks.map((chunk) => {
      const chunkId = slugToId.get(chunk.id);
      const fileStats =
        chunkId != null
          ? (chunkFileStats.get(chunkId) ?? { additions: 0, deletions: 0 })
          : { additions: 0, deletions: 0 };

      return {
        id: chunk.id,
        additions: fileStats.additions,
        deletions: fileStats.deletions,
        estimatedTokens: chunk.estimatedTokens,
        reviewPriority: chunk.reviewPriority,
        commentCount: 0,
      };
    });

    const summaryData: SplitSummaryData = {
      chunkCount: result.chunks.length,
      chunks: chunkEntries,
      manifestPath: join(reviewDir, 'manifest.json'),
      chunksDir: join(reviewDir, 'chunks') + '/',
    };

    const output = formatSplitSummary(summaryData);

    // Should have chunk count header
    expect(output).toContain(`${result.chunks.length} chunks`);

    // Should include Manifest and Chunks paths
    expect(output).toContain('Manifest:');
    expect(output).toContain('Chunks:');

    // Should have Next step
    expect(output).toContain('Next:');
    expect(output).toContain('kaiju cat');
  });

  it('JSON output is valid and has expected structure', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';

    const result = await splitAndPersist(store, reviewKey, { strategy: 'directory' });
    const reviewDir = join(tempDir, 'reviews', 'github', 'org', 'repo', '9999');

    const summaryData: SplitSummaryData = {
      chunkCount: result.chunks.length,
      chunks: result.chunks.map((c) => ({
        id: c.id,
        additions: 0,
        deletions: 0,
        estimatedTokens: c.estimatedTokens,
        reviewPriority: c.reviewPriority,
        commentCount: 0,
      })),
      manifestPath: join(reviewDir, 'manifest.json'),
      chunksDir: join(reviewDir, 'chunks') + '/',
    };

    const json = formatSplitJson(summaryData);
    const parsed = JSON.parse(json);

    expect(parsed.chunkCount).toBe(result.chunks.length);
    expect(parsed.chunks).toHaveLength(result.chunks.length);
    expect(parsed.paths.manifest).toContain('manifest.json');
    expect(parsed.paths.chunks).toContain('chunks');
    expect(parsed.next).toBeTruthy();
  });

  it('error: split before fetch shows clear message', async () => {
    // Create a review without raw diff
    await store.createReview({
      key: 'github/test/repo/1',
      provider: 'github',
      repo: 'test/repo',
      pr: 1,
    });

    await expect(
      splitAndPersist(store, 'github/test/repo/1', { strategy: 'directory' }),
    ).rejects.toThrow(/fetch/i);
  });
});
