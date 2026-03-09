import { getReviewDir, readFindingFile, writeFindingFile } from '../store/fileIO.js';
import type { KaijuStore } from '../store/kaijuStore.js';
import type { CommentState, FileEntry, FindingRow } from '../types/index.js';
import {
  type ChunkAssignment,
  type SplitOptions,
  type SplitResultChunk,
  remapFindings,
  splitFiles,
} from './index.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SplitAndPersistOptions {
  strategy: SplitOptions['strategy'];
  plan?: string;
  maxTokens?: number;
  /** When true, existing findings are remapped to new chunks after splitting. */
  keepFindings?: boolean;
}

export interface SplitAndPersistResult {
  chunks: SplitResultChunk[];
}

// ─── splitAndPersist ────────────────────────────────────────────────────────────

/**
 * High-level pipeline that:
 * 1. Validates the review exists and has a raw diff
 * 2. Runs the splitter engine to compute chunk assignments
 * 3. Persists each chunk to the store (both SQLite and disk)
 * 4. Assigns comments to the correct chunks based on file matching
 *
 * Error handling:
 * - Invalid plan JSON: throws before any data is modified
 * - Empty plan: throws before any data is modified
 * - Missing review: throws with clear message
 * - Missing raw diff: throws with clear message mentioning fetch
 *
 * The splitter engine validates the plan JSON and throws on invalid input,
 * so we call it BEFORE persisting anything to ensure atomicity.
 */
