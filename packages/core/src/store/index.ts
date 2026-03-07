import { Database } from 'bun:sqlite';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import * as schema from './schema.js';

export function createDB(path = ':memory:') {
  const sqlite = new Database(path);
  const db = drizzle(sqlite, { schema });

  if (path === ':memory:') {
    db.run(sql`CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      head_branch TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    db.run(sql`CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      pr_id INTEGER NOT NULL REFERENCES pull_requests(id),
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    db.run(sql`CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY,
      chunk_id INTEGER NOT NULL REFERENCES chunks(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER
    )`);
  }

  return Object.assign(db, { close: () => sqlite.close() });
}

export * from './schema.js';
