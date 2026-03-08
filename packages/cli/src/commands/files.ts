import { homedir } from 'node:os';
import { join } from 'node:path';

import { KaijuStore, createDB, parsePRReference } from '@kaiju/core';
import { Command } from 'commander';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface FileDisplayEntry {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format files as a human-readable table with +N -N stats and change type.
 */
export function formatFilesTable(entries: FileDisplayEntry[]): string {
  if (entries.length === 0) {
    return 'No files found.';
  }

  // Compute column widths
  const maxPath = Math.max(...entries.map((f) => f.path.length));
  const maxAdd = Math.max(...entries.map((f) => `+${f.additions}`.length));
  const maxDel = Math.max(...entries.map((f) => `-${f.deletions}`.length));

  const lines: string[] = [];
  for (const f of entries) {
    const path = f.path.padEnd(maxPath);
    const add = `+${f.additions}`.padStart(maxAdd);
    const del = `-${f.deletions}`.padStart(maxDel);
    lines.push(`${path}  ${add}  ${del}  ${f.status}`);
  }

  lines.push(`\n(${entries.length} files)`);

  return lines.join('\n');
}

/**
 * Format files as JSON for agent consumption.
 */
export function formatFilesJson(entries: FileDisplayEntry[]): string {
  return JSON.stringify(
    {
      totalFiles: entries.length,
      files: entries.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    },
    null,
    2,
  );
}

// ─── Store factory ──────────────────────────────────────────────────────────────

function createStore(): KaijuStore {
  const baseDir = join(homedir(), '.kaiju');
  const dbPath = join(baseDir, 'kaiju.db');
  const db = createDB(dbPath);
  return new KaijuStore(db, baseDir);
}

// ─── Command ────────────────────────────────────────────────────────────────────

export const filesCommand = new Command('files')
  .description('List changed files in a fetched pull request')
  .argument('[pr-ref]', 'PR reference: org/repo#N (optional, uses latest if omitted)')
  .option('--json', 'Output as JSON')
  .action(async (prRef: string | undefined, options: { json?: boolean }) => {
    const store = createStore();

    try {
      const reviewKey = resolveReviewKey(store, prRef);

      if (!reviewKey) {
        console.error('Error: No review found. Run `kaiju fetch` first to download a PR.');
        process.exitCode = 1;
        return;
      }

      const fileEntries = store.getFiles(reviewKey);
      const displayEntries: FileDisplayEntry[] = fileEntries.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      }));

      if (options.json) {
        console.log(formatFilesJson(displayEntries));
      } else {
        console.log(formatFilesTable(displayEntries));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve a review key from a PR reference or find the most recent review.
 */
function resolveReviewKey(store: KaijuStore, prRef?: string): string | null {
  if (prRef) {
    // Try parsing as a PR reference (shorthand or URL)
    try {
      const parsed = parsePRReference(prRef);
      return `github/${parsed.owner}/${parsed.repo}/${parsed.pr}`;
    } catch {
      // Not a valid PR ref — maybe it's a raw review key
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

  // No ref given — use the most recent review
  const allReviews = store.listReviews();
  if (allReviews.length === 0) return null;

  // Sort by most recent (highest updatedAt)
  allReviews.sort((a, b) => b.updatedAt - a.updatedAt);
  return allReviews[0]!.key;
}
