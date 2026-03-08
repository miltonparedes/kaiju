import type { KaijuStore } from '../store/kaijuStore.js';
import type { FileEntry } from '../types/index.js';
import { type SplitOptions, type SplitResultChunk, splitFiles } from './index.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SplitAndPersistOptions {
  strategy: SplitOptions['strategy'];
  plan?: string;
  maxTokens?: number;
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
