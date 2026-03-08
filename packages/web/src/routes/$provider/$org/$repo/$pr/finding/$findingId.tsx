import { createFileRoute } from '@tanstack/react-router';

import { getFindings } from '@/server/findings.js';
import { getReview } from '@/server/reviews.js';

export const Route = createFileRoute('/$provider/$org/$repo/$pr/finding/$findingId')({
  loader: async ({ params }) => {
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    const [review, allFindings] = await Promise.all([
      getReview({ data: { key: reviewKey } }),
      getFindings({ data: { reviewKey } }),
    ]);

    const finding = allFindings.find((f) => String(f.id) === params.findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${params.findingId}`);
    }

    return { review, finding };
  },
  component: FindingDeepLinkPage,
});

function FindingDeepLinkPage() {
  const { review, finding } = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold text-foreground">Finding #{finding.id}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {review.repo} #{review.pr} — {finding.file}
        {finding.line != null ? `:${finding.line}` : ''}
      </p>
      <div className="mt-4 space-y-2">
        <div className="text-sm">
          <span className="font-semibold text-foreground">Severity:</span>{' '}
          <span className="text-muted-foreground">{finding.severity}</span>
        </div>
        <div className="text-sm">
          <span className="font-semibold text-foreground">Message:</span>{' '}
          <span className="text-muted-foreground">{finding.message}</span>
        </div>
        {finding.rootCause && (
          <div className="text-sm">
            <span className="font-semibold text-foreground">Root cause:</span>{' '}
            <span className="text-muted-foreground">{finding.rootCause}</span>
          </div>
        )}
        {finding.suggestion && (
          <div className="text-sm">
            <span className="font-semibold text-foreground">Suggestion:</span>{' '}
            <span className="text-muted-foreground">{finding.suggestion}</span>
          </div>
        )}
      </div>
    </main>
  );
}
