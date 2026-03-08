import { describe, expect, it } from 'vitest';

import { filesCommand, formatFilesTable, formatFilesJson } from './files.js';

describe('files command', () => {
  it('has the correct name', () => {
    expect(filesCommand.name()).toBe('files');
  });

  it('has a description', () => {
    expect(filesCommand.description()).toBeTruthy();
  });

  it('accepts an optional pr-ref argument', () => {
    const args = filesCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('pr-ref');
  });

  it('has a --json option', () => {
    expect(filesCommand.options.some((o) => o.long === '--json')).toBe(true);
  });
});

describe('formatFilesTable', () => {
  it('formats files with +N -N stats and change type', () => {
    const output = formatFilesTable([
      { path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 },
      { path: 'src/auth/jwt.ts', status: 'deleted', additions: 0, deletions: 85 },
      { path: 'src/auth/middleware.ts', status: 'modified', additions: 35, deletions: 12 },
    ]);
    expect(output).toContain('src/auth/session.ts');
    expect(output).toContain('+120');
    expect(output).toContain('-0');
    expect(output).toContain('added');
    expect(output).toContain('src/auth/jwt.ts');
    expect(output).toContain('+0');
    expect(output).toContain('-85');
    expect(output).toContain('deleted');
    expect(output).toContain('src/auth/middleware.ts');
    expect(output).toContain('+35');
    expect(output).toContain('-12');
    expect(output).toContain('modified');
  });

  it('handles empty file list', () => {
    const output = formatFilesTable([]);
    expect(output).toContain('No files');
  });
});

describe('formatFilesJson', () => {
  it('outputs valid JSON with file data', () => {
    const json = formatFilesJson([
      { path: 'src/auth/session.ts', status: 'added', additions: 120, deletions: 0 },
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('src/auth/session.ts');
    expect(parsed.files[0].status).toBe('added');
    expect(parsed.files[0].additions).toBe(120);
    expect(parsed.files[0].deletions).toBe(0);
  });

  it('includes total count', () => {
    const json = formatFilesJson([
      { path: 'a.ts', status: 'added', additions: 10, deletions: 0 },
      { path: 'b.ts', status: 'modified', additions: 5, deletions: 3 },
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.totalFiles).toBe(2);
  });

  it('includes absolute paths when reviewDir is provided', () => {
    const json = formatFilesJson(
      [{ path: 'a.ts', status: 'added', additions: 10, deletions: 0 }],
      '/home/user/.kaiju/reviews/github/org/repo/9999',
    );
    const parsed = JSON.parse(json);
    expect(parsed.paths).toBeDefined();
    expect(parsed.paths.reviewDir).toBe('/home/user/.kaiju/reviews/github/org/repo/9999');
    expect(parsed.paths.filesJson).toContain('files.json');
  });

  it('omits paths when reviewDir is not provided', () => {
    const json = formatFilesJson([{ path: 'a.ts', status: 'added', additions: 10, deletions: 0 }]);
    const parsed = JSON.parse(json);
    expect(parsed.paths).toBeUndefined();
  });
});
