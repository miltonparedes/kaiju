// ─── On-disk JSON file types (aligned to Kaiju - Formato.md spec) ────────────

import type {
  CommentState,
  FileStatus,
  FindingSeverity,
  FindingStatus,
  ReviewPriority,
} from '../types/index.js';

// ─── manifest.json ──────────────────────────────────────────────────────────────

export interface ManifestSource {
  provider: string;
  repo: string;
  pr: number;
  base: string;
  head: string;
  url: string;
  title?: string;
}

export interface ManifestStats {
  total_files: number;
  total_additions: number;
  total_deletions: number;
  total_chunks: number;
  total_comments: number;
  total_findings: number;
}

export interface ManifestChunk {
  id: string;
  title: string;
  description: string;
  files: string[];
  additions: number;
  deletions: number;
  review_priority: ReviewPriority;
  estimated_tokens: number;
  status: string;
  comments_count: number;
  findings_count: number;
}

export interface ManifestJson {
  version: string;
  source: ManifestSource;
  stats: ManifestStats;
  chunks: ManifestChunk[];
}

// ─── files.json ─────────────────────────────────────────────────────────────────

export interface FilesJsonEntry {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}

export interface FilesJsonImport {
  source: string;
  target: string;
}

export interface FilesJson {
  files: FilesJsonEntry[];
  imports: FilesJsonImport[];
}

// ─── chunks/*.meta.json ─────────────────────────────────────────────────────────

export interface ChunkMetaFile {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}

export interface ChunkMetaContext {
  imports_from: string[];
  imported_by: string[];
  has_breaking_changes: boolean;
}

export interface ChunkMetaJson {
  id: string;
  title: string;
  description: string;
  review_priority: ReviewPriority;
  estimated_tokens: number;
  files: ChunkMetaFile[];
  context: ChunkMetaContext;
  comments: string[];
  findings: string[];
}

// ─── comments/*.json ────────────────────────────────────────────────────────────

export interface CommentMessage {
  author: string;
  body: string;
  timestamp: string;
  gh_comment_id?: number;
}

export interface CommentFileJson {
  thread_id: string;
  source: string;
  state: CommentState;
  chunk_id?: string | null;
  file?: string | null;
  line?: number | null;
  messages: CommentMessage[];
}

// ─── findings/*.json ────────────────────────────────────────────────────────────

export interface FindingEntry {
  file: string;
  line?: number | null;
  end_line?: number | null;
  severity: FindingSeverity;
  message: string;
  suggestion?: string | null;
  code_suggestion?: string | null;
  root_cause?: string | null;
  impact?: string | null;
  status: FindingStatus;
  publish: boolean;
}

export interface FindingFileJson {
  id: string;
  reviewer: string;
  chunk_id?: string | null;
  timestamp: string;
  in_reply_to?: string | null;
  findings: FindingEntry[];
}

// ─── Review directory key ───────────────────────────────────────────────────────

export interface ReviewKey {
  provider: string;
  org: string;
  repo: string;
  pr: number;
}
