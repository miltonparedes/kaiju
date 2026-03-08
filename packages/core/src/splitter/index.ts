import type { FileEntry, FindingRow, ReviewPriority } from '../types/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type SplitStrategy = 'directory' | 'single-file' | 'plan';

/** A chunk assignment produced by a splitter strategy (pre-store). */
export interface ChunkAssignment {
  id: string;
  title: string;
  description: string;
  reviewPriority: ReviewPriority;
  filePaths: string[];
  /** Set to true when a single-file chunk exceeds maxTokens and cannot be subdivided further. */
  oversized?: boolean;
}

/** Input for the high-level splitFiles function. */
export interface SplitInput {
  files: FileEntry[];
  rawDiff: string;
}

/** Options for splitting. */
export interface SplitOptions {
  strategy: SplitStrategy;
  /** JSON plan string (required when strategy === 'plan'). */
  plan?: string;
  /** Maximum estimated tokens per chunk. Oversized chunks are subdivided. */
  maxTokens?: number;
}

/** A chunk definition in a plan JSON. */
export interface PlanChunkDef {
  id: string;
  title: string;
  description?: string;
  files: string[];
  review_priority?: ReviewPriority;
}

/** The parsed plan structure. */
export interface PlanJson {
  chunks: PlanChunkDef[];
}

/** Result chunk with token estimate. */
export interface SplitResultChunk extends ChunkAssignment {
  estimatedTokens: number;
  patchContent: string;
}

/** Result of the split operation. */
export interface SplitResult {
  chunks: SplitResultChunk[];
}

/** Result of remapping a finding to a new chunk. */
export interface FindingRemap {
  findingId: number;
  newChunkSlug: string | null;
}

// ─── Token Estimation ───────────────────────────────────────────────────────────

/**
 * Approximate token count from text content.
 *
 * Uses a simple heuristic: ~4 characters per token (common approximation
 * for code/diff content). Returns 0 for empty content.
 */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  // Approximate: 1 token ≈ 4 characters for code-like content
  return Math.ceil(content.length / 4);
}

// ─── Patch Extraction ───────────────────────────────────────────────────────────

/**
 * Extract the patch content for specific files from a raw unified diff.
 * Returns the concatenated patch sections for the given file paths.
 */
export function extractPatchForFiles(rawDiff: string, filePaths: string[]): string {
  if (!rawDiff || filePaths.length === 0) return '';

  const pathSet = new Set(filePaths);
  const lines = rawDiff.split('\n');
  const result: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // Parse file path from "diff --git a/path b/path"
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match?.[2]) {
        capturing = pathSet.has(match[2]);
      } else {
        capturing = false;
      }
    }

    if (capturing) {
      result.push(line);
    }
  }

  return result.join('\n');
}

// ─── DirectorySplitter ──────────────────────────────────────────────────────────

/**
 * Groups files by top-level directory. Files at root go into a '_root' group.
 * Returns chunk assignments with all files assigned to exactly one chunk.
 */
export function directorySplit(files: FileEntry[]): ChunkAssignment[] {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.path.split('/');
    // Use the top-level directory, or '_root' for files without a directory
    const dir = parts.length > 1 ? (parts[0] ?? '_root') : '_root';
    const existing = groups.get(dir) ?? [];
    existing.push(file.path);
    groups.set(dir, existing);
  }

  const chunks: ChunkAssignment[] = [];
  let idx = 1;

  for (const [dir, filePaths] of groups) {
    const paddedIdx = String(idx).padStart(3, '0');
    chunks.push({
      id: `${paddedIdx}-${dir}`,
      title: dir === '_root' ? 'Root files' : `${dir}/`,
      description: `Files in ${dir === '_root' ? 'root directory' : `${dir}/`}`,
      reviewPriority: 'medium',
      filePaths,
    });
    idx++;
  }

  return chunks;
}

// ─── SingleFileSplitter ─────────────────────────────────────────────────────────

/**
 * Creates one chunk per file. Chunk count equals file count.
 */
export function singleFileSplit(files: FileEntry[]): ChunkAssignment[] {
  return files.map((file, idx) => {
    const paddedIdx = String(idx + 1).padStart(3, '0');
    // Create a slug from the file path
    const slug = file.path.replace(/[/\\]/g, '-').replace(/\.[^.]+$/, '');
    return {
      id: `${paddedIdx}-${slug}`,
      title: file.path,
      description: `Single file: ${file.path}`,
      reviewPriority: 'medium',
      filePaths: [file.path],
    };
  });
}

