import { createServerFn } from '@tanstack/react-start';

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
    const allComments = store.getComments(data.reviewKey);

    if (!data.chunkSlug) {
      return allComments;
    }

    // Filter by chunk slug — resolve slug to numeric chunk ID first
    const chunks = store.getChunks(data.reviewKey);
    const chunk = chunks.find((c) => c.slug === data.chunkSlug);
    if (!chunk) {
      return [];
    }

    return allComments.filter((c) => c.chunkId === chunk.id);
  });
