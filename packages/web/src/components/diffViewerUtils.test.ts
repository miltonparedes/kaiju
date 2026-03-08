import { describe, expect, it } from 'vitest';

import { filePathToId, splitPatchByFile } from './diffViewerUtils.js';

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
});
