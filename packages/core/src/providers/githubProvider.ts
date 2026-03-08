import { readFile } from 'node:fs/promises';

import type { KaijuStore } from '../store/kaijuStore.js';
import type { CreateCommentInput, CreateFileInput } from '../store/kaijuStore.js';
import type { FileStatus } from '../types/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Parsed PR reference from URL or shorthand. */
export interface ParsedPRRef {
  owner: string;
  repo: string;
  pr: number;
}

/** Parsed file entry from a unified diff. */
export interface DiffFileEntry {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}

/** PR metadata extracted from `gh pr view`. */
export interface PRMetadata {
  title: string;
  base: string;
  head: string;
  url: string;
}

/** A single message in a comment thread. */
export interface ThreadMessage {
  author: string;
  body: string;
  timestamp: string;
  gh_comment_id?: number;
}

/** A grouped comment thread ready for store insertion. */
export interface CommentThread {
  thread_id: string;
  source: string;
  state: 'open' | 'resolved';
  file: string | null;
  line: number | null;
  messages: ThreadMessage[];
}

/**
 * Abstraction over `gh` CLI execution.
 * Accepts the argument array (e.g. ['pr', 'diff', '9999', '-R', 'acme/widgets'])
 * and returns stdout as a string. Throws on non-zero exit code.
 */
export type GhCliRunner = (args: string[]) => Promise<string>;

// ─── Raw GitHub API response types ──────────────────────────────────────────────

interface GhReviewComment {
  id: number;
  path?: string;
  line?: number;
  body: string;
  user?: { login: string };
  created_at: string;
  pull_request_review_id?: number;
  in_reply_to_id?: number | null;
}

interface GhIssueComment {
  id: number;
  body: string;
  user?: { login: string };
  created_at: string;
}

// ─── parsePRReference ───────────────────────────────────────────────────────────

/**
 * Parse a PR reference in any of these formats:
 * - Full URL: https://github.com/org/repo/pull/N
 * - URL without protocol: github.com/org/repo/pull/N
 * - Shorthand: org/repo#N
 */
export function parsePRReference(ref: string): ParsedPRRef {
  // Try full GitHub URL first
  const urlPattern = /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;
  const urlMatch = ref.match(urlPattern);
  if (urlMatch) {
    return {
      owner: urlMatch[1]!,
      repo: urlMatch[2]!,
      pr: Number.parseInt(urlMatch[3]!, 10),
    };
  }

  // Try shorthand: org/repo#N
  const shorthandPattern = /^([^/]+)\/([^#]+)#(\d+)$/;
  const shorthandMatch = ref.match(shorthandPattern);
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1]!,
      repo: shorthandMatch[2]!,
      pr: Number.parseInt(shorthandMatch[3]!, 10),
    };
  }

  throw new Error(
    `Invalid PR reference "${ref}". Expected formats:\n` +
      `  - https://github.com/org/repo/pull/N\n` +
      `  - org/repo#N`,
  );
}

// ─── parseDiffIntoFiles ─────────────────────────────────────────────────────────

/**
 * Parse a unified diff string into file entries with stats.
 * Handles added, deleted, modified, and renamed files.
 */
export function parseDiffIntoFiles(diff: string): DiffFileEntry[] {
  if (!diff || !diff.trim()) return [];

  const files: DiffFileEntry[] = [];
  const lines = diff.split('\n');

  let currentFile: DiffFileEntry | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // Save previous file if exists
      if (currentFile) {
        files.push(currentFile);
      }

      // Parse the b/ path from the diff header
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (!match) continue;

      const bPath = match[2]!;

      currentFile = {
        path: bPath,
        status: 'modified',
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (!currentFile) continue;

    // Detect file status markers
    if (line.startsWith('new file mode')) {
      currentFile.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      currentFile.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename to ')) {
      currentFile.path = line.slice('rename to '.length);
      currentFile.status = 'renamed';
      continue;
    }
    if (line.startsWith('rename from ') || line.startsWith('similarity index')) {
      continue;
    }

    // Count additions and deletions in hunk content
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentFile.additions++;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      currentFile.deletions++;
      continue;
    }
  }

  // Don't forget the last file
  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

// ─── parseGhPrViewJson ──────────────────────────────────────────────────────────

/**
 * Parse the JSON output of `gh pr view --json title,number,baseRefName,headRefName,url`.
 */
export function parseGhPrViewJson(json: string): PRMetadata {
  const data = JSON.parse(json) as {
    title: string;
    number: number;
    baseRefName: string;
    headRefName: string;
    url: string;
  };

  return {
    title: data.title,
    base: data.baseRefName,
    head: data.headRefName,
    url: data.url,
  };
}

