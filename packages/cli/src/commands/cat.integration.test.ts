import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDB, fetchGitHubPR, KaijuStore, splitAndPersist } from '@kaiju/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatCatHeader, formatCatJson, formatCatMeta, type CatDisplayData } from './cat.js';

describe('cat integration', () => {
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
    tempDir = await mkdtemp(join(tmpdir(), 'kaiju-cli-cat-'));
    const db = createDB(':memory:');
    store = new KaijuStore(db, tempDir);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function fetchAndSplit(): Promise<string> {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewKey = 'github/org/repo/9999';
    await splitAndPersist(store, reviewKey, { strategy: 'directory' });
    return reviewKey;
  }

  function buildDisplayData(reviewKey: string, chunkSlug: string): CatDisplayData {
    const allChunks = store.getChunks(reviewKey);
    const chunk = allChunks.find((c) => c.slug === chunkSlug)!;
    const allFiles = store.getFiles(reviewKey);
    const chunkFiles = allFiles.filter((f) => f.chunkId === chunk.id);
    const allComments = store.getComments(reviewKey);
    const chunkComments = allComments.filter((c) => c.chunkId === chunk.id);
    const allFindings = store.getFindings(reviewKey);
    const chunkFindings = allFindings.filter((f) => f.chunkId === chunk.id);
    const reviewDir = join(tempDir, 'reviews', 'github', 'org', 'repo', '9999');

    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const f of chunkFiles) {
      totalAdditions += f.additions;
      totalDeletions += f.deletions;
    }

    return {
      id: chunk.slug,
      title: chunk.title,
      fileCount: chunkFiles.length,
      totalAdditions,
      totalDeletions,
      estimatedTokens: chunk.estimatedTokens,
      commentCount: chunkComments.length,
      comments: chunkComments.map((c) => ({
        threadId: c.threadId,
        file: c.file ?? null,
        line: c.line ?? null,
        author: c.author ?? null,
        body: c.body,
      })),
      findings: chunkFindings.map((f) => ({
        id: f.id,
        severity: f.severity,
        file: f.file,
        line: f.line ?? null,
        message: f.message,
      })),
      diff: chunk.patch ?? '',
      patchPath: join(reviewDir, 'chunks', `${chunk.slug}.patch`),
      metaPath: join(reviewDir, 'chunks', `${chunk.slug}.meta.json`),
      files: chunkFiles.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    };
  }

  it('cat displays chunk header with title, files, stats, tokens', async () => {
    const reviewKey = await fetchAndSplit();
    const allChunks = store.getChunks(reviewKey);
    const firstChunk = allChunks[0]!;

    const displayData = buildDisplayData(reviewKey, firstChunk.slug);
    const header = formatCatHeader(displayData);

    expect(header).toContain(firstChunk.slug);
    expect(header).toContain(firstChunk.title);
    expect(header).toContain('Patch:');
    expect(header).toContain('Meta:');
    expect(header).toContain('files');
    expect(header).toContain('tokens');
  });

  it('cat --meta shows metadata without diff', async () => {
    const reviewKey = await fetchAndSplit();
    const allChunks = store.getChunks(reviewKey);
    const firstChunk = allChunks[0]!;

    const displayData = buildDisplayData(reviewKey, firstChunk.slug);
    const meta = formatCatMeta(displayData);

    expect(meta).toContain(firstChunk.slug);
    expect(meta).toContain('Files:');
    // Should contain file paths but NOT the raw diff content (diff --git lines)
    expect(meta).not.toContain('diff --git');
  });

  it('cat --json outputs valid JSON with expected keys', async () => {
    const reviewKey = await fetchAndSplit();
    const allChunks = store.getChunks(reviewKey);
    const firstChunk = allChunks[0]!;

    const displayData = buildDisplayData(reviewKey, firstChunk.slug);
    const json = formatCatJson(displayData);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe(firstChunk.slug);
    expect(parsed.title).toBe(firstChunk.title);
    expect(parsed.files).toBeInstanceOf(Array);
    expect(parsed.diff).toBeDefined();
    expect(parsed.comments).toBeInstanceOf(Array);
    expect(parsed.findings).toBeInstanceOf(Array);
  });

  it('cat on nonexistent chunk: chunk not found in store', async () => {
    const reviewKey = await fetchAndSplit();
    const allChunks = store.getChunks(reviewKey);
    const existingIds = new Set(allChunks.map((c) => c.slug));

    // The chunk 'nonexistent-chunk' should not exist
    expect(existingIds.has('nonexistent-chunk')).toBe(false);
  });

  it('cat shows diff content for a chunk', async () => {
    const reviewKey = await fetchAndSplit();
    const allChunks = store.getChunks(reviewKey);

    // Find a chunk that has patch content
    const chunkWithPatch = allChunks.find((c) => c.patch && c.patch.length > 0);
    expect(chunkWithPatch).toBeDefined();

    const displayData = buildDisplayData(reviewKey, chunkWithPatch!.slug);

    // The diff should contain some content
    expect(displayData.diff.length).toBeGreaterThan(0);
  });

  it('cat with comments shows comment details in header', async () => {
    const reviewKey = await fetchAndSplit();

    // Add a comment to the review associated with a file in the first chunk
    const allChunks = store.getChunks(reviewKey);
    const firstChunk = allChunks[0]!;
    const allFiles = store.getFiles(reviewKey);
    const chunkFile = allFiles.find((f) => f.chunkId === firstChunk.id);

    if (chunkFile) {
      await store.addComment(reviewKey, {
        threadId: 'test-thread-1',
        source: 'github',
        chunkId: firstChunk.id,
        file: chunkFile.path,
        line: 10,
        body: 'Review comment',
        author: 'reviewer',
      });

      const displayData = buildDisplayData(reviewKey, firstChunk.slug);
      const header = formatCatHeader(displayData);

      expect(header).toContain('Comments:');
      expect(header).toContain('test-thread-1');
      expect(header).toContain(chunkFile.path);
      expect(header).toContain('    Review comment');
    }
  });

  it('cat with multiline comment body shows all lines indented', async () => {
    const reviewKey = await fetchAndSplit();
    const allChunks = store.getChunks(reviewKey);
    const firstChunk = allChunks[0]!;
    const allFiles = store.getFiles(reviewKey);
    const chunkFile = allFiles.find((f) => f.chunkId === firstChunk.id);

    if (chunkFile) {
      await store.addComment(reviewKey, {
        threadId: 'test-thread-ml',
        source: 'github',
        chunkId: firstChunk.id,
        file: chunkFile.path,
        line: 5,
        body: 'Line one\nLine two\nLine three',
        author: 'tester',
      });

      const displayData = buildDisplayData(reviewKey, firstChunk.slug);
      const header = formatCatHeader(displayData);

      expect(header).toContain('test-thread-ml');
      expect(header).toContain('    Line one');
      expect(header).toContain('    Line two');
      expect(header).toContain('    Line three');
    }
  });
});
