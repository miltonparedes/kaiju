import { Link, createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Progress } from '@/components/ui/progress.js';
import { getDashboardReviews } from '@/server/reviews.js';
import type { DashboardReview } from '@/server/reviews.js';

export const Route = createFileRoute('/')({
  loader: () => getDashboardReviews(),
  component: DashboardPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a unix timestamp (seconds) as a relative time string. */
function relativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;

  if (diff < 60) {
    return 'just now';
  }
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h}h ago`;
  }
  const d = Math.floor(diff / 86400);
  return `${d}d ago`;
}

// ─── Components ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
      <div className="text-6xl">🦎</div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground">No reviews yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Get started by fetching a PR. Kaiju will divide it into reviewable chunks so you can
          tackle giant PRs piece by piece.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/50 px-6 py-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quick start
        </p>
        <code className="text-sm text-primary">kaiju fetch org/repo#1234</code>
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: DashboardReview }) {
  const { provider, repo, pr, title, chunkCount, reviewedChunkCount } = review;
  const progressPercent = chunkCount > 0 ? Math.round((reviewedChunkCount / chunkCount) * 100) : 0;

  return (
    <Link
      to="/$provider/$org/$repo/$pr"
      params={{
        provider,
        org: repo.split('/')[0]!,
        repo: repo.split('/')[1]!,
        pr: String(pr),
      }}
      className="block transition-colors"
    >
      <Card className="hover:border-primary/40 transition-colors">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">
                <span className="text-muted-foreground">{repo}</span>{' '}
                <span className="text-primary">#{pr}</span>
                {title ? (
                  <>
                    {' — '}
                    <span className="text-foreground">{`"${title}"`}</span>
                  </>
                ) : null}
              </CardTitle>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime(review.updatedAt)}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{review.fileCount} files</span>
            <span className="text-border">│</span>
            <span>{chunkCount} chunks</span>
            <span className="text-border">│</span>
            <span>{reviewedChunkCount} reviewed</span>
            <span className="text-border">│</span>
            <span className="inline-flex items-center gap-1">
              {review.findingCount} findings
              {review.findingCount > 0 ? (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {review.findingCount}
                </Badge>
              ) : null}
            </span>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <Progress value={progressPercent} className="h-2 flex-1" />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {reviewedChunkCount}/{chunkCount}
            </span>
          </div>

          {/* Open link */}
          <div className="flex justify-end pt-1">
            <span className="text-sm font-medium text-primary">Open →</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DashboardPage() {
  const reviews = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Kaiju</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {reviews.length > 0
            ? `${reviews.length} active review${reviews.length === 1 ? '' : 's'}`
            : 'Divide, visualize, and share giant PRs'}
        </p>
      </header>

      {/* Content */}
      {reviews.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <ReviewCard key={r.key} review={r} />
          ))}
        </div>
      )}
    </main>
  );
}
