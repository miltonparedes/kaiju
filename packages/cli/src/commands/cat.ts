import { homedir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, createDB, getReviewDir, parsePRReference } from '@kaiju/core';
import { Command } from 'commander';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface CatCommentEntry {
  threadId: string;
  file: string | null;
  line: number | null;
  author: string | null;
  body: string;
}

export interface CatFindingEntry {
  id: number;
  severity: string;
  file: string;
  line: number | null;
  message: string;
}

export interface CatFileEntry {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface CatDisplayData {
  id: string;
  title: string;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  estimatedTokens: number;
  commentCount: number;
  comments: CatCommentEntry[];
  findings: CatFindingEntry[];
  diff: string;
  patchPath: string;
  metaPath: string;
  files: CatFileEntry[];
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format the chunk header with title, stats, tokens, comments, and file paths.
 */
export function formatCatHeader(data: CatDisplayData): string {
  const lines: string[] = [];

  // Chunk header line
  lines.push(`Chunk: ${data.id} — "${data.title}"`);
  lines.push(
    `  ${data.fileCount} files │ ${data.totalAdditions}+ ${data.totalDeletions}- │ ${data.estimatedTokens} tokens │ ${data.commentCount} comments`,
  );
  lines.push('');

  // Paths
  lines.push(`Patch:    ${data.patchPath}`);
  lines.push(`Meta:     ${data.metaPath}`);

  // Comments summary
  if (data.comments.length > 0) {
    lines.push('');
    lines.push('Comments:');
    for (const comment of data.comments) {
      const location = comment.file
        ? `${comment.file}${comment.line != null ? `:${comment.line}` : ''}`
        : 'general';
      const author = comment.author ?? 'unknown';
      lines.push(`  ${comment.threadId} (${location}) — ${author}`);
      // Add comment body indented below the header line
      const bodyLines = comment.body.split('\n');
      for (const bodyLine of bodyLines) {
        lines.push(`    ${bodyLine}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format metadata-only view (no diff body).
 * Includes header info plus file list.
 */
export function formatCatMeta(data: CatDisplayData): string {
  const lines: string[] = [];

  // Header
  lines.push(formatCatHeader(data));
  lines.push('');

  // File list
  lines.push('Files:');
  for (const file of data.files) {
    lines.push(`  ${file.path}  +${file.additions} -${file.deletions}  ${file.status}`);
  }

  return lines.join('\n');
}

/**
 * Format as structured JSON with all chunk data.
 */
export function formatCatJson(data: CatDisplayData): string {
  return JSON.stringify(
    {
      id: data.id,
      title: data.title,
      files: data.files.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      diff: data.diff,
      comments: data.comments.map((c) => ({
        threadId: c.threadId,
        file: c.file,
        line: c.line,
        author: c.author,
        body: c.body,
      })),
      findings: data.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        file: f.file,
        line: f.line,
        message: f.message,
      })),
    },
    null,
    2,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve a review key from a PR reference or find the most recent review.
 */
function resolveReviewKey(store: KaijuStore, prRef?: string): string | null {
  if (prRef) {
    try {
      const parsed = parsePRReference(prRef);
      const key = `github/${parsed.owner}/${parsed.repo}/${parsed.pr}`;
      const review = store.getReview(key);
      if (!review) {
        console.error(
          `Error: Review for ${parsed.owner}/${parsed.repo}#${parsed.pr} not found. Run 'kaiju fetch ${parsed.owner}/${parsed.repo}#${parsed.pr}' first.`,
        );
        process.exitCode = 1;
        return null;
      }
      return key;
    } catch {
      const review = store.getReview(prRef);
      if (review) {
        return prRef;
      }

      console.error(
        `Error: Invalid PR reference "${prRef}". Expected formats:\n` +
          '  - org/repo#N\n' +
          '  - https://github.com/org/repo/pull/N',
      );
      process.exitCode = 1;
      return null;
    }
  }

  const allReviews = store.listReviews();
  if (allReviews.length === 0) {
    return null;
  }

  allReviews.sort((a, b) => b.updatedAt - a.updatedAt);
  return allReviews[0]!.key;
}

// ─── Store factory ──────────────────────────────────────────────────────────────

function createStore(): KaijuStore {
  const baseDir = join(homedir(), '.kaiju');
  const dbPath = join(baseDir, 'kaiju.db');
  const db = createDB(dbPath);
  return new KaijuStore(db, baseDir);
}

// ─── Command ────────────────────────────────────────────────────────────────────

export const catCommand = new Command('cat')
  .description('Display a chunk diff with header and metadata')
  .argument('<chunk-id>', 'Chunk ID to display')
  .argument('[pr-ref]', 'PR reference: org/repo#N (optional, uses latest if omitted)')
  .option('--json', 'Output as structured JSON')
  .option('--meta', 'Show metadata only, without diff body')
  .action(
    async (
      chunkId: string,
      prRef: string | undefined,
      options: { json?: boolean; meta?: boolean },
    ) => {
      const store = createStore();

      try {
        const reviewKey = resolveReviewKey(store, prRef);
        if (!reviewKey) {
          // resolveReviewKey already printed a specific error if a PR ref was given
          if (!process.exitCode) {
            console.error('Error: No review found. Run `kaiju fetch` first to download a PR.');
            process.exitCode = 1;
          }
          return;
        }

        // Get all chunks for the review
        const allChunks = store.getChunks(reviewKey);
        const chunk = allChunks.find((c) => c.slug === chunkId);

        if (!chunk) {
          console.error(`Error: Chunk "${chunkId}" not found in review "${reviewKey}".`);
          process.exitCode = 1;
          return;
        }

        // Get files for this chunk
        const allFiles = store.getFiles(reviewKey);
        const chunkFiles = allFiles.filter((f) => f.chunkId === chunk.id);

        // Compute stats
        let totalAdditions = 0;
        let totalDeletions = 0;
        for (const f of chunkFiles) {
          totalAdditions += f.additions;
          totalDeletions += f.deletions;
        }

        // Get comments for this chunk
        const allComments = store.getComments(reviewKey);
        const chunkComments = allComments.filter((c) => c.chunkId === chunk.id);

        // Get findings for this chunk
        const allFindings = store.getFindings(reviewKey);
        const chunkFindings = allFindings.filter((f) => f.chunkId === chunk.id);

        // Build paths
        const baseDir = join(homedir(), '.kaiju');
        const reviewDir = getReviewDir(reviewKey, baseDir);

        const displayData: CatDisplayData = {
          id: chunk.slug,
          title: chunk.title,
          fileCount: chunkFiles.length,
          totalAdditions,
          totalDeletions,
          estimatedTokens: chunk.estimatedTokens,
          commentCount: chunkComments.length,
          comments: chunkComments.map((c) => ({
            threadId: c.threadId,
            file: c.file ?? null,
            line: c.line ?? null,
            author: c.author ?? null,
            body: c.body,
          })),
          findings: chunkFindings.map((f) => ({
            id: f.id,
            severity: f.severity,
            file: f.file,
            line: f.line ?? null,
            message: f.message,
          })),
          diff: chunk.patch ?? '',
          patchPath: join(reviewDir, 'chunks', `${chunk.slug}.patch`),
          metaPath: join(reviewDir, 'chunks', `${chunk.slug}.meta.json`),
          files: chunkFiles.map((f) => ({
            path: f.path,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
          })),
        };

        if (options.json) {
          console.log(formatCatJson(displayData));
        } else if (options.meta) {
          console.log(formatCatMeta(displayData));
        } else {
          // Full output: header + diff
          const header = formatCatHeader(displayData);
          console.log(header);
          console.log('');
          console.log(displayData.diff);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      } finally {
        store.close();
      }
    },
  );
