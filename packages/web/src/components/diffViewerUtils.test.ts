import { describe, expect, it } from 'vitest';

import { filePathToId, splitPatchByFile, unquoteGitPath } from './diffViewerUtils.js';

describe('filePathToId', () => {
  it('replaces non-alphanumeric chars with hyphens', () => {
    expect(filePathToId('src/auth/session.ts')).toBe('diff-file-src-auth-session-ts');
  });

  it('handles paths with special characters', () => {
    const result = filePathToId('src/日本語/file (copy).tsx');
    // Non-alphanumeric chars replaced with hyphens, prefix applied
    expect(result).toMatch(/^diff-file-/);
    expect(result).not.toContain('/');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
    expect(result).not.toContain(' ');
  });

  it('handles simple filenames', () => {
    expect(filePathToId('README.md')).toBe('diff-file-README-md');
  });
});

describe('splitPatchByFile', () => {
  it('returns empty array for empty input', () => {
    expect(splitPatchByFile('')).toEqual([]);
    expect(splitPatchByFile('  ')).toEqual([]);
  });

  it('returns empty array for null/undefined-like input', () => {
    expect(splitPatchByFile(null as unknown as string)).toEqual([]);
  });

  it('splits a single file patch', () => {
    const patch = `diff --git a/src/auth.ts b/src/auth.ts
index abc1234..def5678 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 import { hash } from 'bcrypt';
+import { session } from './session';
 
 export function login() {`;

    const result = splitPatchByFile(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('src/auth.ts');
    expect(result[0]!.patch).toContain('diff --git');
    expect(result[0]!.patch).toContain('import { session }');
  });

  it('splits a multi-file patch', () => {
    const patch = `diff --git a/src/auth.ts b/src/auth.ts
index abc1234..def5678 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 import { hash } from 'bcrypt';
+import { session } from './session';
diff --git a/src/session.ts b/src/session.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/session.ts
@@ -0,0 +1,5 @@
+export class Session {
+  constructor(public token: string) {}
+}`;

    const result = splitPatchByFile(patch);
    expect(result).toHaveLength(2);
    expect(result[0]!.filePath).toBe('src/auth.ts');
    expect(result[1]!.filePath).toBe('src/session.ts');

    // Each patch is self-contained
    expect(result[0]!.patch).toContain('import { hash }');
    expect(result[0]!.patch).not.toContain('export class Session');
    expect(result[1]!.patch).toContain('export class Session');
  });

  it('extracts the b/ path for renamed files', () => {
    const patch = `diff --git a/old/name.ts b/new/name.ts
similarity index 95%
rename from old/name.ts
rename to new/name.ts
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,3 +1,3 @@
-export const old = true;
+export const renamed = true;`;

    const result = splitPatchByFile(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('new/name.ts');
  });

  it('handles patch content that is not a diff', () => {
    const result = splitPatchByFile('just some random text\nno diff headers');
    expect(result).toEqual([]);
  });

  it('handles patches with multiple hunks per file', () => {
    const patch = `diff --git a/src/big.ts b/src/big.ts
index abc..def 100644
--- a/src/big.ts
+++ b/src/big.ts
@@ -10,3 +10,4 @@
 line 10
+added at 11
 line 12
@@ -50,3 +51,4 @@
 line 50
+added at 51
 line 52`;

    const result = splitPatchByFile(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('src/big.ts');
    // Both hunks should be in the same patch
    expect(result[0]!.patch).toContain('added at 11');
    expect(result[0]!.patch).toContain('added at 51');
  });

  it('splits a quoted-path patch (non-ASCII file name)', () => {
    const patch = `diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"
index abc1234..def5678 100644
--- "a/src/caf\\303\\251.ts"
+++ "b/src/caf\\303\\251.ts"
@@ -1,3 +1,4 @@
 import { brew } from 'coffee';
+import { latte } from './latte';
 
 export function order() {`;

    const result = splitPatchByFile(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('src/café.ts');
    expect(result[0]!.patch).toContain('diff --git');
    expect(result[0]!.patch).toContain('import { latte }');
  });

  it('splits multi-file patch with mixed quoted and unquoted paths', () => {
    const patch = `diff --git a/src/normal.ts b/src/normal.ts
index abc..def 100644
--- a/src/normal.ts
+++ b/src/normal.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
diff --git "a/src/\\346\\227\\245\\346\\234\\254\\350\\252\\236.ts" "b/src/\\346\\227\\245\\346\\234\\254\\350\\252\\236.ts"
index 111..222 100644
--- "a/src/\\346\\227\\245\\346\\234\\254\\350\\252\\236.ts"
+++ "b/src/\\346\\227\\245\\346\\234\\254\\350\\252\\236.ts"
@@ -1,2 +1,3 @@
 export const lang = 'ja';
+export const greeting = 'こんにちは';`;

    const result = splitPatchByFile(patch);
    expect(result).toHaveLength(2);
    expect(result[0]!.filePath).toBe('src/normal.ts');
    expect(result[1]!.filePath).toBe('src/日本語.ts');
  });

  it('handles quoted paths with spaces and special characters', () => {
    const patch = `diff --git "a/src/file (copy).tsx" "b/src/file (copy).tsx"
index abc..def 100644
--- "a/src/file (copy).tsx"
+++ "b/src/file (copy).tsx"
@@ -1 +1,2 @@
 export const a = 1;
+export const b = 2;`;

    const result = splitPatchByFile(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('src/file (copy).tsx');
  });
});

describe('unquoteGitPath', () => {
  it('returns unquoted strings as-is', () => {
    expect(unquoteGitPath('src/auth.ts')).toBe('src/auth.ts');
  });

  it('strips quotes from a simple quoted string', () => {
    expect(unquoteGitPath('"hello"')).toBe('hello');
  });

  it('decodes octal escape sequences for UTF-8 (café)', () => {
    // É = \\303\\251 in octal (UTF-8 bytes 0xC3, 0xA9)
    expect(unquoteGitPath('"caf\\303\\251.ts"')).toBe('café.ts');
  });

  it('decodes octal escape sequences for CJK characters', () => {
    // 日 = \\346\\227\\245 in octal (UTF-8 bytes 0xE6, 0x97, 0xA5)
    expect(unquoteGitPath('"\\346\\227\\245.ts"')).toBe('日.ts');
  });

  it('handles backslash escapes (\\n, \\t, \\\\, \\")', () => {
    expect(unquoteGitPath('"hello\\nworld"')).toBe('hello\nworld');
    expect(unquoteGitPath('"hello\\tworld"')).toBe('hello\tworld');
    expect(unquoteGitPath('"hello\\\\world"')).toBe('hello\\world');
    expect(unquoteGitPath('"hello\\"world"')).toBe('hello"world');
  });

  it('handles mixed octal and plain characters', () => {
    expect(unquoteGitPath('"src/caf\\303\\251/main.ts"')).toBe('src/café/main.ts');
  });
});
