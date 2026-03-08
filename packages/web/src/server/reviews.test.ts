import { afterEach, describe, expect, it } from 'vitest';

import { readRepoContext } from './reviews.js';

describe('readRepoContext', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns undefined when neither env var is set', () => {
    delete process.env.KAIJU_CONTEXT_ORG;
    delete process.env.KAIJU_CONTEXT_REPO;
    expect(readRepoContext()).toBeUndefined();
  });

  it('returns undefined when only KAIJU_CONTEXT_ORG is set', () => {
    process.env.KAIJU_CONTEXT_ORG = 'acme';
    delete process.env.KAIJU_CONTEXT_REPO;
    expect(readRepoContext()).toBeUndefined();
  });

  it('returns undefined when only KAIJU_CONTEXT_REPO is set', () => {
    delete process.env.KAIJU_CONTEXT_ORG;
    process.env.KAIJU_CONTEXT_REPO = 'widgets';
    expect(readRepoContext()).toBeUndefined();
  });

  it('returns context when both env vars are set', () => {
    process.env.KAIJU_CONTEXT_ORG = 'acme';
    process.env.KAIJU_CONTEXT_REPO = 'widgets';
    expect(readRepoContext()).toEqual({ org: 'acme', repo: 'widgets' });
  });

  it('returns undefined when env vars are empty strings', () => {
    process.env.KAIJU_CONTEXT_ORG = '';
    process.env.KAIJU_CONTEXT_REPO = '';
    expect(readRepoContext()).toBeUndefined();
  });
});
