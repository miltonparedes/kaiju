import { describe, expect, it } from 'vitest';

import { parseDiffIntoFiles, parseGhPaginatedJson, parsePRReference } from './githubProvider.js';

// ─── parsePRReference ───────────────────────────────────────────────────────────

describe('parsePRReference', () => {
  it('parses shorthand org/repo#N', () => {
    const result = parsePRReference('acme/widgets#42');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', pr: 42 });
  });

  it('parses full GitHub URL https://github.com/org/repo/pull/N', () => {
    const result = parsePRReference('https://github.com/acme/widgets/pull/123');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', pr: 123 });
  });

  it('parses GitHub URL without protocol prefix', () => {
    const result = parsePRReference('github.com/acme/widgets/pull/99');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', pr: 99 });
  });

  it('rejects invalid format', () => {
    expect(() => parsePRReference('not-a-valid-ref')).toThrow();
  });

  it('rejects URL with non-numeric PR', () => {
    expect(() => parsePRReference('https://github.com/org/repo/pull/abc')).toThrow();
  });

  it('rejects shorthand with non-numeric PR', () => {
    expect(() => parsePRReference('org/repo#abc')).toThrow();
  });

  it('rejects shorthand without hash', () => {
    expect(() => parsePRReference('org/repo/123')).toThrow();
  });

  it('handles org names with hyphens', () => {
    const result = parsePRReference('my-org/my-repo#7');
    expect(result).toEqual({ owner: 'my-org', repo: 'my-repo', pr: 7 });
  });

  it('handles URLs with trailing slashes', () => {
    const result = parsePRReference('https://github.com/org/repo/pull/42/');
    expect(result).toEqual({ owner: 'org', repo: 'repo', pr: 42 });
  });
});

// ─── parseDiffIntoFiles ─────────────────────────────────────────────────────────

