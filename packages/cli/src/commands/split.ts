import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, createDB, getReviewDir, parsePRReference, splitAndPersist } from '@kaiju/core';
import type { ReviewPriority } from '@kaiju/core';
import { Command } from 'commander';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ChunkSummaryEntry {
  id: string;
  additions: number;
  deletions: number;
  estimatedTokens: number;
  reviewPriority: ReviewPriority;
  commentCount: number;
}

export interface SplitSummaryData {
  chunkCount: number;
  chunks: ChunkSummaryEntry[];
  manifestPath: string;
  chunksDir: string;
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
 * Format a human-readable split summary with chunk table, paths, and Next step.
 */
export function formatSplitSummary(data: SplitSummaryData): string {
  const lines: string[] = [];

  // Header
  lines.push(`Split into ${data.chunkCount} chunks:`);

  // Chunk table
  const maxId = Math.max(...data.chunks.map((c) => c.id.length));
  const maxAdd = Math.max(...data.chunks.map((c) => `${c.additions}+`.length));
  const maxDel = Math.max(...data.chunks.map((c) => `${c.deletions}-`.length));
  const maxTok = Math.max(...data.chunks.map((c) => formatTokens(c.estimatedTokens).length));

  for (const chunk of data.chunks) {
    const id = chunk.id.padEnd(maxId);
    const add = `${chunk.additions}+`.padStart(maxAdd);
    const del = `${chunk.deletions}-`.padStart(maxDel);
    const tok = formatTokens(chunk.estimatedTokens).padStart(maxTok);
    const priority = chunk.reviewPriority.toUpperCase().padEnd(6);
    const comments = `${chunk.commentCount} comments`;

    lines.push(`  ${id}  ${add} ${del}  ${tok}  ${priority} ${comments}`);
  }

  lines.push('');

  // Paths
  lines.push(`Manifest: ${data.manifestPath}`);
  lines.push(`Chunks:   ${data.chunksDir}`);
  lines.push('');

  // Next step
  lines.push('Next: Read a chunk with `kaiju cat <chunk-id>` or open UI with `kaiju show`.');

  return lines.join('\n');
}

/**
 * Format split result as JSON for agent consumption.
 */
export function formatSplitJson(data: SplitSummaryData): string {
  return JSON.stringify(
    {
      chunkCount: data.chunkCount,
      chunks: data.chunks.map((c) => ({
        id: c.id,
        additions: c.additions,
        deletions: c.deletions,
        estimatedTokens: c.estimatedTokens,
        reviewPriority: c.reviewPriority,
        commentCount: c.commentCount,
      })),
      paths: {
        manifest: data.manifestPath,
        chunks: data.chunksDir,
      },
      next: 'kaiju cat <chunk-id>',
    },
    null,
    2,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve plan content from a --plan value. Accepts either:
 * - A file path to a JSON file
 * - An inline JSON string
 */
function resolvePlanContent(planValue: string): string {
  // If it starts with '{' or '[', treat as inline JSON
  const trimmed = planValue.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  // Otherwise treat as a file path
  if (!existsSync(planValue)) {
    throw new Error(`Plan file not found: ${planValue}`);
  }
  return readFileSync(planValue, 'utf-8');
}

/**
 * Resolve a review key from a PR reference or find the most recent review.
 */
function resolveReviewKey(store: KaijuStore, prRef?: string): string | null {
  if (prRef) {
    try {
      const parsed = parsePRReference(prRef);
      return `github/${parsed.owner}/${parsed.repo}/${parsed.pr}`;
    } catch {
      const review = store.getReview(prRef);
      if (review) return prRef;

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
  if (allReviews.length === 0) return null;

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

export const splitCommand = new Command('split')
  .description('Split a pull request into reviewable chunks')
  .argument('[pr-ref]', 'PR reference: org/repo#N (optional, uses latest if omitted)')
  .option('-p, --plan <plan>', 'Split plan: file path or inline JSON string')
  .option('-a, --auto', 'Auto-split without a plan')
  .option(
    '-s, --strategy <strategy>',
    'Auto-split strategy: directory, single-file (default: directory)',
    'directory',
  )
  .option('-m, --max-tokens <tokens>', 'Maximum tokens per chunk')
  .option('-k, --keep-findings', 'Preserve existing findings when re-splitting')
  .option('--json', 'Output as JSON')
  .action(
    async (
      prRef: string | undefined,
      options: {
        plan?: string;
        auto?: boolean;
        strategy?: string;
        maxTokens?: string;
        keepFindings?: boolean;
        json?: boolean;
      },
    ) => {
      const store = createStore();

      try {
        // Validate: either --plan or --auto must be provided
        if (!options.plan && !options.auto) {
          console.error(
            'Error: Please provide --plan <json> or --auto flag.\n' +
              'Usage:\n' +
              '  kaiju split --plan plan.json\n' +
              '  kaiju split --plan \'{"chunks": [...]}\'\n' +
              '  kaiju split --auto\n' +
              '  kaiju split --auto --strategy single-file',
          );
          process.exitCode = 1;
          return;
        }

        const reviewKey = resolveReviewKey(store, prRef);
        if (!reviewKey) {
          console.error('Error: No review found. Run `kaiju fetch` first to download a PR.');
          process.exitCode = 1;
          return;
        }

        // Check review exists
        const review = store.getReview(reviewKey);
        if (!review) {
          console.error(
            `Error: Review "${reviewKey}" not found. Run \`kaiju fetch\` first to download a PR.`,
          );
          process.exitCode = 1;
          return;
        }

        // Check that review has been fetched (has raw diff)
        if (!review.rawDiff) {
          console.error(
            `Error: Review "${reviewKey}" has no diff data. Run \`kaiju fetch\` first to download the PR diff.`,
          );
          process.exitCode = 1;
          return;
        }

        // Determine strategy and plan
        let strategy: 'directory' | 'single-file' | 'plan';
        let planContent: string | undefined;

        if (options.plan) {
          strategy = 'plan';
          planContent = resolvePlanContent(options.plan);
        } else {
          // Auto mode
          const strat = options.strategy ?? 'directory';
          if (strat !== 'directory' && strat !== 'single-file') {
            console.error(`Error: Unknown strategy "${strat}". Valid: directory, single-file.`);
            process.exitCode = 1;
            return;
          }
          strategy = strat;
        }

        const maxTokens = options.maxTokens ? Number.parseInt(options.maxTokens, 10) : undefined;

        // Run the split pipeline
        const result = await splitAndPersist(store, reviewKey, {
          strategy,
          plan: planContent,
          maxTokens,
          keepFindings: options.keepFindings,
        });

        // Gather summary data
        const baseDir = join(homedir(), '.kaiju');
        const reviewDir = getReviewDir(reviewKey, baseDir);

        // Get comment counts per chunk from the store
        const allComments = store.getComments(reviewKey);
        const dbChunks = store.getChunks(reviewKey);

        // Build chunk slug → numeric id map
        const slugToId = new Map<string, number>();
        for (const dbChunk of dbChunks) {
          slugToId.set(dbChunk.slug, dbChunk.id);
        }

        // Build chunkId → comment count map
        const commentCountMap = new Map<number, number>();
        for (const comment of allComments) {
          if (comment.chunkId != null) {
            commentCountMap.set(comment.chunkId, (commentCountMap.get(comment.chunkId) ?? 0) + 1);
          }
        }

        // Get file stats per chunk
        const allFiles = store.getFiles(reviewKey);
        const chunkFileStats = new Map<number, { additions: number; deletions: number }>();
        for (const file of allFiles) {
          if (file.chunkId != null) {
            const existing = chunkFileStats.get(file.chunkId) ?? { additions: 0, deletions: 0 };
            existing.additions += file.additions;
            existing.deletions += file.deletions;
            chunkFileStats.set(file.chunkId, existing);
          }
        }

        const chunkEntries: ChunkSummaryEntry[] = result.chunks.map((chunk) => {
          const chunkId = slugToId.get(chunk.id);
          const fileStats =
            chunkId != null
              ? (chunkFileStats.get(chunkId) ?? { additions: 0, deletions: 0 })
              : { additions: 0, deletions: 0 };

          return {
            id: chunk.id,
            additions: fileStats.additions,
            deletions: fileStats.deletions,
            estimatedTokens: chunk.estimatedTokens,
            reviewPriority: chunk.reviewPriority,
            commentCount: chunkId != null ? (commentCountMap.get(chunkId) ?? 0) : 0,
          };
        });

        const summaryData: SplitSummaryData = {
          chunkCount: result.chunks.length,
          chunks: chunkEntries,
          manifestPath: join(reviewDir, 'manifest.json'),
          chunksDir: join(reviewDir, 'chunks') + '/',
        };

        if (options.json) {
          console.log(formatSplitJson(summaryData));
        } else {
          console.log(formatSplitSummary(summaryData));
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
