import { describe, expect, it } from 'vitest';

import type {
  DashboardComment,
  DashboardFinding,
} from '../routes/$provider/$org/$repo/$pr/types.js';
import {
  buildCommentAnnotations,
  buildFileAnnotations,
  buildFindingAnnotations,
  determineAnnotationSide,
  getSeverityStyle,
  parseDiffSides,
} from './findingsCommentsUtils.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<DashboardFinding> = {}): DashboardFinding {
  return {
    id: 1,
    reviewId: 1,
    chunkId: 1,
    reviewer: 'claude-code',
    file: 'src/auth/session.ts',
    line: 44,
    endLine: 46,
    severity: 'critical',
    message: 'Session token not rotated after privilege escalation.',
    suggestion: null,
    codeSuggestion: null,
    rootCause: 'Token reuse after role change.',
    impact: 'Privilege escalation risk.',
    status: 'open',
    publish: false,
    inReplyTo: null,
    timestamp: null,
    createdAt: 1000,
    ...overrides,
  };
}

function makeComment(overrides: Partial<DashboardComment> = {}): DashboardComment {
  return {
    id: 1,
    reviewId: 1,
    threadId: 'thread-1',
    source: 'github',
    state: 'open',
    chunkId: 1,
    file: 'src/auth/session.ts',
    line: 10,
    body: 'This looks good!',
    author: 'alice',
    timestamp: '2026-03-01T10:00:00Z',
    ghCommentId: 100,
    createdAt: 1000,
    ...overrides,
  };
}

// ─── getSeverityStyle ─────────────────────────────────────────────────────────

describe('getSeverityStyle', () => {
  it('returns critical style for "critical" severity', () => {
    const style = getSeverityStyle('critical');
    expect(style.label).toBe('Critical');
    expect(style.text).toContain('red');
  });

  it('returns suggestion style for "suggestion" severity', () => {
    const style = getSeverityStyle('suggestion');
    expect(style.label).toBe('Suggestion');
    expect(style.text).toContain('yellow');
  });

  it('returns nitpick style for "nitpick" severity', () => {
    const style = getSeverityStyle('nitpick');
    expect(style.label).toBe('Nitpick');
    expect(style.text).toContain('blue');
  });

  it('returns praise style for "praise" severity', () => {
    const style = getSeverityStyle('praise');
    expect(style.label).toBe('Praise');
    expect(style.text).toContain('green');
  });

  it('falls back to suggestion style for unknown severity', () => {
    const style = getSeverityStyle('unknown-sev');
    expect(style.label).toBe('Suggestion');
  });
});

// ─── buildFindingAnnotations ──────────────────────────────────────────────────

describe('buildFindingAnnotations', () => {
  it('returns empty array when no findings match the file', () => {
    const findings = [makeFinding({ file: 'other/file.ts', line: 5 })];
    const result = buildFindingAnnotations(findings, 'src/auth/session.ts');
    expect(result).toEqual([]);
  });

  it('returns annotations for findings matching the file', () => {
    const findings = [
      makeFinding({ id: 1, file: 'src/auth/session.ts', line: 44 }),
      makeFinding({ id: 2, file: 'src/auth/session.ts', line: 50 }),
      makeFinding({ id: 3, file: 'other.ts', line: 10 }),
    ];
    const result = buildFindingAnnotations(findings, 'src/auth/session.ts');
    expect(result).toHaveLength(2);
    expect(result[0]?.side).toBe('additions');
    expect(result[0]?.lineNumber).toBe(44);
    expect(result[0]?.metadata.kind).toBe('finding');
    expect(result[1]?.lineNumber).toBe(50);
  });

  it('excludes findings without a line number', () => {
    const findings = [makeFinding({ file: 'src/auth/session.ts', line: null })];
    const result = buildFindingAnnotations(findings, 'src/auth/session.ts');
    expect(result).toEqual([]);
  });
});

// ─── buildCommentAnnotations ──────────────────────────────────────────────────

