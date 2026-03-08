import { createServerFn } from '@tanstack/react-start';

import { getStore } from './store.js';

/**
 * List all reviews.
 */
export const getReviews = createServerFn({ method: 'GET' }).handler(async () => {
  const store = getStore();
  return store.listReviews();
});

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
