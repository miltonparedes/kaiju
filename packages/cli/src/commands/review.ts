import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchGitHubPR, getReviewDir, parsePRReference, splitAndPersist } from '@kaiju/core';
import { Command } from 'commander';

import { type FetchSummaryData, formatFetchSummary } from './fetch.js';
import { createStore } from './shared.js';
import { buildReviewUrl, formatShowStartup, openBrowser, waitForServer } from './show.js';
import { type ChunkSummaryEntry, type SplitSummaryData, formatSplitSummary } from './split.js';

// ─── Command ────────────────────────────────────────────────────────────────────

export const reviewCommand = new Command('review')
  .description('Fetch, auto-split, and launch web UI for a PR (shortcut)')
  .argument('<pr-ref>', 'PR reference: org/repo#N or GitHub URL')
  .option('-p, --port <port>', 'Port for the web server', '1954')
  .option(
    '-s, --strategy <strategy>',
    'Auto-split strategy: directory, single-file (default: directory)',
    'directory',
  )
  .option('--json', 'Output as JSON')
  .action(async (prRef: string, options: { port?: string; strategy?: string; json?: boolean }) => {
    const store = createStore();

    try {
      // ─── Step 1: Fetch ──────────────────────────────────────────────────────
      let parsed;
      try {
        parsed = parsePRReference(prRef);
      } catch {
        console.error(
          `Error: Invalid PR reference "${prRef}". Expected formats:\n` +
            '  - https://github.com/org/repo/pull/N\n' +
            '  - org/repo#N',
        );
        process.exitCode = 1;
        return;
      }

      // Check for existing review and delete stale data before re-fetch
      const existingKey = `github/${parsed.owner}/${parsed.repo}/${parsed.pr}`;
      const existingReview = store.getReview(existingKey);
      if (existingReview) {
        await store.deleteReview(existingKey);
      }

      const fetchResult = await fetchGitHubPR(store, parsed.owner, parsed.repo, parsed.pr);
      const reviewKey = fetchResult.reviewKey;

      // Gather fetch summary
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

      const fetchSummary: FetchSummaryData = {
        reviewKey,
        title: review?.title ?? '',
        fileCount: fetchResult.fileCount,
        totalAdditions,
        totalDeletions,
        commentCount: fetchResult.commentCount,
        reviewDir,
      };

      console.log(formatFetchSummary(fetchSummary));
      console.log('');

      // ─── Step 2: Auto-split ─────────────────────────────────────────────────
      const strategy = (options.strategy ?? 'directory') as 'directory' | 'single-file';
      if (strategy !== 'directory' && strategy !== 'single-file') {
        console.error(`Error: Unknown strategy "${strategy}". Valid: directory, single-file.`);
        process.exitCode = 1;
        return;
      }

      const splitResult = await splitAndPersist(store, reviewKey, { strategy });

      // Gather split summary
      const allComments = store.getComments(reviewKey);
      const dbChunks = store.getChunks(reviewKey);

      const slugToId = new Map<string, number>();
      for (const dbChunk of dbChunks) {
        slugToId.set(dbChunk.slug, dbChunk.id);
      }

      const commentCountMap = new Map<number, number>();
      for (const comment of allComments) {
        if (comment.chunkId != null) {
          commentCountMap.set(comment.chunkId, (commentCountMap.get(comment.chunkId) ?? 0) + 1);
        }
      }

      const allFiles = store.getFiles(reviewKey);
      const chunkFileStats = new Map<number, { additions: number; deletions: number }>();
      for (const file of allFiles) {
        if (file.chunkId != null) {
          const stats = chunkFileStats.get(file.chunkId) ?? { additions: 0, deletions: 0 };
          stats.additions += file.additions;
          stats.deletions += file.deletions;
          chunkFileStats.set(file.chunkId, stats);
        }
      }

      const chunkEntries: ChunkSummaryEntry[] = splitResult.chunks.map((chunk) => {
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

      const splitSummary: SplitSummaryData = {
        chunkCount: splitResult.chunks.length,
        chunks: chunkEntries,
        manifestPath: join(reviewDir, 'manifest.json'),
        chunksDir: join(reviewDir, 'chunks') + '/',
      };

      console.log(formatSplitSummary(splitSummary));
      console.log('');

      // ─── Step 3: Show ───────────────────────────────────────────────────────
      // Close the store before starting the web server
      store.close();

      const port = Number.parseInt(options.port ?? '1954', 10);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        console.error(
          `Error: Invalid port "${options.port}". Must be a number between 1 and 65535.`,
        );
        process.exitCode = 1;
        return;
      }

      const url = `http://localhost:${port}`;

      // Build environment variables for the web server
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PORT: String(port),
      };

      // Context detection: pass the repo from the fetched PR
      env.KAIJU_CONTEXT_ORG = parsed.owner;
      env.KAIJU_CONTEXT_REPO = parsed.repo;

      // Find the web package directory
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const webDir = resolve(__dirname, '../../../web');

      // Start the Vite dev server
      const bunBin = process.argv[0] ?? 'bun';
      const child = spawn(bunBin, ['run', 'dev'], {
        cwd: webDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let serverReady = false;

      child.on('error', (err) => {
        if (!serverReady) {
          console.error(`Error: Failed to start web server: ${err.message}`);
          process.exitCode = 1;
        }
      });

      child.on('exit', (code) => {
        if (!serverReady && code !== 0) {
          console.error(`Error: Web server exited with code ${code}`);
          process.exitCode = 1;
        }
      });

      // Forward Ctrl+C to the child
      process.on('SIGINT', () => {
        child.kill('SIGINT');
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        child.kill('SIGTERM');
        process.exit(0);
      });

      // Wait for server
      const ready = await waitForServer(url);

      if (!ready) {
        console.error('Error: Web server failed to start within 15 seconds.');
        child.kill();
        process.exitCode = 1;
        return;
      }

      serverReady = true;

      // Construct the concrete review URL for this PR
      const reviewUrl = buildReviewUrl(url, prRef);

      console.log(formatShowStartup({ port, url: reviewUrl }));

      // Open browser to the specific PR review
      openBrowser(reviewUrl);

      // Keep the process alive
      await new Promise(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
      store.close();
    }
  });
