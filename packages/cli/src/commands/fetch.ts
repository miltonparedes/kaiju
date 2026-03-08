import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  KaijuStore,
  createDB,
  fetchGitHubPR,
  fetchLocalBranch,
  fetchLocalDiff,
  getReviewDir,
  parsePRReference,
} from '@kaiju/core';
import { Command } from 'commander';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface FetchSummaryData {
  reviewKey: string;
  title: string;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  commentCount: number;
  reviewDir: string;
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format a human-readable fetch summary with paths and Next step.
 */
export function formatFetchSummary(data: FetchSummaryData): string {
  // Extract display name from review key (e.g. "github/org/repo/9999" → "org/repo #9999")
  const parts = data.reviewKey.split('/');
  const _provider = parts[0] ?? '';
  const org = parts[1] ?? '';
  const repo = parts[2] ?? '';
  const pr = parts[3] ?? '';
  const displayRef = `${org}/${repo} #${pr}`;

  const lines: string[] = [];

  // Header
  if (data.title) {
    lines.push(`Fetched ${displayRef} — "${data.title}"`);
  } else {
    lines.push(`Fetched ${displayRef}`);
  }

  // Stats line
  lines.push(
    `  ${data.fileCount} files │ ${data.totalAdditions}+ ${data.totalDeletions}- │ ${data.commentCount} comments`,
  );

  // Saved-to line
  lines.push(`  Saved to ${data.reviewDir}/`);
  lines.push('');

  // Paths
  lines.push(`Files:    ${join(data.reviewDir, 'files.json')}`);
  lines.push(`Comments: ${join(data.reviewDir, 'comments')}/`);
  lines.push('');

  // Next step
  lines.push(
    'Next: Run `kaiju files` to see the file list, or `kaiju split --auto` for quick split.',
  );

  return lines.join('\n');
}

/**
 * Format fetch result as JSON for agent consumption.
 */
export function formatFetchJson(data: FetchSummaryData): string {
  return JSON.stringify(
    {
      reviewKey: data.reviewKey,
      title: data.title,
      fileCount: data.fileCount,
      totalAdditions: data.totalAdditions,
      totalDeletions: data.totalDeletions,
      commentCount: data.commentCount,
      paths: {
        reviewDir: data.reviewDir,
        files: join(data.reviewDir, 'files.json'),
        comments: join(data.reviewDir, 'comments'),
      },
      next: 'kaiju files',
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

export const fetchCommand = new Command('fetch')
  .description('Fetch a pull request for analysis')
  .argument('[pr-ref]', 'PR reference: org/repo#N or GitHub URL')
  .option('-b, --branch <branch>', 'Fetch diff from a local branch (compares with current branch)')
  .option('-d, --diff <path>', 'Ingest a local patch/diff file')
  .option('--json', 'Output as JSON')
  .action(
    async (
      prRef: string | undefined,
      options: { branch?: string; diff?: string; json?: boolean },
    ) => {
      const store = createStore();

      try {
        // Determine fetch mode
        if (options.diff) {
          // Local diff file mode
          await handleDiffFetch(store, options.diff, options.json ?? false);
        } else if (options.branch) {
          // Local branch mode
          await handleBranchFetch(store, options.branch, options.json ?? false);
        } else if (prRef) {
          // GitHub PR mode
          await handlePRFetch(store, prRef, options.json ?? false);
        } else {
          console.error(
            'Error: Please provide a PR reference, --branch, or --diff flag.\n' +
              'Usage:\n' +
              '  kaiju fetch org/repo#N\n' +
              '  kaiju fetch https://github.com/org/repo/pull/N\n' +
              '  kaiju fetch --branch feature-branch\n' +
              '  kaiju fetch --diff changes.patch',
          );
          process.exitCode = 1;
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

// ─── Fetch handlers ─────────────────────────────────────────────────────────────

async function handlePRFetch(store: KaijuStore, ref: string, json: boolean): Promise<void> {
  // Validate and parse the PR reference
  let parsed;
  try {
    parsed = parsePRReference(ref);
  } catch {
    console.error(
      `Error: Invalid PR reference "${ref}". Expected formats:\n` +
        '  - https://github.com/org/repo/pull/N\n' +
        '  - org/repo#N',
    );
    process.exitCode = 1;
    return;
  }

  const result = await fetchGitHubPR(store, parsed.owner, parsed.repo, parsed.pr);
  const reviewKey = result.reviewKey;

  // Gather summary data
  const review = store.getReview(reviewKey);
  const fileEntries = store.getFiles(reviewKey);
  const baseDir = join(homedir(), '.kaiju');
  const reviewDir = getReviewDir(reviewKey, baseDir);

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of fileEntries) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  const summaryData: FetchSummaryData = {
    reviewKey,
    title: review?.title ?? '',
    fileCount: result.fileCount,
    totalAdditions,
    totalDeletions,
    commentCount: result.commentCount,
    reviewDir,
  };

  if (json) {
    console.log(formatFetchJson(summaryData));
  } else {
    console.log(formatFetchSummary(summaryData));
  }
}

async function handleBranchFetch(store: KaijuStore, branch: string, json: boolean): Promise<void> {
  const result = await fetchLocalBranch(store, branch);
  const reviewKey = result.reviewKey;

  const review = store.getReview(reviewKey);
  const fileEntries = store.getFiles(reviewKey);
  const baseDir = join(homedir(), '.kaiju');
  const reviewDir = getReviewDir(reviewKey, baseDir);

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of fileEntries) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  const summaryData: FetchSummaryData = {
    reviewKey,
    title: review?.title ?? '',
    fileCount: result.fileCount,
    totalAdditions,
    totalDeletions,
    commentCount: 0,
    reviewDir,
  };

  if (json) {
    console.log(formatFetchJson(summaryData));
  } else {
    console.log(formatFetchSummary(summaryData));
  }
}

async function handleDiffFetch(store: KaijuStore, diffPath: string, json: boolean): Promise<void> {
  const result = await fetchLocalDiff(store, diffPath);
  const reviewKey = result.reviewKey;

  const review = store.getReview(reviewKey);
  const fileEntries = store.getFiles(reviewKey);
  const baseDir = join(homedir(), '.kaiju');
  const reviewDir = getReviewDir(reviewKey, baseDir);

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of fileEntries) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  const summaryData: FetchSummaryData = {
    reviewKey,
    title: review?.title ?? '',
    fileCount: result.fileCount,
    totalAdditions,
    totalDeletions,
    commentCount: 0,
    reviewDir,
  };

  if (json) {
    console.log(formatFetchJson(summaryData));
  } else {
    console.log(formatFetchSummary(summaryData));
  }
}
