import { createServerFn } from '@tanstack/react-start';

import { getStore } from './store.js';

/**
 * List all reviews (raw rows).
 */
export const getReviews = createServerFn({ method: 'GET' }).handler(async () => {
  const store = getStore();
  return store.listReviews();
});

/** Dashboard card shape returned by getDashboardReviews. */
export interface DashboardReview {
  key: string;
  provider: string;
  repo: string;
  pr: number;
  title: string;
  url: string;
  status: string;
  fileCount: number;
  chunkCount: number;
  reviewedChunkCount: number;
  findingCount: number;
  updatedAt: number;
}

/**
 * List all reviews enriched with stats for the dashboard cards.
 * Returns file count, chunk count, reviewed-chunk count, finding count,
 * and updatedAt timestamp per review.
 */
export const getDashboardReviews = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardReview[]> => {
    const store = getStore();
    const reviews = store.listReviews();

    return reviews.map((r) => {
      const files = store.getFiles(r.key);
      const chunks = store.getChunks(r.key);
      const findings = store.getFindings(r.key);
      const reviewedChunkCount = chunks.filter((c) => c.status === 'reviewed').length;

      return {
        key: r.key,
        provider: r.provider,
        repo: r.repo,
        pr: r.pr,
        title: r.title,
        url: r.url,
        status: r.status,
        fileCount: files.length,
        chunkCount: chunks.length,
        reviewedChunkCount,
        findingCount: findings.length,
        updatedAt: r.updatedAt,
      };
    });
  },
);

/**
 * Get a single review by its key (e.g. "github/org/repo/123").
 */
export const getReview = createServerFn({ method: 'GET' })
  .inputValidator((data: { key: string }) => {
    if (!data.key || typeof data.key !== 'string') {
      throw new Error('Review key is required');
    }
    return data;
  })
  .handler(async ({ data }) => {
    const store = getStore();
    const review = store.getReview(data.key);
    if (!review) {
      throw new Error(`Review not found: ${data.key}`);
    }
    return review;
  });
