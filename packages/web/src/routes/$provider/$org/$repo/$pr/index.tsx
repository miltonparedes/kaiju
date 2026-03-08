import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import { ChunkNavigator } from '@/components/ChunkNavigator.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable.js';
import { ScrollArea } from '@/components/ui/scroll-area.js';
import { getChunks } from '@/server/chunks.js';
import { getFiles } from '@/server/files.js';
import { getFindings } from '@/server/findings.js';
import { getReview } from '@/server/reviews.js';

import type { DashboardChunk, DashboardFile, DashboardFinding, PRLoaderData } from './types.js';

export const Route = createFileRoute('/$provider/$org/$repo/$pr/')({
  loader: async ({ params }): Promise<PRLoaderData> => {
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    const [review, chunks, findings, files] = await Promise.all([
      getReview({ data: { key: reviewKey } }),
      getChunks({ data: { reviewKey } }),
      getFindings({ data: { reviewKey } }),
      getFiles({ data: { reviewKey } }),
    ]);
    return {
      review,
      chunks: chunks as DashboardChunk[],
      findings: findings as DashboardFinding[],
      files: files as DashboardFile[],
    };
  },
  component: PRViewPage,
});

// ─── Center Panel: Diff Viewer Placeholder ────────────────────────────────────

function DiffViewer({ chunks }: { chunks: DashboardChunk[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Diffs</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {chunks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No chunks to display. Run <code>kaiju split</code> to create chunks.
            </p>
          ) : (
            <div className="space-y-4">
              {chunks.map((chunk) => (
                <div key={chunk.slug} className="rounded-md border border-border bg-muted/30 p-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    {chunk.title || chunk.slug}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {chunk.description || 'No description'}
                  </p>
                  {chunk.patch ? (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-sm bg-background p-3 font-mono text-xs text-foreground">
                      {chunk.patch.slice(0, 2000)}
                      {chunk.patch.length > 2000 ? '\n... (truncated)' : ''}
                    </pre>
                  ) : (
                    <p className="mt-2 text-xs italic text-muted-foreground">
                      No patch data available
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Right Panel: Review Summary ──────────────────────────────────────────────

/** Compute summary stats for the review panel. */
function computeSummaryStats(chunks: DashboardChunk[], findings: DashboardFinding[]) {
  const reviewedCount = chunks.filter((c) => c.status === 'reviewed').length;
  const totalChunks = chunks.length;
  const progressPercent = totalChunks > 0 ? Math.round((reviewedCount / totalChunks) * 100) : 0;

  const severityGroups = {
    critical: findings.filter((f) => f.severity === 'critical'),
    suggestion: findings.filter((f) => f.severity === 'suggestion'),
    nitpick: findings.filter((f) => f.severity === 'nitpick'),
    praise: findings.filter((f) => f.severity === 'praise'),
  };

  const reviewerMap = new Map<string, number>();
  for (const f of findings) {
    reviewerMap.set(f.reviewer, (reviewerMap.get(f.reviewer) ?? 0) + 1);
  }

  const totalTokens = chunks.reduce((sum, c) => sum + c.estimatedTokens, 0);
  const reviewedTokens = chunks
    .filter((c) => c.status === 'reviewed')
    .reduce((sum, c) => sum + c.estimatedTokens, 0);

  return {
    reviewedCount,
    totalChunks,
    progressPercent,
    severityGroups,
    reviewerMap,
    totalTokens,
    reviewedTokens,
  };
}

function ReviewSummary({
  review,
  chunks,
  findings,
}: {
  review: PRLoaderData['review'];
  chunks: DashboardChunk[];
  findings: DashboardFinding[];
}) {
  const stats = computeSummaryStats(chunks, findings);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Info</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          {/* PR Summary */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              PR Summary
            </h3>
            <p className="mt-1 text-sm text-foreground">{review.title || 'Untitled review'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {review.repo} #{review.pr} · {review.base} → {review.head}
            </p>
          </section>

          {/* Findings by severity */}
          {findings.length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Findings
              </h3>
              <ul className="mt-2 space-y-1">
                {stats.severityGroups.critical.length > 0 ? (
                  <li className="flex items-center gap-2 text-sm">
                    <span className="text-red-400">■</span>
                    <span className="text-foreground">
                      {stats.severityGroups.critical.length} bugs
                    </span>
                  </li>
                ) : null}
                {stats.severityGroups.suggestion.length > 0 ? (
                  <li className="flex items-center gap-2 text-sm">
                    <span className="text-yellow-400">■</span>
                    <span className="text-foreground">
                      {stats.severityGroups.suggestion.length} suggestions
                    </span>
                  </li>
                ) : null}
                {stats.severityGroups.nitpick.length > 0 ? (
                  <li className="flex items-center gap-2 text-sm">
                    <span className="text-blue-400">□</span>
                    <span className="text-foreground">
                      {stats.severityGroups.nitpick.length} nitpicks
                    </span>
                  </li>
                ) : null}
                {stats.severityGroups.praise.length > 0 ? (
                  <li className="flex items-center gap-2 text-sm">
                    <span className="text-green-400">★</span>
                    <span className="text-foreground">
                      {stats.severityGroups.praise.length} praise
                    </span>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {/* Progress */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Progress
            </h3>
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {stats.reviewedCount}/{stats.totalChunks} chunks
                </span>
                <span>{stats.progressPercent}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${stats.progressPercent}%` }}
                />
              </div>
            </div>
          </section>

          {/* Reviewers */}
          {stats.reviewerMap.size > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Reviewers
              </h3>
              <ul className="mt-2 space-y-1">
                {[...stats.reviewerMap.entries()].map(([reviewer, count]) => (
                  <li
                    key={reviewer}
                    className="flex items-center justify-between text-sm text-foreground"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-primary">●</span>
                      {reviewer}
                    </span>
                    <span className="text-xs text-muted-foreground">({count})</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Token budget */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Token budget
            </h3>
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Reviewed: {stats.reviewedTokens.toLocaleString()}</span>
                <span>Total: {stats.totalTokens.toLocaleString()}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-2 transition-all"
                  style={{
                    width:
                      stats.totalTokens > 0
                        ? `${(stats.reviewedTokens / stats.totalTokens) * 100}%`
                        : '0%',
                  }}
                />
              </div>
            </div>
          </section>

          {/* Back to dashboard link */}
          <section className="border-t border-border pt-4">
            <Link to="/" className="text-xs text-primary hover:underline">
              ← Back to dashboard
            </Link>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PRViewPage() {
  const { review, chunks, findings, files } = Route.useLoaderData();

  const handleFileClick = useCallback((filePath: string) => {
    // Scroll center diff viewer to the file's section
    const fileId = `diff-file-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const el = document.getElementById(fileId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link to="/" className="text-sm font-bold text-primary">
          Kaiju
        </Link>
        <span className="text-border">│</span>
        <span className="text-sm text-muted-foreground">{review.repo}</span>
        <span className="text-sm text-primary">#{review.pr}</span>
        {review.title ? (
          <span className="truncate text-sm text-foreground">— {review.title}</span>
        ) : null}
      </header>

      {/* 3-panel layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        {/* Left panel: Chunk Navigator */}
        <ResizablePanel defaultSize="20%" minSize="12%" maxSize="40%">
          <ChunkNavigator
            chunks={chunks}
            findings={findings}
            files={files}
            onFileClick={handleFileClick}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center panel: Diff Viewer */}
        <ResizablePanel defaultSize="55%" minSize="30%">
          <DiffViewer chunks={chunks} />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel: Review Summary */}
        <ResizablePanel defaultSize="25%" minSize="15%" maxSize="40%">
          <ReviewSummary review={review} chunks={chunks} findings={findings} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
