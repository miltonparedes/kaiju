import { describe, expect, it } from 'vitest';

import type {
  DashboardChunk,
  DashboardFile,
  DashboardFinding,
} from '../routes/$provider/$org/$repo/$pr/types.js';
import { buildSortedChunks, countBySeverity } from './chunkNavigatorUtils.js';

// ─── Test factories ───────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<DashboardChunk> = {}): DashboardChunk {
  return {
    id: 1,
    reviewId: 1,
    slug: 'chunk-1',
    title: 'Chunk 1',
    description: '',
    reviewPriority: 'medium',
    estimatedTokens: 1000,
    patch: null,
    status: 'pending',
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeFile(overrides: Partial<DashboardFile> = {}): DashboardFile {
  return {
    id: 1,
    reviewId: 1,
    path: 'src/index.ts',
    status: 'modified',
    additions: 10,
    deletions: 5,
    chunkId: 1,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<DashboardFinding> = {}): DashboardFinding {
  return {
    id: 1,
    reviewId: 1,
    chunkId: 1,
    reviewer: 'claude',
    file: 'src/index.ts',
    line: 10,
    endLine: null,
    severity: 'suggestion',
    message: 'Consider extracting this',
    suggestion: null,
    codeSuggestion: null,
    rootCause: null,
    impact: null,
    status: 'open',
    publish: true,
    inReplyTo: null,
    timestamp: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Helper to safely access a result element, throwing if undefined. */
function at<T>(arr: T[], index: number): T {
  const item = arr[index];
  if (item === undefined) {
    throw new Error(`Expected element at index ${index}, but array has ${arr.length} items`);
  }
  return item;
}

// ─── countBySeverity ──────────────────────────────────────────────────────────

describe('countBySeverity', () => {
  it('returns empty object for no findings', () => {
    expect(countBySeverity([])).toEqual({});
  });

  it('counts single severity', () => {
    const findings = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'critical', id: 2 }),
    ];
    expect(countBySeverity(findings)).toEqual({ critical: 2 });
  });

  it('counts multiple severities', () => {
    const findings = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'suggestion', id: 2 }),
      makeFinding({ severity: 'suggestion', id: 3 }),
      makeFinding({ severity: 'nitpick', id: 4 }),
      makeFinding({ severity: 'praise', id: 5 }),
    ];
    expect(countBySeverity(findings)).toEqual({
      critical: 1,
      suggestion: 2,
      nitpick: 1,
      praise: 1,
    });
  });
});

// ─── buildSortedChunks ───────────────────────────────────────────────────────