export async function splitAndPersist(
  store: KaijuStore,
  reviewKey: string,
  options: SplitAndPersistOptions,
): Promise<SplitAndPersistResult> {
  // 1. Validate review exists and has rawDiff
  const review = store.getReview(reviewKey);
  if (!review) {
    throw new Error(`Review not found: ${reviewKey}`);
  }
  if (!review.rawDiff) {
    throw new Error(
      `Review "${reviewKey}" has no diff data. Run fetch first to download the PR diff.`,
    );
  }

  // 2. Validate empty plan before calling splitFiles
  validatePlanNotEmpty(options);

  // 3. Get files and run the splitter engine (validates plan JSON, no side effects)
  const fileEntries = buildFileEntries(store.getFiles(reviewKey));
  const splitResult = splitFiles(
    { files: fileEntries, rawDiff: review.rawDiff },
    { strategy: options.strategy, plan: options.plan, maxTokens: options.maxTokens },
  );

  // 3.5. Capture existing findings before clearing old chunks (for keepFindings)
  const existingFindings = options.keepFindings ? store.getFindings(reviewKey) : [];

  // 3.6. Clear old chunks before persisting new ones (handles re-split)
  store.deleteChunksForReview(reviewKey);

  // 4. Persist each chunk to the store (addChunk writes both SQLite + disk)
  for (const chunk of splitResult.chunks) {
    await store.addChunk(reviewKey, {
      slug: chunk.id,
      title: chunk.title,
      description: chunk.description,
      reviewPriority: chunk.reviewPriority,
      estimatedTokens: chunk.estimatedTokens,
      filePaths: chunk.filePaths,
      patchContent: chunk.patchContent,
    });
  }

  // 5. Assign comments to chunks based on file matching
  assignCommentsToChunks(store, reviewKey, splitResult.chunks);

  // 6. Persist comment files to disk with updated chunk_id
  await persistCommentFiles(store, reviewKey, splitResult.chunks);

  // 7. Remap findings to new chunks when keepFindings is set
  if (options.keepFindings && existingFindings.length > 0) {
    await remapAndPersistFindings(store, reviewKey, existingFindings, splitResult.chunks);
  }

  // 8. Re-sync chunk meta.json files to include comment info
  await resyncChunkMetaFiles(store, reviewKey, splitResult.chunks);

  // 9. Final manifest sync to ensure stats are accurate
  await store.syncManifestPublic(reviewKey);

  return { chunks: splitResult.chunks };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build FileEntry[] from raw DB rows.
 */
function buildFileEntries(dbFiles: ReturnType<KaijuStore['getFiles']>): FileEntry[] {
  return dbFiles.map((f) => ({
    id: f.id,
    reviewId: f.reviewId,
    path: f.path,
    status: f.status as FileEntry['status'],
    additions: f.additions,
    deletions: f.deletions,
    chunkId: f.chunkId ?? null,
  }));
}

/**
 * Validate that a plan strategy isn't given an empty chunks array.
 * Throws before any data is modified.
 */
function validatePlanNotEmpty(options: SplitAndPersistOptions): void {
  if (options.strategy !== 'plan' || !options.plan) {
    return;
  }
  const parsed = JSON.parse(options.plan) as { chunks?: unknown[] };
  if (
    parsed &&
    typeof parsed === 'object' &&
    'chunks' in parsed &&
    Array.isArray(parsed.chunks) &&
    parsed.chunks.length === 0
  ) {
    throw new Error('Plan is empty: must contain at least one chunk definition');
  }
}

// ─── Comment Assignment ─────────────────────────────────────────────────────────

/**
 * Assign comments to chunks based on file matching.
 *
 * For each comment that has a file reference, find which chunk contains
 * that file and update the comment's chunk_id in SQLite.
 */
function assignCommentsToChunks(
  store: KaijuStore,
  reviewKey: string,
  resultChunks: SplitResultChunk[],
): void {
  const fileToChunkSlug = buildFileToChunkMap(resultChunks);
  const slugToChunkId = buildSlugToIdMap(store.getChunks(reviewKey));

  for (const comment of store.getComments(reviewKey)) {
    if (!comment.file) {
      continue;
    }
    const chunkSlug = fileToChunkSlug.get(comment.file);
    if (!chunkSlug) {
      continue;
    }
    const chunkId = slugToChunkId.get(chunkSlug);
    if (chunkId == null) {
      continue;
    }
    store.updateCommentChunkId(comment.id, chunkId);
  }
}

/**
 * Build file path → chunk slug lookup from split result chunks.
 */
function buildFileToChunkMap(chunks: SplitResultChunk[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of chunks) {
    for (const path of chunk.filePaths) {
      map.set(path, chunk.id);
    }
  }
  return map;
}

/**
 * Build chunk slug → numeric chunk ID lookup from DB chunks.
 */
function buildSlugToIdMap(dbChunks: ReturnType<KaijuStore['getChunks']>): Map<string, number> {
  const map = new Map<string, number>();
  for (const chunk of dbChunks) {
    map.set(chunk.slug, chunk.id);
  }
  return map;
}

// ─── Comment Disk Persistence ───────────────────────────────────────────────────

/**
 * Rewrite comments/*.json files on disk with updated chunk_id after split.
 * For each comment that has been assigned to a chunk, the on-disk JSON
 * reflects the chunk slug.
 */
async function persistCommentFiles(
  store: KaijuStore,
  reviewKey: string,
  _resultChunks: SplitResultChunk[],
): Promise<void> {
  const dbComments = store.getComments(reviewKey);
  if (dbComments.length === 0) {
    return;
  }

  const dbChunks = store.getChunks(reviewKey);
  const chunkIdToSlug = new Map<number, string>();
  for (const chunk of dbChunks) {
    chunkIdToSlug.set(chunk.id, chunk.slug);
  }

  // Group comments by threadId to write one file per thread
  const threadMap = new Map<string, typeof dbComments>();
  for (const comment of dbComments) {
    const existing = threadMap.get(comment.threadId) ?? [];
    existing.push(comment);
    threadMap.set(comment.threadId, existing);
  }

  for (const [threadId, threadComments] of threadMap) {
    const first = threadComments[0]!;
    const chunkSlug = first.chunkId != null ? (chunkIdToSlug.get(first.chunkId) ?? null) : null;

    await store.writeCommentFilePublic(reviewKey, threadId, {
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
    });
  }
}

// ─── Finding Remapping ──────────────────────────────────────────────────────────

/**
 * Remap existing findings to new chunks and persist the updated chunk_id
 * in BOTH SQLite and on-disk findings/*.json files (dual-layer consistency).
 */
async function remapAndPersistFindings(
  store: KaijuStore,
  reviewKey: string,
  existingFindings: ReturnType<KaijuStore['getFindings']>,
  resultChunks: SplitResultChunk[],
): Promise<void> {
  const remapped = remapFindings(
    existingFindings as unknown as FindingRow[],
    resultChunks as ChunkAssignment[],
  );
  const dbChunks = store.getChunks(reviewKey);
  const slugToId = buildSlugToIdMap(dbChunks);
  const reviewDir = getReviewDir(reviewKey, store.baseDir);

  for (const remap of remapped) {
    const newChunkId = remap.newChunkSlug ? (slugToId.get(remap.newChunkSlug) ?? null) : null;

    // Update SQLite layer
    store.updateFindingChunkId(remap.findingId, newChunkId);

    // Update disk layer — rewrite findings/*.json with new chunk_id
    const findingFileId = `finding-${String(remap.findingId).padStart(3, '0')}`;
    try {
      const findingFile = await readFindingFile(reviewDir, findingFileId);
      findingFile.chunk_id = remap.newChunkSlug ?? null;
      await writeFindingFile(reviewDir, findingFileId, findingFile);
    } catch {
      // Finding file may not exist if it was created externally; skip silently
    }
  }
}

// ─── Chunk Meta Re-sync ─────────────────────────────────────────────────────────

/**
 * Re-sync chunk .meta.json files to include comment thread IDs and finding IDs.
 * Called after comment assignment so that meta files reflect the final state.
 */
async function resyncChunkMetaFiles(
  store: KaijuStore,
  reviewKey: string,
  resultChunks: SplitResultChunk[],
): Promise<void> {
  for (const chunk of resultChunks) {
    await store.resyncChunkMeta(reviewKey, chunk.id);
  }
}
