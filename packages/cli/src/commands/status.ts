import { homedir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, createDB, parsePRReference } from '@kaiju/core';
import { Command } from 'commander';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface HighPriorityChunkEntry {
  id: string;
  additions: number;
  deletions: number;
  estimatedTokens: number;
  commentCount: number;
}

export interface StatusDisplayData {
  repo: string;
  pr: number;
  title: string;
  chunkCount: number;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  reviewedCount: number;
  findingCount: number;
  commentCount: number;
  highPriorityChunks: HighPriorityChunkEntry[];
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
 * Format a human-readable status summary following the CLI spec.
 */
export function formatStatusSummary(data: StatusDisplayData): string {
  const lines: string[] = [];

  // Header: repo #PR — "title"
  lines.push(`${data.repo} #${data.pr} — "${data.title}"`);

  // Stats line: chunks │ files │ +N -N
  lines.push(
    `${data.chunkCount} chunks │ ${data.fileCount} files │ ${data.totalAdditions}+ ${data.totalDeletions}-`,
  );

  // Progress line: Reviewed: N/M │ Findings: N │ Comments: N
  lines.push(
    `Reviewed: ${data.reviewedCount}/${data.chunkCount} │ Findings: ${data.findingCount} │ Comments: ${data.commentCount}`,
  );

  // High priority section
  if (data.highPriorityChunks.length > 0) {
    lines.push('');
    lines.push('High priority:');

    const maxId = Math.max(...data.highPriorityChunks.map((c) => c.id.length));
    const maxAdd = Math.max(...data.highPriorityChunks.map((c) => `${c.additions}+`.length));
    const maxDel = Math.max(...data.highPriorityChunks.map((c) => `${c.deletions}-`.length));
    const maxTok = Math.max(
      ...data.highPriorityChunks.map((c) => formatTokens(c.estimatedTokens).length),
    );

    for (const chunk of data.highPriorityChunks) {
      const id = chunk.id.padEnd(maxId);
      const add = `${chunk.additions}+`.padStart(maxAdd);
      const del = `${chunk.deletions}-`.padStart(maxDel);
      const tok = formatTokens(chunk.estimatedTokens).padStart(maxTok);
      const commentLabel = chunk.commentCount === 1 ? 'comment' : 'comments';
      lines.push(`  ${id}  ${add} ${del}  ${tok}  ${chunk.commentCount} ${commentLabel}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format status data as JSON for agent consumption.
 */
export function formatStatusJson(data: StatusDisplayData): string {
  return JSON.stringify(
    {
      repo: data.repo,
      pr: data.pr,
      title: data.title,
      chunkCount: data.chunkCount,
      fileCount: data.fileCount,
      totalAdditions: data.totalAdditions,
      totalDeletions: data.totalDeletions,
      reviewedCount: data.reviewedCount,
      findingCount: data.findingCount,
      commentCount: data.commentCount,
      highPriorityChunks: data.highPriorityChunks.map((c) => ({
        id: c.id,
        additions: c.additions,
        deletions: c.deletions,
        estimatedTokens: c.estimatedTokens,
        commentCount: c.commentCount,
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

export const statusCommand = new Command('status')
  .description('Show summary of the active kaiju review')
  .argument('[pr-ref]', 'PR reference: org/repo#N (optional, uses latest if omitted)')
  .option('--json', 'Output as JSON')
  .action(async (prRef: string | undefined, options: { json?: boolean }) => {
    const store = createStore();

    try {
      const reviewKey = resolveReviewKey(store, prRef);
      if (!reviewKey) {
        if (!process.exitCode) {
          console.error('Error: No review found. Run `kaiju fetch` first to download a PR.');
          process.exitCode = 1;
        }
        return;
      }

      const review = store.getReview(reviewKey);
      if (!review) {
        console.error(
          `Error: Review "${reviewKey}" not found. Run \`kaiju fetch\` first to download a PR.`,
        );
        process.exitCode = 1;
        return;
      }

      // Gather data from store
      const allFiles = store.getFiles(reviewKey);
      const allChunks = store.getChunks(reviewKey);
      const allComments = store.getComments(reviewKey);
      const allFindings = store.getFindings(reviewKey);

      // Compute aggregate stats
      let totalAdditions = 0;
      let totalDeletions = 0;
      for (const f of allFiles) {
        totalAdditions += f.additions;
        totalDeletions += f.deletions;
      }

      // Count reviewed chunks
      const reviewedCount = allChunks.filter((c) => c.status === 'reviewed').length;

      // Build comment counts per chunk
      const commentCountMap = new Map<number, number>();
      for (const comment of allComments) {
        if (comment.chunkId != null) {
          commentCountMap.set(comment.chunkId, (commentCountMap.get(comment.chunkId) ?? 0) + 1);
        }
      }

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

      // Identify high priority chunks (review_priority === 'high' OR chunks with most comments/findings)
      const highPriorityChunks: HighPriorityChunkEntry[] = allChunks
        .filter((c) => c.reviewPriority === 'high')
        .map((c) => {
          const stats = chunkFileStats.get(c.id) ?? { additions: 0, deletions: 0 };
          return {
            id: c.slug,
            additions: stats.additions,
            deletions: stats.deletions,
            estimatedTokens: c.estimatedTokens,
            commentCount: commentCountMap.get(c.id) ?? 0,
          };
        });

      const displayData: StatusDisplayData = {
        repo: review.repo,
        pr: review.pr,
        title: review.title,
        chunkCount: allChunks.length,
        fileCount: allFiles.length,
        totalAdditions,
        totalDeletions,
        reviewedCount,
        findingCount: allFindings.length,
        commentCount: allComments.length,
        highPriorityChunks,
      };

      if (options.json) {
        console.log(formatStatusJson(displayData));
      } else {
        console.log(formatStatusSummary(displayData));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });
