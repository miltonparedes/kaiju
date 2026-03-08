import { describe, expect, it } from 'vitest';

import { createDB } from './index.js';
import { KaijuStore } from './kaijuStore.js';

function makeStore() {
  const db = createDB();
  // Use a dummy base dir — unit tests don't hit filesystem
  return new KaijuStore(db, '/tmp/fake-kaiju');
}

describe('KaijuStore constructor', () => {
  it('creates a store instance', () => {
    const store = makeStore();
    expect(store).toBeDefined();
    store.close();
  });
});

describe('KaijuStore.createReview', () => {
  it('requires a valid review key format', async () => {
    const store = makeStore();
    await expect(
      store.createReview({
        key: 'invalid-key',
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      }),
    ).rejects.toThrow();
    store.close();
  });
});

describe('KaijuStore.getReview', () => {
  it('returns undefined for non-existent review', () => {
    const store = makeStore();
    const review = store.getReview('github/acme/widgets/99999');
    expect(review).toBeUndefined();
    store.close();
  });
});

describe('KaijuStore.updateReviewStatus', () => {
  it('throws for non-existent review', async () => {
    const store = makeStore();
    await expect(store.updateReviewStatus('github/acme/widgets/99999', 'split')).rejects.toThrow();
    store.close();
  });
});

describe('KaijuStore.getFiles', () => {
  it('returns empty array for non-existent review', () => {
    const store = makeStore();
    const files = store.getFiles('github/acme/widgets/99999');
    expect(files).toEqual([]);
    store.close();
  });
});

describe('KaijuStore.getChunks', () => {
  it('returns empty array for non-existent review', () => {
    const store = makeStore();
    const chunks = store.getChunks('github/acme/widgets/99999');
    expect(chunks).toEqual([]);
    store.close();
  });
});

describe('KaijuStore.getComments', () => {
  it('returns empty array for non-existent review', () => {
    const store = makeStore();
    const comments = store.getComments('github/acme/widgets/99999');
    expect(comments).toEqual([]);
    store.close();
  });
});

describe('KaijuStore.getFindings', () => {
  it('returns empty array for non-existent review', () => {
    const store = makeStore();
    const findings = store.getFindings('github/acme/widgets/99999');
    expect(findings).toEqual([]);
    store.close();
  });
});

describe('KaijuStore.listReviews', () => {
  it('returns empty array when no reviews exist', () => {
    const store = makeStore();
    const reviews = store.listReviews();
    expect(reviews).toEqual([]);
    store.close();
  });
});

describe('KaijuStore.deleteReview', () => {
  it('returns false for non-existent review', async () => {
    const store = makeStore();
    const deleted = await store.deleteReview('github/acme/widgets/99999');
    expect(deleted).toBe(false);
    store.close();
  });
});
