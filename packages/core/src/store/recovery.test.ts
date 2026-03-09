import { describe, expect, it } from 'vitest';

import { extractChunkPatch, generatePlaceholderPatch } from './recovery.js';

// ─── extractChunkPatch ──────────────────────────────────────────────────────

describe('extractChunkPatch', () => {
  const rawDiff = [
    'diff --git a/src/auth/session.ts b/src/auth/session.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/auth/session.ts',
    '@@ -0,0 +1,5 @@',
    '+export class SessionManager {}',
    'diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts',
    '--- a/src/auth/middleware.ts',
    '+++ b/src/auth/middleware.ts',
    '@@ -1,3 +1,5 @@',
    '+// updated',
  ].join('\n');

  it('extracts matching file sections from raw diff', () => {
    const result = extractChunkPatch(rawDiff, ['src/auth/session.ts']);
    expect(result).toContain('diff --git a/src/auth/session.ts');
    expect(result).toContain('+export class SessionManager {}');
    expect(result).not.toContain('middleware');
  });

  it('returns empty string for no matching files', () => {
    const result = extractChunkPatch(rawDiff, ['nonexistent.ts']);
    expect(result).toBe('');
  });

  it('returns empty string for empty rawDiff', () => {
    expect(extractChunkPatch('', ['src/auth/session.ts'])).toBe('');
  });

  it('returns empty string for empty filePaths', () => {
    expect(extractChunkPatch(rawDiff, [])).toBe('');
  });

  it('extracts multiple matching files', () => {
    const result = extractChunkPatch(rawDiff, ['src/auth/session.ts', 'src/auth/middleware.ts']);
    expect(result).toContain('session.ts');
    expect(result).toContain('middleware.ts');
  });
});

// ─── generatePlaceholderPatch ───────────────────────────────────────────────

describe('generatePlaceholderPatch', () => {
  it('generates placeholder for added files', () => {
    const result = generatePlaceholderPatch([{ path: 'new.ts', status: 'added' }]);
    expect(result).toContain('new file mode 100644');
    expect(result).toContain('--- /dev/null');
    expect(result).toContain('+++ b/new.ts');
  });

  it('generates placeholder for deleted files', () => {
    const result = generatePlaceholderPatch([{ path: 'old.ts', status: 'deleted' }]);
    expect(result).toContain('deleted file mode 100644');
    expect(result).toContain('+++ /dev/null');
  });

  it('generates placeholder for modified files', () => {
    const result = generatePlaceholderPatch([{ path: 'mod.ts', status: 'modified' }]);
    expect(result).toContain('--- a/mod.ts');
    expect(result).toContain('+++ b/mod.ts');
  });

  it('handles empty input', () => {
    expect(generatePlaceholderPatch([])).toBe('');
  });
});
