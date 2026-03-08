import { createServerFn } from '@tanstack/react-start';

import { getChunkFromStore, getChunksFromStore } from './dataAccess.js';
import { getStore, setChunkStatus } from './store.js';

/**
 * Get all chunks for a review, identified by review key.
 */
export const getChunks = createServerFn({ method: 'GET' })
  .inputValidator((data: { reviewKey: string }) => {
    if (!data.reviewKey || typeof data.reviewKey !== 'string') {
      throw new Error('Review key is required');
    }
    return data;
  })
  .handler(async ({ data }) => {
    const store = getStore();
    return getChunksFromStore(store, data.reviewKey);
  });

/**
 * Get a single chunk by its slug, including its associated files.
 */
export const getChunk = createServerFn({ method: 'GET' })
  .inputValidator((data: { reviewKey: string; chunkSlug: string }) => {
    if (!data.reviewKey || typeof data.reviewKey !== 'string') {
      throw new Error('Review key is required');
    }
    if (!data.chunkSlug || typeof data.chunkSlug !== 'string') {
      throw new Error('Chunk slug is required');
    }
    return data;
  })
  .handler(async ({ data }) => {
    const store = getStore();
    return getChunkFromStore(store, data.reviewKey, data.chunkSlug);
  });

/** Resolve a chunk by slug from a review, throwing if not found. */
function resolveChunk(reviewKey: string, chunkSlug: string) {
  const store = getStore();
  if (!store.getReview(reviewKey)) {
    throw new Error(`Review not found: ${reviewKey}`);
  }
  const chunk = store.getChunks(reviewKey).find((c) => c.slug === chunkSlug);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkSlug}`);
  }
  return { store, chunk };
}

/**
 * Mark a chunk as reviewed.
 * Updates the chunk status in the store.
 */
export const markChunkReviewed = createServerFn({ method: 'POST' })
  .inputValidator((data: { reviewKey: string; chunkSlug: string }) => {
    if (!data.reviewKey || typeof data.reviewKey !== 'string') {
      throw new Error('Review key is required');
    }
    if (!data.chunkSlug || typeof data.chunkSlug !== 'string') {
      throw new Error('Chunk slug is required');
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { store, chunk } = resolveChunk(data.reviewKey, data.chunkSlug);
    setChunkStatus(store, chunk.id, 'reviewed');
    await store.syncManifestPublic(data.reviewKey);
    return { ...chunk, status: 'reviewed' };
  });
