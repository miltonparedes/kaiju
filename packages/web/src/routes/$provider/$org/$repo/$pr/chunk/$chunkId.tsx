import { createFileRoute } from '@tanstack/react-router';

import { getChunk } from '@/server/chunks.js';
import { getComments } from '@/server/comments.js';
import { getFindings } from '@/server/findings.js';
import { getReview } from '@/server/reviews.js';

export const Route = createFileRoute('/$provider/$org/$repo/$pr/chunk/$chunkId')({
  loader: async ({ params }) => {
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    const [review, chunk, findings, comments] = await Promise.all([
      getReview({ data: { key: reviewKey } }),
      getChunk({ data: { reviewKey, chunkSlug: params.chunkId } }),
      getFindings({ data: { reviewKey, chunkSlug: params.chunkId } }),
      getComments({ data: { reviewKey, chunkSlug: params.chunkId } }),
    ]);
    return { review, chunk, findings, comments };
  },
  component: ChunkDeepLinkPage,
});

function ChunkDeepLinkPage() {
  const { review, chunk, findings, comments } = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold text-foreground">{chunk.title || chunk.slug}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {review.repo} #{review.pr} — Chunk: {chunk.slug}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-muted-foreground">
        <div>Priority: {chunk.reviewPriority}</div>
        <div>Tokens: {chunk.estimatedTokens}</div>
        <div>Files: {chunk.files.length}</div>
        <div>Status: {chunk.status}</div>
        <div>Findings: {findings.length}</div>
        <div>Comments: {comments.length}</div>
      </div>
    </main>
  );
}
