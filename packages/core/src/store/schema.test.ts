import { describe, expect, it } from 'vitest';

import { pullRequests, chunks, findings } from './schema.js';

describe('schema', () => {
  it('defines pullRequests table', () => {
    expect(pullRequests).toBeDefined();
  });

  it('defines chunks table', () => {
    expect(chunks).toBeDefined();
  });

  it('defines findings table', () => {
    expect(findings).toBeDefined();
  });
});
