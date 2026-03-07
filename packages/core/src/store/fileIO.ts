import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  ChunkMetaJson,
  CommentFileJson,
  FilesJson,
  FilesJsonEntry,
  FindingFileJson,
  ManifestChunk,
  ManifestJson,
  ManifestStats,
  ReviewKey,
} from './fileTypes.js';

// ─── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_KAIJU_DIR = join(homedir(), '.kaiju');

// ─── Review key parsing ─────────────────────────────────────────────────────────

/**
 * Parse a review key like "github/org/repo/9999" into its components.
 */
export function parseReviewKey(key: string): ReviewKey {
  const parts = key.split('/');
  if (parts.length < 4 || !parts[0] || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error(`Invalid review key "${key}": expected format "provider/org/repo/pr"`);
  }

  const pr = Number.parseInt(parts[3], 10);
  if (Number.isNaN(pr)) {
    throw new Error(`Invalid review key "${key}": expected format "provider/org/repo/pr"`);
  }

  return { provider: parts[0], org: parts[1], repo: parts[2], pr };
}

/**
 * Convert a ReviewKey to its path segment string.
 */
export function reviewKeyToPath(key: ReviewKey): string {
  return `${key.provider}/${key.org}/${key.repo}/${key.pr}`;
}

// ─── Directory helpers ──────────────────────────────────────────────────────────

/**
 * Get the full path for a review directory.
 *
 * @param key - Review key (e.g., "github/acme/widgets/9999")
 * @param baseDir - Base directory (defaults to ~/.kaiju)
 */
export function getReviewDir(key: string, baseDir: string = DEFAULT_KAIJU_DIR): string {
  return join(baseDir, 'reviews', key);
}

/**
 * Create the review directory structure:
 * reviewDir/
 * ├── chunks/
 * ├── comments/
 * └── findings/
 */
export async function ensureReviewDirs(reviewDir: string): Promise<void> {
  await mkdir(reviewDir, { recursive: true });
  await mkdir(join(reviewDir, 'chunks'), { recursive: true });
  await mkdir(join(reviewDir, 'comments'), { recursive: true });
  await mkdir(join(reviewDir, 'findings'), { recursive: true });
}

// ─── Path sanitization ──────────────────────────────────────────────────────────

/**
 * Sanitize a file path for safe storage. Strips path traversals (..)
 * while preserving unicode, spaces, and other special characters.
 */
export function sanitizePath(filePath: string): string {
  if (!filePath) {
    return '';
  }
  // Remove path traversal sequences
  return filePath
    .split('/')
    .filter((segment) => segment !== '..')
    .join('/');
}

// ─── JSON helpers ───────────────────────────────────────────────────────────────

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(filePath, content, 'utf-8');
}

async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

// ─── manifest.json ──────────────────────────────────────────────────────────────

export async function writeManifest(reviewDir: string, manifest: ManifestJson): Promise<void> {
  await writeJson(join(reviewDir, 'manifest.json'), manifest);
}

export async function readManifest(reviewDir: string): Promise<ManifestJson> {
  return readJson<ManifestJson>(join(reviewDir, 'manifest.json'));
}

// ─── files.json ─────────────────────────────────────────────────────────────────

export async function writeFilesJson(reviewDir: string, filesJson: FilesJson): Promise<void> {
  await writeJson(join(reviewDir, 'files.json'), filesJson);
}

export async function readFilesJson(reviewDir: string): Promise<FilesJson> {
  return readJson<FilesJson>(join(reviewDir, 'files.json'));
}

// ─── chunks/*.patch ─────────────────────────────────────────────────────────────

export async function writeChunkPatch(
  reviewDir: string,
  chunkId: string,
  patchContent: string,
): Promise<void> {
  await writeFile(join(reviewDir, 'chunks', `${chunkId}.patch`), patchContent, 'utf-8');
}

export async function readChunkPatch(reviewDir: string, chunkId: string): Promise<string> {
  return readFile(join(reviewDir, 'chunks', `${chunkId}.patch`), 'utf-8');
}

// ─── chunks/*.meta.json ─────────────────────────────────────────────────────────

export async function writeChunkMeta(
  reviewDir: string,
  chunkId: string,
  meta: ChunkMetaJson,
): Promise<void> {
  await writeJson(join(reviewDir, 'chunks', `${chunkId}.meta.json`), meta);
}

export async function readChunkMeta(reviewDir: string, chunkId: string): Promise<ChunkMetaJson> {
  return readJson<ChunkMetaJson>(join(reviewDir, 'chunks', `${chunkId}.meta.json`));
}

// ─── comments/*.json ────────────────────────────────────────────────────────────

export async function writeCommentFile(
  reviewDir: string,
  threadId: string,
  comment: CommentFileJson,
): Promise<void> {
  await writeJson(join(reviewDir, 'comments', `${threadId}.json`), comment);
}

export async function readCommentFile(
  reviewDir: string,
  threadId: string,
): Promise<CommentFileJson> {
  return readJson<CommentFileJson>(join(reviewDir, 'comments', `${threadId}.json`));
}

// ─── findings/*.json ────────────────────────────────────────────────────────────

export async function writeFindingFile(
  reviewDir: string,
  findingId: string,
  finding: FindingFileJson,
): Promise<void> {
  await writeJson(join(reviewDir, 'findings', `${findingId}.json`), finding);
}

export async function readFindingFile(
  reviewDir: string,
  findingId: string,
): Promise<FindingFileJson> {
  return readJson<FindingFileJson>(join(reviewDir, 'findings', `${findingId}.json`));
}

// ─── Stats computation ──────────────────────────────────────────────────────────

export interface ComputeStatsInput {
  files: FilesJsonEntry[];
  chunks: ManifestChunk[];
  totalComments: number;
  totalFindings: number;
}

/**
 * Compute manifest stats from actual data.
 */
export function computeManifestStats(input: ComputeStatsInput): ManifestStats;
/**
 * Compute manifest stats from actual data (positional args).
 * @deprecated Use the object form instead.
 */
export function computeManifestStats(
  files: FilesJsonEntry[],
  chunks: ManifestChunk[],
  totalComments: number,
  totalFindings: number,
): ManifestStats;
export function computeManifestStats(
  filesOrInput: FilesJsonEntry[] | ComputeStatsInput,
  chunks?: ManifestChunk[],
  totalComments?: number,
  totalFindings?: number,
): ManifestStats {
  const input: ComputeStatsInput = Array.isArray(filesOrInput)
    ? {
        files: filesOrInput,
        chunks: chunks ?? [],
        totalComments: totalComments ?? 0,
        totalFindings: totalFindings ?? 0,
      }
    : filesOrInput;

  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const file of input.files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }

  return {
    total_files: input.files.length,
    total_additions: totalAdditions,
    total_deletions: totalDeletions,
    total_chunks: input.chunks.length,
    total_comments: input.totalComments,
    total_findings: input.totalFindings,
  };
}
