import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const pullRequests = sqliteTable('pull_requests', {
  id: integer('id').primaryKey(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  provider: text('provider').notNull(),
  baseBranch: text('base_branch').notNull(),
  headBranch: text('head_branch').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export const chunks = sqliteTable('chunks', {
  id: integer('id').primaryKey(),
  prId: integer('pr_id')
    .notNull()
    .references(() => pullRequests.id),
  label: text('label').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export const findings = sqliteTable('findings', {
  id: integer('id').primaryKey(),
  chunkId: integer('chunk_id')
    .notNull()
    .references(() => chunks.id),
  type: text('type').notNull(),
  message: text('message').notNull(),
  file: text('file').notNull(),
  line: integer('line'),
});
