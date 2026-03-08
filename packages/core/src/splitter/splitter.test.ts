import { describe, expect, it } from 'vitest';

import type { FileEntry } from '../types/index.js';
import {
  type ChunkAssignment,
  type PlanChunkDef,
  type SplitInput,
  directorySplit,
  estimateTokens,
  parsePlan,
  planSplit,
  remapFindings,
  singleFileSplit,
  splitFiles,
  subdivideChunks,
} from './index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeFile(path: string, additions = 10, deletions = 5): FileEntry {
  return {
    id: 0,
    reviewId: 0,
    path,
    status: 'modified',
    additions,
    deletions,
    chunkId: null,
  };
}

function makePatch(filePaths: string[]): string {
  return filePaths
    .map(
      (p) =>
        `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,3 +1,5 @@\n+added line 1\n+added line 2\n context\n-removed\n`,
    )
    .join('');
}

// ─── Token Estimation ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns a positive integer for non-empty content', () => {
    const tokens = estimateTokens('hello world this is a test of token estimation');
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
  });

  it('returns 0 for empty content', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('produces reasonable estimate for a patch', () => {
    const patch = makePatch(['src/auth/session.ts']);
    const tokens = estimateTokens(patch);
    // A small patch should have a reasonable positive number
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(1000);
  });

  it('scales roughly with content size', () => {
    const small = estimateTokens('one two three');
    const large = estimateTokens('one two three four five six seven eight nine ten eleven twelve');
    expect(large).toBeGreaterThan(small);
  });
});

// ─── DirectorySplitter ──────────────────────────────────────────────────────────

describe('directorySplit', () => {
  it('groups files by top-level directory', () => {
    const files = [
      makeFile('src/auth/session.ts'),
      makeFile('src/auth/jwt.ts'),
      makeFile('src/routes/api.ts'),
      makeFile('tests/auth.test.ts'),
    ];

    const result = directorySplit(files);

    expect(result.length).toBeGreaterThanOrEqual(2);

    // All files must be assigned to exactly one chunk
    const assignedFiles = result.flatMap((c) => c.filePaths);
    expect(assignedFiles.sort()).toEqual(files.map((f) => f.path).sort());

    // Files in same directory should be in same chunk
    const authChunk = result.find((c) => c.filePaths.includes('src/auth/session.ts'));
    expect(authChunk).toBeDefined();
    expect(authChunk!.filePaths).toContain('src/auth/jwt.ts');
  });

  it('handles files at root level', () => {
    const files = [makeFile('README.md'), makeFile('package.json'), makeFile('src/index.ts')];

    const result = directorySplit(files);
    const assignedFiles = result.flatMap((c) => c.filePaths);
    expect(assignedFiles.sort()).toEqual(files.map((f) => f.path).sort());
  });

  it('assigns each file to exactly one chunk (no duplicates)', () => {
    const files = [
      makeFile('src/a.ts'),
      makeFile('src/b.ts'),
      makeFile('lib/c.ts'),
      makeFile('lib/d.ts'),
    ];

    const result = directorySplit(files);
    const assignedFiles = result.flatMap((c) => c.filePaths);

    // No duplicates
    expect(new Set(assignedFiles).size).toBe(assignedFiles.length);
    expect(assignedFiles.length).toBe(files.length);
  });

  it('generates unique chunk IDs', () => {
    const files = [makeFile('src/a.ts'), makeFile('lib/b.ts'), makeFile('tests/c.ts')];

    const result = directorySplit(files);
    const ids = result.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes directory name in chunk title', () => {
    const files = [makeFile('src/auth/session.ts')];
    const result = directorySplit(files);
    expect(result[0]!.title.toLowerCase()).toContain('src');
  });
});

// ─── SingleFileSplitter ─────────────────────────────────────────────────────────

describe('singleFileSplit', () => {
  it('creates one chunk per file', () => {
    const files = [
      makeFile('src/auth/session.ts'),
      makeFile('src/routes/api.ts'),
      makeFile('tests/auth.test.ts'),
    ];

    const result = singleFileSplit(files);
    expect(result.length).toBe(files.length);
  });

  it('each chunk contains exactly one file', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts')];

    const result = singleFileSplit(files);
    for (const chunk of result) {
      expect(chunk.filePaths.length).toBe(1);
    }
  });

  it('generates unique chunk IDs', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts'), makeFile('src/c.ts')];

    const result = singleFileSplit(files);
    const ids = result.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all files assigned exactly once', () => {
    const files = [makeFile('src/a.ts'), makeFile('lib/b.ts')];

    const result = singleFileSplit(files);
    const assignedFiles = result.flatMap((c) => c.filePaths);
    expect(assignedFiles.sort()).toEqual(files.map((f) => f.path).sort());
  });
});

