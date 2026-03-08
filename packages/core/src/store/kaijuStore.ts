import { eq } from 'drizzle-orm';

import type { FileStatus, FindingSeverity, FindingStatus, ReviewPriority } from '../types/index.js';
import type { CommentState } from '../types/index.js';
import {
  computeManifestStats,
  ensureReviewDirs,
  getReviewDir,
  parseReviewKey,
  writeChunkMeta,
  writeChunkPatch,
  writeCommentFile,
  writeFilesJson,
  writeFindingFile,
  writeManifest,
} from './fileIO.js';
import type {
  ChunkMetaJson,
  CommentFileJson,
  FilesJsonEntry,
  FindingFileJson,
  ManifestChunk,
  ManifestJson,
} from './fileTypes.js';
import type { KaijuDB } from './index.js';
import { chunks, comments, files, findings, imports, reviews } from './schema.js';

// ─── Input types ────────────────────────────────────────────────────────────────

export interface CreateReviewInput {
  key: string;
  provider: string;
  repo: string;
  pr: number;
  title?: string;
  url?: string;
  base?: string;
  head?: string;
  rawDiff?: string;
}

export interface CreateFileInput {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}

export interface CreateImportInput {
  source: string;
  target: string;
}

export interface CreateChunkInput {
  slug: string;
  title: string;
  description?: string;
  reviewPriority?: ReviewPriority;
  estimatedTokens?: number;
  filePaths?: string[];
  fileIds?: number[];
  patchContent: string;
}

export interface CreateCommentInput {
  threadId: string;
  source?: string;
  state?: CommentState;
  chunkId?: number;
  file?: string;
  line?: number;
  body: string;
  author?: string;
  timestamp?: string;
  ghCommentId?: number;
}

export interface CreateFindingInput {
  chunkId?: number;
  reviewer: string;
  file: string;
  line?: number;
  endLine?: number;
  severity: FindingSeverity;
  message: string;
  suggestion?: string;
  codeSuggestion?: string;
  rootCause?: string;
  impact?: string;
  status?: FindingStatus;
  publish?: boolean;
  inReplyTo?: string;
  timestamp?: string;
}

// ─── KaijuStore ─────────────────────────────────────────────────────────────────

/**
 * Dual-layer store: every write updates BOTH files on disk AND SQLite.
 *
 * SQLite is the query layer (for UI, CLI aggregations, FTS).
 * Files on disk are the agent-readable layer (Read tool, Glob).
 */
export class KaijuStore {
  constructor(
    private readonly db: KaijuDB,
    private readonly baseDir: string,
  ) {}

  // ─── Review CRUD ────────────────────────────────────────────────────────────

  /**
   * Create a new review in both SQLite and disk.
   * Creates directory structure, manifest.json, and empty files.json.
   */
  async createReview(input: CreateReviewInput) {
    // Validate key format
    parseReviewKey(input.key);

    // SQLite layer
    const result = this.db
      .insert(reviews)
      .values({
        key: input.key,
        provider: input.provider,
        repo: input.repo,
        pr: input.pr,
        title: input.title ?? '',
        url: input.url ?? '',
        base: input.base ?? '',
        head: input.head ?? '',
        rawDiff: input.rawDiff ?? null,
      })
      .returning()
      .get();

    // File layer
    const reviewDir = getReviewDir(input.key, this.baseDir);
    await ensureReviewDirs(reviewDir);

    // Write empty files.json
    await writeFilesJson(reviewDir, { files: [], imports: [] });

    // Write initial manifest.json
    const manifest = this.buildManifest(input, [], [], 0, 0);
    await writeManifest(reviewDir, manifest);

    return result;
  }

  /** Get a review by key. */
  getReview(key: string) {
    return this.db.select().from(reviews).where(eq(reviews.key, key)).get();
  }

  /** List all reviews. */
  listReviews() {
    return this.db.select().from(reviews).all();
  }

  /** Delete a review from SQLite. Returns true if deleted, false if not found. */
  deleteReview(key: string): boolean {
    const result = this.db.delete(reviews).where(eq(reviews.key, key)).returning().all();
    return result.length > 0;
  }

