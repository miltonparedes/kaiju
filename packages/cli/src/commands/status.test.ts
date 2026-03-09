import { describe, expect, it } from 'vitest';

import {
  HIGH_PRIORITY_MAX,
  chunkImportanceScore,
  formatStatusJson,
  formatStatusSummary,
  statusCommand,
  type StatusDisplayData,
} from './status.js';

describe('status command', () => {
  it('has the correct name', () => {
    expect(statusCommand.name()).toBe('status');
  });

  it('has a description', () => {
    expect(statusCommand.description()).toBeTruthy();
  });

  it('accepts an optional pr-ref argument', () => {
    const args = statusCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('pr-ref');
  });

  it('has a --json option', () => {
    expect(statusCommand.options.some((o) => o.long === '--json')).toBe(true);
  });

  it('has a --all option', () => {
    expect(statusCommand.options.some((o) => o.long === '--all')).toBe(true);
  });
});

describe('formatStatusSummary', () => {
  const sampleData: StatusDisplayData = {
    repo: 'org/repo',
    pr: 9999,
    title: 'Migrate auth to sessions',
    chunkCount: 12,
    fileCount: 87,
    totalAdditions: 4521,
    totalDeletions: 1203,
    reviewedCount: 2,
    findingCount: 3,
    commentCount: 5,
    highPriorityChunks: [
      {
        id: '001-auth-refactor',
        additions: 340,
        deletions: 210,
        estimatedTokens: 2800,
        commentCount: 2,
        findingCount: 1,
      },
      {
        id: '005-db-migrations',
        additions: 500,
        deletions: 80,
        estimatedTokens: 3200,
        commentCount: 0,
        findingCount: 0,
      },
      {
        id: '007-breaking-api',
        additions: 180,
        deletions: 400,
        estimatedTokens: 2500,
        commentCount: 1,
        findingCount: 0,
      },
    ],
  };

  it('includes repo and PR number', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('org/repo');
    expect(output).toContain('#9999');
  });

  it('includes PR title', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('Migrate auth to sessions');
  });

  it('includes chunk and file counts', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('12 chunks');
    expect(output).toContain('87 files');
  });

  it('includes diff stats', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('4521+');
    expect(output).toContain('1203-');
  });

  it('includes review progress', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('2/12');
  });

  it('includes finding and comment counts', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('Findings: 3');
    expect(output).toContain('Comments: 5');
  });

  it('includes high priority section', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('High priority:');
    expect(output).toContain('001-auth-refactor');
    expect(output).toContain('005-db-migrations');
    expect(output).toContain('007-breaking-api');
  });

  it('includes diff stats in high priority chunks', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('340+');
    expect(output).toContain('210-');
  });

  it('includes token estimates in high priority chunks', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('~2.8k tok');
    expect(output).toContain('~3.2k tok');
    expect(output).toContain('~2.5k tok');
  });

  it('includes comment counts in high priority chunks', () => {
    const output = formatStatusSummary(sampleData);
    expect(output).toContain('2 comments');
    expect(output).toContain('0 comments');
    expect(output).toContain('1 comment');
  });

  it('omits high priority section when no high priority chunks', () => {
    const noHighData: StatusDisplayData = {
      ...sampleData,
      highPriorityChunks: [],
    };
    const output = formatStatusSummary(noHighData);
    expect(output).not.toContain('High priority:');
  });

  it('shows no-chunks message when chunkCount is 0', () => {
    const noChunksData: StatusDisplayData = {
      ...sampleData,
      chunkCount: 0,
      reviewedCount: 0,
      highPriorityChunks: [],
    };
    const output = formatStatusSummary(noChunksData);
    expect(output).toContain('0 chunks');
  });
});