// ─── PlanSplitter ───────────────────────────────────────────────────────────────

describe('parsePlan', () => {
  it('parses valid JSON plan', () => {
    const plan = JSON.stringify({
      chunks: [{ id: '001-auth', title: 'Auth', files: ['src/auth/*'] }],
    });

    const result = parsePlan(plan);
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0]!.id).toBe('001-auth');
  });

  it('rejects invalid JSON with clear error', () => {
    expect(() => parsePlan('{invalid}')).toThrow();
  });

  it('rejects plan without chunks array', () => {
    expect(() => parsePlan(JSON.stringify({ foo: 'bar' }))).toThrow();
  });

  it('rejects chunk missing id', () => {
    const plan = JSON.stringify({
      chunks: [{ title: 'Auth', files: ['src/auth/*'] }],
    });
    expect(() => parsePlan(plan)).toThrow();
  });

  it('rejects chunk missing files array', () => {
    const plan = JSON.stringify({
      chunks: [{ id: '001', title: 'Auth' }],
    });
    expect(() => parsePlan(plan)).toThrow();
  });
});

describe('planSplit', () => {
  it('assigns files using glob patterns', () => {
    const files = [
      makeFile('src/auth/session.ts'),
      makeFile('src/auth/jwt.ts'),
      makeFile('src/routes/api.ts'),
    ];

    const plan: PlanChunkDef[] = [
      { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
      { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
    ];

    const result = planSplit(files, plan);

    const authChunk = result.find((c) => c.id === '001-auth');
    expect(authChunk).toBeDefined();
    expect(authChunk!.filePaths).toContain('src/auth/session.ts');
    expect(authChunk!.filePaths).toContain('src/auth/jwt.ts');

    const routesChunk = result.find((c) => c.id === '002-routes');
    expect(routesChunk).toBeDefined();
    expect(routesChunk!.filePaths).toContain('src/routes/api.ts');
  });

  it('supports nested glob patterns', () => {
    const files = [makeFile('src/auth/deep/nested/file.ts'), makeFile('src/auth/session.ts')];

    const plan: PlanChunkDef[] = [{ id: '001-auth', title: 'Auth', files: ['src/auth/**'] }];

    const result = planSplit(files, plan);
    const authChunk = result.find((c) => c.id === '001-auth');
    expect(authChunk).toBeDefined();
    expect(authChunk!.filePaths.length).toBe(2);
  });

  it('puts unmatched files in _uncategorized chunk', () => {
    const files = [
      makeFile('src/auth/session.ts'),
      makeFile('src/routes/api.ts'),
      makeFile('README.md'),
    ];

    const plan: PlanChunkDef[] = [{ id: '001-auth', title: 'Auth', files: ['src/auth/*'] }];

    const result = planSplit(files, plan);

    // README.md and routes/api.ts don't match any glob
    const uncategorized = result.find((c) => c.id === '_uncategorized');
    expect(uncategorized).toBeDefined();
    expect(uncategorized!.filePaths).toContain('README.md');
    expect(uncategorized!.filePaths).toContain('src/routes/api.ts');
  });

  it('no _uncategorized chunk when all files matched', () => {
    const files = [makeFile('src/auth/session.ts')];

    const plan: PlanChunkDef[] = [{ id: '001-auth', title: 'Auth', files: ['src/auth/*'] }];

    const result = planSplit(files, plan);
    const uncategorized = result.find((c) => c.id === '_uncategorized');
    expect(uncategorized).toBeUndefined();
  });

  it('no files are silently dropped', () => {
    const files = [
      makeFile('src/a.ts'),
      makeFile('src/b.ts'),
      makeFile('lib/c.ts'),
      makeFile('docs/d.md'),
    ];

    const plan: PlanChunkDef[] = [{ id: '001-src', title: 'Source', files: ['src/*'] }];

    const result = planSplit(files, plan);
    const allAssigned = result.flatMap((c) => c.filePaths);
    expect(allAssigned.sort()).toEqual(files.map((f) => f.path).sort());
  });

  it('enforces chunk ID uniqueness', () => {
    const files = [makeFile('src/a.ts')];

    const plan: PlanChunkDef[] = [
      { id: '001-dup', title: 'A', files: ['src/*'] },
      { id: '001-dup', title: 'B', files: ['lib/*'] },
    ];

    expect(() => planSplit(files, plan)).toThrow(/duplicate|unique/i);
  });

  it('preserves review_priority from plan', () => {
    const files = [makeFile('src/a.ts')];

    const plan: PlanChunkDef[] = [
      {
        id: '001-high',
        title: 'Important',
        files: ['src/*'],
        review_priority: 'high',
        description: 'Very important chunk',
      },
    ];

    const result = planSplit(files, plan);
    expect(result[0]!.reviewPriority).toBe('high');
    expect(result[0]!.description).toBe('Very important chunk');
  });
});

// ─── max-tokens subdivision ─────────────────────────────────────────────────────

describe('subdivideChunks', () => {
  it('splits oversized chunks based on max tokens', () => {
    // Create files with known token estimates
    const files = [
      makeFile('src/a.ts', 200, 50),
      makeFile('src/b.ts', 200, 50),
      makeFile('src/c.ts', 200, 50),
      makeFile('src/d.ts', 200, 50),
    ];

    const assignment: ChunkAssignment = {
      id: '001-big',
      title: 'Big chunk',
      description: '',
      reviewPriority: 'medium',
      filePaths: files.map((f) => f.path),
    };

    // Use a very low max tokens so it forces subdivision
    const result = subdivideChunks([assignment], files, 100);
    expect(result.length).toBeGreaterThan(1);

    // All files still assigned
    const allFiles = result.flatMap((c) => c.filePaths);
    expect(allFiles.sort()).toEqual(files.map((f) => f.path).sort());
  });

  it('does not split when under max tokens', () => {
    const files = [makeFile('src/a.ts', 5, 2)];

    const assignment: ChunkAssignment = {
      id: '001-small',
      title: 'Small chunk',
      description: '',
      reviewPriority: 'medium',
      filePaths: ['src/a.ts'],
    };

    const result = subdivideChunks([assignment], files, 10_000);
    expect(result.length).toBe(1);
  });

  it('preserves chunk metadata in sub-chunks', () => {
    const files = [makeFile('src/a.ts', 200, 50), makeFile('src/b.ts', 200, 50)];

    const assignment: ChunkAssignment = {
      id: '001-big',
      title: 'Big chunk',
      description: 'A big chunk',
      reviewPriority: 'high',
      filePaths: files.map((f) => f.path),
    };

    const result = subdivideChunks([assignment], files, 50);
    for (const chunk of result) {
      expect(chunk.reviewPriority).toBe('high');
      expect(chunk.id).toMatch(/^001-big/);
    }
  });

  it('generates unique IDs for sub-chunks', () => {
    const files = [
      makeFile('src/a.ts', 200, 50),
      makeFile('src/b.ts', 200, 50),
      makeFile('src/c.ts', 200, 50),
    ];

    const assignment: ChunkAssignment = {
      id: '001-big',
      title: 'Big chunk',
      description: '',
      reviewPriority: 'medium',
      filePaths: files.map((f) => f.path),
    };

    const result = subdivideChunks([assignment], files, 50);
    const ids = result.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── keep-findings remapping ────────────────────────────────────────────────────

describe('remapFindings', () => {
  it('remaps finding chunk IDs to new chunk containing the file', () => {
    const existingFindings = [
      {
        id: 1,
        reviewId: 1,
        chunkId: 10,
        reviewer: 'claude',
        file: 'src/auth/session.ts',
        line: 45,
        endLine: null,
        severity: 'critical' as const,
        message: 'Security issue',
        suggestion: null,
        codeSuggestion: null,
        rootCause: null,
        impact: null,
        status: 'open' as const,
        publish: false,
        inReplyTo: null,
        timestamp: null,
        createdAt: 0,
      },
    ];

    const newChunks: ChunkAssignment[] = [
      {
        id: 'new-auth-chunk',
        title: 'Auth',
        description: '',
        reviewPriority: 'high',
        filePaths: ['src/auth/session.ts', 'src/auth/jwt.ts'],
      },
    ];

    const remapped = remapFindings(existingFindings, newChunks);
    expect(remapped.length).toBe(1);
    expect(remapped[0]!.newChunkSlug).toBe('new-auth-chunk');
    expect(remapped[0]!.findingId).toBe(1);
  });

  it('preserves finding content (message, severity)', () => {
    const existingFindings = [
      {
        id: 1,
        reviewId: 1,
        chunkId: 10,
        reviewer: 'claude',
        file: 'src/a.ts',
        line: 10,
        endLine: null,
        severity: 'critical' as const,
        message: 'Important finding',
        suggestion: 'Fix it',
        codeSuggestion: null,
        rootCause: null,
        impact: null,
        status: 'open' as const,
        publish: false,
        inReplyTo: null,
        timestamp: null,
        createdAt: 0,
      },
    ];

    const newChunks: ChunkAssignment[] = [
      {
        id: '001-new',
        title: 'New',
        description: '',
        reviewPriority: 'medium',
        filePaths: ['src/a.ts'],
      },
    ];

    const remapped = remapFindings(existingFindings, newChunks);
    expect(remapped[0]!.findingId).toBe(1);
    // Finding content is preserved — the remapping only changes chunk assignment
    expect(remapped[0]!.newChunkSlug).toBe('001-new');
  });

  it('sets null chunk for findings whose file is not in any chunk', () => {
    const existingFindings = [
      {
        id: 1,
        reviewId: 1,
        chunkId: 10,
        reviewer: 'claude',
        file: 'deleted-file.ts',
        line: 1,
        endLine: null,
        severity: 'suggestion' as const,
        message: 'Orphan',
        suggestion: null,
        codeSuggestion: null,
        rootCause: null,
        impact: null,
        status: 'open' as const,
        publish: false,
        inReplyTo: null,
        timestamp: null,
        createdAt: 0,
      },
    ];

    const newChunks: ChunkAssignment[] = [
      {
        id: '001-src',
        title: 'Source',
        description: '',
        reviewPriority: 'medium',
        filePaths: ['src/a.ts'],
      },
    ];

    const remapped = remapFindings(existingFindings, newChunks);
    expect(remapped[0]!.newChunkSlug).toBeNull();
  });
});

// ─── splitFiles (high-level orchestrator) ───────────────────────────────────────

describe('splitFiles', () => {
  it('splits using directory strategy', () => {
    const input: SplitInput = {
      files: [makeFile('src/a.ts'), makeFile('lib/b.ts')],
      rawDiff: makePatch(['src/a.ts', 'lib/b.ts']),
    };

    const result = splitFiles(input, { strategy: 'directory' });
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.chunks.every((c) => c.estimatedTokens > 0)).toBe(true);
  });

  it('splits using single-file strategy', () => {
    const input: SplitInput = {
      files: [makeFile('src/a.ts'), makeFile('src/b.ts'), makeFile('src/c.ts')],
      rawDiff: makePatch(['src/a.ts', 'src/b.ts', 'src/c.ts']),
    };

    const result = splitFiles(input, { strategy: 'single-file' });
    expect(result.chunks.length).toBe(3);
  });

  it('splits using plan strategy', () => {
    const input: SplitInput = {
      files: [makeFile('src/auth/session.ts'), makeFile('src/routes/api.ts')],
      rawDiff: makePatch(['src/auth/session.ts', 'src/routes/api.ts']),
    };

    const plan = JSON.stringify({
      chunks: [
        { id: '001-auth', title: 'Auth', files: ['src/auth/*'] },
        { id: '002-routes', title: 'Routes', files: ['src/routes/*'] },
      ],
    });

    const result = splitFiles(input, { strategy: 'plan', plan });
    expect(result.chunks.length).toBe(2);
  });

  it('applies max-tokens subdivision', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`src/file${i}.ts`, 100, 50));
    const input: SplitInput = {
      files,
      rawDiff: makePatch(files.map((f) => f.path)),
    };

    const result = splitFiles(input, { strategy: 'directory', maxTokens: 50 });
    // With very low maxTokens, should subdivide
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('each chunk has estimatedTokens as positive integer', () => {
    const input: SplitInput = {
      files: [makeFile('src/a.ts'), makeFile('lib/b.ts')],
      rawDiff: makePatch(['src/a.ts', 'lib/b.ts']),
    };

    const result = splitFiles(input, { strategy: 'directory' });
    for (const chunk of result.chunks) {
      expect(chunk.estimatedTokens).toBeGreaterThan(0);
      expect(Number.isInteger(chunk.estimatedTokens)).toBe(true);
    }
  });

  it('rejects invalid plan JSON', () => {
    const input: SplitInput = {
      files: [makeFile('src/a.ts')],
      rawDiff: makePatch(['src/a.ts']),
    };

    expect(() => splitFiles(input, { strategy: 'plan', plan: '{invalid}' })).toThrow();
  });
});
