import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import type {
  CommentState,
  FileStatus,
  FindingSeverity,
  FindingStatus,
  ReviewPriority,
} from '../types/index.js';
import {
  ensureReviewDirs,
  getReviewDir,
  writeChunkMeta,
  writeChunkPatch,
  writeCommentFile,
  writeFilesJson,
  writeFindingFile,
  writeManifest,
  computeManifestStats,
} from './fileIO.js';
import type {
  ChunkMetaJson,
  CommentFileJson,
  FilesJson,
  FilesJsonEntry,
  FindingFileJson,
  ManifestChunk,
  ManifestJson,
} from './fileTypes.js';
import type { KaijuDB } from './index.js';
import { chunks, comments, files, findings, imports, reviews } from './schema.js';

// ─── rebuildIndex: files on disk → SQLite ───────────────────────────────────

/**
 * Reconstruct all SQLite tables from files on disk.
 *
 * Scans the reviews directory, parses all JSON and patch files,
 * and repopulates all 7 tables + FTS5 indexes. Produces query-equivalent
 * results to the original database state.
 *
 * @param db - A fresh (empty) KaijuDB instance
 * @param baseDir - Base directory (contains reviews/ subdirectory)
 */
export async function rebuildIndex(db: KaijuDB, baseDir: string): Promise<void> {
  const reviewsDir = join(baseDir, 'reviews');
  if (!existsSync(reviewsDir)) return;

  // Discover all review directories (provider/org/repo/pr)
  const reviewKeys = discoverReviewKeys(reviewsDir, '');

  for (const key of reviewKeys) {
    await rebuildReview(db, baseDir, key);
  }
}

/**
 * Recursively discover review keys by walking the directory tree.
 * A review directory has a manifest.json or files.json.
 */
function discoverReviewKeys(dir: string, prefix: string): string[] {
  const keys: string[] = [];
  if (!existsSync(dir)) return keys;

  const entries = readdirSync(dir, { withFileTypes: true });

  // Check if this is a review directory (has manifest.json or files.json)
  const hasManifest = entries.some((e) => e.name === 'manifest.json' && !e.isDirectory());
  const hasFiles = entries.some((e) => e.name === 'files.json' && !e.isDirectory());

  if (hasManifest || hasFiles) {
    if (prefix) keys.push(prefix);
    return keys;
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      keys.push(...discoverReviewKeys(join(dir, entry.name), childPrefix));
    }
  }

  return keys;
}

/**
 * Rebuild a single review from its files on disk into SQLite.
 */
