import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDB, KaijuStore, fetchGitHubPR } from '@kaiju/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatFilesJson, formatFilesTable } from './files.js';

describe('files integration', () => {
  let tempDir: string;
  let store: KaijuStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kaiju-cli-files-'));
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
    ...Array.from({ length: 120 }, (_, i) => `+line ${i + 1}`),
    'diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts',
    'deleted file mode 100644',
    '--- a/src/auth/jwt.ts',
    '+++ /dev/null',
    '@@ -1,85 +0,0 @@',
    ...Array.from({ length: 85 }, (_, i) => `-line ${i + 1}`),
    'diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts',
    '--- a/src/auth/middleware.ts',
    '+++ b/src/auth/middleware.ts',
    '@@ -1,12 +1,35 @@',
    ...Array.from({ length: 35 }, () => '+new line'),
    ...Array.from({ length: 12 }, () => '-old line'),
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

  it('lists files with correct +N -N stats and change types', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const fileEntries = store.getFiles('github/org/repo/9999');

    const displayEntries = fileEntries.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    }));

    const output = formatFilesTable(displayEntries);

    // Check all files present
    expect(output).toContain('src/auth/session.ts');
    expect(output).toContain('src/auth/jwt.ts');
    expect(output).toContain('src/auth/middleware.ts');

    // Check stats
    expect(output).toContain('+120');
    expect(output).toContain('-0');
    expect(output).toContain('added');
    expect(output).toContain('+0');
    expect(output).toContain('-85');
    expect(output).toContain('deleted');
    expect(output).toContain('+35');
    expect(output).toContain('-12');
    expect(output).toContain('modified');

    // Check file count
    expect(output).toContain('3 files');
  });

  it('JSON output has valid structure', async () => {
    await fetchGitHubPR(store, 'org', 'repo', 9999, mockGhRunner);
    const fileEntries = store.getFiles('github/org/repo/9999');

    const displayEntries = fileEntries.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    }));

    const json = formatFilesJson(displayEntries);
    const parsed = JSON.parse(json);

    expect(parsed.totalFiles).toBe(3);
    expect(parsed.files).toHaveLength(3);

    const sessionFile = parsed.files.find(
      (f: { path: string }) => f.path === 'src/auth/session.ts',
    );
    expect(sessionFile.status).toBe('added');
    expect(sessionFile.additions).toBe(120);
    expect(sessionFile.deletions).toBe(0);
  });

  it('empty file list shows message', () => {
    const output = formatFilesTable([]);
    expect(output).toContain('No files');
  });
});