// ─── groupCommentsIntoThreads ───────────────────────────────────────────────────

/**
 * Group GitHub review comments and issue comments into threaded conversations.
 *
 * Review comments have `inReplyToId` for threading. Comments that reply to
 * another comment are grouped into the same thread. Root comments (no inReplyToId)
 * start new threads.
 *
 * Issue-level comments (no file/line) each become their own thread.
 *
 * Messages within a thread are sorted by timestamp.
 */
export function groupCommentsIntoThreads(
  reviewComments: GhReviewComment[],
  issueComments: GhIssueComment[],
): CommentThread[] {
  const threads: CommentThread[] = [];

  // Build a map from comment ID → comment for threading
  const commentById = new Map<number, GhReviewComment>();
  for (const c of reviewComments) {
    commentById.set(c.id, c);
  }

  // Find root comment ID for each comment (walking in_reply_to_id chain)
  const rootMap = new Map<number, number>();
  function findRoot(id: number): number {
    if (rootMap.has(id)) return rootMap.get(id)!;
    const comment = commentById.get(id);
    if (!comment || !comment.in_reply_to_id) {
      rootMap.set(id, id);
      return id;
    }
    const root = findRoot(comment.in_reply_to_id);
    rootMap.set(id, root);
    return root;
  }

  // Group review comments by root
  const threadGroups = new Map<number, GhReviewComment[]>();
  for (const c of reviewComments) {
    const rootId = findRoot(c.id);
    const group = threadGroups.get(rootId) ?? [];
    group.push(c);
    threadGroups.set(rootId, group);
  }

  // Build threads from grouped review comments
  for (const [rootId, group] of threadGroups) {
    // Sort by timestamp
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const root = commentById.get(rootId)!;

    threads.push({
      thread_id: `gh-review-${rootId}`,
      source: 'github',
      state: 'open',
      file: root.path ?? null,
      line: root.line ?? null,
      messages: group.map((c) => ({
        author: `github:${c.user?.login ?? 'unknown'}`,
        body: c.body,
        timestamp: c.created_at,
        gh_comment_id: c.id,
      })),
    });
  }

  // Issue-level comments each become their own thread
  for (const c of issueComments) {
    threads.push({
      thread_id: `gh-issue-${c.id}`,
      source: 'github',
      state: 'open',
      file: null,
      line: null,
      messages: [
        {
          author: `github:${c.user?.login ?? 'unknown'}`,
          body: c.body,
          timestamp: c.created_at,
          gh_comment_id: c.id,
        },
      ],
    });
  }

  return threads;
}

// ─── Default gh CLI runner ──────────────────────────────────────────────────────

/**
 * Execute `gh` CLI and return stdout.
 * This is the real implementation; tests inject a mock runner.
 */
export async function defaultGhRunner(args: string[]): Promise<string> {
  const proc = Bun.spawn(['gh', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`gh ${args.join(' ')} failed (exit ${exitCode}):\n${stderr}`);
  }

  return stdout;
}

// ─── parseGhPaginatedJson ────────────────────────────────────────────────────────

/**
 * Parse JSON output from `gh api --paginate --jq '.'`.
 *
 * When `--paginate` is used with `--jq '.'`, `gh` concatenates the JSON arrays
 * from each page. This may result in either:
 * - A single JSON array (single page), e.g. `[{...}, {...}]`
 * - Multiple concatenated arrays (multi-page), e.g. `[{...}][{...}]`
 *
 * This function handles both cases by attempting a direct parse first,
 * then falling back to splitting on `][` boundaries and merging.
 */
export function parseGhPaginatedJson<T>(raw: string): T[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[]') return [];

  // Fast path: single valid JSON array
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    // Single object (shouldn't happen with --jq .) but handle gracefully
    return [parsed];
  } catch {
    // Fall through to concatenated array handling
  }

  // Slow path: handle concatenated arrays like `[...][...]`
  // Split on `][` while preserving array boundaries
  const results: T[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '[') depth++;
    else if (trimmed[i] === ']') {
      depth--;
      if (depth === 0) {
        const segment = trimmed.slice(start, i + 1);
        try {
          const parsed = JSON.parse(segment);
          if (Array.isArray(parsed)) {
            results.push(...parsed);
          } else {
            results.push(parsed);
          }
        } catch {
          // Skip malformed segments
        }
        start = i + 1;
      }
    }
  }

  return results;
}

// ─── fetchGitHubPR ──────────────────────────────────────────────────────────────

