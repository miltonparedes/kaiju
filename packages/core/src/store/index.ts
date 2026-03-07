import { Database } from 'bun:sqlite';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import * as schema from './schema.js';

export type KaijuDB = ReturnType<typeof createDB>;

export function createDB(path = ':memory:') {
  const sqlite = new Database(path);
  const db = drizzle(sqlite, { schema });

  // Enable foreign key enforcement
  db.run(sql`PRAGMA foreign_keys = ON`);

  if (path === ':memory:') {
    createTables(db);
  }

  return Object.assign(db, { close: () => sqlite.close() });
}

type DB = ReturnType<typeof drizzle>;

function createCoreTables(db: DB) {
  db.run(sql`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    repo TEXT NOT NULL,
    pr INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    base TEXT NOT NULL DEFAULT '',
    head TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'fetched',
    raw_diff TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    review_priority TEXT NOT NULL DEFAULT 'medium',
    estimated_tokens INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_review_slug ON chunks(review_id, slug)`);

  db.run(sql`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'modified',
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    chunk_id INTEGER REFERENCES chunks(id) ON DELETE SET NULL
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_files_review_path ON files(review_id, path)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_files_chunk ON files(chunk_id)`);

  db.run(sql`CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    target TEXT NOT NULL
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_imports_review_source ON imports(review_id, source)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_imports_review_target ON imports(review_id, target)`);
}

function createChunkDepsTable(db: DB) {
  db.run(sql`CREATE TABLE IF NOT EXISTS chunk_deps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    target_chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE
  )`);
  db.run(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_chunk_deps_pair ON chunk_deps(source_chunk_id, target_chunk_id)`,
  );
}

function createCommentsTable(db: DB) {
  db.run(sql`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'github',
    state TEXT NOT NULL DEFAULT 'open',
    chunk_id INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
    file TEXT,
    line INTEGER,
    body TEXT NOT NULL DEFAULT '',
    author TEXT,
    timestamp TEXT,
    gh_comment_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_comments_review_file_line ON comments(review_id, file, line)`,
  );
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_comments_chunk ON comments(chunk_id)`);
}

function createFindingsTable(db: DB) {
  db.run(sql`CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    chunk_id INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
    reviewer TEXT NOT NULL DEFAULT '',
    file TEXT NOT NULL,
    line INTEGER,
    end_line INTEGER,
    severity TEXT NOT NULL DEFAULT 'suggestion',
    message TEXT NOT NULL,
    suggestion TEXT,
    code_suggestion TEXT,
    root_cause TEXT,
    impact TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    publish INTEGER NOT NULL DEFAULT 0,
    in_reply_to TEXT,
    timestamp TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_findings_review_file_line ON findings(review_id, file, line)`,
  );
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_findings_reviewer ON findings(reviewer)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_findings_chunk ON findings(chunk_id)`);
}

function createFTS(db: DB) {
  db.run(
    sql`CREATE VIRTUAL TABLE IF NOT EXISTS findings_fts USING fts5(message, suggestion, root_cause, content=findings, content_rowid=id)`,
  );
  db.run(
    sql`CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(body, content=comments, content_rowid=id)`,
  );

  // Auto-sync triggers for findings FTS
  db.run(sql`CREATE TRIGGER IF NOT EXISTS findings_ai AFTER INSERT ON findings BEGIN
    INSERT INTO findings_fts(rowid, message, suggestion, root_cause)
    VALUES (new.id, new.message, new.suggestion, new.root_cause);
  END`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS findings_ad AFTER DELETE ON findings BEGIN
    INSERT INTO findings_fts(findings_fts, rowid, message, suggestion, root_cause)
    VALUES ('delete', old.id, old.message, old.suggestion, old.root_cause);
  END`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS findings_au AFTER UPDATE ON findings BEGIN
    INSERT INTO findings_fts(findings_fts, rowid, message, suggestion, root_cause)
    VALUES ('delete', old.id, old.message, old.suggestion, old.root_cause);
    INSERT INTO findings_fts(rowid, message, suggestion, root_cause)
    VALUES (new.id, new.message, new.suggestion, new.root_cause);
  END`);

  // Auto-sync triggers for comments FTS
  db.run(sql`CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
    INSERT INTO comments_fts(rowid, body) VALUES (new.id, new.body);
  END`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
    INSERT INTO comments_fts(comments_fts, rowid, body)
    VALUES ('delete', old.id, old.body);
  END`);
  db.run(sql`CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE ON comments BEGIN
    INSERT INTO comments_fts(comments_fts, rowid, body)
    VALUES ('delete', old.id, old.body);
    INSERT INTO comments_fts(rowid, body) VALUES (new.id, new.body);
  END`);
}

export function createTables(db: DB) {
  createCoreTables(db);
  createChunkDepsTable(db);
  createCommentsTable(db);
  createFindingsTable(db);
  createFTS(db);
}

export * from './schema.js';
export * from './fileIO.js';
export * from './fileTypes.js';
