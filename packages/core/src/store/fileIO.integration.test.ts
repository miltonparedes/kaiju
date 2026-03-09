import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureReviewDirs,
  readCommentFile,
  readFilesJson,
  readFindingFile,
  readManifest,
  readChunkMeta,
  readChunkPatch,
  writeCommentFile,
  writeFilesJson,
  writeFindingFile,
  writeManifest,
  writeChunkMeta,
  writeChunkPatch,
} from './fileIO.js';
import type {
  ChunkMetaJson,
  CommentFileJson,
  FilesJson,
  FindingFileJson,
  ManifestJson,
} from './fileTypes.js';

let tempBase: string;

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), 'kaiju-fileio-test-'));
});

afterEach(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

describe('ensureReviewDirs', () => {
  it('creates the full directory structure for a review', async () => {
    const reviewDir = join(tempBase, 'reviews/github/acme/widgets/9999');
    await ensureReviewDirs(reviewDir);

    expect(existsSync(reviewDir)).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks'))).toBe(true);
    expect(existsSync(join(reviewDir, 'comments'))).toBe(true);
    expect(existsSync(join(reviewDir, 'findings'))).toBe(true);
  });

  it('is idempotent — calling twice does not throw', async () => {
    const reviewDir = join(tempBase, 'reviews/github/acme/widgets/9999');
    await ensureReviewDirs(reviewDir);
    await ensureReviewDirs(reviewDir);
    expect(existsSync(reviewDir)).toBe(true);
  });
});

describe('manifest.json read/write', () => {
  it('writes and reads a complete manifest', async () => {
    const reviewDir = join(tempBase, 'review1');
    await ensureReviewDirs(reviewDir);

    const manifest: ManifestJson = {
      version: '1',
      source: {
        provider: 'github',
        repo: 'acme/widgets',
        pr: 9999,
        base: 'main',
        head: 'feature/big-change',
        url: 'https://github.com/acme/widgets/pull/9999',
      },
      status: 'split',
      stats: {
        total_files: 3,
        total_additions: 150,
        total_deletions: 20,
        total_chunks: 1,
        total_comments: 0,
        total_findings: 0,
      },
      chunks: [
        {
          id: '001-auth',
          title: 'Auth system refactor',
          description: 'Migrates from JWT to session-based auth',
          files: ['src/auth/session.ts', 'src/auth/jwt.ts'],
          additions: 150,
          deletions: 20,
          review_priority: 'high',
          estimated_tokens: 2800,
          status: 'pending',
          comments_count: 0,
          findings_count: 0,
        },
      ],
    };

    await writeManifest(reviewDir, manifest);
    const read = await readManifest(reviewDir);
    expect(read).toEqual(manifest);
  });

  it('writes manifest for empty review (no chunks)', async () => {
    const reviewDir = join(tempBase, 'review-empty');
    await ensureReviewDirs(reviewDir);

    const manifest: ManifestJson = {
      version: '1',
      source: {
        provider: 'github',
        repo: 'acme/widgets',
        pr: 42,
        base: 'main',
        head: 'fix/typo',
        url: 'https://github.com/acme/widgets/pull/42',
      },
      status: 'fetched',
      stats: {
        total_files: 0,
        total_additions: 0,
        total_deletions: 0,
        total_chunks: 0,
        total_comments: 0,
        total_findings: 0,
      },
      chunks: [],
    };

    await writeManifest(reviewDir, manifest);
    const read = await readManifest(reviewDir);
    expect(read).toEqual(manifest);
    expect(read.chunks).toEqual([]);
    expect(read.stats.total_files).toBe(0);
  });
});

describe('files.json read/write', () => {
  it('writes and reads files.json with files and imports', async () => {
    const reviewDir = join(tempBase, 'review-files');
    await ensureReviewDirs(reviewDir);

    const filesJson: FilesJson = {
      files: [
        { path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 },
        { path: 'src/auth/jwt.ts', status: 'deleted', additions: 0, deletions: 85 },
        { path: 'src/auth/middleware.ts', status: 'modified', additions: 35, deletions: 12 },
      ],
      imports: [
        { source: 'src/auth/session.ts', target: 'src/types/auth.ts' },
        { source: 'src/auth/middleware.ts', target: 'src/auth/session.ts' },
      ],
    };

    await writeFilesJson(reviewDir, filesJson);
    const read = await readFilesJson(reviewDir);
    expect(read).toEqual(filesJson);
  });

  it('writes empty files.json for empty review', async () => {
    const reviewDir = join(tempBase, 'review-empty-files');
    await ensureReviewDirs(reviewDir);

    const filesJson: FilesJson = { files: [], imports: [] };
    await writeFilesJson(reviewDir, filesJson);
    const read = await readFilesJson(reviewDir);
    expect(read.files).toEqual([]);
    expect(read.imports).toEqual([]);
  });
});

describe('chunks/*.patch read/write', () => {
  it('writes and reads a patch file', async () => {
    const reviewDir = join(tempBase, 'review-chunks');
    await ensureReviewDirs(reviewDir);

    const patch = `diff --git a/src/auth/session.ts b/src/auth/session.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/session.ts
@@ -0,0 +1,5 @@
+import { generateToken } from '../crypto/tokens';
+
+export class SessionManager {
+  private sessions = new Map();
+}
`;

    await writeChunkPatch(reviewDir, '001-auth-refactor', patch);
    const read = await readChunkPatch(reviewDir, '001-auth-refactor');
    expect(read).toBe(patch);
  });
});

describe('chunks/*.meta.json read/write', () => {
  it('writes and reads chunk metadata', async () => {
    const reviewDir = join(tempBase, 'review-chunk-meta');
    await ensureReviewDirs(reviewDir);

    const meta: ChunkMetaJson = {
      id: '001-auth-refactor',
      title: 'Auth system refactor',
      description: 'Migrates from JWT to session-based auth',
      review_priority: 'high',
      estimated_tokens: 2800,
      files: [
        { path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 },
        { path: 'src/auth/jwt.ts', status: 'deleted', additions: 0, deletions: 85 },
      ],
      context: {
        imports_from: ['src/types/auth.ts', 'src/crypto/tokens.ts'],
        imported_by: ['src/auth/middleware.ts'],
        has_breaking_changes: true,
      },
      comments: ['gh-review-123'],
      findings: [],
    };

    await writeChunkMeta(reviewDir, '001-auth-refactor', meta);
    const read = await readChunkMeta(reviewDir, '001-auth-refactor');
    expect(read).toEqual(meta);
  });
});

describe('comments/*.json read/write', () => {
  it('writes and reads a comment thread file', async () => {
    const reviewDir = join(tempBase, 'review-comments');
    await ensureReviewDirs(reviewDir);

    const comment: CommentFileJson = {
      thread_id: 'gh-review-123',
      source: 'github',
      state: 'open',
      chunk_id: '001-auth-refactor',
      file: 'src/auth/session.ts',
      line: 45,
      messages: [
        {
          author: 'github:alice',
          body: 'This needs session rotation after role change',
          timestamp: '2026-03-07T09:00:00Z',
          gh_comment_id: 12_345,
        },
        {
          author: 'github:bob',
          body: "Agreed, I'll fix this",
          timestamp: '2026-03-07T09:15:00Z',
          gh_comment_id: 12_346,
        },
      ],
    };

    await writeCommentFile(reviewDir, 'gh-review-123', comment);
    const read = await readCommentFile(reviewDir, 'gh-review-123');
    expect(read).toEqual(comment);
  });
});

describe('findings/*.json read/write', () => {
  it('writes and reads a finding file', async () => {
    const reviewDir = join(tempBase, 'review-findings');
    await ensureReviewDirs(reviewDir);

    const finding: FindingFileJson = {
      id: 'finding-001',
      reviewer: 'claude-code',
      chunk_id: '001-auth-refactor',
      timestamp: '2026-03-07T10:30:00Z',
      in_reply_to: 'gh-review-123',
      findings: [
        {
          file: 'src/auth/session.ts',
          line: 45,
          end_line: 52,
          severity: 'critical',
          message: 'Session token is not rotated after privilege escalation',
          suggestion: 'Call rotateSession() after role change',
          code_suggestion: 'await rotateSession(req.session);',
          root_cause: "When a user's role changes, the old session token remains valid",
          impact: 'Privilege escalation vulnerability',
          status: 'open',
          publish: false,
        },
      ],
    };

    await writeFindingFile(reviewDir, 'finding-001', finding);
    const read = await readFindingFile(reviewDir, 'finding-001');
    expect(read).toEqual(finding);
  });
});

describe('special characters in file paths', () => {
  it('handles unicode characters in file paths within files.json', async () => {
    const reviewDir = join(tempBase, 'review-unicode');
    await ensureReviewDirs(reviewDir);

    const filesJson: FilesJson = {
      files: [
        { path: 'src/日本語/file (copy).tsx', status: 'modified', additions: 10, deletions: 5 },
        { path: 'src/données/résumé.ts', status: 'added', additions: 20, deletions: 0 },
      ],
      imports: [],
    };

    await writeFilesJson(reviewDir, filesJson);
    const read = await readFilesJson(reviewDir);
    expect(read.files[0]!.path).toBe('src/日本語/file (copy).tsx');
    expect(read.files[1]!.path).toBe('src/données/résumé.ts');
  });
});

describe('full directory structure matches spec', () => {
  it('creates all expected files after full lifecycle write', async () => {
    const reviewDir = join(tempBase, 'review-full');
    await ensureReviewDirs(reviewDir);

    // Write manifest
    const manifest: ManifestJson = {
      version: '1',
      source: {
        provider: 'github',
        repo: 'org/repo',
        pr: 9999,
        base: 'main',
        head: 'feature',
        url: 'https://github.com/org/repo/pull/9999',
      },
      status: 'split',
      stats: {
        total_files: 2,
        total_additions: 150,
        total_deletions: 20,
        total_chunks: 1,
        total_comments: 1,
        total_findings: 1,
      },
      chunks: [
        {
          id: '001-auth',
          title: 'Auth',
          description: '',
          files: ['src/a.ts', 'src/b.ts'],
          additions: 150,
          deletions: 20,
          review_priority: 'high',
          estimated_tokens: 2000,
          status: 'pending',
          comments_count: 1,
          findings_count: 1,
        },
      ],
    };
    await writeManifest(reviewDir, manifest);

    // Write files.json
    await writeFilesJson(reviewDir, {
      files: [
        { path: 'src/a.ts', status: 'added', additions: 100, deletions: 0 },
        { path: 'src/b.ts', status: 'modified', additions: 50, deletions: 20 },
      ],
      imports: [],
    });

    // Write chunk patch + meta
    await writeChunkPatch(reviewDir, '001-auth', 'diff --git a/src/a.ts b/src/a.ts\n+added\n');
    await writeChunkMeta(reviewDir, '001-auth', {
      id: '001-auth',
      title: 'Auth',
      description: '',
      review_priority: 'high',
      estimated_tokens: 2000,
      files: [
        { path: 'src/a.ts', status: 'added', additions: 100, deletions: 0 },
        { path: 'src/b.ts', status: 'modified', additions: 50, deletions: 20 },
      ],
      context: { imports_from: [], imported_by: [], has_breaking_changes: false },
      comments: ['gh-review-123'],
      findings: ['finding-001'],
    });

    // Write comment
    await writeCommentFile(reviewDir, 'gh-review-123', {
      thread_id: 'gh-review-123',
      source: 'github',
      state: 'open',
      file: 'src/a.ts',
      line: 10,
      messages: [
        {
          author: 'github:alice',
          body: 'LGTM',
          timestamp: '2026-03-07T10:00:00Z',
        },
      ],
    });

    // Write finding
    await writeFindingFile(reviewDir, 'finding-001', {
      id: 'finding-001',
      reviewer: 'claude-code',
      chunk_id: '001-auth',
      timestamp: '2026-03-07T10:30:00Z',
      findings: [
        {
          file: 'src/a.ts',
          line: 5,
          severity: 'suggestion',
          message: 'Consider adding type annotation',
          status: 'open',
          publish: false,
        },
      ],
    });

    // Verify directory structure
    expect(existsSync(join(reviewDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'files.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks', '001-auth.patch'))).toBe(true);
    expect(existsSync(join(reviewDir, 'chunks', '001-auth.meta.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'comments', 'gh-review-123.json'))).toBe(true);
    expect(existsSync(join(reviewDir, 'findings', 'finding-001.json'))).toBe(true);

    // Verify each file is valid JSON (except .patch)
    const manifestContent = await readFile(join(reviewDir, 'manifest.json'), 'utf-8');
    expect(() => JSON.parse(manifestContent)).not.toThrow();

    const filesContent = await readFile(join(reviewDir, 'files.json'), 'utf-8');
    expect(() => JSON.parse(filesContent)).not.toThrow();

    const metaContent = await readFile(join(reviewDir, 'chunks', '001-auth.meta.json'), 'utf-8');
    expect(() => JSON.parse(metaContent)).not.toThrow();

    const commentContent = await readFile(
      join(reviewDir, 'comments', 'gh-review-123.json'),
      'utf-8',
    );
    expect(() => JSON.parse(commentContent)).not.toThrow();

    const findingContent = await readFile(join(reviewDir, 'findings', 'finding-001.json'), 'utf-8');
    expect(() => JSON.parse(findingContent)).not.toThrow();

    // Verify .patch is plain text (starts with diff)
    const patchContent = await readFile(join(reviewDir, 'chunks', '001-auth.patch'), 'utf-8');
    expect(patchContent).toContain('diff --git');
  });
});
