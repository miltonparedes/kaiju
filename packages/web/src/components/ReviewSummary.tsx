'use client';

import { Link } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Progress } from '@/components/ui/progress.js';
import { ScrollArea } from '@/components/ui/scroll-area.js';
import { Separator } from '@/components/ui/separator.js';
import { cn } from '@/lib/utils.js';

import type {
  DashboardChunk,
  DashboardFinding,
  DashboardReview,
} from '../routes/$provider/$org/$repo/$pr/types.js';
import { computeSummaryStats, formatTokens, type SeverityGroup } from './reviewSummaryUtils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewSummaryProps {
  review: DashboardReview;
  chunks: DashboardChunk[];
  findings: DashboardFinding[];
  onFindingClick?: (findingId: number) => void;
}

// ─── Severity Row ─────────────────────────────────────────────────────────────

function SeverityRow({
  group,
  onFindingClick,
}: {
  group: SeverityGroup;
  onFindingClick?: (findingId: number) => void;
}) {
  if (group.count === 0) {
    return null;
  }

  const displayLabel = group.count === 1 ? group.label : group.pluralLabel;

  return (
    <li className="group">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-sm transition-colors hover:bg-accent/50"
        onClick={() => {
          if (group.findings[0] && onFindingClick) {
            onFindingClick(group.findings[0].id);
          }
        }}
      >
        <span className={cn('text-base', group.colorClass)}>{group.icon}</span>
        <span className="text-foreground">
          {group.count} {displayLabel}
        </span>
        <Badge
          variant="outline"
          className={cn('ml-auto px-1.5 py-0 text-[10px]', group.badgeClass)}
        >
          {group.count}
        </Badge>
      </button>
    </li>
  );
}

// ─── ReviewSummary (main export) ──────────────────────────────────────────────

export function ReviewSummary({ review, chunks, findings, onFindingClick }: ReviewSummaryProps) {
  const stats = computeSummaryStats(chunks, findings);
  const hasFindingsToShow = stats.severityGroups.some((g) => g.count > 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Review Summary</h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* PR Description */}
          <Card className="border-border bg-card/50 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                PR Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-sm font-medium text-foreground">
                {review.title || 'Untitled review'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {review.repo} #{review.pr}
              </p>
              {review.base || review.head ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {review.base} → {review.head}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Separator />

          {/* Findings by severity */}
          <Card className="border-border bg-card/50 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Findings
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {hasFindingsToShow ? (
                <ul className="space-y-0.5">
                  {stats.severityGroups.map((group) => (
                    <SeverityRow key={group.key} group={group} onFindingClick={onFindingClick} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No findings yet</p>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Progress bar — reviewed chunks / total */}
          <Card className="border-border bg-card/50 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {stats.reviewedCount}/{stats.totalChunks} chunks
                </span>
                <span>{stats.progressPercent}%</span>
              </div>
              <Progress value={stats.progressPercent} className="mt-2 h-2" />
            </CardContent>
          </Card>

          <Separator />

          {/* Reviewers with finding counts */}
          <Card className="border-border bg-card/50 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Reviewers
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {stats.reviewers.length > 0 ? (
                <ul className="space-y-1.5">
                  {stats.reviewers.map((reviewer) => (
                    <li
                      key={reviewer.name}
                      className="flex items-center justify-between text-sm text-foreground"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-primary">●</span>
                        <span className="truncate">{reviewer.name}</span>
                      </span>
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {reviewer.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No reviewers yet</p>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Token budget visualization */}
          <Card className="border-border bg-card/50 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Token Budget
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Reviewed: {formatTokens(stats.reviewedTokens)}</span>
                <span>Total: {formatTokens(stats.totalTokens)}</span>
              </div>
              <Progress
                value={stats.tokenPercent}
                className="mt-2 h-2 [&>[data-slot=progress-indicator]]:bg-chart-2"
              />
            </CardContent>
          </Card>

          {/* Back to dashboard link */}
          <div className="pt-2">
            <Link to="/" className="text-xs text-primary hover:underline">
              ← Back to dashboard
            </Link>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
