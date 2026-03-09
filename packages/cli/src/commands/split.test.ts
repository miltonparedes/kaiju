import { describe, expect, it } from 'vitest';

import {
  formatSplitJson,
  formatSplitSummary,
  splitCommand,
  type SplitSummaryData,
} from './split.js';

describe('split command', () => {
  it('has the correct name', () => {
    expect(splitCommand.name()).toBe('split');
  });

  it('has a description', () => {
    expect(splitCommand.description()).toBeTruthy();
  });

  it('accepts an optional pr-ref argument', () => {
    const args = splitCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('pr-ref');
  });

  it('has a --plan option', () => {
    expect(splitCommand.options.some((o) => o.long === '--plan')).toBe(true);
  });

  it('has a --auto option', () => {
    expect(splitCommand.options.some((o) => o.long === '--auto')).toBe(true);
  });

  it('has a --strategy option', () => {
    expect(splitCommand.options.some((o) => o.long === '--strategy')).toBe(true);
  });

  it('has a --max-tokens option', () => {
    expect(splitCommand.options.some((o) => o.long === '--max-tokens')).toBe(true);
  });

  it('has a --keep-findings option', () => {
    expect(splitCommand.options.some((o) => o.long === '--keep-findings')).toBe(true);
  });

  it('has a --json option', () => {
    expect(splitCommand.options.some((o) => o.long === '--json')).toBe(true);
  });
});

describe('formatSplitSummary', () => {
  const sampleData: SplitSummaryData = {
    chunkCount: 3,
    chunks: [
      {
        id: '001-auth-refactor',
        additions: 340,
        deletions: 210,
        estimatedTokens: 2800,
        reviewPriority: 'high',
        commentCount: 2,
      },
      {
        id: '002-api-endpoints',
        additions: 890,
        deletions: 120,
        estimatedTokens: 5100,
        reviewPriority: 'medium',
        commentCount: 0,
      },
      {
        id: '003-tests',
        additions: 1200,
        deletions: 50,
        estimatedTokens: 8000,
        reviewPriority: 'low',
        commentCount: 0,
      },
    ],
    manifestPath: '/home/user/.kaiju/reviews/github/org/repo/9999/manifest.json',
    chunksDir: '/home/user/.kaiju/reviews/github/org/repo/9999/chunks/',
  };

  it('includes chunk count header', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('3 chunks');
  });

  it('includes chunk IDs', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('001-auth-refactor');
    expect(output).toContain('002-api-endpoints');
    expect(output).toContain('003-tests');
  });

  it('includes diff stats for each chunk', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('340+');
    expect(output).toContain('210-');
    expect(output).toContain('890+');
    expect(output).toContain('120-');
  });

  it('includes token estimates', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('~2.8k tok');
    expect(output).toContain('~5.1k tok');
    expect(output).toContain('~8.0k tok');
  });

  it('includes priority labels', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('HIGH');
    expect(output).toContain('MEDIUM');
    expect(output).toContain('LOW');
  });

  it('includes comment counts', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('2 comments');
    expect(output).toContain('0 comments');
  });

  it('includes Manifest: path', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('Manifest:');
    expect(output).toContain(sampleData.manifestPath);
  });

  it('includes Chunks: path', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('Chunks:');
    expect(output).toContain(sampleData.chunksDir);
  });

  it('includes Next: step', () => {
    const output = formatSplitSummary(sampleData);
    expect(output).toContain('Next:');
    expect(output).toContain('kaiju cat');
  });
});

describe('formatSplitJson', () => {
  const sampleData: SplitSummaryData = {
    chunkCount: 2,
    chunks: [
      {
        id: '001-auth',
        additions: 100,
        deletions: 50,
        estimatedTokens: 800,
        reviewPriority: 'high',
        commentCount: 1,
      },
      {
        id: '002-api',
        additions: 200,
        deletions: 30,
        estimatedTokens: 1200,
        reviewPriority: 'medium',
        commentCount: 0,
      },
    ],
    manifestPath: '/home/user/.kaiju/reviews/github/org/repo/123/manifest.json',
    chunksDir: '/home/user/.kaiju/reviews/github/org/repo/123/chunks/',
  };

  it('outputs valid JSON', () => {
    const json = formatSplitJson(sampleData);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes chunk count', () => {
    const parsed = JSON.parse(formatSplitJson(sampleData));
    expect(parsed.chunkCount).toBe(2);
  });

  it('includes chunk details', () => {
    const parsed = JSON.parse(formatSplitJson(sampleData));
    expect(parsed.chunks).toHaveLength(2);
    expect(parsed.chunks[0].id).toBe('001-auth');
    expect(parsed.chunks[0].additions).toBe(100);
    expect(parsed.chunks[0].deletions).toBe(50);
    expect(parsed.chunks[0].estimatedTokens).toBe(800);
    expect(parsed.chunks[0].reviewPriority).toBe('high');
    expect(parsed.chunks[0].commentCount).toBe(1);
  });

  it('includes paths', () => {
    const parsed = JSON.parse(formatSplitJson(sampleData));
    expect(parsed.paths.manifest).toContain('manifest.json');
    expect(parsed.paths.chunks).toContain('chunks');
  });

  it('includes next suggestion', () => {
    const parsed = JSON.parse(formatSplitJson(sampleData));
    expect(parsed.next).toBeTruthy();
  });
});
