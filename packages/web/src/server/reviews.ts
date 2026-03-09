import { createServerFn } from '@tanstack/react-start';

import { getDashboardReviewsFromStore, getReviewFromStore } from './dataAccess.js';
import type { DashboardReviewData, RepoContextFilter } from './dataAccess.js';
import { getStore } from './store.js';

// ─── Context helpers ────────────────────────────────────────────────────────────

/**
 * Read repo-context env vars set by `kaiju show` (when run inside a git repo).
 * Returns a filter when both KAIJU_CONTEXT_ORG and KAIJU_CONTEXT_REPO are set.
 */
export function readRepoContext(): RepoContextFilter | undefined {
  const org = process.env.KAIJU_CONTEXT_ORG;
  const repo = process.env.KAIJU_CONTEXT_REPO;
  if (org && repo) {
    return { org, repo };
  }
  return undefined;
}

// ─── Server functions ───────────────────────────────────────────────────────────

/**
 * List all reviews (raw rows).
 */
export const getReviews = createServerFn({ method: 'GET' }).handler(async () => {
  const store = getStore();
  return store.listReviews();
});

/** Dashboard card shape returned by getDashboardReviews. */
export type DashboardReview = DashboardReviewData;

/** Response shape for the dashboard: reviews + optional active context. */
export interface DashboardData {
  reviews: DashboardReview[];
  context: { org: string; repo: string } | null;
}

/**
 * List reviews enriched with stats for the dashboard cards.
 * Applies repo-context filtering when KAIJU_CONTEXT_ORG and KAIJU_CONTEXT_REPO
 * env vars are set (i.e. `kaiju show` was run inside a repo without `--all`).
 */
export const getDashboardReviews = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardData> => {
    const store = getStore();
    const context = readRepoContext();
    const reviews = getDashboardReviewsFromStore(store, context);
    return { reviews, context: context ?? null };
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
