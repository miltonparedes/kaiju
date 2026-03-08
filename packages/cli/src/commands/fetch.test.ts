import { describe, expect, it } from 'vitest';

import { fetchCommand, formatFetchJson, formatFetchSummary } from './fetch.js';

describe('fetch command', () => {
  it('has the correct name', () => {
    expect(fetchCommand.name()).toBe('fetch');
  });

  it('has a description', () => {
    expect(fetchCommand.description()).toBeTruthy();
  });

  it('accepts an optional pr-ref argument', () => {
    const args = fetchCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('pr-ref');
  });

  it('has a --branch option', () => {
    expect(fetchCommand.options.some((o) => o.long === '--branch')).toBe(true);
  });

  it('has a --diff option', () => {
    expect(fetchCommand.options.some((o) => o.long === '--diff')).toBe(true);
  });

  it('has a --json option', () => {
    expect(fetchCommand.options.some((o) => o.long === '--json')).toBe(true);
  });
});

describe('formatFetchSummary', () => {
  it('formats summary with file count, diff stats, and comment count', () => {
    const summary = formatFetchSummary({
      reviewKey: 'github/org/repo/9999',
      title: 'Migrate auth to sessions',
      fileCount: 87,
      totalAdditions: 4521,
      totalDeletions: 1203,
      commentCount: 5,
      reviewDir: '/home/user/.kaiju/reviews/github/org/repo/9999',
    });
    expect(summary).toContain('org/repo');
    expect(summary).toContain('#9999');
    expect(summary).toContain('87 files');
    expect(summary).toContain('4521+');
    expect(summary).toContain('1203-');
    expect(summary).toContain('5 comments');
    expect(summary).toContain('Files:');
    expect(summary).toContain('Comments:');
    expect(summary).toContain('Next:');
  });

  it('includes the title in the summary', () => {
    const summary = formatFetchSummary({
      reviewKey: 'github/org/repo/9999',
      title: 'Migrate auth to sessions',
      fileCount: 87,
      totalAdditions: 4521,
      totalDeletions: 1203,
      commentCount: 5,
      reviewDir: '/home/user/.kaiju/reviews/github/org/repo/9999',
    });
    expect(summary).toContain('Migrate auth to sessions');
  });

  it('handles zero comments', () => {
    const summary = formatFetchSummary({
      reviewKey: 'github/org/repo/123',
      title: 'Fix bug',
      fileCount: 3,
      totalAdditions: 10,
      totalDeletions: 5,
      commentCount: 0,
      reviewDir: '/home/user/.kaiju/reviews/github/org/repo/123',
    });
    expect(summary).toContain('0 comments');
  });

  it('includes absolute paths to Files and Comments', () => {
    const summary = formatFetchSummary({
      reviewKey: 'github/org/repo/123',
      title: '',
      fileCount: 1,
      totalAdditions: 5,
      totalDeletions: 0,
      commentCount: 0,
      reviewDir: '/home/user/.kaiju/reviews/github/org/repo/123',
    });
    expect(summary).toContain('Files:');
    expect(summary).toContain('/home/user/.kaiju/reviews/github/org/repo/123/files.json');
    expect(summary).toContain('Comments:');
    expect(summary).toContain('/home/user/.kaiju/reviews/github/org/repo/123/comments');
  });
});

describe('formatFetchJson', () => {
  it('outputs valid JSON with all expected keys', () => {
    const json = formatFetchJson({
      reviewKey: 'github/org/repo/9999',
      title: 'Migrate auth to sessions',
      fileCount: 87,
      totalAdditions: 4521,
      totalDeletions: 1203,
      commentCount: 5,
      reviewDir: '/home/user/.kaiju/reviews/github/org/repo/9999',
    });
    const parsed = JSON.parse(json);
    expect(parsed.reviewKey).toBe('github/org/repo/9999');
    expect(parsed.title).toBe('Migrate auth to sessions');
    expect(parsed.fileCount).toBe(87);
    expect(parsed.totalAdditions).toBe(4521);
    expect(parsed.totalDeletions).toBe(1203);
    expect(parsed.commentCount).toBe(5);
    expect(parsed.paths.files).toContain('files.json');
    expect(parsed.paths.comments).toContain('comments');
    expect(parsed.next).toBeTruthy();
  });
});