describe('buildSortedChunks', () => {
  it('returns empty array for no chunks', () => {
    expect(buildSortedChunks([], [], [])).toEqual([]);
  });

  it('enriches chunk with files and findings', () => {
    const chunks = [makeChunk({ id: 1 })];
    const files = [
      makeFile({ id: 1, chunkId: 1, additions: 20, deletions: 5 }),
      makeFile({ id: 2, chunkId: 1, path: 'src/other.ts', additions: 10, deletions: 3 }),
    ];
    const findings = [makeFinding({ chunkId: 1 })];

    const result = buildSortedChunks(chunks, findings, files);
    const first = at(result, 0);

    expect(result).toHaveLength(1);
    expect(first.files).toHaveLength(2);
    expect(first.findings).toHaveLength(1);
    expect(first.totalAdditions).toBe(30);
    expect(first.totalDeletions).toBe(8);
  });

  it('sorts chunks with critical findings first', () => {
    const chunks = [
      makeChunk({ id: 1, slug: 'no-findings', reviewPriority: 'high' }),
      makeChunk({ id: 2, slug: 'has-critical', reviewPriority: 'low' }),
    ];
    const findings = [makeFinding({ chunkId: 2, severity: 'critical' })];

    const result = buildSortedChunks(chunks, findings, []);

    expect(at(result, 0).chunk.slug).toBe('has-critical');
    expect(at(result, 1).chunk.slug).toBe('no-findings');
  });

  it('sorts by priority when critical count is equal', () => {
    const chunks = [
      makeChunk({ id: 1, slug: 'low-priority', reviewPriority: 'low' }),
      makeChunk({ id: 2, slug: 'high-priority', reviewPriority: 'high' }),
      makeChunk({ id: 3, slug: 'medium-priority', reviewPriority: 'medium' }),
    ];

    const result = buildSortedChunks(chunks, [], []);

    expect(result.map((r) => r.chunk.slug)).toEqual([
      'high-priority',
      'medium-priority',
      'low-priority',
    ]);
  });

  it('sorts alphabetically by slug when priority is equal', () => {
    const chunks = [
      makeChunk({ id: 1, slug: 'zebra', reviewPriority: 'medium' }),
      makeChunk({ id: 2, slug: 'alpha', reviewPriority: 'medium' }),
      makeChunk({ id: 3, slug: 'mike', reviewPriority: 'medium' }),
    ];

    const result = buildSortedChunks(chunks, [], []);

    expect(result.map((r) => r.chunk.slug)).toEqual(['alpha', 'mike', 'zebra']);
  });

  it('handles files with null chunkId', () => {
    const chunks = [makeChunk({ id: 1 })];
    const files = [
      makeFile({ id: 1, chunkId: 1, additions: 10, deletions: 0 }),
      makeFile({ id: 2, chunkId: null, additions: 5, deletions: 0 }),
    ];

    const result = buildSortedChunks(chunks, [], files);
    const first = at(result, 0);

    expect(first.files).toHaveLength(1);
    expect(first.totalAdditions).toBe(10);
  });

  it('handles findings with null chunkId', () => {
    const chunks = [makeChunk({ id: 1 })];
    const findings = [makeFinding({ chunkId: 1 }), makeFinding({ id: 2, chunkId: null })];

    const result = buildSortedChunks(chunks, findings, []);

    expect(at(result, 0).findings).toHaveLength(1);
  });

  it('correctly assigns files and findings to different chunks', () => {
    const chunks = [makeChunk({ id: 1, slug: 'chunk-a' }), makeChunk({ id: 2, slug: 'chunk-b' })];
    const files = [
      makeFile({ id: 1, chunkId: 1, additions: 10, deletions: 5 }),
      makeFile({ id: 2, chunkId: 2, additions: 20, deletions: 10 }),
      makeFile({ id: 3, chunkId: 2, additions: 5, deletions: 1 }),
    ];
    const findings = [makeFinding({ id: 1, chunkId: 2, severity: 'critical' })];

    const result = buildSortedChunks(chunks, findings, files);
    const first = at(result, 0);
    const second = at(result, 1);

    // Chunk-b should be first (has critical finding)
    expect(first.chunk.slug).toBe('chunk-b');
    expect(first.files).toHaveLength(2);
    expect(first.findings).toHaveLength(1);
    expect(first.totalAdditions).toBe(25);
    expect(first.totalDeletions).toBe(11);

    expect(second.chunk.slug).toBe('chunk-a');
    expect(second.files).toHaveLength(1);
    expect(second.findings).toHaveLength(0);
    expect(second.totalAdditions).toBe(10);
    expect(second.totalDeletions).toBe(5);
  });

  it('chunk with more critical findings sorts before chunk with fewer', () => {
    const chunks = [
      makeChunk({ id: 1, slug: 'one-critical' }),
      makeChunk({ id: 2, slug: 'two-critical' }),
    ];
    const findings = [
      makeFinding({ id: 1, chunkId: 1, severity: 'critical' }),
      makeFinding({ id: 2, chunkId: 2, severity: 'critical' }),
      makeFinding({ id: 3, chunkId: 2, severity: 'critical' }),
    ];

    const result = buildSortedChunks(chunks, findings, []);

    expect(at(result, 0).chunk.slug).toBe('two-critical');
    expect(at(result, 1).chunk.slug).toBe('one-critical');
  });

  it('review status is preserved in chunk data', () => {
    const chunks = [makeChunk({ id: 1, status: 'reviewed' })];
    const result = buildSortedChunks(chunks, [], []);
    expect(at(result, 0).chunk.status).toBe('reviewed');
  });
});