  /**
   * Update review status and sync to both layers.
   */
  async updateReviewStatus(key: string, status: string) {
    const review = this.getReview(key);
    if (!review) {
      throw new Error(`Review not found: ${key}`);
    }

    // SQLite layer
    this.db
      .update(reviews)
      .set({ status, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(reviews.key, key))
      .run();

    // File layer — update manifest
    await this.syncManifest(key);
  }

  /** Store raw diff text in the review row. */
  setRawDiff(key: string, rawDiff: string) {
    this.db.update(reviews).set({ rawDiff }).where(eq(reviews.key, key)).run();
  }

  // ─── Files CRUD ─────────────────────────────────────────────────────────────

  /**
   * Add files to a review. Updates both SQLite and files.json on disk.
   */
  async addFiles(key: string, fileInputs: CreateFileInput[]) {
    const review = this.getReview(key);
    if (!review) {
      throw new Error(`Review not found: ${key}`);
    }

    // SQLite layer
    const results = [];
    for (const f of fileInputs) {
      const result = this.db
        .insert(files)
        .values({
          reviewId: review.id,
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        })
        .returning()
        .get();
      results.push(result);
    }

    // File layer — update files.json
    await this.syncFilesJson(key);

    // Update manifest stats
    await this.syncManifest(key);

    return results;
  }

  /** Get all files for a review. */
  getFiles(key: string) {
    const review = this.getReview(key);
    if (!review) return [];
    return this.db.select().from(files).where(eq(files.reviewId, review.id)).all();
  }

  // ─── Imports CRUD ───────────────────────────────────────────────────────────

  /**
   * Add imports to a review. Updates both SQLite and files.json on disk.
   */
  async addImports(key: string, importInputs: CreateImportInput[]) {
    const review = this.getReview(key);
    if (!review) {
      throw new Error(`Review not found: ${key}`);
    }

    // SQLite layer
    const results = [];
    for (const imp of importInputs) {
      const result = this.db
        .insert(imports)
        .values({
          reviewId: review.id,
          source: imp.source,
          target: imp.target,
        })
        .returning()
        .get();
      results.push(result);
    }

    // File layer — update files.json (imports section)
    await this.syncFilesJson(key);

    return results;
  }

  /** Get all imports for a review. */
  getImports(key: string) {
    const review = this.getReview(key);
    if (!review) return [];
    return this.db.select().from(imports).where(eq(imports.reviewId, review.id)).all();
  }

  // ─── Chunks CRUD ────────────────────────────────────────────────────────────

  /**
   * Add a chunk to a review. Updates SQLite, writes .patch + .meta.json,
   * assigns files to chunk, and updates manifest.
   */
  async addChunk(key: string, input: CreateChunkInput) {
    const review = this.getReview(key);
    if (!review) {
      throw new Error(`Review not found: ${key}`);
    }

    // SQLite layer — create chunk
    const chunk = this.db
      .insert(chunks)
      .values({
        reviewId: review.id,
        slug: input.slug,
        title: input.title,
        description: input.description ?? '',
        reviewPriority: input.reviewPriority ?? 'medium',
        estimatedTokens: input.estimatedTokens ?? 0,
      })
      .returning()
      .get();

    // Assign files to chunk by path
    if (input.filePaths && input.filePaths.length > 0) {
      const pathSet = new Set(input.filePaths);
      const allFiles = this.db.select().from(files).where(eq(files.reviewId, review.id)).all();
      for (const f of allFiles) {
        if (pathSet.has(f.path)) {
          this.db.update(files).set({ chunkId: chunk.id }).where(eq(files.id, f.id)).run();
        }
      }
    }

    // Auto-transition review status to 'split' when first chunk is added
    if (review.status === 'fetched') {
      this.db
        .update(reviews)
        .set({ status: 'split', updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(reviews.key, key))
        .run();
    }

    // File layer — write .patch
    const reviewDir = getReviewDir(key, this.baseDir);
    await writeChunkPatch(reviewDir, input.slug, input.patchContent);

    // File layer — write .meta.json
    const chunkFiles = this.getChunkFiles(review.id, chunk.id);
    const chunkComments = this.getChunkCommentThreadIds(review.id, chunk.id);
    const chunkFindings = this.getChunkFindingIds(review.id, chunk.id);

    const meta: ChunkMetaJson = {
      id: input.slug,
      title: input.title,
      description: input.description ?? '',
      review_priority: input.reviewPriority ?? 'medium',
      estimated_tokens: input.estimatedTokens ?? 0,
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
      comments: chunkComments,
      findings: chunkFindings,
    };
    await writeChunkMeta(reviewDir, input.slug, meta);

    // Update manifest
    await this.syncManifest(key);

    return chunk;
  }

  /** Get all chunks for a review. */
  getChunks(key: string) {
    const review = this.getReview(key);
    if (!review) return [];
    return this.db.select().from(chunks).where(eq(chunks.reviewId, review.id)).all();
  }

  // ─── Comments CRUD ──────────────────────────────────────────────────────────

  /**
   * Add a comment to a review. Updates SQLite and writes/updates comment file.
   * If a comment with the same threadId exists, the file is updated with
   * an appended message (thread grouping).
   */
  async addComment(key: string, input: CreateCommentInput) {
    const review = this.getReview(key);
    if (!review) {
      throw new Error(`Review not found: ${key}`);
    }

    // SQLite layer
    const comment = this.db
      .insert(comments)
      .values({
        reviewId: review.id,
        threadId: input.threadId,
        source: input.source ?? 'github',
        state: input.state ?? 'open',
        chunkId: input.chunkId ?? null,
        file: input.file ?? null,
        line: input.line ?? null,
        body: input.body,
        author: input.author ?? null,
        timestamp: input.timestamp ?? null,
        ghCommentId: input.ghCommentId ?? null,
      })
      .returning()
      .get();

    // File layer — gather all messages for this thread from SQLite
    const threadComments = this.db
      .select()
      .from(comments)
      .where(eq(comments.threadId, input.threadId))
      .all();

    // Resolve chunk slug from numeric ID for on-disk representation
    const chunkSlug = input.chunkId ? this.resolveChunkSlug(input.chunkId) : null;

    const commentFile: CommentFileJson = {
      thread_id: input.threadId,
      source: input.source ?? 'github',
      state: input.state ?? 'open',
      chunk_id: chunkSlug,
      file: input.file ?? null,
      line: input.line ?? null,
      messages: threadComments.map((c) => ({
        author: c.author ?? '',
        body: c.body,
        timestamp: c.timestamp ?? '',
        ...(c.ghCommentId ? { gh_comment_id: c.ghCommentId } : {}),
      })),
    };

    const reviewDir = getReviewDir(key, this.baseDir);
    await writeCommentFile(reviewDir, input.threadId, commentFile);

    // Update manifest stats
    await this.syncManifest(key);

    return comment;
  }

  /** Get all comments for a review. */
  getComments(key: string) {
    const review = this.getReview(key);
    if (!review) return [];
    return this.db.select().from(comments).where(eq(comments.reviewId, review.id)).all();
  }

  // ─── Findings CRUD ──────────────────────────────────────────────────────────

  /**
   * Add a finding to a review. Updates SQLite and writes finding file.
   */
  async addFinding(key: string, input: CreateFindingInput) {
    const review = this.getReview(key);
    if (!review) {
      throw new Error(`Review not found: ${key}`);
    }

    // SQLite layer
    const finding = this.db
      .insert(findings)
      .values({
        reviewId: review.id,
        chunkId: input.chunkId ?? null,
        reviewer: input.reviewer,
        file: input.file,
        line: input.line ?? null,
        endLine: input.endLine ?? null,
        severity: input.severity,
        message: input.message,
        suggestion: input.suggestion ?? null,
        codeSuggestion: input.codeSuggestion ?? null,
        rootCause: input.rootCause ?? null,
        impact: input.impact ?? null,
        status: input.status ?? 'open',
        publish: input.publish ?? false,
        inReplyTo: input.inReplyTo ?? null,
        timestamp: input.timestamp ?? null,
      })
      .returning()
      .get();

    // File layer — write finding JSON
    const findingId = `finding-${String(finding.id).padStart(3, '0')}`;
    // Resolve chunk slug from numeric ID for on-disk representation
    const findingChunkSlug = input.chunkId ? this.resolveChunkSlug(input.chunkId) : null;
    const findingFile: FindingFileJson = {
      id: findingId,
      reviewer: input.reviewer,
      chunk_id: findingChunkSlug,
      timestamp: input.timestamp ?? new Date().toISOString(),
      in_reply_to: input.inReplyTo ?? null,
      findings: [
        {
          file: input.file,
          line: input.line ?? null,
          end_line: input.endLine ?? null,
          severity: input.severity,
          message: input.message,
          suggestion: input.suggestion ?? null,
          code_suggestion: input.codeSuggestion ?? null,
          root_cause: input.rootCause ?? null,
          impact: input.impact ?? null,
          status: input.status ?? 'open',
          publish: input.publish ?? false,
        },
      ],
    };

    const reviewDir = getReviewDir(key, this.baseDir);
    await writeFindingFile(reviewDir, findingId, findingFile);

    // Update manifest stats
    await this.syncManifest(key);

    return finding;
  }

  /** Get all findings for a review. */
  getFindings(key: string) {
    const review = this.getReview(key);
    if (!review) return [];
    return this.db.select().from(findings).where(eq(findings.reviewId, review.id)).all();
  }

  // ─── Close ────────────────────────────────────────────────────────────────

  /** Close the database connection. */
  close() {
    this.db.close();
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Sync files.json on disk with current SQLite state.
   */
  private async syncFilesJson(key: string) {
    const review = this.getReview(key);
    if (!review) return;

    const dbFiles = this.db.select().from(files).where(eq(files.reviewId, review.id)).all();
    const dbImports = this.db.select().from(imports).where(eq(imports.reviewId, review.id)).all();

    const reviewDir = getReviewDir(key, this.baseDir);
    await writeFilesJson(reviewDir, {
      files: dbFiles.map((f) => ({
        path: f.path,
        status: f.status as FileStatus,
        additions: f.additions,
        deletions: f.deletions,
      })),
      imports: dbImports.map((i) => ({
        source: i.source,
        target: i.target,
      })),
    });
  }

  /**
   * Sync manifest.json on disk with current SQLite state.
   */
  private async syncManifest(key: string) {
    const review = this.getReview(key);
    if (!review) return;

    const dbFiles = this.db.select().from(files).where(eq(files.reviewId, review.id)).all();
    const dbChunks = this.db.select().from(chunks).where(eq(chunks.reviewId, review.id)).all();
    const dbComments = this.db
      .select()
      .from(comments)
      .where(eq(comments.reviewId, review.id))
      .all();
    const dbFindings = this.db
      .select()
      .from(findings)
      .where(eq(findings.reviewId, review.id))
      .all();

    const filesEntries: FilesJsonEntry[] = dbFiles.map((f) => ({
      path: f.path,
      status: f.status as FileStatus,
      additions: f.additions,
      deletions: f.deletions,
    }));

    // Build manifest chunks from DB chunks
    const manifestChunks: ManifestChunk[] = dbChunks.map((c) => {
      const chunkFiles = dbFiles.filter((f) => f.chunkId === c.id);
      const chunkComments = dbComments.filter((co) => co.chunkId === c.id);
      const chunkFindings = dbFindings.filter((fi) => fi.chunkId === c.id);

      let additions = 0;
      let deletions = 0;
      for (const f of chunkFiles) {
        additions += f.additions;
        deletions += f.deletions;
      }

      return {
        id: c.slug,
        title: c.title,
        description: c.description,
        files: chunkFiles.map((f) => f.path),
        additions,
        deletions,
        review_priority: c.reviewPriority as ReviewPriority,
        estimated_tokens: c.estimatedTokens,
        status: c.status,
        comments_count: chunkComments.length,
        findings_count: chunkFindings.length,
      };
    });

    const stats = computeManifestStats({
      files: filesEntries,
      chunks: manifestChunks,
      totalComments: dbComments.length,
      totalFindings: dbFindings.length,
    });

    // Re-read review to get the latest status (may have been updated by addChunk)
    const latestReview = this.getReview(key);
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
      status: latestReview?.status ?? review.status,
      stats,
      chunks: manifestChunks,
    };

    const reviewDir = getReviewDir(key, this.baseDir);
    await writeManifest(reviewDir, manifest);
  }

  /**
   * Build an initial manifest from review input and data.
   */
  private buildManifest(
    input: CreateReviewInput,
    filesEntries: FilesJsonEntry[],
    manifestChunks: ManifestChunk[],
    totalComments: number,
    totalFindings: number,
    status: string = 'fetched',
  ): ManifestJson {
    const stats = computeManifestStats({
      files: filesEntries,
      chunks: manifestChunks,
      totalComments,
      totalFindings,
    });

    return {
      version: '1',
      source: {
        provider: input.provider,
        repo: input.repo,
        pr: input.pr,
        base: input.base ?? '',
        head: input.head ?? '',
        url: input.url ?? '',
        title: input.title ?? '',
      },
      status,
      stats,
      chunks: manifestChunks,
    };
  }

  /**
   * Resolve a numeric chunk ID to its slug.
   * Returns null if the chunk is not found.
   */
  private resolveChunkSlug(chunkId: number): string | null {
    const chunk = this.db.select().from(chunks).where(eq(chunks.id, chunkId)).get();
    return chunk?.slug ?? null;
  }

  /**
   * Get files assigned to a specific chunk.
   */
  private getChunkFiles(reviewId: number, chunkId: number) {
    return this.db.select().from(files).where(eq(files.chunkId, chunkId)).all();
  }

  /**
   * Get comment thread IDs assigned to a specific chunk.
   */
  private getChunkCommentThreadIds(reviewId: number, chunkId: number): string[] {
    const chunkComments = this.db
      .select()
      .from(comments)
      .where(eq(comments.chunkId, chunkId))
      .all();
    return [...new Set(chunkComments.map((c) => c.threadId))];
  }

  /**
   * Get finding IDs assigned to a specific chunk.
   */
  private getChunkFindingIds(reviewId: number, chunkId: number): string[] {
    const chunkFindings = this.db
      .select()
      .from(findings)
      .where(eq(findings.chunkId, chunkId))
      .all();
    return chunkFindings.map((f) => `finding-${String(f.id).padStart(3, '0')}`);
  }
}
