import { createFileRoute } from '@tanstack/react-router';

import { getChunks } from '@/server/chunks.js';
import { getReview } from '@/server/reviews.js';

export const Route = createFileRoute('/$provider/$org/$repo/$pr/')({
  loader: async ({ params }) => {
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    const [review, chunks] = await Promise.all([
      getReview({ data: { key: reviewKey } }),
      getChunks({ data: { reviewKey } }),
    ]);
    return { review, chunks };
  },
  component: PRViewPage,
});

function PRViewPage() {
  const { review, chunks } = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold text-foreground">{review.title || review.key}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {review.repo} #{review.pr} — {review.status}
      </p>
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-foreground">Chunks ({chunks.length})</h2>
        {chunks.length === 0 ? (
          <p className="mt-2 text-muted-foreground">No chunks yet. Run kaiju split first.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {chunks.map((c) => (
              <li key={c.slug} className="text-foreground">
                {c.slug} — {c.title || 'Untitled'} ({c.estimatedTokens} tokens)
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
