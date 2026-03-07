import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDB } from './index.js';
import { chunkDeps, chunks, comments, files, findings, imports, reviews } from './schema.js';

function testReviewKey(pr = 1) {
  return `github/acme/widgets/${pr}`;
}

describe('store integration', () => {
  it('creates an in-memory database', () => {
    const db = createDB();
    expect(db).toBeDefined();
    db.close();
  });

  it('creates all 7 tables', () => {
    const db = createDB();
    const tables = db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name`,
      )
      .map((r) => r.name);

    expect(tables).toEqual([
      'chunk_deps',
      'chunks',
      'comments',
      'files',
      'findings',
      'imports',
      'reviews',
    ]);
    db.close();
  });

  it('creates FTS5 virtual tables for findings and comments', () => {
    const db = createDB();
    const vtables = db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts' ORDER BY name`,
      )
      .map((r) => r.name);

    expect(vtables).toEqual(['comments_fts', 'findings_fts']);
    db.close();
  });

  it('enforces foreign key constraints (PRAGMA foreign_keys = ON)', () => {
    const db = createDB();

    // Attempt to insert a file with a non-existent review_id
    expect(() => {
      db.insert(files)
        .values({
          reviewId: 99_999,
          path: 'src/test.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
        })
        .run();
    }).toThrow();

    db.close();
  });

  it('enforces FK on findings with non-existent chunk', () => {
    const db = createDB();

    // First create a valid review
    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      })
      .run();

    // Attempt to insert a finding with a non-existent chunk_id
    expect(() => {
      db.insert(findings)
        .values({
          reviewId: 1,
          chunkId: 99_999,
          file: 'src/test.ts',
          message: 'Test finding',
        })
        .run();
    }).toThrow();

    db.close();
  });

  it('can insert and query reviews', () => {
    const db = createDB();
    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
        title: 'Test PR',
        url: 'https://github.com/org/repo/pull/1',
        base: 'main',
        head: 'feature',
      })
      .run();

    const rows = db.select().from(reviews).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Test PR');
    expect(rows[0]!.status).toBe('fetched');
    expect(rows[0]!.createdAt).toBeGreaterThan(0);
    db.close();
  });

  it('enforces unique composite index on files (review_id, path)', () => {
    const db = createDB();
    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      })
      .run();

    db.insert(files)
      .values({
        reviewId: 1,
        path: 'src/auth.ts',
        status: 'modified',
        additions: 10,
        deletions: 5,
      })
      .run();

    // Duplicate (review_id, path) should fail
    expect(() => {
      db.insert(files)
        .values({
          reviewId: 1,
          path: 'src/auth.ts',
          status: 'added',
          additions: 1,
          deletions: 0,
        })
        .run();
    }).toThrow();

    db.close();
  });

  it('default timestamps auto-populate on insert', () => {
    const db = createDB();
    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      })
      .run();

    const rows = db.select().from(reviews).all();
    expect(rows[0]!.createdAt).toBeGreaterThan(0);
    expect(rows[0]!.updatedAt).toBeGreaterThan(0);
    db.close();
  });

  it('supports FTS5 search on findings', () => {
    const db = createDB();

    // Create review and finding
    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      })
      .run();

    db.insert(findings)
      .values({
        reviewId: 1,
        file: 'src/auth/session.ts',
        line: 45,
        severity: 'critical',
        message: 'Session rotation vulnerability detected',
        suggestion: 'Call rotateSession() after role change',
        rootCause: 'Old session token remains valid after privilege escalation',
      })
      .run();

    // FTS5 search for 'rotation'
    const results = db.all<{ message: string }>(
      sql`SELECT message FROM findings_fts WHERE findings_fts MATCH 'rotation'`,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.message).toContain('rotation');

    db.close();
  });

  it('supports FTS5 search on comments', () => {
    const db = createDB();

    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      })
      .run();

    db.insert(comments)
      .values({
        reviewId: 1,
        threadId: 'gh-review-123',
        source: 'github',
        body: 'This needs session rotation after role change',
        author: 'github:alice',
      })
      .run();

    const results = db.all<{ body: string }>(
      sql`SELECT body FROM comments_fts WHERE comments_fts MATCH 'rotation'`,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.body).toContain('rotation');

    db.close();
  });

  it('cascade deletes files when review is deleted', () => {
    const db = createDB();
    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
      })
      .run();

    db.insert(files)
      .values({
        reviewId: 1,
        path: 'src/test.ts',
        status: 'modified',
        additions: 10,
        deletions: 5,
      })
      .run();

    expect(db.select().from(files).all()).toHaveLength(1);

    db.delete(reviews).run();
    expect(db.select().from(files).all()).toHaveLength(0);

    db.close();
  });

  it('can insert and query all entity types', () => {
    const db = createDB();

    // Review
    db.insert(reviews)
      .values({
        key: testReviewKey(),
        provider: 'github',
        repo: 'acme/widgets',
        pr: 1,
        title: 'Big PR',
      })
      .run();

    // Chunk
    db.insert(chunks)
      .values({
        reviewId: 1,
        slug: '001-auth',
        title: 'Auth refactor',
        reviewPriority: 'high',
        estimatedTokens: 2800,
      })
      .run();

    // File assigned to chunk
    db.insert(files)
      .values({
        reviewId: 1,
        path: 'src/auth.ts',
        status: 'modified',
        additions: 120,
        deletions: 30,
        chunkId: 1,
      })
      .run();

    // Import
    db.insert(imports)
      .values({
        reviewId: 1,
        source: 'src/auth.ts',
        target: 'src/types.ts',
      })
      .run();

    // Chunk dep
    db.insert(chunks)
      .values({
        reviewId: 1,
        slug: '002-api',
        title: 'API endpoints',
      })
      .run();

    db.insert(chunkDeps)
      .values({
        sourceChunkId: 1,
        targetChunkId: 2,
      })
      .run();

    // Comment
    db.insert(comments)
      .values({
        reviewId: 1,
        threadId: 'gh-123',
        source: 'github',
        file: 'src/auth.ts',
        line: 45,
        body: 'Needs session rotation',
        author: 'github:alice',
        chunkId: 1,
      })
      .run();

    // Finding
    db.insert(findings)
      .values({
        reviewId: 1,
        chunkId: 1,
        reviewer: 'claude-code',
        file: 'src/auth.ts',
        line: 45,
        severity: 'critical',
        message: 'Session token vulnerability',
      })
      .run();

    // Verify all entities
    expect(db.select().from(reviews).all()).toHaveLength(1);
    expect(db.select().from(files).all()).toHaveLength(1);
    expect(db.select().from(imports).all()).toHaveLength(1);
    expect(db.select().from(chunks).all()).toHaveLength(2);
    expect(db.select().from(chunkDeps).all()).toHaveLength(1);
    expect(db.select().from(comments).all()).toHaveLength(1);
    expect(db.select().from(findings).all()).toHaveLength(1);

    db.close();
  });

  it('exposes close method to release the sqlite connection', () => {
    const db = createDB();
    expect(typeof db.close).toBe('function');
    db.close();
  });
});
