import { createServerFn } from '@tanstack/react-start';

import { getStore } from './store.js';

/**
 * Get all files for a review, identified by review key.
 */
export const getFiles = createServerFn({ method: 'GET' })
  .inputValidator((data: { reviewKey: string }) => {
    if (!data.reviewKey || typeof data.reviewKey !== 'string') {
      throw new Error('Review key is required');
    }
    return data;
  })
  .handler(async ({ data }) => {
    const store = getStore();
    return store.getFiles(data.reviewKey);
  });