async function rebuildReview(db: KaijuDB, baseDir: string, key: string): Promise<void> {
  const reviewDir = getReviewDir(key, baseDir);

  // Read manifest.json for review metadata
  const manifestPath = join(reviewDir, 'manifest.json');
  if (!existsSync(manifestPath)) return;

  const manifest: ManifestJson = JSON.parse(await readFile(manifestPath, 'utf-8'));

  // Determine status from manifest chunk presence
  const status = manifest.chunks.length > 0 ? 'split' : 'fetched';

  // Insert the review into SQLite
  const review = db
    .insert(reviews)
    .values({
      key,
      provider: manifest.source.provider,
      repo: manifest.source.repo,
      pr: manifest.source.pr,
      title: manifest.source.title ?? '',
      url: manifest.source.url,
      base: manifest.source.base,
      head: manifest.source.head,
      status,
      rawDiff: null,
    })
    .returning()
    .get();

  // Read files.json for file entries and imports
  const filesJsonPath = join(reviewDir, 'files.json');
  if (existsSync(filesJsonPath)) {
    const filesJson: FilesJson = JSON.parse(await readFile(filesJsonPath, 'utf-8'));

    // Insert files (without chunk assignment first)
    for (const f of filesJson.files) {
      db.insert(files)
        .values({
          reviewId: review.id,
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        })
        .run();
    }

    // Insert imports
    for (const imp of filesJson.imports) {
      db.insert(imports)
        .values({
          reviewId: review.id,
          source: imp.source,
          target: imp.target,
        })
        .run();
    }
  }

  // Read chunks from meta.json files
  const chunksDir = join(reviewDir, 'chunks');
  if (existsSync(chunksDir)) {
    const chunkEntries = readdirSync(chunksDir).filter((f) => f.endsWith('.meta.json'));

    for (const metaFile of chunkEntries) {
      const metaPath = join(chunksDir, metaFile);
      const meta: ChunkMetaJson = JSON.parse(await readFile(metaPath, 'utf-8'));

      // Insert chunk
      const chunk = db
        .insert(chunks)
        .values({
          reviewId: review.id,
          slug: meta.id,
          title: meta.title,
          description: meta.description,
          reviewPriority: meta.review_priority,
          estimatedTokens: meta.estimated_tokens,
        })
        .returning()
        .get();

      // Assign files to this chunk
      if (meta.files && meta.files.length > 0) {
        const filePaths = new Set(meta.files.map((f) => f.path));
        const allFiles = db.select().from(files).where(eq(files.reviewId, review.id)).all();
        for (const f of allFiles) {
          if (filePaths.has(f.path)) {
            db.update(files).set({ chunkId: chunk.id }).where(eq(files.id, f.id)).run();
          }
        }
      }
    }
  }

  // Read comments from comments/*.json
  const commentsDir = join(reviewDir, 'comments');
  if (existsSync(commentsDir)) {
    const commentFiles = readdirSync(commentsDir).filter((f) => f.endsWith('.json'));

    for (const commentFileName of commentFiles) {
      const commentPath = join(commentsDir, commentFileName);
      const commentFile: CommentFileJson = JSON.parse(await readFile(commentPath, 'utf-8'));

      // Resolve chunk_id from slug to DB id if possible
      let chunkId: number | null = null;
      if (commentFile.chunk_id) {
        const chunkRow = db
          .select()
          .from(chunks)
          .where(eq(chunks.reviewId, review.id))
          .all()
          .find((c) => c.slug === commentFile.chunk_id || String(c.id) === commentFile.chunk_id);
        if (chunkRow) chunkId = chunkRow.id;
      }

      // Insert each message as a separate comment row
      for (const msg of commentFile.messages) {
        db.insert(comments)
          .values({
            reviewId: review.id,
            threadId: commentFile.thread_id,
            source: commentFile.source,
            state: commentFile.state as CommentState,
            chunkId,
            file: commentFile.file ?? null,
            line: commentFile.line ?? null,
            body: msg.body,
            author: msg.author || null,
            timestamp: msg.timestamp || null,
            ghCommentId: msg.gh_comment_id ?? null,
          })
          .run();
      }
    }
  }

  // Read findings from findings/*.json
  const findingsDir = join(reviewDir, 'findings');
  if (existsSync(findingsDir)) {
    const findingFiles = readdirSync(findingsDir).filter((f) => f.endsWith('.json'));

    for (const findingFileName of findingFiles) {
      const findingPath = join(findingsDir, findingFileName);
      const findingFile: FindingFileJson = JSON.parse(await readFile(findingPath, 'utf-8'));

      // Resolve chunk_id
      let chunkId: number | null = null;
      if (findingFile.chunk_id) {
        const chunkRow = db
          .select()
          .from(chunks)
          .where(eq(chunks.reviewId, review.id))
          .all()
          .find((c) => c.slug === findingFile.chunk_id || String(c.id) === findingFile.chunk_id);
        if (chunkRow) chunkId = chunkRow.id;
      }

      for (const entry of findingFile.findings) {
        db.insert(findings)
          .values({
            reviewId: review.id,
            chunkId,
            reviewer: findingFile.reviewer,
            file: entry.file,
            line: entry.line ?? null,
            endLine: entry.end_line ?? null,
            severity: entry.severity as FindingSeverity,
            message: entry.message,
            suggestion: entry.suggestion ?? null,
            codeSuggestion: entry.code_suggestion ?? null,
            rootCause: entry.root_cause ?? null,
            impact: entry.impact ?? null,
            status: (entry.status as FindingStatus) ?? 'open',
            publish: entry.publish ?? false,
            inReplyTo: findingFile.in_reply_to ?? null,
            timestamp: findingFile.timestamp ?? null,
          })
          .run();
      }
    }
  }
}

// ─── regenerateFiles: SQLite → files on disk ────────────────────────────────

