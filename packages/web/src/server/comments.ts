import { createServerFn } from '@tanstack/react-start';

import { getCommentsFromStore } from './dataAccess.js';
import { getStore } from './store.js';

/**
 * Get all comments for a review, optionally filtered by chunk slug.
 */
export const getComments = createServerFn({ method: 'GET' })
  .inputValidator((data: { reviewKey: string; chunkSlug?: string }) => {
    if (!data.reviewKey || typeof data.reviewKey !== 'string') {
      throw new Error('Review key is required');
    }
    return data;
  })
  .handler(async ({ data }) => {
    const store = getStore();
    return getCommentsFromStore(store, data.reviewKey, data.chunkSlug);
  });
