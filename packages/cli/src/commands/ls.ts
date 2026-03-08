import { homedir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, createDB, parsePRReference } from '@kaiju/core';
import { Command } from 'commander';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface LsChunkEntry {
  id: string;
  additions: number;
  deletions: number;
  estimatedTokens: number;
  status: string;
}

export interface LsAllEntry {
  key: string;
  repo: string;
  pr: number;
  chunkCount: number;
  reviewedCount: number;
  totalChunks: number;
  fileCount: number;
  status: string;
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format token count as a human-readable string (e.g., "~2.8k tok").
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `~${k.toFixed(1)}k tok`;
  }
  return `~${tokens} tok`;
}

/**
 * Format chunks as a human-readable table for `kaiju ls`.
 */
export function formatLsChunksTable(entries: LsChunkEntry[]): string {
  if (entries.length === 0) {
    return 'No chunks found. Run `kaiju split` first to create chunks.';
  }

  const maxId = Math.max(...entries.map((c) => c.id.length));
  const maxAdd = Math.max(...entries.map((c) => `${c.additions}+`.length));
  const maxDel = Math.max(...entries.map((c) => `${c.deletions}-`.length));
  const maxTok = Math.max(...entries.map((c) => formatTokens(c.estimatedTokens).length));

  const lines: string[] = [];
  for (const chunk of entries) {
    const id = chunk.id.padEnd(maxId);
    const add = `${chunk.additions}+`.padStart(maxAdd);
    const del = `${chunk.deletions}-`.padStart(maxDel);
    const tok = formatTokens(chunk.estimatedTokens).padStart(maxTok);
    lines.push(`${id}  ${add} ${del}  ${tok}  ${chunk.status}`);
  }

  return lines.join('\n');
}

/**
 * Format chunks as JSON for agent consumption.
 */
export function formatLsChunksJson(entries: LsChunkEntry[]): string {
  return JSON.stringify(
    {
      totalChunks: entries.length,
      chunks: entries.map((c) => ({
        id: c.id,
        additions: c.additions,
        deletions: c.deletions,
        estimatedTokens: c.estimatedTokens,
        status: c.status,
      })),
    },
    null,
    2,
  );
}

/**
 * Format all reviews as a human-readable table for `kaiju ls --all`.
 */
export function formatLsAllTable(entries: LsAllEntry[]): string {
  if (entries.length === 0) {
    return 'No reviews found. Run `kaiju fetch` first to download a PR.';
  }

  const lines: string[] = [];

  const maxRef = Math.max(...entries.map((e) => `${e.repo}#${e.pr}`.length));

  for (const entry of entries) {
    const ref = `${entry.repo}#${entry.pr}`.padEnd(maxRef);

    let info: string;
    if (entry.chunkCount > 0) {
      const chunkLabel = entry.chunkCount === 1 ? 'chunk' : 'chunks';
      info = `${entry.chunkCount} ${chunkLabel}  ${entry.reviewedCount}/${entry.totalChunks} reviewed`;
    } else {
      const fileLabel = entry.fileCount === 1 ? 'file' : 'files';
      info = `-         ${entry.fileCount} ${fileLabel}      `;
    }

    lines.push(`${ref}  ${info}  ${entry.status}`);
  }

  return lines.join('\n');
}

/**
 * Format all reviews as JSON for agent consumption.
 */
export function formatLsAllJson(entries: LsAllEntry[]): string {
  return JSON.stringify(
    {
      totalReviews: entries.length,
      reviews: entries.map((e) => ({
        key: e.key,
        repo: e.repo,
        pr: e.pr,
        chunkCount: e.chunkCount,
        reviewedCount: e.reviewedCount,
        fileCount: e.fileCount,
        status: e.status,
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

export const lsCommand = new Command('ls')
  .description('List chunks of the active kaiju or all kaijus')
  .argument('[pr-ref]', 'PR reference: org/repo#N (optional, uses latest if omitted)')
  .option('-a, --all', 'List all kaijus across repos')
  .option('--json', 'Output as JSON')
  .action(async (prRef: string | undefined, options: { all?: boolean; json?: boolean }) => {
    const store = createStore();

    try {
      if (options.all) {
        // List all reviews
        const allReviews = store.listReviews();

        const entries: LsAllEntry[] = allReviews.map((review) => {
          const reviewChunks = store.getChunks(review.key);
          const reviewFiles = store.getFiles(review.key);
          const reviewedCount = reviewChunks.filter((c) => c.status === 'reviewed').length;

          return {
            key: review.key,
            repo: review.repo,
            pr: review.pr,
            chunkCount: reviewChunks.length,
            reviewedCount,
            totalChunks: reviewChunks.length,
            fileCount: reviewFiles.length,
            status: review.status,
          };
        });

        if (options.json) {
          console.log(formatLsAllJson(entries));
        } else {
          console.log(formatLsAllTable(entries));
        }
      } else {
        // List chunks of active/specified kaiju
        const reviewKey = resolveReviewKey(store, prRef);
        if (!reviewKey) {
          if (!process.exitCode) {
            console.error('Error: No review found. Run `kaiju fetch` first to download a PR.');
            process.exitCode = 1;
          }
          return;
        }

        const allChunks = store.getChunks(reviewKey);
        const allFiles = store.getFiles(reviewKey);

        // Build file stats per chunk
        const chunkFileStats = new Map<number, { additions: number; deletions: number }>();
        for (const file of allFiles) {
          if (file.chunkId != null) {
            const existing = chunkFileStats.get(file.chunkId) ?? { additions: 0, deletions: 0 };
            existing.additions += file.additions;
            existing.deletions += file.deletions;
            chunkFileStats.set(file.chunkId, existing);
          }
        }

        const chunkEntries: LsChunkEntry[] = allChunks.map((c) => {
          const stats = chunkFileStats.get(c.id) ?? { additions: 0, deletions: 0 };
          return {
            id: c.slug,
            additions: stats.additions,
            deletions: stats.deletions,
            estimatedTokens: c.estimatedTokens,
            status: c.status,
          };
        });

        if (options.json) {
          console.log(formatLsChunksJson(chunkEntries));
        } else {
          console.log(formatLsChunksTable(chunkEntries));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });
