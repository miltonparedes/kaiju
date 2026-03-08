import { describe, expect, it } from 'vitest';

import type { DashboardChunk, DashboardFinding } from '../routes/$provider/$org/$repo/$pr/types.js';
import {
  buildReviewerStats,
  computeSummaryStats,
  formatTokens,
  groupFindingsBySeverity,
} from './reviewSummaryUtils.js';

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

// ─── groupFindingsBySeverity ──────────────────────────────────────────────────

describe('groupFindingsBySeverity', () => {
  it('returns all four groups with zero counts for no findings', () => {
    const groups = groupFindingsBySeverity([]);
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.count === 0)).toBe(true);
    expect(groups.map((g) => g.key)).toEqual(['critical', 'suggestion', 'nitpick', 'praise']);
  });

  it('counts findings per severity correctly', () => {
    const findings = [
      makeFinding({ id: 1, severity: 'critical' }),
      makeFinding({ id: 2, severity: 'critical' }),
      makeFinding({ id: 3, severity: 'suggestion' }),
      makeFinding({ id: 4, severity: 'nitpick' }),
      makeFinding({ id: 5, severity: 'praise' }),
      makeFinding({ id: 6, severity: 'praise' }),
      makeFinding({ id: 7, severity: 'praise' }),
    ];

    const groups = groupFindingsBySeverity(findings);
    const critical = groups.find((g) => g.key === 'critical')!;
    const suggestion = groups.find((g) => g.key === 'suggestion')!;
    const nitpick = groups.find((g) => g.key === 'nitpick')!;
    const praise = groups.find((g) => g.key === 'praise')!;

    expect(critical.count).toBe(2);
    expect(suggestion.count).toBe(1);
    expect(nitpick.count).toBe(1);
    expect(praise.count).toBe(3);
  });

  it('includes the actual findings in each group', () => {
    const findings = [
      makeFinding({ id: 1, severity: 'critical', message: 'Bug A' }),
      makeFinding({ id: 2, severity: 'critical', message: 'Bug B' }),
    ];

    const groups = groupFindingsBySeverity(findings);
    const critical = groups.find((g) => g.key === 'critical')!;

    expect(critical.findings).toHaveLength(2);
    expect(critical.findings.map((f) => f.message)).toEqual(['Bug A', 'Bug B']);
  });

  it('includes color and label metadata', () => {
    const groups = groupFindingsBySeverity([]);
    const critical = groups.find((g) => g.key === 'critical')!;

    expect(critical.label).toBe('bug');
    expect(critical.pluralLabel).toBe('bugs');
    expect(critical.icon).toBe('■');
    expect(critical.colorClass).toContain('text-red');
  });

  it('ignores unknown severity values', () => {
    const findings = [makeFinding({ id: 1, severity: 'unknown-severity' })];

    const groups = groupFindingsBySeverity(findings);
    expect(groups.every((g) => g.count === 0)).toBe(true);
  });
});

// ─── buildReviewerStats ───────────────────────────────────────────────────────

describe('buildReviewerStats', () => {
  it('returns empty array for no findings', () => {
    expect(buildReviewerStats([])).toEqual([]);
  });

  it('counts findings per reviewer', () => {
    const findings = [
      makeFinding({ id: 1, reviewer: 'alice' }),
      makeFinding({ id: 2, reviewer: 'alice' }),
      makeFinding({ id: 3, reviewer: 'bob' }),
    ];

    const stats = buildReviewerStats(findings);

    expect(stats).toHaveLength(2);
    expect(stats[0]).toEqual({ name: 'alice', count: 2 });
    expect(stats[1]).toEqual({ name: 'bob', count: 1 });
  });

  it('sorts by count descending, then name ascending', () => {
    const findings = [
      makeFinding({ id: 1, reviewer: 'charlie' }),
      makeFinding({ id: 2, reviewer: 'alice' }),
      makeFinding({ id: 3, reviewer: 'alice' }),
      makeFinding({ id: 4, reviewer: 'bob' }),
      makeFinding({ id: 5, reviewer: 'bob' }),
    ];

    const stats = buildReviewerStats(findings);

    expect(stats.map((s) => s.name)).toEqual(['alice', 'bob', 'charlie']);
  });

  it('skips findings with empty reviewer', () => {
    const findings = [
      makeFinding({ id: 1, reviewer: '' }),
      makeFinding({ id: 2, reviewer: 'alice' }),
    ];

    const stats = buildReviewerStats(findings);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.name).toBe('alice');
  });
});

