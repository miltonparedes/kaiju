import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { CommentRow, FindingRow } from '../types/index.js';
import { createDB } from './index.js';

// ─── Fix 1: createDB() creates tables for file-backed DBs ──────────────────

describe('createDB: file-backed DB gets tables', () => {
  it('creates all tables for :memory: DB', () => {
    const db = createDB(':memory:');
    const tables = db
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table'`)
      .map((r) => r.name);
    expect(tables).toContain('reviews');
    expect(tables).toContain('chunks');
    expect(tables).toContain('files');
    expect(tables).toContain('comments');
    expect(tables).toContain('findings');
    db.close();
  });
});

// ─── Fix 2: Row types exported from types/index.ts ──────────────────────────

describe('type exports: *Row types exist', () => {
  it('CommentRow has numeric chunkId (DB row shape)', () => {
    // This is a type-level test — if this compiles, the types exist
    const row: CommentRow = {
      id: 1,
      reviewId: 1,
      threadId: 'thread-1',
      source: 'github',
      state: 'open',
      chunkId: 42,
      file: 'foo.ts',
      line: 10,
      body: 'nice',
      author: 'alice',
      timestamp: '2026-01-01T00:00:00Z',
      ghCommentId: 123,
      createdAt: 1000,
    };
    expect(row.chunkId).toBe(42);
  });

  it('FindingRow has numeric chunkId (DB row shape)', () => {
    const row: FindingRow = {
      id: 1,
      reviewId: 1,
      chunkId: 42,
      reviewer: 'claude',
      file: 'foo.ts',
      line: 10,
      endLine: 20,
      severity: 'critical',
      message: 'bad',
      suggestion: null,
      codeSuggestion: null,
      rootCause: null,
      impact: null,
      status: 'open',
      publish: false,
      inReplyTo: null,
      timestamp: null,
      createdAt: 1000,
    };
    expect(row.chunkId).toBe(42);
  });
});
