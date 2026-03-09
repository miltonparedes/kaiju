import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ChunkMetaJson,
  CommentFileJson,
  FindingFileJson,
  ManifestJson,
} from '../store/fileTypes.js';
import { createDB } from '../store/index.js';
import { KaijuStore } from '../store/kaijuStore.js';
import { splitAndPersist } from './splitAndPersist.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makePatch(filePaths: string[]): string {
  return filePaths
    .map(
      (p) =>
        `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,3 +1,5 @@\n+added line 1\n+added line 2\n context\n-removed\n`,
    )
    .join('');
}

const REVIEW_KEY = 'github/acme/widgets/42';

let testDir: string;
let store: KaijuStore;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `kaiju-split-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const db = createDB(':memory:');
  store = new KaijuStore(db, testDir);
});

afterEach(async () => {
  store.close();
  await rm(testDir, { recursive: true, force: true }).catch(() => {});
});

async function createTestReview(filePaths: string[], rawDiff?: string) {
  await store.createReview({
    key: REVIEW_KEY,
    provider: 'github',
    repo: 'acme/widgets',
    pr: 42,
    title: 'Test PR',
    url: 'https://github.com/acme/widgets/pull/42',
    base: 'main',
    head: 'feature',
    rawDiff: rawDiff ?? makePatch(filePaths),
  });
  await store.addFiles(
    REVIEW_KEY,
    filePaths.map((p) => ({
      path: p,
      status: 'modified' as const,
      additions: 10,
      deletions: 5,
    })),
  );
}

function reviewDir(): string {
  return join(testDir, 'reviews', 'github', 'acme', 'widgets', '42');
}

// ─── VAL-SPLIT-004: .patch files contain valid unified diff ─────────────────

describe('VAL-SPLIT-004: .patch files start with diff --git', () => {
  it('generates .patch files with diff --git headers', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

    const dbChunks = store.getChunks(REVIEW_KEY);
    for (const chunk of dbChunks) {
      const patchPath = join(reviewDir(), 'chunks', `${chunk.slug}.patch`);
      expect(existsSync(patchPath)).toBe(true);

      const content = await readFile(patchPath, 'utf-8');
      expect(content).toMatch(/^diff --git/);
      expect(content).toContain('@@');
    }
  });

  it('patch files contain unified diff hunks for exactly the chunk files', async () => {
    const filePaths = ['src/auth/session.ts', 'src/auth/jwt.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    const plan = JSON.stringify({
      chunks: [
        { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
        { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
      ],
    });

    await splitAndPersist(store, REVIEW_KEY, { strategy: 'plan', plan });

    // Auth chunk should have auth files in its patch
    const authPatch = await readFile(join(reviewDir(), 'chunks', '001-auth.patch'), 'utf-8');
    expect(authPatch).toContain('src/auth/session.ts');
    expect(authPatch).toContain('src/auth/jwt.ts');
    expect(authPatch).not.toContain('src/routes/api.ts');

    // Routes chunk should only have routes files
    const routesPatch = await readFile(join(reviewDir(), 'chunks', '002-routes.patch'), 'utf-8');
    expect(routesPatch).toContain('src/routes/api.ts');
    expect(routesPatch).not.toContain('src/auth/session.ts');
  });
});

// ─── VAL-SPLIT-007: manifest.json updated after split ───────────────────────

describe('VAL-SPLIT-007: manifest.json chunks array populated', () => {
  it('manifest has chunks array with per-chunk stats', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

    const manifestPath = join(reviewDir(), 'manifest.json');
    const manifest: ManifestJson = JSON.parse(await readFile(manifestPath, 'utf-8'));

    expect(manifest.chunks.length).toBeGreaterThan(0);
    for (const chunk of manifest.chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.title).toBeTruthy();
      expect(chunk.files.length).toBeGreaterThan(0);
      expect(typeof chunk.additions).toBe('number');
      expect(typeof chunk.deletions).toBe('number');
      expect(typeof chunk.estimated_tokens).toBe('number');
      expect(chunk.estimated_tokens).toBeGreaterThan(0);
    }
  });

  it('stats.total_chunks matches chunks array length', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts', 'lib/util.ts'];
    await createTestReview(filePaths);

    await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

    const manifestPath = join(reviewDir(), 'manifest.json');
    const manifest: ManifestJson = JSON.parse(await readFile(manifestPath, 'utf-8'));

    expect(manifest.stats.total_chunks).toBe(manifest.chunks.length);
  });

  it('manifest status is "split" after split', async () => {
    const filePaths = ['src/auth/session.ts'];
    await createTestReview(filePaths);

    await splitAndPersist(store, REVIEW_KEY, { strategy: 'single-file' });

    const manifestPath = join(reviewDir(), 'manifest.json');
    const manifest: ManifestJson = JSON.parse(await readFile(manifestPath, 'utf-8'));

    expect(manifest.status).toBe('split');
  });
});

// ─── VAL-SPLIT-008: SQLite consistent after split ───────────────────────────

describe('VAL-SPLIT-008: SQLite consistent with on-disk files', () => {
  it('SQLite chunks table matches manifest chunks', async () => {
    const filePaths = ['src/auth/session.ts', 'src/auth/jwt.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    const manifestPath = join(reviewDir(), 'manifest.json');
    const manifest: ManifestJson = JSON.parse(await readFile(manifestPath, 'utf-8'));

    const dbChunks = store.getChunks(REVIEW_KEY);

    // Same count
    expect(dbChunks.length).toBe(manifest.chunks.length);

    // Same slugs
    const dbSlugs = new Set(dbChunks.map((c) => c.slug));
    const manifestIds = new Set(manifest.chunks.map((c) => c.id));
    expect(dbSlugs).toEqual(manifestIds);
  });

  it('files table chunk_id matches the chunk containing each file', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    const dbChunks = store.getChunks(REVIEW_KEY);
    const dbFiles = store.getFiles(REVIEW_KEY);

    for (const file of dbFiles) {
      expect(file.chunkId).not.toBeNull();

      // Find which chunk this file should belong to
      const chunk = dbChunks.find((c) => c.id === file.chunkId);
      expect(chunk).toBeDefined();
    }

    // Verify chunk slug matches what we expect for each file
    const authFile = dbFiles.find((f) => f.path === 'src/auth/session.ts');
    const authChunk = dbChunks.find((c) => c.slug === '001-auth');
    expect(authFile?.chunkId).toBe(authChunk?.id);

    const routesFile = dbFiles.find((f) => f.path === 'src/routes/api.ts');
    const routesChunk = dbChunks.find((c) => c.slug === '002-routes');
    expect(routesFile?.chunkId).toBe(routesChunk?.id);
  });

  it('.meta.json files match SQLite chunk data', async () => {
    const filePaths = ['src/auth/session.ts', 'src/auth/jwt.ts'];
    await createTestReview(filePaths);

    await splitAndPersist(store, REVIEW_KEY, { strategy: 'directory' });

    const dbChunks = store.getChunks(REVIEW_KEY);

    for (const chunk of dbChunks) {
      const metaPath = join(reviewDir(), 'chunks', `${chunk.slug}.meta.json`);
      expect(existsSync(metaPath)).toBe(true);

      const meta: ChunkMetaJson = JSON.parse(await readFile(metaPath, 'utf-8'));

      expect(meta.id).toBe(chunk.slug);
      expect(meta.title).toBe(chunk.title);
      expect(meta.estimated_tokens).toBe(chunk.estimatedTokens);
      expect(meta.files.length).toBeGreaterThan(0);
    }
  });
});

// ─── VAL-SPLIT-009: Comments assigned to correct chunks ─────────────────────

describe('VAL-SPLIT-009: Comments assigned to correct chunks', () => {
  it('comment with file reference assigned to chunk containing that file', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-review-100',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 45,
      body: 'Needs session rotation',
      author: 'alice',
    });

    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    const dbComments = store.getComments(REVIEW_KEY);
    const dbChunks = store.getChunks(REVIEW_KEY);

    const authComment = dbComments.find((c) => c.threadId === 'gh-review-100');
    expect(authComment).toBeDefined();

    const authChunk = dbChunks.find((c) => c.slug === '001-auth');
    expect(authChunk).toBeDefined();
    expect(authComment!.chunkId).toBe(authChunk!.id);
  });

  it('multiple comments assigned to their respective chunks', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-review-100',
      file: 'src/auth/session.ts',
      line: 10,
      body: 'Auth comment',
      author: 'alice',
    });

    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-review-200',
      file: 'src/routes/api.ts',
      line: 20,
      body: 'Routes comment',
      author: 'bob',
    });

    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    const dbComments = store.getComments(REVIEW_KEY);
    const dbChunks = store.getChunks(REVIEW_KEY);

    const authChunk = dbChunks.find((c) => c.slug === '001-auth');
    const routesChunk = dbChunks.find((c) => c.slug === '002-routes');

    const authComment = dbComments.find((c) => c.threadId === 'gh-review-100');
    const routesComment = dbComments.find((c) => c.threadId === 'gh-review-200');

    expect(authComment!.chunkId).toBe(authChunk!.id);
    expect(routesComment!.chunkId).toBe(routesChunk!.id);
  });
});

// ─── Comment disk persistence after split ───────────────────────────────────

describe('Comment disk persistence after split', () => {
  it('comments/*.json files reflect updated chunk_id after split', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-review-100',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 10,
      body: 'Auth comment',
      author: 'alice',
    });

    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    // Read the comment file from disk
    const commentPath = join(reviewDir(), 'comments', 'gh-review-100.json');
    expect(existsSync(commentPath)).toBe(true);

    const commentFile: CommentFileJson = JSON.parse(await readFile(commentPath, 'utf-8'));
    expect(commentFile.chunk_id).toBe('001-auth');
  });

  it('chunk *.meta.json includes comment thread IDs after split', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-review-100',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 10,
      body: 'Auth comment',
      author: 'alice',
    });

    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    // Read auth chunk meta
    const authMetaPath = join(reviewDir(), 'chunks', '001-auth.meta.json');
    const authMeta: ChunkMetaJson = JSON.parse(await readFile(authMetaPath, 'utf-8'));
    expect(authMeta.comments).toContain('gh-review-100');

    // Routes chunk should have no comments
    const routesMetaPath = join(reviewDir(), 'chunks', '002-routes.meta.json');
    const routesMeta: ChunkMetaJson = JSON.parse(await readFile(routesMetaPath, 'utf-8'));
    expect(routesMeta.comments.length).toBe(0);
  });

  it('manifest.json stats accurate after split with comments', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    await store.addComment(REVIEW_KEY, {
      threadId: 'gh-review-100',
      source: 'github',
      state: 'open',
      file: 'src/auth/session.ts',
      line: 10,
      body: 'Auth comment',
      author: 'alice',
    });

    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    const manifestPath = join(reviewDir(), 'manifest.json');
    const manifest: ManifestJson = JSON.parse(await readFile(manifestPath, 'utf-8'));

    expect(manifest.stats.total_comments).toBe(1);
    expect(manifest.stats.total_chunks).toBe(2);

    // Auth chunk should have 1 comment_count
    const authChunk = manifest.chunks.find((c) => c.id === '001-auth');
    expect(authChunk!.comments_count).toBe(1);

    // Routes chunk should have 0 comments_count
    const routesChunk = manifest.chunks.find((c) => c.id === '002-routes');
    expect(routesChunk!.comments_count).toBe(0);
  });
});

// ─── _uncategorized collision in plan ───────────────────────────────────────

describe('_uncategorized reserved ID rejection', () => {
  it('rejects plan containing _uncategorized as a chunk ID', async () => {
    const filePaths = ['src/auth/session.ts'];
    await createTestReview(filePaths);

    await expect(
      splitAndPersist(store, REVIEW_KEY, {
        strategy: 'plan',
        plan: JSON.stringify({
          chunks: [{ id: '_uncategorized', title: 'My chunk', files: ['src/*'] }],
        }),
      }),
    ).rejects.toThrow(/_uncategorized.*reserved/i);

    // Verify no side effects
    const dbChunks = store.getChunks(REVIEW_KEY);
    expect(dbChunks.length).toBe(0);
  });
});

// ─── VAL-SPLIT-010: Invalid plan JSON produces clear error ──────────────────

describe('VAL-SPLIT-010: invalid plan JSON produces clear error', () => {
  it('invalid JSON string rejects without modifying data', async () => {
    const filePaths = ['src/auth/session.ts'];
    await createTestReview(filePaths);

    await expect(
      splitAndPersist(store, REVIEW_KEY, { strategy: 'plan', plan: '{invalid}' }),
    ).rejects.toThrow();

    // Verify no side effects on disk
    const manifestPath = join(reviewDir(), 'manifest.json');
    const manifest: ManifestJson = JSON.parse(await readFile(manifestPath, 'utf-8'));
    expect(manifest.chunks.length).toBe(0);
    expect(manifest.status).toBe('fetched');

    // Verify no side effects in SQLite
    const dbChunks = store.getChunks(REVIEW_KEY);
    expect(dbChunks.length).toBe(0);
  });
});

// ─── VAL-SPLIT-011: --keep-findings disk sync ──────────────────────────────

describe('VAL-SPLIT-011: --keep-findings disk persistence', () => {
  it('findings/*.json files reflect updated chunk_id after re-split', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    // First split
    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    // Add a finding to the auth chunk
    const authChunk = store.getChunks(REVIEW_KEY).find((c) => c.slug === '001-auth');
    await store.addFinding(REVIEW_KEY, {
      chunkId: authChunk!.id,
      reviewer: 'claude',
      file: 'src/auth/session.ts',
      line: 10,
      severity: 'critical',
      message: 'Security issue found',
    });

    // Re-split with keepFindings
    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: 'new-auth', title: 'New Auth', files: ['src/auth/*'] },
          { id: 'new-routes', title: 'New Routes', files: ['src/routes/*'] },
        ],
      }),
      keepFindings: true,
    });

    // Read the finding file from disk
    const findingsDir = join(reviewDir(), 'findings');
    const findingPath = join(findingsDir, 'finding-001.json');
    expect(existsSync(findingPath)).toBe(true);

    const findingFile: FindingFileJson = JSON.parse(await readFile(findingPath, 'utf-8'));
    // After re-split, the on-disk chunk_id should reflect the NEW chunk slug
    expect(findingFile.chunk_id).toBe('new-auth');
  });

  it('disk and SQLite finding chunk_id values match after re-split', async () => {
    const filePaths = ['src/auth/session.ts', 'src/routes/api.ts'];
    await createTestReview(filePaths);

    // First split
    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
          { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
        ],
      }),
    });

    // Add findings to both chunks
    const chunks = store.getChunks(REVIEW_KEY);
    const authChunk = chunks.find((c) => c.slug === '001-auth')!;
    const routesChunk = chunks.find((c) => c.slug === '002-routes')!;

    await store.addFinding(REVIEW_KEY, {
      chunkId: authChunk.id,
      reviewer: 'claude',
      file: 'src/auth/session.ts',
      line: 10,
      severity: 'critical',
      message: 'Auth issue',
    });

    await store.addFinding(REVIEW_KEY, {
      chunkId: routesChunk.id,
      reviewer: 'claude',
      file: 'src/routes/api.ts',
      line: 20,
      severity: 'suggestion',
      message: 'Route issue',
    });

    // Re-split with keepFindings
    await splitAndPersist(store, REVIEW_KEY, {
      strategy: 'plan',
      plan: JSON.stringify({
        chunks: [
          { id: 'chunk-a', title: 'Chunk A', files: ['src/auth/*'] },
          { id: 'chunk-b', title: 'Chunk B', files: ['src/routes/*'] },
        ],
      }),
      keepFindings: true,
    });

    // Check dual-layer consistency for each finding
    const dbFindings = store.getFindings(REVIEW_KEY);
    const newChunks = store.getChunks(REVIEW_KEY);
    const chunkIdToSlug = new Map<number, string>();
    for (const c of newChunks) {
      chunkIdToSlug.set(c.id, c.slug);
    }

    for (const finding of dbFindings) {
      const findingFileId = `finding-${String(finding.id).padStart(3, '0')}`;
      const findingPath = join(reviewDir(), 'findings', `${findingFileId}.json`);
      const diskFinding: FindingFileJson = JSON.parse(await readFile(findingPath, 'utf-8'));

      // SQLite chunk_id (numeric) should resolve to the same slug as on-disk chunk_id (string)
      const sqliteSlug = finding.chunkId != null ? chunkIdToSlug.get(finding.chunkId) : null;
      expect(diskFinding.chunk_id).toBe(sqliteSlug);
    }
  });
});