// ─── computeSummaryStats ──────────────────────────────────────────────────────

describe('computeSummaryStats', () => {
  it('returns zero stats for empty data', () => {
    const stats = computeSummaryStats([], []);

    expect(stats.reviewedCount).toBe(0);
    expect(stats.totalChunks).toBe(0);
    expect(stats.progressPercent).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.reviewedTokens).toBe(0);
    expect(stats.tokenPercent).toBe(0);
    expect(stats.reviewers).toEqual([]);
    expect(stats.severityGroups).toHaveLength(4);
  });

  it('computes review progress correctly', () => {
    const chunks = [
      makeChunk({ id: 1, status: 'reviewed' }),
      makeChunk({ id: 2, status: 'reviewed' }),
      makeChunk({ id: 3, status: 'pending' }),
      makeChunk({ id: 4, status: 'pending' }),
    ];

    const stats = computeSummaryStats(chunks, []);

    expect(stats.reviewedCount).toBe(2);
    expect(stats.totalChunks).toBe(4);
    expect(stats.progressPercent).toBe(50);
  });

  it('computes token budget correctly', () => {
    const chunks = [
      makeChunk({ id: 1, status: 'reviewed', estimatedTokens: 2000 }),
      makeChunk({ id: 2, status: 'pending', estimatedTokens: 3000 }),
      makeChunk({ id: 3, status: 'pending', estimatedTokens: 5000 }),
    ];

    const stats = computeSummaryStats(chunks, []);

    expect(stats.totalTokens).toBe(10000);
    expect(stats.reviewedTokens).toBe(2000);
    expect(stats.tokenPercent).toBe(20);
  });

  it('includes severity groups and reviewers', () => {
    const chunks = [makeChunk({ id: 1 })];
    const findings = [
      makeFinding({ id: 1, severity: 'critical', reviewer: 'alice' }),
      makeFinding({ id: 2, severity: 'suggestion', reviewer: 'alice' }),
      makeFinding({ id: 3, severity: 'suggestion', reviewer: 'bob' }),
    ];

    const stats = computeSummaryStats(chunks, findings);

    const critical = stats.severityGroups.find((g) => g.key === 'critical')!;
    expect(critical.count).toBe(1);

    const suggestion = stats.severityGroups.find((g) => g.key === 'suggestion')!;
    expect(suggestion.count).toBe(2);

    expect(stats.reviewers).toHaveLength(2);
    expect(stats.reviewers[0]).toEqual({ name: 'alice', count: 2 });
    expect(stats.reviewers[1]).toEqual({ name: 'bob', count: 1 });
  });

  it('rounds progress percentage', () => {
    const chunks = [
      makeChunk({ id: 1, status: 'reviewed' }),
      makeChunk({ id: 2, status: 'pending' }),
      makeChunk({ id: 3, status: 'pending' }),
    ];

    const stats = computeSummaryStats(chunks, []);
    expect(stats.progressPercent).toBe(33); // 1/3 = 33.33... → 33
  });
});

// ─── formatTokens ─────────────────────────────────────────────────────────────

describe('formatTokens', () => {
  it('returns raw number for values under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(2800)).toBe('2.8k');
    expect(formatTokens(15900)).toBe('15.9k');
  });

  it('formats large values', () => {
    expect(formatTokens(100000)).toBe('100.0k');
  });
});