describe('formatStatusJson', () => {
  const sampleData: StatusDisplayData = {
    repo: 'org/repo',
    pr: 9999,
    title: 'Migrate auth to sessions',
    chunkCount: 12,
    fileCount: 87,
    totalAdditions: 4521,
    totalDeletions: 1203,
    reviewedCount: 2,
    findingCount: 3,
    commentCount: 5,
    highPriorityChunks: [
      {
        id: '001-auth-refactor',
        additions: 340,
        deletions: 210,
        estimatedTokens: 2800,
        commentCount: 2,
        findingCount: 1,
      },
    ],
  };

  it('outputs valid JSON', () => {
    const json = formatStatusJson(sampleData);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes all fields', () => {
    const parsed = JSON.parse(formatStatusJson(sampleData));
    expect(parsed.repo).toBe('org/repo');
    expect(parsed.pr).toBe(9999);
    expect(parsed.title).toBe('Migrate auth to sessions');
    expect(parsed.chunkCount).toBe(12);
    expect(parsed.fileCount).toBe(87);
    expect(parsed.totalAdditions).toBe(4521);
    expect(parsed.totalDeletions).toBe(1203);
    expect(parsed.reviewedCount).toBe(2);
    expect(parsed.findingCount).toBe(3);
    expect(parsed.commentCount).toBe(5);
  });

  it('includes high priority chunks', () => {
    const parsed = JSON.parse(formatStatusJson(sampleData));
    expect(parsed.highPriorityChunks).toHaveLength(1);
    expect(parsed.highPriorityChunks[0].id).toBe('001-auth-refactor');
    expect(parsed.highPriorityChunks[0].additions).toBe(340);
    expect(parsed.highPriorityChunks[0].deletions).toBe(210);
    expect(parsed.highPriorityChunks[0].estimatedTokens).toBe(2800);
    expect(parsed.highPriorityChunks[0].commentCount).toBe(2);
  });

  it('includes absolute paths when reviewDir is provided', () => {
    const dataWithPaths: StatusDisplayData = {
      ...sampleData,
      reviewDir: '/home/user/.kaiju/reviews/github/org/repo/9999',
    };
    const parsed = JSON.parse(formatStatusJson(dataWithPaths));
    expect(parsed.paths).toBeDefined();
    expect(parsed.paths.reviewDir).toBe('/home/user/.kaiju/reviews/github/org/repo/9999');
    expect(parsed.paths.manifest).toContain('manifest.json');
    expect(parsed.paths.files).toContain('files.json');
    expect(parsed.paths.chunks).toContain('chunks/');
  });

  it('omits paths when reviewDir is not provided', () => {
    const parsed = JSON.parse(formatStatusJson(sampleData));
    expect(parsed.paths).toBeUndefined();
  });

  it('includes findingCount in high priority chunks JSON', () => {
    const parsed = JSON.parse(formatStatusJson(sampleData));
    expect(parsed.highPriorityChunks[0].findingCount).toBe(1);
  });
});

describe('chunkImportanceScore', () => {
  it('ranks findings highest', () => {
    const withFindings = chunkImportanceScore({
      findingCount: 1,
      commentCount: 0,
      additions: 0,
      deletions: 0,
    });
    const withComments = chunkImportanceScore({
      findingCount: 0,
      commentCount: 5,
      additions: 0,
      deletions: 0,
    });
    const withDiff = chunkImportanceScore({
      findingCount: 0,
      commentCount: 0,
      additions: 400,
      deletions: 500,
    });
    expect(withFindings).toBeGreaterThan(withComments);
    expect(withComments).toBeGreaterThan(withDiff);
  });

  it('returns 0 for empty chunk', () => {
    expect(
      chunkImportanceScore({ findingCount: 0, commentCount: 0, additions: 0, deletions: 0 }),
    ).toBe(0);
  });

  it('combines all factors', () => {
    const score = chunkImportanceScore({
      findingCount: 2,
      commentCount: 3,
      additions: 100,
      deletions: 50,
    });
    expect(score).toBe(2 * 10000 + 3 * 1000 + 150);
  });
});

describe('HIGH_PRIORITY_MAX', () => {
  it('is 5', () => {
    expect(HIGH_PRIORITY_MAX).toBe(5);
  });
});

describe('formatStatusSummary with findings', () => {
  it('shows finding count in high priority chunk lines', () => {
    const data: StatusDisplayData = {
      repo: 'org/repo',
      pr: 42,
      title: 'Test',
      chunkCount: 2,
      fileCount: 3,
      totalAdditions: 100,
      totalDeletions: 50,
      reviewedCount: 0,
      findingCount: 2,
      commentCount: 1,
      highPriorityChunks: [
        {
          id: 'chunk-a',
          additions: 80,
          deletions: 30,
          estimatedTokens: 500,
          commentCount: 1,
          findingCount: 2,
        },
      ],
    };
    const output = formatStatusSummary(data);
    expect(output).toContain('2 findings');
    expect(output).toContain('1 comment');
  });

  it('omits finding label when findingCount is 0', () => {
    const data: StatusDisplayData = {
      repo: 'org/repo',
      pr: 42,
      title: 'Test',
      chunkCount: 1,
      fileCount: 1,
      totalAdditions: 10,
      totalDeletions: 5,
      reviewedCount: 0,
      findingCount: 0,
      commentCount: 0,
      highPriorityChunks: [
        {
          id: 'chunk-b',
          additions: 10,
          deletions: 5,
          estimatedTokens: 100,
          commentCount: 0,
          findingCount: 0,
        },
      ],
    };
    const output = formatStatusSummary(data);
    expect(output).not.toContain('finding');
    expect(output).toContain('0 comments');
  });

  it('uses singular "finding" for count of 1', () => {
    const data: StatusDisplayData = {
      repo: 'org/repo',
      pr: 42,
      title: 'Test',
      chunkCount: 1,
      fileCount: 1,
      totalAdditions: 10,
      totalDeletions: 5,
      reviewedCount: 0,
      findingCount: 1,
      commentCount: 0,
      highPriorityChunks: [
        {
          id: 'chunk-c',
          additions: 10,
          deletions: 5,
          estimatedTokens: 100,
          commentCount: 0,
          findingCount: 1,
        },
      ],
    };
    const output = formatStatusSummary(data);
    expect(output).toContain('1 finding');
    expect(output).not.toContain('1 findings');
  });
});
