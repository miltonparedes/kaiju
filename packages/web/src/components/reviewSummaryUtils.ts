import type { DashboardChunk, DashboardFinding } from '../routes/$provider/$org/$repo/$pr/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Severity categories matching the spec's display groups. */
export type SeverityKey = 'critical' | 'suggestion' | 'nitpick' | 'praise';

export interface SeverityGroup {
  key: SeverityKey;
  label: string;
  pluralLabel: string;
  icon: string;
  colorClass: string;
  badgeClass: string;
  count: number;
  findings: DashboardFinding[];
}

export interface ReviewerStat {
  name: string;
  count: number;
}

export interface ReviewSummaryStats {
  reviewedCount: number;
  totalChunks: number;
  progressPercent: number;
  severityGroups: SeverityGroup[];
  reviewers: ReviewerStat[];
  totalTokens: number;
  reviewedTokens: number;
  tokenPercent: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SEVERITY_CONFIG: {
  key: SeverityKey;
  label: string;
  pluralLabel: string;
  icon: string;
  colorClass: string;
  badgeClass: string;
}[] = [
  {
    key: 'critical',
    label: 'bug',
    pluralLabel: 'bugs',
    icon: '■',
    colorClass: 'text-red-400',
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
  {
    key: 'suggestion',
    label: 'suggestion',
    pluralLabel: 'suggestions',
    icon: '■',
    colorClass: 'text-yellow-400',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  {
    key: 'nitpick',
    label: 'nitpick',
    pluralLabel: 'nitpicks',
    icon: '□',
    colorClass: 'text-blue-400',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  {
    key: 'praise',
    label: 'praise',
    pluralLabel: 'praise',
    icon: '★',
    colorClass: 'text-green-400',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
];

// ─── Pure functions ───────────────────────────────────────────────────────────

/** Group findings by severity with counts and metadata. */
export function groupFindingsBySeverity(findings: DashboardFinding[]): SeverityGroup[] {
  return SEVERITY_CONFIG.map((config) => {
    const matched = findings.filter((f) => f.severity === config.key);
    return {
      ...config,
      count: matched.length,
      findings: matched,
    };
  });
}

/** Build reviewer stats sorted by finding count (descending). */
export function buildReviewerStats(findings: DashboardFinding[]): ReviewerStat[] {
  const map = new Map<string, number>();
  for (const f of findings) {
    if (f.reviewer) {
      map.set(f.reviewer, (map.get(f.reviewer) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Compute the full summary stats for the right panel. */
export function computeSummaryStats(
  chunks: DashboardChunk[],
  findings: DashboardFinding[],
): ReviewSummaryStats {
  const reviewedCount = chunks.filter((c) => c.status === 'reviewed').length;
  const totalChunks = chunks.length;
  const progressPercent = totalChunks > 0 ? Math.round((reviewedCount / totalChunks) * 100) : 0;

  const totalTokens = chunks.reduce((sum, c) => sum + c.estimatedTokens, 0);
  const reviewedTokens = chunks
    .filter((c) => c.status === 'reviewed')
    .reduce((sum, c) => sum + c.estimatedTokens, 0);
  const tokenPercent = totalTokens > 0 ? Math.round((reviewedTokens / totalTokens) * 100) : 0;

  return {
    reviewedCount,
    totalChunks,
    progressPercent,
    severityGroups: groupFindingsBySeverity(findings),
    reviewers: buildReviewerStats(findings),
    totalTokens,
    reviewedTokens,
    tokenPercent,
  };
}

/** Format a token count for display (e.g. 15900 → "15.9k"). */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
