import { createServerFn } from '@tanstack/react-start';

import { getFindingsFromStore } from './dataAccess.js';
import { getStore } from './store.js';

/**
 * Get all findings for a review, optionally filtered by chunk slug.
 */
export const getFindings = createServerFn({ method: 'GET' })
  .inputValidator((data: { reviewKey: string; chunkSlug?: string }) => {
    if (!data.reviewKey || typeof data.reviewKey !== 'string') {
      throw new Error('Review key is required');
    }
    return data;
  })
  .handler(async ({ data }) => {
    const store = getStore();
    return getFindingsFromStore(store, data.reviewKey, data.chunkSlug);
  });