describe('buildCommentAnnotations', () => {
  it('returns empty array when no comments match the file', () => {
    const comments = [makeComment({ file: 'other/file.ts', line: 5 })];
    const result = buildCommentAnnotations(comments, 'src/auth/session.ts');
    expect(result).toEqual([]);
  });

  it('groups comments by threadId', () => {
    const comments = [
      makeComment({ id: 1, threadId: 'thread-1', line: 10, timestamp: '2026-03-01T10:00:00Z' }),
      makeComment({ id: 2, threadId: 'thread-1', line: 10, timestamp: '2026-03-01T11:00:00Z' }),
      makeComment({ id: 3, threadId: 'thread-2', line: 20, timestamp: '2026-03-01T10:00:00Z' }),
    ];
    const result = buildCommentAnnotations(comments, 'src/auth/session.ts');
    expect(result).toHaveLength(2);

    const thread1 = result.find(
      (r) => r.metadata.kind === 'comment-thread' && r.metadata.threadId === 'thread-1',
    );
    expect(thread1).toBeDefined();
    expect(thread1?.lineNumber).toBe(10);
    if (thread1?.metadata.kind === 'comment-thread') {
      expect(thread1.metadata.comments).toHaveLength(2);
    }

    const thread2 = result.find(
      (r) => r.metadata.kind === 'comment-thread' && r.metadata.threadId === 'thread-2',
    );
    expect(thread2).toBeDefined();
    expect(thread2?.lineNumber).toBe(20);
  });

  it('sorts comments within a thread by timestamp', () => {
    const comments = [
      makeComment({ id: 2, threadId: 'thread-1', line: 10, timestamp: '2026-03-01T12:00:00Z' }),
      makeComment({ id: 1, threadId: 'thread-1', line: 10, timestamp: '2026-03-01T10:00:00Z' }),
    ];
    const result = buildCommentAnnotations(comments, 'src/auth/session.ts');
    expect(result).toHaveLength(1);
    if (result[0]?.metadata.kind === 'comment-thread') {
      expect(result[0].metadata.comments[0]?.id).toBe(1);
      expect(result[0].metadata.comments[1]?.id).toBe(2);
    }
  });

  it('excludes comments without a line number', () => {
    const comments = [makeComment({ file: 'src/auth/session.ts', line: null })];
    const result = buildCommentAnnotations(comments, 'src/auth/session.ts');
    expect(result).toEqual([]);
  });
});

// ─── buildFileAnnotations ─────────────────────────────────────────────────────

describe('buildFileAnnotations', () => {
  it('merges findings and comments, sorted by line number', () => {
    const findings = [makeFinding({ id: 1, file: 'src/auth/session.ts', line: 50 })];
    const comments = [makeComment({ id: 1, threadId: 'thread-1', line: 10 })];
    const result = buildFileAnnotations(findings, comments, 'src/auth/session.ts');
    expect(result).toHaveLength(2);
    // Comment at line 10 should come first
    expect(result[0]?.lineNumber).toBe(10);
    expect(result[0]?.metadata.kind).toBe('comment-thread');
    // Finding at line 50 should be second
    expect(result[1]?.lineNumber).toBe(50);
    expect(result[1]?.metadata.kind).toBe('finding');
  });

  it('returns empty array for a file with no annotations', () => {
    const result = buildFileAnnotations([], [], 'src/nothing.ts');
    expect(result).toEqual([]);
  });
});

// ─── parseDiffSides ───────────────────────────────────────────────────────────

const SAMPLE_PATCH = `diff --git a/src/auth.ts b/src/auth.ts
index abc..def 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,5 +1,6 @@
 import { hash } from 'bcrypt';
-import { oldSession } from './old';
+import { session } from './session';
+import { token } from './token';
 
 export function login() {
   return true;`;

