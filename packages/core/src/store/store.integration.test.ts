import { describe, expect, it } from 'vitest';

import { createDB } from './index.js';
import { pullRequests } from './schema.js';

describe('store integration', () => {
  it('creates an in-memory database', () => {
    const db = createDB();
    expect(db).toBeDefined();
  });

  it('can insert and query pull requests', () => {
    const db = createDB();
    db.insert(pullRequests)
      .values({
        number: 1,
        title: 'Test PR',
        url: 'https://github.com/test/repo/pull/1',
        provider: 'github',
        baseBranch: 'main',
        headBranch: 'feature',
      })
      .run();

    const rows = db.select().from(pullRequests).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Test PR');
  });
});