/**
 * Fetch a GitHub PR: diff, metadata, and comments.
 * Writes everything to KaijuStore (dual layer).
 *
 * @param store - KaijuStore instance
 * @param owner - GitHub owner/org
 * @param repo - GitHub repo name
 * @param pr - PR number
 * @param ghRunner - Optional mock gh CLI runner for testing
 */
export async function fetchGitHubPR(
  store: KaijuStore,
  owner: string,
  repo: string,
  pr: number,
  ghRunner: GhCliRunner = defaultGhRunner,
): Promise<{ reviewKey: string; fileCount: number; commentCount: number }> {
  const repoSlug = `${owner}/${repo}`;

  // 1. Fetch diff via `gh pr diff`
  const diff = await ghRunner(['pr', 'diff', String(pr), '-R', repoSlug]);

  // 2. Fetch PR metadata via `gh pr view`
  const prViewJson = await ghRunner([
    'pr',
    'view',
    String(pr),
    '-R',
    repoSlug,
    '--json',
    'title,number,baseRefName,headRefName,url',
  ]);
  const metadata = parseGhPrViewJson(prViewJson);

  // 3. Fetch review comments via `gh api` (with pagination)
  const reviewCommentsJson = await ghRunner([
    'api',
    `repos/${repoSlug}/pulls/${pr}/comments`,
    '--paginate',
    '--jq',
    '.',
  ]);
  // --paginate concatenates JSON arrays, so we may get multiple arrays.
  // Parse them and flatten into a single array.
  const reviewComments: GhReviewComment[] = parseGhPaginatedJson(reviewCommentsJson || '[]');

  // 4. Fetch issue-level comments via `gh api` (with pagination)
  const issueCommentsJson = await ghRunner([
    'api',
    `repos/${repoSlug}/issues/${pr}/comments`,
    '--paginate',
    '--jq',
    '.',
  ]);
  const issueComments: GhIssueComment[] = parseGhPaginatedJson(issueCommentsJson || '[]');

  // 5. Parse diff into file entries
  const diffFiles = parseDiffIntoFiles(diff);

  // 6. Group comments into threads
  const threads = groupCommentsIntoThreads(reviewComments, issueComments);

  // 7. Write to store (dual layer)
  const reviewKey = `github/${owner}/${repo}/${pr}`;

  await store.createReview({
    key: reviewKey,
    provider: 'github',
    repo: repoSlug,
    pr,
    title: metadata.title,
    url: metadata.url,
    base: metadata.base,
    head: metadata.head,
    rawDiff: diff,
  });

  // Add files
  const fileInputs: CreateFileInput[] = diffFiles.map((f) => ({
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));
  if (fileInputs.length > 0) {
    await store.addFiles(reviewKey, fileInputs);
  }

  // Add comments (one addComment call per message for SQLite rows,
  // but the store groups them by threadId in files on disk)
  let totalCommentRows = 0;
  for (const thread of threads) {
    for (const msg of thread.messages) {
      const commentInput: CreateCommentInput = {
        threadId: thread.thread_id,
        source: thread.source,
        state: thread.state,
        file: thread.file ?? undefined,
        line: thread.line ?? undefined,
        body: msg.body,
        author: msg.author,
        timestamp: msg.timestamp,
        ghCommentId: msg.gh_comment_id,
      };
      await store.addComment(reviewKey, commentInput);
      totalCommentRows++;
    }
  }

  return {
    reviewKey,
    fileCount: diffFiles.length,
    commentCount: totalCommentRows,
  };
}

// ─── fetchLocalDiff ─────────────────────────────────────────────────────────────

/**
 * Create a review from a local patch/diff file (--diff flag).
 * Reads the file, parses it, and writes to KaijuStore.
 *
 * The review key uses provider 'local' and a timestamp-based PR number.
 */
export async function fetchLocalDiff(
  store: KaijuStore,
  diffPath: string,
): Promise<{ reviewKey: string; fileCount: number }> {
  const diff = await readFile(diffPath, 'utf-8');
  const diffFiles = parseDiffIntoFiles(diff);

  // Generate a unique PR number from timestamp
  const pr = Math.floor(Date.now() / 1000);
  const reviewKey = `local/local/patch/${pr}`;

  await store.createReview({
    key: reviewKey,
    provider: 'local',
    repo: 'local/patch',
    pr,
    title: `Local diff: ${diffPath.split('/').pop() ?? 'unknown'}`,
    url: '',
    base: '',
    head: '',
    rawDiff: diff,
  });

  // Add files
  const fileInputs: CreateFileInput[] = diffFiles.map((f) => ({
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));
  if (fileInputs.length > 0) {
    await store.addFiles(reviewKey, fileInputs);
  }

  return {
    reviewKey,
    fileCount: diffFiles.length,
  };
}
