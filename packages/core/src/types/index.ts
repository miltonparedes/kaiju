// ─── Core domain types aligned to the Kaiju format spec ─────────────────────

export type ReviewStatus = 'fetched' | 'split' | 'reviewed';
export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';
export type FindingSeverity = 'critical' | 'suggestion' | 'nitpick' | 'praise';
export type FindingStatus = 'open' | 'resolved' | 'dismissed';
export type ReviewPriority = 'high' | 'medium' | 'low';
export type CommentState = 'open' | 'resolved';

// ─── Review ─────────────────────────────────────────────────────────────────────

export interface Review {
  id: number;
  key: string;
  provider: string;
  repo: string;
  pr: number;
  title: string;
  url: string;
  base: string;
  head: string;
  status: ReviewStatus;
  rawDiff?: string | null;
  createdAt: number;
  updatedAt: number;
}

// ─── FileEntry ──────────────────────────────────────────────────────────────────

export interface FileEntry {
  id: number;
  reviewId: number;
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  chunkId?: number | null;
}

// ─── Import ─────────────────────────────────────────────────────────────────────

export interface Import {
  id: number;
  reviewId: number;
  source: string;
  target: string;
}

// ─── Chunk ──────────────────────────────────────────────────────────────────────

export interface Chunk {
  id: number;
  reviewId: number;
  slug: string;
  title: string;
  description: string;
  reviewPriority: ReviewPriority;
  estimatedTokens: number;
  patch?: string | null;
  status: string;
  createdAt: number;
}

// ─── ChunkDep ───────────────────────────────────────────────────────────────────

export interface ChunkDep {
  id: number;
  sourceChunkId: number;
  targetChunkId: number;
}

// ─── Comment ────────────────────────────────────────────────────────────────────

export interface Comment {
  id: number;
  reviewId: number;
  threadId: string;
  source: string;
  state: CommentState;
  chunkId?: number | null;
  file?: string | null;
  line?: number | null;
  body: string;
  author?: string | null;
  timestamp?: string | null;
  ghCommentId?: number | null;
  createdAt: number;
}

// ─── Finding ────────────────────────────────────────────────────────────────────

export interface Finding {
  id: number;
  reviewId: number;
  chunkId?: number | null;
  reviewer: string;
  file: string;
  line?: number | null;
  endLine?: number | null;
  severity: FindingSeverity;
  message: string;
  suggestion?: string | null;
  codeSuggestion?: string | null;
  rootCause?: string | null;
  impact?: string | null;
  status: FindingStatus;
  publish: boolean;
  inReplyTo?: string | null;
  timestamp?: string | null;
  createdAt: number;
}

// ─── DB Row type aliases ────────────────────────────────────────────────────
// These are aliases for the DB row shapes (numeric chunkId, SQLite IDs).
// Use them when dealing with raw Drizzle query results.

export type ReviewRow = Review;
export type FileEntryRow = FileEntry;
export type ImportRow = Import;
export type ChunkRow = Chunk;
export type ChunkDepRow = ChunkDep;
export type CommentRow = Comment;
export type FindingRow = Finding;

// ─── Git Provider ───────────────────────────────────────────────────────────────

export interface GitProvider {
  name: string;
  baseUrl: string;
}

export interface PullRequest {
  provider: string;
  repo: string;
  pr: number;
  title: string;
  url: string;
  base: string;
  head: string;
  files: FileEntry[];
}
