import { describe, expect, it } from 'vitest';

import { getReviewDir, parseReviewKey } from './fileIO.js';
import { createDB } from './index.js';
import { KaijuStore } from './kaijuStore.js';

function makeStore() {
  const db = createDB();
  return new KaijuStore(db, '/tmp/fake-kaiju');
}

// ─── Path traversal: parseReviewKey ─────────────────────────────────────────

describe('parseReviewKey path traversal hardening', () => {
  it('rejects keys with more than 4 segments', () => {
    expect(() => parseReviewKey('github/org/repo/42/extra')).toThrow(/exactly 4 segments/i);
  });

  it('rejects keys with 5+ segments even if first 4 are valid', () => {
    expect(() => parseReviewKey('github/org/repo/7/../../etc/passwd')).toThrow();
  });

  it('rejects keys with ".." in provider segment', () => {
    expect(() => parseReviewKey('../evil/repo/42')).toThrow(/\.\./);
  });

  it('rejects keys with ".." in org segment', () => {
    expect(() => parseReviewKey('github/../repo/42')).toThrow(/\.\./);
  });

  it('rejects keys with ".." in repo segment', () => {
    expect(() => parseReviewKey('github/org/../42')).toThrow(/\.\./);
  });

  it('rejects keys with ".." embedded in pr segment', () => {
    // PR segment is numeric-only, so ".." will fail the parseInt check anyway,
    // But we should also reject explicit ".." in any segment
    expect(() => parseReviewKey('github/org/repo/..')).toThrow();
  });

  it('still accepts valid 4-segment keys', () => {
    const key = parseReviewKey('github/acme/widgets/42');
    expect(key).toEqual({ provider: 'github', org: 'acme', repo: 'widgets', pr: 42 });
  });

  it('still accepts keys with hyphens and underscores', () => {
    const key = parseReviewKey('github/my-org/my_repo/123');
    expect(key).toEqual({ provider: 'github', org: 'my-org', repo: 'my_repo', pr: 123 });
  });
});

// ─── Path traversal: getReviewDir ───────────────────────────────────────────

describe('getReviewDir builds path from parsed fields', () => {
  it('builds path from a valid key using parsed fields', () => {
    const dir = getReviewDir('github/acme/widgets/42', '/home/user/.kaiju');
    expect(dir).toBe('/home/user/.kaiju/reviews/github/acme/widgets/42');
  });

  it('rejects a key with path traversal segments', () => {
    // Validates and rejects malicious keys
    expect(() => getReviewDir('github/../../../etc/passwd', '/home/user/.kaiju')).toThrow();
  });

  it('rejects a key with more than 4 segments', () => {
    expect(() => getReviewDir('github/org/repo/42/extra', '/home/user/.kaiju')).toThrow();
  });
});

// ─── createReview rejects path traversal keys ───────────────────────────────

describe('KaijuStore.createReview rejects path traversal', () => {
  it('rejects keys with ".." segments', async () => {
    const store = makeStore();
    const badKey = ['github', '..', '..', '..', 'etc', 'passwd'].join('/');
    await expect(
      store.createReview({
        key: badKey,
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      }),
    ).rejects.toThrow();
    store.close();
  });

  it('rejects keys with more than 4 segments', async () => {
    const store = makeStore();
    const badKey = ['github', 'org', 'repo', '42', 'extra'].join('/');
    await expect(
      store.createReview({
        key: badKey,
        provider: 'github',
        repo: 'acme/widgets',
        pr: 42,
      }),
    ).rejects.toThrow();
    store.close();
  });
});
