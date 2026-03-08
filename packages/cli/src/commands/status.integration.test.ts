import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDB, fetchGitHubPR, KaijuStore, splitAndPersist } from '@kaiju/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatStatusJson, formatStatusSummary, type StatusDisplayData } from './status.js';

describe('status integration', () => {
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
          title: 'Migrate auth to sessions',
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
    tempDir = await mkdtemp(join(tmpdir(), 'kaiju-cli-status-'));
    const db = createDB(':memory:');
    store = new KaijuStore(db, tempDir);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildStatusData(reviewKey: string): StatusDisplayData {
    const review = store.getReview(reviewKey)!;
    const allFiles = store.getFiles(reviewKey);
    const allChunks = store.getChunks(reviewKey);
    const allComments = store.getComments(reviewKey);
    const allFindings = store.getFindings(reviewKey);

    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const f of allFiles) {
      totalAdditions += f.additions;
      totalDeletions += f.deletions;
    }

    const reviewedCount = allChunks.filter((c) => c.status === 'reviewed').length;

    const commentCountMap = new Map<number, number>();
    for (const comment of allComments) {
      if (comment.chunkId != null) {
        commentCountMap.set(comment.chunkId, (commentCountMap.get(comment.chunkId) ?? 0) + 1);
      }
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

    const highPriorityChunks = allChunks
      .filter((c) => c.reviewPriority === 'high')
      .map((c) => {
        const stats = chunkFileStats.get(c.id) ?? { additions: 0, deletions: 0 };
        return {
          id: c.slug,
          additions: stats.additions,
          deletions: stats.deletions,
          estimatedTokens: c.estimatedTokens,
          commentCount: commentCountMap.get(c.id) ?? 0,
        };
      });

    return {
      repo: review.repo,
      pr: review.pr,
      title: review.title,
      chunkCount: allChunks.length,
      fileCount: allFiles.length,
      totalAdditions,
      totalDeletions,
      reviewedCount,
      findingCount: allFindings.length,
      commentCount: allComments.length,
      highPriorityChunks,
    };
  }

  it('status shows PR title, chunk/file counts, diff stats after fetch and split', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    const data = buildStatusData(reviewKey);
    const output = formatStatusSummary(data);

    expect(output).toContain('org/repo');
    expect(output).toContain('#9999');
    expect(output).toContain('Migrate auth to sessions');
    expect(output).toContain('chunks');
    expect(output).toContain('3 files');
  });

  it('status --json outputs valid JSON with all fields', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    const data = buildStatusData(reviewKey);
    const json = formatStatusJson(data);
    const parsed = JSON.parse(json);

    expect(parsed.repo).toBe('org/repo');
    expect(parsed.pr).toBe(9999);
    expect(parsed.title).toBe('Migrate auth to sessions');
    expect(parsed.chunkCount).toBeGreaterThan(0);
    expect(parsed.fileCount).toBe(3);
    expect(parsed.totalAdditions).toBeGreaterThan(0);
    expect(parsed.totalDeletions).toBeGreaterThan(0);
    expect(parsed.reviewedCount).toBe(0);
    expect(parsed.findingCount).toBe(0);
    expect(parsed.commentCount).toBe(0);
    expect(parsed.highPriorityChunks).toBeInstanceOf(Array);
  });

  it('status shows finding and comment counts', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    // Add a comment and a finding
    const allChunks = store.getChunks(reviewKey);
    const firstChunk = allChunks[0]!;

    await store.addComment(reviewKey, {
      threadId: 'thread-1',
      chunkId: firstChunk.id,
      file: 'src/auth/session.ts',
      line: 10,
      body: 'Test comment',
      author: 'reviewer',
    });

    await store.addFinding(reviewKey, {
      chunkId: firstChunk.id,
      reviewer: 'claude',
      file: 'src/auth/session.ts',
      line: 15,
      severity: 'critical',
      message: 'Security issue',
    });

    const data = buildStatusData(reviewKey);
    const output = formatStatusSummary(data);

    expect(output).toContain('Findings: 1');
    expect(output).toContain('Comments: 1');
  });

  it('status shows review progress', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey, { strategy: 'directory' });

    const data = buildStatusData(reviewKey);

    // All chunks should be pending initially
    expect(data.reviewedCount).toBe(0);
    expect(data.chunkCount).toBeGreaterThan(0);

    const output = formatStatusSummary(data);
    expect(output).toContain(`0/${data.chunkCount}`);
  });
});
