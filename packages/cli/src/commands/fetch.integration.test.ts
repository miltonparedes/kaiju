import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDB, KaijuStore, fetchGitHubPR, fetchLocalDiff, getReviewDir } from '@kaiju/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatFetchJson, formatFetchSummary } from './fetch.js';

describe('fetch integration', () => {
  let tempDir: string;
  let store: KaijuStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kaiju-cli-fetch-'));
    const db = createDB(':memory:');
    store = new KaijuStore(db, tempDir);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  const sampleDiff = [
    'diff --git a/src/auth/session.ts b/src/auth/session.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/auth/session.ts',
    '@@ -0,0 +1,120 @@',
    '+export class Session {}',
    '+export function createSession() {}',
    'diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts',
    'deleted file mode 100644',
    '--- a/src/auth/jwt.ts',
    '+++ /dev/null',
    '@@ -1,85 +0,0 @@',
    '-export class JWT {}',
    'diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts',
    '--- a/src/auth/middleware.ts',
    '+++ b/src/auth/middleware.ts',
    '@@ -1,12 +1,35 @@',
    '+import { Session } from "./session";',
    ' export function authMiddleware() {}',
    '-// old comment',
  ].join('\n');

  const mockGhRunner = (args: string[]): Promise<string> => {
    const command = args[0];
    if (command === 'pr' && args[1] === 'diff') {
      return Promise.resolve(sampleDiff);
    }
    if (command === 'pr' && args[1] === 'view') {
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
    // Review comments (file-level)
    if (command === 'api' && args[1]?.includes('/pulls/') && args[1]?.includes('/comments')) {
      return Promise.resolve(
        JSON.stringify([
          {
            id: 100,
            path: 'src/auth/session.ts',
            line: 45,
            body: 'This needs error handling',
            user: { login: 'reviewer1' },
            created_at: '2026-01-01T00:00:00Z',
            in_reply_to_id: null,
          },
        ]),
      );
    }
    // Issue-level comments — return empty
    if (command === 'api' && args[1]?.includes('/issues/') && args[1]?.includes('/comments')) {
      return Promise.resolve('[]');
    }
    return Promise.resolve('[]');
  };

  it('fetchGitHubPR writes to store and returns correct counts', async () => {
    const result = await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    expect(result.reviewKey).toBe('github/org/repo/9999');
    expect(result.fileCount).toBe(3);
    expect(result.commentCount).toBe(1);
  });

  it('formatFetchSummary matches CLI spec output format', async () => {
    const result = await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const fileEntries = store.getFiles(result.reviewKey);

    let totalAdd = 0;
    let totalDel = 0;
    for (const f of fileEntries) {
      totalAdd += f.additions;
      totalDel += f.deletions;
    }

    const reviewDir = getReviewDir(result.reviewKey, tempDir);
    const summary = formatFetchSummary({
      reviewKey: result.reviewKey,
      title: 'Migrate auth to sessions',
      fileCount: result.fileCount,
      totalAdditions: totalAdd,
      totalDeletions: totalDel,
      commentCount: result.commentCount,
      reviewDir,
    });

    // Check output matches spec: "Fetched org/repo #9999 — "title""
    expect(summary).toContain('Fetched org/repo #9999');
    expect(summary).toContain('Migrate auth to sessions');
    expect(summary).toContain('3 files');
    expect(summary).toContain(`${totalAdd}+`);
    expect(summary).toContain(`${totalDel}-`);
    expect(summary).toContain('1 comments');
    expect(summary).toContain('Files:');
    expect(summary).toContain('files.json');
    expect(summary).toContain('Comments:');
    expect(summary).toContain('comments');
    expect(summary).toContain('Next:');
  });

  it('fetchLocalDiff creates review from patch file', async () => {
    const patchPath = join(tempDir, 'changes.patch');
    await writeFile(patchPath, sampleDiff);

    const result = await fetchLocalDiff(store, patchPath);
    expect(result.fileCount).toBe(3);
    expect(result.reviewKey).toContain('local/');

    // Verify files stored correctly
    const fileEntries = store.getFiles(result.reviewKey);
    expect(fileEntries).toHaveLength(3);

    const sessionFile = fileEntries.find((f) => f.path === 'src/auth/session.ts');
    expect(sessionFile?.status).toBe('added');

    const jwtFile = fileEntries.find((f) => f.path === 'src/auth/jwt.ts');
    expect(jwtFile?.status).toBe('deleted');

    const mwFile = fileEntries.find((f) => f.path === 'src/auth/middleware.ts');
    expect(mwFile?.status).toBe('modified');
  });

  it('formatFetchJson includes all expected keys', async () => {
    const result = await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const reviewDir = getReviewDir(result.reviewKey, tempDir);

    const json = formatFetchJson({
      reviewKey: result.reviewKey,
      title: 'Migrate auth to sessions',
      fileCount: result.fileCount,
      totalAdditions: 3,
      totalDeletions: 2,
      commentCount: result.commentCount,
      reviewDir,
    });

    const parsed = JSON.parse(json);
    expect(parsed.reviewKey).toBe('github/org/repo/9999');
    expect(parsed.title).toBe('Migrate auth to sessions');
    expect(parsed.fileCount).toBe(3);
    expect(parsed.commentCount).toBe(1);
    expect(parsed.paths).toBeTruthy();
    expect(parsed.paths.files).toContain('files.json');
    expect(parsed.paths.comments).toContain('comments');
    expect(parsed.next).toBeTruthy();
  });
});
