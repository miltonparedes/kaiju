import type { KaijuStore } from '@kaiju/core';

// ─── Data access functions ──────────────────────────────────────────────────────
// These are the underlying functions that server functions delegate to.
// They accept a KaijuStore instance, making them testable without TanStack Start.

/** Dashboard card shape returned by getDashboardReviewsFromStore. */
export interface DashboardReviewData {
  key: string;
  provider: string;
  repo: string;
  pr: number;
  title: string;
  url: string;
  body: string;
  status: string;
  fileCount: number;
  chunkCount: number;
  reviewedChunkCount: number;
  findingCount: number;
  updatedAt: number;
}

/** Optional context filter for scoping reviews to a specific repo. */
export interface RepoContextFilter {
  org: string;
  repo: string;
}

/**
 * Enrich all reviews with stats for the dashboard cards.
 * When a context filter is provided, only reviews matching `{org}/{repo}` are returned.
 * Returns file count, chunk count, reviewed-chunk count, finding count,
 * and updatedAt timestamp per review.
 */
export function getDashboardReviewsFromStore(
  store: KaijuStore,
  context?: RepoContextFilter,
): DashboardReviewData[] {
  let reviews = store.listReviews();

  if (context) {
    const target = `${context.org}/${context.repo}`;
    reviews = reviews.filter((r) => r.repo === target);
  }

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
      body: r.body,
      status: r.status,
      fileCount: files.length,
      chunkCount: chunks.length,
      reviewedChunkCount,
      findingCount: findings.length,
      updatedAt: r.updatedAt,
    };
  });
}

/**
 * Get a single review by key. Throws if not found.
 */
export function getReviewFromStore(store: KaijuStore, key: string) {
  const review = store.getReview(key);
  if (!review) {
    throw new Error(`Review not found: ${key}`);
  }
  return review;
}

/**
 * Get all chunks for a review.
 */
export function getChunksFromStore(store: KaijuStore, reviewKey: string) {
  return store.getChunks(reviewKey);
}

/**
 * Get a single chunk by slug, including its associated files.
 */
export function getChunkFromStore(store: KaijuStore, reviewKey: string, chunkSlug: string) {
  const chunks = store.getChunks(reviewKey);
  const chunk = chunks.find((c) => c.slug === chunkSlug);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkSlug}`);
  }

  const allFiles = store.getFiles(reviewKey);
  const chunkFiles = allFiles.filter((f) => f.chunkId === chunk.id);

  return { ...chunk, files: chunkFiles };
}

/**
 * Get all findings for a review, optionally filtered by chunk slug.
 */
export function getFindingsFromStore(store: KaijuStore, reviewKey: string, chunkSlug?: string) {
  const allFindings = store.getFindings(reviewKey);

  if (!chunkSlug) {
    return allFindings;
  }

  const chunks = store.getChunks(reviewKey);
  const chunk = chunks.find((c) => c.slug === chunkSlug);
  if (!chunk) {
    return [];
  }

  return allFindings.filter((f) => f.chunkId === chunk.id);
}

/**
 * Get all comments for a review, optionally filtered by chunk slug.
 */
export function getCommentsFromStore(store: KaijuStore, reviewKey: string, chunkSlug?: string) {
  const allComments = store.getComments(reviewKey);

  if (!chunkSlug) {
    return allComments;
  }

  const chunks = store.getChunks(reviewKey);
  const chunk = chunks.find((c) => c.slug === chunkSlug);
  if (!chunk) {
    return [];
  }

  return allComments.filter((c) => c.chunkId === chunk.id);
}

/**
 * Get all files for a review.
 */
export function getFilesFromStore(store: KaijuStore, reviewKey: string) {
  return store.getFiles(reviewKey);
}
