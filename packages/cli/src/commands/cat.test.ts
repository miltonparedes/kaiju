import { describe, expect, it } from 'vitest';

import {
  catCommand,
  formatCatHeader,
  formatCatJson,
  formatCatMeta,
  type CatDisplayData,
} from './cat.js';

describe('cat command', () => {
  it('has the correct name', () => {
    expect(catCommand.name()).toBe('cat');
  });

  it('has a description', () => {
    expect(catCommand.description()).toBeTruthy();
  });

  it('accepts a required first argument (chunk-id or pr-ref)', () => {
    const args = catCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('chunk-id-or-pr-ref');
    expect(args[0]!.required).toBe(true);
  });

  it('accepts an optional second argument (chunk-id when pr-ref is first)', () => {
    const args = catCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(2);
    expect(args[1]!.name()).toBe('chunk-id');
    expect(args[1]!.required).toBe(false);
  });

  it('has a --json option', () => {
    expect(catCommand.options.some((o) => o.long === '--json')).toBe(true);
  });

  it('has a --meta option', () => {
    expect(catCommand.options.some((o) => o.long === '--meta')).toBe(true);
  });
});

describe('formatCatHeader', () => {
  const sampleData: CatDisplayData = {
    id: '001-auth-refactor',
    title: 'Auth system refactor',
    fileCount: 3,
    totalAdditions: 340,
    totalDeletions: 210,
    estimatedTokens: 2800,
    commentCount: 2,
    comments: [
      {
        threadId: 'gh-review-123',
        file: 'src/auth/session.ts',
        line: 45,
        author: 'reviewer1',
        body: 'Should rotate session',
      },
    ],
    findings: [],
    diff: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+line 1\n+line 2',
    patchPath: '/home/user/.kaiju/reviews/github/org/repo/9999/chunks/001-auth-refactor.patch',
    metaPath: '/home/user/.kaiju/reviews/github/org/repo/9999/chunks/001-auth-refactor.meta.json',
    files: [
      { path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 },
      { path: 'src/auth/jwt.ts', status: 'deleted', additions: 0, deletions: 85 },
      { path: 'src/auth/middleware.ts', status: 'modified', additions: 35, deletions: 12 },
    ],
  };

  it('includes chunk id and title', () => {
    const output = formatCatHeader(sampleData);
    expect(output).toContain('001-auth-refactor');
    expect(output).toContain('Auth system refactor');
  });

  it('includes file count', () => {
    const output = formatCatHeader(sampleData);
    expect(output).toContain('3 files');
  });

  it('includes diff stats', () => {
    const output = formatCatHeader(sampleData);
    expect(output).toContain('340+');
    expect(output).toContain('210-');
  });

  it('includes token estimate', () => {
    const output = formatCatHeader(sampleData);
    expect(output).toContain('2800 tokens');
  });

  it('includes comment count', () => {
    const output = formatCatHeader(sampleData);
    expect(output).toContain('2 comments');
  });

  it('includes Patch: and Meta: paths', () => {
    const output = formatCatHeader(sampleData);
    expect(output).toContain('Patch:');
    expect(output).toContain(sampleData.patchPath);
    expect(output).toContain('Meta:');
    expect(output).toContain(sampleData.metaPath);
  });

  it('includes comment details with body', () => {
    const output = formatCatHeader(sampleData);
    expect(output).toContain('gh-review-123');
    expect(output).toContain('src/auth/session.ts');
    expect(output).toContain('    Should rotate session');
  });

  it('indents multiline comment body', () => {
    const multilineData: CatDisplayData = {
      ...sampleData,
      comments: [
        {
          threadId: 'thread-1',
          file: 'src/main.ts',
          line: 10,
          author: 'alice',
          body: 'First line\nSecond line\nThird line',
        },
      ],
    };
    const output = formatCatHeader(multilineData);
    expect(output).toContain('    First line');
    expect(output).toContain('    Second line');
    expect(output).toContain('    Third line');
  });
});

describe('formatCatMeta', () => {
  const sampleData: CatDisplayData = {
    id: '001-auth-refactor',
    title: 'Auth system refactor',
    fileCount: 3,
    totalAdditions: 340,
    totalDeletions: 210,
    estimatedTokens: 2800,
    commentCount: 0,
    comments: [],
    findings: [],
    diff: 'diff --git...',
    patchPath: '/path/to/patch',
    metaPath: '/path/to/meta',
    files: [{ path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 }],
  };

  it('includes header info but no diff', () => {
    const output = formatCatMeta(sampleData);
    expect(output).toContain('001-auth-refactor');
    expect(output).toContain('Auth system refactor');
    expect(output).not.toContain('diff --git');
  });

  it('includes file list', () => {
    const output = formatCatMeta(sampleData);
    expect(output).toContain('src/auth/session.ts');
  });
});

describe('formatCatJson', () => {
  const sampleData: CatDisplayData = {
    id: '001-auth-refactor',
    title: 'Auth system refactor',
    fileCount: 3,
    totalAdditions: 340,
    totalDeletions: 210,
    estimatedTokens: 2800,
    commentCount: 2,
    comments: [
      {
        threadId: 'gh-review-123',
        file: 'src/auth/session.ts',
        line: 45,
        author: 'reviewer1',
        body: 'Should rotate session',
      },
    ],
    findings: [
      {
        id: 1,
        severity: 'critical',
        file: 'src/auth/session.ts',
        line: 45,
        message: 'Session not rotated',
      },
    ],
    diff: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n+line',
    patchPath: '/path/to/patch',
    metaPath: '/path/to/meta',
    files: [{ path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 }],
  };

  it('outputs valid JSON', () => {
    const json = formatCatJson(sampleData);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes id and title', () => {
    const parsed = JSON.parse(formatCatJson(sampleData));
    expect(parsed.id).toBe('001-auth-refactor');
    expect(parsed.title).toBe('Auth system refactor');
  });

  it('includes files array', () => {
    const parsed = JSON.parse(formatCatJson(sampleData));
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('src/auth/session.ts');
  });

  it('includes diff', () => {
    const parsed = JSON.parse(formatCatJson(sampleData));
    expect(parsed.diff).toContain('diff --git');
  });

  it('includes comments', () => {
    const parsed = JSON.parse(formatCatJson(sampleData));
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].threadId).toBe('gh-review-123');
  });

  it('includes findings', () => {
    const parsed = JSON.parse(formatCatJson(sampleData));
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].severity).toBe('critical');
  });

  it('includes absolute paths to patch and meta files', () => {
    const parsed = JSON.parse(formatCatJson(sampleData));
    expect(parsed.paths).toBeDefined();
    expect(parsed.paths.patch).toBe('/path/to/patch');
    expect(parsed.paths.meta).toBe('/path/to/meta');
  });
});
