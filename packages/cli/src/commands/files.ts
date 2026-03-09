import { homedir } from 'node:os';
import { join } from 'node:path';

import { getReviewDir } from '@kaiju/core';
import { Command } from 'commander';

import { createStore, resolveReviewKey } from './shared.js';

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
 * Includes absolute paths to relevant review files.
 */
export function formatFilesJson(entries: FileDisplayEntry[], reviewDir?: string): string {
  return JSON.stringify(
    {
      totalFiles: entries.length,
      files: entries.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      ...(reviewDir
        ? {
            paths: {
              filesJson: join(reviewDir, 'files.json'),
              reviewDir,
            },
          }
        : {}),
    },
    null,
    2,
  );
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
        // resolveReviewKey already printed a specific error if a PR ref was given
        if (!process.exitCode) {
          console.error('Error: No review found. Run `kaiju fetch` first to download a PR.');
          process.exitCode = 1;
        }
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
        const baseDir = join(homedir(), '.kaiju');
        const reviewDir = getReviewDir(reviewKey, baseDir);
        console.log(formatFilesJson(displayEntries, reviewDir));
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
