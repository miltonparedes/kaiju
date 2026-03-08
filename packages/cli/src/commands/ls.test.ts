import { describe, expect, it } from 'vitest';

import {
  formatLsAllJson,
  formatLsAllTable,
  formatLsChunksJson,
  formatLsChunksTable,
  lsCommand,
  type LsAllEntry,
  type LsChunkEntry,
} from './ls.js';

describe('ls command', () => {
  it('has the correct name', () => {
    expect(lsCommand.name()).toBe('ls');
  });

  it('has a description', () => {
    expect(lsCommand.description()).toBeTruthy();
  });

  it('has a --all option', () => {
    expect(lsCommand.options.some((o) => o.long === '--all')).toBe(true);
  });

  it('has a --json option', () => {
    expect(lsCommand.options.some((o) => o.long === '--json')).toBe(true);
  });

  it('accepts an optional pr-ref argument', () => {
    const args = lsCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('pr-ref');
  });
});

describe('formatLsChunksTable', () => {
  const sampleChunks: LsChunkEntry[] = [
    {
      id: '001-auth-refactor',
      additions: 340,
      deletions: 210,
      estimatedTokens: 2800,
      status: 'reviewed',
    },
    {
      id: '002-api-endpoints',
      additions: 890,
      deletions: 120,
      estimatedTokens: 5100,
      status: 'pending',
    },
    {
      id: '003-tests',
      additions: 1200,
      deletions: 50,
      estimatedTokens: 8000,
      status: 'pending',
    },
  ];

  it('includes chunk IDs', () => {
    const output = formatLsChunksTable(sampleChunks);
    expect(output).toContain('001-auth-refactor');
    expect(output).toContain('002-api-endpoints');
    expect(output).toContain('003-tests');
  });

  it('includes diff stats', () => {
    const output = formatLsChunksTable(sampleChunks);
    expect(output).toContain('340+');
    expect(output).toContain('210-');
    expect(output).toContain('890+');
    expect(output).toContain('120-');
  });

  it('includes token estimates', () => {
    const output = formatLsChunksTable(sampleChunks);
    expect(output).toContain('~2.8k tok');
    expect(output).toContain('~5.1k tok');
    expect(output).toContain('~8.0k tok');
  });

  it('includes review status', () => {
    const output = formatLsChunksTable(sampleChunks);
    expect(output).toContain('reviewed');
    expect(output).toContain('pending');
  });

  it('handles empty chunk list', () => {
    const output = formatLsChunksTable([]);
    expect(output).toContain('No chunks');
  });
});

describe('formatLsChunksJson', () => {
  const sampleChunks: LsChunkEntry[] = [
    {
      id: '001-auth',
      additions: 100,
      deletions: 50,
      estimatedTokens: 800,
      status: 'reviewed',
    },
    {
      id: '002-api',
      additions: 200,
      deletions: 30,
      estimatedTokens: 1200,
      status: 'pending',
    },
  ];

  it('outputs valid JSON', () => {
    const json = formatLsChunksJson(sampleChunks);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes chunk count', () => {
    const parsed = JSON.parse(formatLsChunksJson(sampleChunks));
    expect(parsed.totalChunks).toBe(2);
  });

  it('includes chunk details', () => {
    const parsed = JSON.parse(formatLsChunksJson(sampleChunks));
    expect(parsed.chunks).toHaveLength(2);
    expect(parsed.chunks[0].id).toBe('001-auth');
    expect(parsed.chunks[0].additions).toBe(100);
    expect(parsed.chunks[0].deletions).toBe(50);
    expect(parsed.chunks[0].estimatedTokens).toBe(800);
    expect(parsed.chunks[0].status).toBe('reviewed');
  });
});

describe('formatLsAllTable', () => {
  const sampleEntries: LsAllEntry[] = [
    {
      key: 'github/org/repo/9999',
      repo: 'org/repo',
      pr: 9999,
      chunkCount: 12,
      reviewedCount: 2,
      totalChunks: 12,
      fileCount: 87,
      status: 'split',
    },
    {
      key: 'github/org/repo/10001',
      repo: 'org/repo',
      pr: 10001,
      chunkCount: 0,
      reviewedCount: 0,
      totalChunks: 0,
      fileCount: 14,
      status: 'fetched',
    },
    {
      key: 'github/org/other-repo/42',
      repo: 'org/other-repo',
      pr: 42,
      chunkCount: 7,
      reviewedCount: 0,
      totalChunks: 7,
      fileCount: 30,
      status: 'split',
    },
  ];

  it('includes repo and PR number', () => {
    const output = formatLsAllTable(sampleEntries);
    expect(output).toContain('org/repo#9999');
    expect(output).toContain('org/repo#10001');
    expect(output).toContain('org/other-repo#42');
  });

  it('includes chunk counts', () => {
    const output = formatLsAllTable(sampleEntries);
    expect(output).toContain('12 chunks');
    expect(output).toContain('7 chunks');
  });

  it('includes review progress for split reviews', () => {
    const output = formatLsAllTable(sampleEntries);
    expect(output).toContain('2/12 reviewed');
  });

  it('shows file count for fetched reviews without chunks', () => {
    const output = formatLsAllTable(sampleEntries);
    expect(output).toContain('14 files');
  });

  it('includes lifecycle state', () => {
    const output = formatLsAllTable(sampleEntries);
    expect(output).toContain('split');
    expect(output).toContain('fetched');
  });

  it('handles empty list', () => {
    const output = formatLsAllTable([]);
    expect(output).toContain('No reviews');
  });
});

describe('formatLsAllJson', () => {
  const sampleEntries: LsAllEntry[] = [
    {
      key: 'github/org/repo/9999',
      repo: 'org/repo',
      pr: 9999,
      chunkCount: 12,
      reviewedCount: 2,
      totalChunks: 12,
      fileCount: 87,
      status: 'split',
    },
  ];

  it('outputs valid JSON', () => {
    const json = formatLsAllJson(sampleEntries);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes review count', () => {
    const parsed = JSON.parse(formatLsAllJson(sampleEntries));
    expect(parsed.totalReviews).toBe(1);
  });

  it('includes review details', () => {
    const parsed = JSON.parse(formatLsAllJson(sampleEntries));
    expect(parsed.reviews).toHaveLength(1);
    expect(parsed.reviews[0].key).toBe('github/org/repo/9999');
    expect(parsed.reviews[0].repo).toBe('org/repo');
    expect(parsed.reviews[0].pr).toBe(9999);
    expect(parsed.reviews[0].chunkCount).toBe(12);
    expect(parsed.reviews[0].reviewedCount).toBe(2);
    expect(parsed.reviews[0].fileCount).toBe(87);
    expect(parsed.reviews[0].status).toBe('split');
  });
});
