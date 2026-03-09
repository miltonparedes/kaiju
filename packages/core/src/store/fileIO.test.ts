import { describe, expect, it } from 'vitest';

import {
  computeManifestStats,
  getReviewDir,
  parseReviewKey,
  reviewKeyToPath,
  sanitizePath,
} from './fileIO.js';
import type { FilesJsonEntry, ManifestChunk, ReviewKey } from './fileTypes.js';

describe('parseReviewKey', () => {
  it('parses a standard key like github/org/repo/9999', () => {
    const result = parseReviewKey('github/org/repo/9999');
    expect(result).toEqual({
      provider: 'github',
      org: 'org',
      repo: 'repo',
      pr: 9999,
    });
  });

  it('parses keys with nested org/repo names', () => {
    const result = parseReviewKey('github/my-org/my-repo/42');
    expect(result).toEqual({
      provider: 'github',
      org: 'my-org',
      repo: 'my-repo',
      pr: 42,
    });
  });

  it('throws on invalid key format', () => {
    expect(() => parseReviewKey('invalid')).toThrow();
    expect(() => parseReviewKey('github/org')).toThrow();
    expect(() => parseReviewKey('')).toThrow();
  });
});

describe('reviewKeyToPath', () => {
  it('converts a ReviewKey to a path segment', () => {
    const key: ReviewKey = { provider: 'github', org: 'acme', repo: 'widgets', pr: 9999 };
    expect(reviewKeyToPath(key)).toBe('github/acme/widgets/9999');
  });
});

describe('getReviewDir', () => {
  it('returns the full path for a review key', () => {
    const dir = getReviewDir('github/acme/widgets/9999', '/home/user/.kaiju');
    expect(dir).toBe('/home/user/.kaiju/reviews/github/acme/widgets/9999');
  });

  it('uses default base dir when not specified', () => {
    const dir = getReviewDir('github/acme/widgets/9999');
    expect(dir).toMatch(/\.kaiju\/reviews\/github\/acme\/widgets\/9999$/);
  });
});

describe('sanitizePath', () => {
  it('passes through normal paths unchanged', () => {
    expect(sanitizePath('src/auth/session.ts')).toBe('src/auth/session.ts');
  });

  it('handles paths with spaces', () => {
    expect(sanitizePath('src/my folder/file.ts')).toBe('src/my folder/file.ts');
  });

  it('handles paths with unicode characters', () => {
    expect(sanitizePath('src/日本語/file.ts')).toBe('src/日本語/file.ts');
  });

  it('handles paths with parentheses', () => {
    expect(sanitizePath('src/file (copy).tsx')).toBe('src/file (copy).tsx');
  });

  it('strips dangerous path traversals', () => {
    expect(sanitizePath('../../../etc/passwd')).not.toContain('..');
  });

  it('handles empty path', () => {
    expect(sanitizePath('')).toBe('');
  });
});

describe('computeManifestStats', () => {
  it('computes stats from files and chunks', () => {
    const files: FilesJsonEntry[] = [
      { path: 'src/a.ts', status: 'added', additions: 100, deletions: 0 },
      { path: 'src/b.ts', status: 'modified', additions: 50, deletions: 20 },
    ];
    const chunks: ManifestChunk[] = [
      {
        id: '001-auth',
        title: 'Auth',
        description: '',
        files: ['src/a.ts', 'src/b.ts'],
        additions: 150,
        deletions: 20,
        review_priority: 'high',
        estimated_tokens: 1000,
        status: 'pending',
        comments_count: 2,
        findings_count: 1,
      },
    ];
    const stats = computeManifestStats(files, chunks, 2, 1);
    expect(stats).toEqual({
      total_files: 2,
      total_additions: 150,
      total_deletions: 20,
      total_chunks: 1,
      total_comments: 2,
      total_findings: 1,
    });
  });

  it('returns all zeros for empty review', () => {
    const stats = computeManifestStats([], [], 0, 0);
    expect(stats).toEqual({
      total_files: 0,
      total_additions: 0,
      total_deletions: 0,
      total_chunks: 0,
      total_comments: 0,
      total_findings: 0,
    });
  });

  it('accumulates stats from all files', () => {
    const files: FilesJsonEntry[] = [
      { path: 'a.ts', status: 'added', additions: 10, deletions: 0 },
      { path: 'b.ts', status: 'deleted', additions: 0, deletions: 30 },
      { path: 'c.ts', status: 'modified', additions: 5, deletions: 3 },
    ];
    const stats = computeManifestStats(files, [], 0, 0);
    expect(stats.total_files).toBe(3);
    expect(stats.total_additions).toBe(15);
    expect(stats.total_deletions).toBe(33);
  });
});
