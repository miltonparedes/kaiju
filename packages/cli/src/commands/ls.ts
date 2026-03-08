import { homedir } from 'node:os';
import { join } from 'node:path';

import { getReviewDir } from '@kaiju/core';
import { Command } from 'commander';

import { createStore, resolveReviewKey } from './shared.js';

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
 * Includes absolute paths to review directory and chunk files when reviewDir is provided.
 */
export function formatLsChunksJson(entries: LsChunkEntry[], reviewDir?: string): string {
  return JSON.stringify(
    {
      totalChunks: entries.length,
      chunks: entries.map((c) => ({
        id: c.id,
        additions: c.additions,
        deletions: c.deletions,
        estimatedTokens: c.estimatedTokens,
        status: c.status,
        ...(reviewDir
          ? {
              paths: {
                patch: join(reviewDir, 'chunks', `${c.id}.patch`),
                meta: join(reviewDir, 'chunks', `${c.id}.meta.json`),
              },
            }
          : {}),
      })),
      ...(reviewDir
        ? {
            paths: {
              reviewDir,
              chunks: join(reviewDir, 'chunks/'),
            },
          }
        : {}),
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
 * Includes absolute paths to review directories when baseDir is provided.
 */
export function formatLsAllJson(entries: LsAllEntry[], baseDir?: string): string {
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
        ...(baseDir
          ? {
              paths: {
                reviewDir: getReviewDir(e.key, baseDir),
              },
            }
          : {}),
      })),
    },
    null,
    2,
  );
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
        // List all reviews — --all overrides context filter
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
          const baseDir = join(homedir(), '.kaiju');
          console.log(formatLsAllJson(entries, baseDir));
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
          const baseDir = join(homedir(), '.kaiju');
          const reviewDir = getReviewDir(reviewKey, baseDir);
          console.log(formatLsChunksJson(chunkEntries, reviewDir));
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