describe('parseDiffIntoFiles', () => {
  const SAMPLE_DIFF = `diff --git a/src/auth/session.ts b/src/auth/session.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/session.ts
@@ -0,0 +1,5 @@
+import { token } from '../crypto';
+
+export function createSession() {
+  return token();
+}
diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
deleted file mode 100644
--- a/src/auth/jwt.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function verifyJwt() {
-  return true;
-}
diff --git a/src/routes/api.ts b/src/routes/api.ts
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -1,4 +1,6 @@
 import express from 'express';
+import { createSession } from '../auth/session';
+
 const router = express.Router();
-router.get('/hello', (req, res) => res.send('hi'));
+router.get('/hello', (req, res) => res.json({ ok: true }));
 export default router;
`;

  it('parses files from unified diff', () => {
    const result = parseDiffIntoFiles(SAMPLE_DIFF);
    expect(result).toHaveLength(3);
  });

  it('detects added files', () => {
    const result = parseDiffIntoFiles(SAMPLE_DIFF);
    const added = result.find((f) => f.path === 'src/auth/session.ts');
    expect(added).toBeDefined();
    expect(added!.status).toBe('added');
    expect(added!.additions).toBe(5);
    expect(added!.deletions).toBe(0);
  });

  it('detects deleted files', () => {
    const result = parseDiffIntoFiles(SAMPLE_DIFF);
    const deleted = result.find((f) => f.path === 'src/auth/jwt.ts');
    expect(deleted).toBeDefined();
    expect(deleted!.status).toBe('deleted');
    expect(deleted!.additions).toBe(0);
    expect(deleted!.deletions).toBe(3);
  });

  it('detects modified files with correct stats', () => {
    const result = parseDiffIntoFiles(SAMPLE_DIFF);
    const modified = result.find((f) => f.path === 'src/routes/api.ts');
    expect(modified).toBeDefined();
    expect(modified!.status).toBe('modified');
    expect(modified!.additions).toBe(3);
    expect(modified!.deletions).toBe(1);
  });

  it('returns empty array for empty diff', () => {
    expect(parseDiffIntoFiles('')).toEqual([]);
  });

  it('handles renamed files', () => {
    const renameDiff = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1,3 +1,3 @@
 export function hello() {
-  return 'old';
+  return 'new';
 }
`;
    const result = parseDiffIntoFiles(renameDiff);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('new.ts');
    expect(result[0]!.status).toBe('renamed');
  });
});

// ─── parseGhPaginatedJson ───────────────────────────────────────────────────────

describe('parseGhPaginatedJson', () => {
  it('parses a single JSON array', () => {
    const result = parseGhPaginatedJson('[{"id":1},{"id":2}]');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('returns empty array for empty string', () => {
    expect(parseGhPaginatedJson('')).toEqual([]);
  });

  it('returns empty array for empty JSON array', () => {
    expect(parseGhPaginatedJson('[]')).toEqual([]);
  });

  it('handles concatenated JSON arrays from --paginate', () => {
    const input = '[{"id":1},{"id":2}][{"id":3},{"id":4}]';
    const result = parseGhPaginatedJson(input);
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });

  it('handles three concatenated pages', () => {
    const input = '[{"id":1}][{"id":2}][{"id":3}]';
    const result = parseGhPaginatedJson(input);
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('handles whitespace around arrays', () => {
    const result = parseGhPaginatedJson('  [{"id":1}]  ');
    expect(result).toEqual([{ id: 1 }]);
  });

  it('parses NDJSON (one JSON object per line) from --jq ".[]"', () => {
    const input = '{"id":1,"body":"hello"}\n{"id":2,"body":"world"}\n';
    const result = parseGhPaginatedJson(input);
    expect(result).toEqual([
      { id: 1, body: 'hello' },
      { id: 2, body: 'world' },
    ]);
  });

  it('parses NDJSON with bracket characters inside string values', () => {
    const input = [
      '{"id":1,"body":"code snippet: const arr = [1, 2]; console.log(arr[0])"}',
      '{"id":2,"body":"markdown table: | a[0] | b[1] |"}',
      '{"id":3,"body":"normal comment"}',
    ].join('\n');
    const result = parseGhPaginatedJson<{ id: number; body: string }>(input);
    expect(result).toHaveLength(3);
    expect(result[0]!.body).toBe('code snippet: const arr = [1, 2]; console.log(arr[0])');
    expect(result[1]!.body).toBe('markdown table: | a[0] | b[1] |');
    expect(result[2]!.body).toBe('normal comment');
  });

  it('handles brackets in string values with concatenated arrays', () => {
    // This was the original bug: brackets inside comment bodies corrupt parsing
    const page1 = JSON.stringify([
      { id: 1, body: 'Fix: `arr[0]` was wrong' },
      { id: 2, body: 'LGTM' },
    ]);
    const page2 = JSON.stringify([{ id: 3, body: 'See `obj["key"]` usage' }]);
    const input = page1 + page2;
    const result = parseGhPaginatedJson<{ id: number; body: string }>(input);
    expect(result).toHaveLength(3);
    expect(result[0]!.body).toBe('Fix: `arr[0]` was wrong');
    expect(result[2]!.body).toBe('See `obj["key"]` usage');
  });

  it('handles unbalanced brackets inside string values (closing bracket)', () => {
    // A "]" inside a string causes premature depth=0 with naive counting
    const input = JSON.stringify([
      { id: 1, body: 'text ] more text' },
      { id: 2, body: 'normal' },
    ]);
    const result = parseGhPaginatedJson<{ id: number; body: string }>(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.body).toBe('text ] more text');
    expect(result[1]!.body).toBe('normal');
  });

  it('handles multi-line NDJSON with empty lines', () => {
    const input = '{"id":1}\n\n{"id":2}\n\n';
    const result = parseGhPaginatedJson(input);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('handles single NDJSON object', () => {
    const input = '{"id":42}\n';
    const result = parseGhPaginatedJson(input);
    expect(result).toEqual([{ id: 42 }]);
  });
});