// ─── PlanSplitter ───────────────────────────────────────────────────────────────

/**
 * Parse and validate a JSON plan string.
 * Rejects invalid JSON, missing chunks array, chunks without id or files.
 */
export function parsePlan(planJson: string): PlanJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(planJson);
  } catch {
    throw new Error(`Invalid plan JSON: ${planJson.substring(0, 100)}`);
  }

  if (!parsed || typeof parsed !== 'object' || !('chunks' in parsed)) {
    throw new Error('Plan must have a "chunks" array');
  }

  const plan = parsed as { chunks: unknown[] };
  if (!Array.isArray(plan.chunks)) {
    throw new Error('Plan must have a "chunks" array');
  }

  for (const chunk of plan.chunks) {
    if (!chunk || typeof chunk !== 'object') {
      throw new Error('Each chunk must be an object');
    }
    const c = chunk as Record<string, unknown>;
    if (!c.id || typeof c.id !== 'string') {
      throw new Error('Each chunk must have a string "id"');
    }
    if (!Array.isArray(c.files)) {
      throw new Error(`Chunk "${c.id}" must have a "files" array of glob patterns`);
    }
  }

  return plan as unknown as PlanJson;
}

/**
 * Assigns files to chunks based on glob patterns from a plan.
 * Unmatched files go to an `_uncategorized` chunk.
 * Enforces chunk ID uniqueness.
 */
export function planSplit(files: FileEntry[], plan: PlanChunkDef[]): ChunkAssignment[] {
  // Validate chunk IDs: uniqueness + reserved IDs
  const idSet = new Set<string>();
  for (const def of plan) {
    if (def.id === '_uncategorized') {
      throw new Error(
        '"_uncategorized" is a reserved chunk ID used for unmatched files. Choose a different ID.',
      );
    }
    if (idSet.has(def.id)) {
      throw new Error(`Duplicate chunk ID: "${def.id}". Chunk IDs must be unique.`);
    }
    idSet.add(def.id);
  }

  const assigned = new Set<string>();
  const chunks: ChunkAssignment[] = [];

  for (const def of plan) {
    const matchedPaths: string[] = [];

    for (const pattern of def.files) {
      const glob = new Bun.Glob(pattern);
      for (const file of files) {
        if (!assigned.has(file.path) && glob.match(file.path)) {
          matchedPaths.push(file.path);
          assigned.add(file.path);
        }
      }
    }

    chunks.push({
      id: def.id,
      title: def.title || def.id,
      description: def.description ?? '',
      reviewPriority: def.review_priority ?? 'medium',
      filePaths: matchedPaths,
    });
  }

  // Collect unmatched files into _uncategorized
  const unmatched = files.filter((f) => !assigned.has(f.path));
  if (unmatched.length > 0) {
    chunks.push({
      id: '_uncategorized',
      title: 'Uncategorized',
      description: 'Files not matched by any plan glob pattern',
      reviewPriority: 'low',
      filePaths: unmatched.map((f) => f.path),
    });
  }

  return chunks;
}

// ─── Max-tokens subdivision ─────────────────────────────────────────────────────

/**
 * Estimate tokens for a single file based on its additions + deletions.
 * Uses a rough heuristic: ~10 tokens per diff line (accounting for context,
 * headers, etc.).
 */
function estimateFileTokens(file: FileEntry): number {
  const lines = file.additions + file.deletions;
  // ~10 tokens per diff line (context, headers, content)
  return Math.max(lines * 10, 5);
}

/**
 * Subdivide oversized chunks based on maxTokens limit.
 * Each chunk whose estimated tokens exceed maxTokens is split into smaller
 * sub-chunks. Returns all chunks (subdivided + those already under limit).
 */