/**
 * Recreate all files on disk from SQLite data.
 *
 * Walks every review in the database, builds and writes the full
 * directory structure: manifest.json, files.json, chunks/*.patch,
 * chunks/*.meta.json, comments/*.json, findings/*.json.
 *
 * @param db - KaijuDB with populated data
 * @param baseDir - Base directory to write files to
 */
export async function regenerateFiles(db: KaijuDB, baseDir: string): Promise<void> {
  const allReviews = db.select().from(reviews).all();

  for (const review of allReviews) {
    await regenerateReview(db, baseDir, review);
  }
}

/**
 * Regenerate all files for a single review.
 */
async function regenerateReview(
  db: KaijuDB,
  baseDir: string,
  review: typeof reviews.$inferSelect,
): Promise<void> {
  const reviewDir = getReviewDir(review.key, baseDir);
  await ensureReviewDirs(reviewDir);

  const dbFiles = db.select().from(files).where(eq(files.reviewId, review.id)).all();
  const dbImports = db.select().from(imports).where(eq(imports.reviewId, review.id)).all();
  const dbChunks = db.select().from(chunks).where(eq(chunks.reviewId, review.id)).all();
  const dbComments = db.select().from(comments).where(eq(comments.reviewId, review.id)).all();
  const dbFindings = db.select().from(findings).where(eq(findings.reviewId, review.id)).all();

  // ── files.json ──────────────────────────────────────────────────────────────

  const filesEntries: FilesJsonEntry[] = dbFiles.map((f) => ({
    path: f.path,
    status: f.status as FileStatus,
    additions: f.additions,
    deletions: f.deletions,
  }));

  await writeFilesJson(reviewDir, {
    files: filesEntries,
    imports: dbImports.map((i) => ({
      source: i.source,
      target: i.target,
    })),
  });

  // ── chunks ──────────────────────────────────────────────────────────────────

  const manifestChunks: ManifestChunk[] = [];

  for (const chunk of dbChunks) {
    const chunkFiles = dbFiles.filter((f) => f.chunkId === chunk.id);
    const chunkComments = dbComments.filter((c) => c.chunkId === chunk.id);
    const chunkFindings = dbFindings.filter((f) => f.chunkId === chunk.id);

    let additions = 0;
    let deletions = 0;
    for (const f of chunkFiles) {
      additions += f.additions;
      deletions += f.deletions;
    }

    // Write .meta.json
    const meta: ChunkMetaJson = {
      id: chunk.slug,
      title: chunk.title,
      description: chunk.description,
      review_priority: chunk.reviewPriority as ReviewPriority,
      estimated_tokens: chunk.estimatedTokens,
      files: chunkFiles.map((f) => ({
        path: f.path,
        status: f.status as FileStatus,
        additions: f.additions,
        deletions: f.deletions,
      })),
      context: {
        imports_from: [],
        imported_by: [],
        has_breaking_changes: false,
      },
      comments: [...new Set(chunkComments.map((c) => c.threadId))],
      findings: chunkFindings.map((f) => `finding-${String(f.id).padStart(3, '0')}`),
    };
    await writeChunkMeta(reviewDir, chunk.slug, meta);

    // Write .patch — use rawDiff if available, otherwise empty placeholder
    // Note: The raw diff for individual chunks isn't stored in SQLite;
    // only the full review rawDiff is. For individual patches we write
    // a placeholder since the actual patch content is only on disk.
    // In a real scenario the rawDiff would be stored per-chunk or we'd
    // recompute from the full diff. For now, write what we have.
    const patchContent = review.rawDiff
      ? extractChunkPatch(
          review.rawDiff,
          chunkFiles.map((f) => f.path),
        )
      : generatePlaceholderPatch(chunkFiles);
    await writeChunkPatch(reviewDir, chunk.slug, patchContent);

    // Build manifest chunk entry
    manifestChunks.push({
      id: chunk.slug,
      title: chunk.title,
      description: chunk.description,
      files: chunkFiles.map((f) => f.path),
      additions,
      deletions,
      review_priority: chunk.reviewPriority as ReviewPriority,
      estimated_tokens: chunk.estimatedTokens,
      status: chunk.status,
      comments_count: chunkComments.length,
      findings_count: chunkFindings.length,
    });
  }

  // ── comments ────────────────────────────────────────────────────────────────

  // Group comments by threadId and write one file per thread
  const threadMap = new Map<string, typeof dbComments>();
  for (const c of dbComments) {
    const existing = threadMap.get(c.threadId) ?? [];
    existing.push(c);
    threadMap.set(c.threadId, existing);
  }

  for (const [threadId, threadComments] of threadMap) {
    const first = threadComments[0]!;
    // Resolve chunk slug from numeric ID for on-disk representation
    const chunkSlug = first.chunkId
      ? (dbChunks.find((c) => c.id === first.chunkId)?.slug ?? null)
      : null;
    const commentFile: CommentFileJson = {
      thread_id: threadId,
      source: first.source,
      state: first.state as CommentState,
      chunk_id: chunkSlug,
      file: first.file ?? null,
      line: first.line ?? null,
      messages: threadComments.map((c) => ({
        author: c.author ?? '',
        body: c.body,
        timestamp: c.timestamp ?? '',
        ...(c.ghCommentId ? { gh_comment_id: c.ghCommentId } : {}),
      })),
    };
    await writeCommentFile(reviewDir, threadId, commentFile);
  }

  // ── findings ────────────────────────────────────────────────────────────────

  for (const finding of dbFindings) {
    const findingId = `finding-${String(finding.id).padStart(3, '0')}`;
    // Resolve chunk slug from numeric ID for on-disk representation
    const findingChunkSlug = finding.chunkId
      ? (dbChunks.find((c) => c.id === finding.chunkId)?.slug ?? null)
      : null;
    const findingFile: FindingFileJson = {
      id: findingId,
      reviewer: finding.reviewer,
      chunk_id: findingChunkSlug,
      timestamp: finding.timestamp ?? new Date().toISOString(),
      in_reply_to: finding.inReplyTo ?? null,
      findings: [
        {
          file: finding.file,
          line: finding.line ?? null,
          end_line: finding.endLine ?? null,
          severity: finding.severity as FindingSeverity,
          message: finding.message,
          suggestion: finding.suggestion ?? null,
          code_suggestion: finding.codeSuggestion ?? null,
          root_cause: finding.rootCause ?? null,
          impact: finding.impact ?? null,
          status: (finding.status as FindingStatus) ?? 'open',
          publish: finding.publish ?? false,
        },
      ],
    };
    await writeFindingFile(reviewDir, findingId, findingFile);
  }

  // ── manifest.json ─────────────────────────────────────────────────────────

  const stats = computeManifestStats({
    files: filesEntries,
    chunks: manifestChunks,
    totalComments: dbComments.length,
    totalFindings: dbFindings.length,
  });

  const manifest: ManifestJson = {
    version: '1',
    source: {
      provider: review.provider,
      repo: review.repo,
      pr: review.pr,
      base: review.base,
      head: review.head,
      url: review.url,
      title: review.title,
    },
    status: review.status,
    stats,
    chunks: manifestChunks,
  };

  await writeManifest(reviewDir, manifest);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract the portions of a raw unified diff that match the given file paths.
 */
function extractChunkPatch(rawDiff: string, filePaths: string[]): string {
  if (!rawDiff || filePaths.length === 0) return '';

  const pathSet = new Set(filePaths);
  const lines = rawDiff.split('\n');
  const result: string[] = [];
  let include = false;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // Parse the file paths from the diff header
      // Format: diff --git a/path b/path
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        const aPath = match[1]!;
        const bPath = match[2]!;
        include = pathSet.has(aPath) || pathSet.has(bPath);
      } else {
        include = false;
      }
    }

    if (include) {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Generate a placeholder patch for files when rawDiff is not available.
 */
function generatePlaceholderPatch(chunkFiles: Array<{ path: string; status: string }>): string {
  const parts: string[] = [];
  for (const f of chunkFiles) {
    if (f.status === 'added') {
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push('new file mode 100644');
      parts.push('--- /dev/null');
      parts.push(`+++ b/${f.path}`);
    } else if (f.status === 'deleted') {
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push('deleted file mode 100644');
      parts.push(`--- a/${f.path}`);
      parts.push('+++ /dev/null');
    } else {
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push(`--- a/${f.path}`);
      parts.push(`+++ b/${f.path}`);
    }
  }
  return parts.join('\n');
}
