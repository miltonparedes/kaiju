import { createServerFn } from '@tanstack/react-start';

import { getDashboardReviewsFromStore, getReviewFromStore } from './dataAccess.js';
import type { DashboardReviewData } from './dataAccess.js';
import { getStore } from './store.js';

/**
 * List all reviews (raw rows).
 */
export const getReviews = createServerFn({ method: 'GET' }).handler(async () => {
  const store = getStore();
  return store.listReviews();
});

/** Dashboard card shape returned by getDashboardReviews. */
export type DashboardReview = DashboardReviewData;

/**
 * List all reviews enriched with stats for the dashboard cards.
 * Returns file count, chunk count, reviewed-chunk count, finding count,
 * and updatedAt timestamp per review.
 */
export const getDashboardReviews = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardReview[]> => {
    const store = getStore();
    return getDashboardReviewsFromStore(store);
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
    return getReviewFromStore(store, data.key);
  });
