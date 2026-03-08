import { createFileRoute } from '@tanstack/react-router';

import { getReviews } from '@/server/reviews.js';

export const Route = createFileRoute('/')({
  loader: () => getReviews(),
  component: DashboardPage,
});

function DashboardPage() {
  const reviews = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-background p-8">
      <h1 className="text-3xl font-bold text-foreground">Kaiju</h1>
      <p className="mt-2 text-muted-foreground">Divide, visualize, and share giant PRs</p>
      <div className="mt-8">
        {reviews.length === 0 ? (
          <p className="text-muted-foreground">
            No reviews yet. Run <code className="text-primary">kaiju fetch</code> to get started.
          </p>
        ) : (
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.key} className="text-foreground">
                {r.key} — {r.title || 'Untitled'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