export function subdivideChunks(
  chunks: ChunkAssignment[],
  allFiles: FileEntry[],
  maxTokens: number,
): ChunkAssignment[] {
  const fileMap = new Map<string, FileEntry>();
  for (const f of allFiles) {
    fileMap.set(f.path, f);
  }

  const result: ChunkAssignment[] = [];

  for (const chunk of chunks) {
    // Estimate total tokens for this chunk
    let totalTokens = 0;
    const fileTokens: { path: string; tokens: number }[] = [];

    for (const path of chunk.filePaths) {
      const file = fileMap.get(path);
      const tokens = file ? estimateFileTokens(file) : 5;
      totalTokens += tokens;
      fileTokens.push({ path, tokens });
    }

    if (totalTokens <= maxTokens) {
      result.push(chunk);
      continue;
    }

    // Single-file chunks that exceed max-tokens cannot be subdivided further
    if (chunk.filePaths.length <= 1) {
      result.push({ ...chunk, oversized: true });
      continue;
    }

    // Subdivide: greedily pack files into sub-chunks
    let subIdx = 1;
    let currentPaths: string[] = [];
    let currentTokens = 0;

    for (const { path, tokens } of fileTokens) {
      if (currentPaths.length > 0 && currentTokens + tokens > maxTokens) {
        // Flush current sub-chunk
        result.push({
          id: `${chunk.id}-${String(subIdx).padStart(2, '0')}`,
          title: `${chunk.title} (part ${subIdx})`,
          description: chunk.description,
          reviewPriority: chunk.reviewPriority,
          filePaths: currentPaths,
        });
        subIdx++;
        currentPaths = [];
        currentTokens = 0;
      }
      currentPaths.push(path);
      currentTokens += tokens;
    }

    // Flush remaining
    if (currentPaths.length > 0) {
      if (subIdx === 1) {
        // No subdivision happened (all files fit or single file)
        result.push(chunk);
      } else {
        result.push({
          id: `${chunk.id}-${String(subIdx).padStart(2, '0')}`,
          title: `${chunk.title} (part ${subIdx})`,
          description: chunk.description,
          reviewPriority: chunk.reviewPriority,
          filePaths: currentPaths,
        });
      }
    }
  }

  return result;
}

// ─── Keep-findings remapping ────────────────────────────────────────────────────

/**
 * Remap existing findings to new chunks based on file assignment.
 * For each finding, looks up which new chunk contains the finding's file.
 * Returns mapping of findingId → new chunk slug (or null if not found).
 */
export function remapFindings(
  existingFindings: FindingRow[],
  newChunks: ChunkAssignment[],
): FindingRemap[] {
  // Build file → chunk slug lookup
  const fileToChunk = new Map<string, string>();
  for (const chunk of newChunks) {
    for (const path of chunk.filePaths) {
      fileToChunk.set(path, chunk.id);
    }
  }

  return existingFindings.map((finding) => ({
    findingId: finding.id,
    newChunkSlug: fileToChunk.get(finding.file) ?? null,
  }));
}

// ─── High-level splitFiles ──────────────────────────────────────────────────────

/**
 * High-level split orchestrator. Takes files + rawDiff, applies the chosen
 * strategy, computes token estimates, and optionally subdivides by maxTokens.
 */
export function splitFiles(input: SplitInput, options: SplitOptions): SplitResult {
  const { files, rawDiff } = input;
  const { strategy, plan, maxTokens } = options;

  // 1. Get chunk assignments from the chosen strategy
  let assignments: ChunkAssignment[];

  switch (strategy) {
    case 'directory':
      assignments = directorySplit(files);
      break;
    case 'single-file':
      assignments = singleFileSplit(files);
      break;
    case 'plan': {
      if (!plan) {
        throw new Error('Plan JSON is required for plan strategy');
      }
      const parsed = parsePlan(plan);
      assignments = planSplit(files, parsed.chunks);
      break;
    }
    default:
      throw new Error(`Unknown strategy: ${strategy}`);
  }

  // 2. Apply max-tokens subdivision if specified
  if (maxTokens && maxTokens > 0) {
    assignments = subdivideChunks(assignments, files, maxTokens);
  }

  // 3. Compute patch content and token estimates for each chunk
  const resultChunks: SplitResultChunk[] = assignments.map((chunk) => {
    const patchContent = extractPatchForFiles(rawDiff, chunk.filePaths);
    const tokens = estimateTokens(patchContent);

    return {
      ...chunk,
      estimatedTokens: tokens,
      patchContent,
    };
  });

  return { chunks: resultChunks };
}