describe('parseDiffSides', () => {
  it('identifies addition-only lines', () => {
    const { additionLines } = parseDiffSides(SAMPLE_PATCH);
    // Line 2 in new file is an addition (+import { session })
    expect(additionLines.has(2)).toBe(true);
    // Line 3 in new file is an addition (+import { token })
    expect(additionLines.has(3)).toBe(true);
  });

  it('identifies deletion-only lines', () => {
    const { deletionLines } = parseDiffSides(SAMPLE_PATCH);
    // Old-file line 2 is a deletion (-import { oldSession })
    expect(deletionLines.has(2)).toBe(true);
  });

  it('handles coinciding line numbers on both sides', () => {
    const { additionLines, deletionLines } = parseDiffSides(SAMPLE_PATCH);
    // Line 2 is in BOTH deletionLines (old-file) and additionLines (new-file)
    // because old-file line 2 is deleted and new-file line 2 is a different addition
    expect(deletionLines.has(2)).toBe(true);
    expect(additionLines.has(2)).toBe(true);
  });

  it('identifies context lines in additions (new file)', () => {
    const { additionLines } = parseDiffSides(SAMPLE_PATCH);
    // Line 1 is context (import { hash }) — present in additions (new file side)
    expect(additionLines.has(1)).toBe(true);
  });
});

// ─── determineAnnotationSide ──────────────────────────────────────────────────

describe('determineAnnotationSide', () => {
  it('returns "additions" for a line on the additions side', () => {
    // Line 3 in new file is added
    expect(determineAnnotationSide(3, SAMPLE_PATCH)).toBe('additions');
  });

  it('returns "deletions" for a line only on the deletions side', () => {
    // When multiple lines are deleted and the new file is shorter,
    // those old-file line numbers won't exist in additionLines.
    // Old: 1(ctx), 2(del), 3(del). New: 1(ctx).
    // additionLines = {1}, deletionLines = {2, 3}
    // Line 2 and 3 are ONLY in deletions → returns 'deletions'
    const patch = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,1 @@
 keep
-del1
-del2`;
    expect(determineAnnotationSide(2, patch)).toBe('deletions');
    expect(determineAnnotationSide(3, patch)).toBe('deletions');
  });

  it('returns "additions" when no patch is provided', () => {
    expect(determineAnnotationSide(10, undefined)).toBe('additions');
  });

  it('returns "additions" for a line not found in either side', () => {
    expect(determineAnnotationSide(999, SAMPLE_PATCH)).toBe('additions');
  });

  it('returns "additions" for a context line (present in both)', () => {
    // Line 1 is context — present in both, should prefer additions
    expect(determineAnnotationSide(1, SAMPLE_PATCH)).toBe('additions');
  });
});

// ─── Side-aware annotations ───────────────────────────────────────────────────

describe('buildFindingAnnotations with filePatch (side detection)', () => {
  it('uses additions side for findings on added lines', () => {
    const findings = [makeFinding({ file: 'src/auth.ts', line: 3 })];
    const result = buildFindingAnnotations(findings, 'src/auth.ts', SAMPLE_PATCH);
    expect(result).toHaveLength(1);
    expect(result[0]?.side).toBe('additions');
  });

  it('uses deletions side for findings on deleted lines', () => {
    // Old: 1(ctx), 2(del), 3(del). New: 1(ctx).
    // Line 2 only in deletions.
    const deletionPatch = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,3 +1,1 @@
 keep
-removed line at 2
-removed line at 3`;
    const findings = [makeFinding({ file: 'src/auth/session.ts', line: 2 })];
    const result = buildFindingAnnotations(findings, 'src/auth/session.ts', deletionPatch);
    expect(result).toHaveLength(1);
    expect(result[0]?.side).toBe('deletions');
  });

  it('defaults to additions when no filePatch given', () => {
    const findings = [makeFinding({ file: 'src/auth/session.ts', line: 44 })];
    const result = buildFindingAnnotations(findings, 'src/auth/session.ts');
    expect(result).toHaveLength(1);
    expect(result[0]?.side).toBe('additions');
  });
});

describe('buildCommentAnnotations with filePatch (side detection)', () => {
  it('uses deletions side for comment on deleted line', () => {
    // Old: 1(ctx), 2(del), 3(del). New: 1(ctx).
    // Line 2 only in deletions.
    const deletionPatch = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,3 +1,1 @@
 keep
-removed at 2
-removed at 3`;
    const comments = [makeComment({ file: 'src/auth/session.ts', line: 2 })];
    const result = buildCommentAnnotations(comments, 'src/auth/session.ts', deletionPatch);
    expect(result).toHaveLength(1);
    expect(result[0]?.side).toBe('deletions');
  });
});
