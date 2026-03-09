import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, chunks, createDB } from '@kaiju/core';
import type { KaijuDB } from '@kaiju/core';
import { eq } from 'drizzle-orm';

let _store: KaijuStore | null = null;

/**
 * Get or create the singleton KaijuStore for server functions.
 * Ensures the ~/.kaiju/ directory exists before opening the SQLite database.
 */
export function getStore(): KaijuStore {
  if (!_store) {
    const baseDir = join(homedir(), '.kaiju');
    mkdirSync(baseDir, { recursive: true });
    const dbPath = join(baseDir, 'kaiju.db');
    const db = createDB(dbPath);
    _store = new KaijuStore(db, baseDir);
  }
  return _store;
}

/**
 * Update a chunk's status to 'reviewed'.
 * Uses the store's DB directly since KaijuStore doesn't expose this operation.
 */
export function setChunkStatus(store: KaijuStore, chunkId: number, status: string): void {
  const db = (store as unknown as { db: KaijuDB }).db;
  db.update(chunks).set({ status }).where(eq(chunks.id, chunkId)).run();
}
