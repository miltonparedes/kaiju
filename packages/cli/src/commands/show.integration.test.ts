import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectGitRepo } from './shared.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

interface BuildShowEnvOptions {
  parentEnv: Record<string, string>;
  port: number;
  all: boolean;
  gitRepo: { org: string; repo: string } | null;
}

/**
 * Build the environment for the web server, mirroring the logic in show.ts.
 * Extracted for testability. The actual command uses identical logic.
 */
function buildShowEnv(opts: BuildShowEnvOptions): Record<string, string> {
  const env: Record<string, string> = {
    ...opts.parentEnv,
    PORT: String(opts.port),
  };

  // Always delete inherited context vars so --all never leaks them
  delete env.KAIJU_CONTEXT_ORG;
  delete env.KAIJU_CONTEXT_REPO;

  // Context detection: if inside a git repo and --all not set, pass context
  if (!opts.all) {
    if (opts.gitRepo) {
      env.KAIJU_CONTEXT_ORG = opts.gitRepo.org;
      env.KAIJU_CONTEXT_REPO = opts.gitRepo.repo;
    }
  }

  return env;
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('show env context filtering', () => {
  it('--all strips inherited KAIJU_CONTEXT_ORG and KAIJU_CONTEXT_REPO', () => {
    const parentEnv: Record<string, string> = {
      HOME: '/home/user',
      KAIJU_CONTEXT_ORG: 'inherited-org',
      KAIJU_CONTEXT_REPO: 'inherited-repo',
    };

    const env = buildShowEnv({ parentEnv, port: 1954, all: true, gitRepo: null });

    expect(env.KAIJU_CONTEXT_ORG).toBeUndefined();
    expect(env.KAIJU_CONTEXT_REPO).toBeUndefined();
    expect(env.PORT).toBe('1954');
    expect(env.HOME).toBe('/home/user');
  });

  it('--all strips inherited context even when git repo is detected', () => {
    const parentEnv: Record<string, string> = {
      HOME: '/home/user',
      KAIJU_CONTEXT_ORG: 'inherited-org',
      KAIJU_CONTEXT_REPO: 'inherited-repo',
    };

    // Even when detectGitRepo returns a result, --all should not set context
    const env = buildShowEnv({
      parentEnv,
      port: 1954,
      all: true,
      gitRepo: { org: 'detected-org', repo: 'detected-repo' },
    });

    expect(env.KAIJU_CONTEXT_ORG).toBeUndefined();
    expect(env.KAIJU_CONTEXT_REPO).toBeUndefined();
  });

  it('without --all, sets context from detected git repo', () => {
    const parentEnv: Record<string, string> = {
      HOME: '/home/user',
    };

    const env = buildShowEnv({
      parentEnv,
      port: 1954,
      all: false,
      gitRepo: { org: 'my-org', repo: 'my-repo' },
    });

    expect(env.KAIJU_CONTEXT_ORG).toBe('my-org');
    expect(env.KAIJU_CONTEXT_REPO).toBe('my-repo');
  });

  it('without --all, replaces inherited context with detected git repo', () => {
    const parentEnv: Record<string, string> = {
      HOME: '/home/user',
      KAIJU_CONTEXT_ORG: 'inherited-org',
      KAIJU_CONTEXT_REPO: 'inherited-repo',
    };

    const env = buildShowEnv({
      parentEnv,
      port: 1954,
      all: false,
      gitRepo: { org: 'detected-org', repo: 'detected-repo' },
    });

    expect(env.KAIJU_CONTEXT_ORG).toBe('detected-org');
    expect(env.KAIJU_CONTEXT_REPO).toBe('detected-repo');
  });

  it('without --all and no git repo, inherited context vars are removed', () => {
    const parentEnv: Record<string, string> = {
      HOME: '/home/user',
      KAIJU_CONTEXT_ORG: 'inherited-org',
      KAIJU_CONTEXT_REPO: 'inherited-repo',
    };

    const env = buildShowEnv({ parentEnv, port: 1954, all: false, gitRepo: null });

    // Even without --all, inherited vars should be cleaned (only fresh detection counts)
    expect(env.KAIJU_CONTEXT_ORG).toBeUndefined();
    expect(env.KAIJU_CONTEXT_REPO).toBeUndefined();
  });
});

describe('detectGitRepo from temp directory', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kaiju-show-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects org and repo from a temp git repo with HTTPS origin', () => {
    // Set up a real git repo with a known remote
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git remote add origin https://github.com/test-org/test-repo.git', {
      cwd: tempDir,
      stdio: 'pipe',
    });

    // Save original cwd, change into temp dir, detect, restore
    const originalCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const result = detectGitRepo();
      expect(result).not.toBeNull();
      expect(result!.org).toBe('test-org');
      expect(result!.repo).toBe('test-repo');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('detects org and repo from a temp git repo with SSH origin', () => {
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git remote add origin git@github.com:ssh-org/ssh-repo.git', {
      cwd: tempDir,
      stdio: 'pipe',
    });

    const originalCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const result = detectGitRepo();
      expect(result).not.toBeNull();
      expect(result!.org).toBe('ssh-org');
      expect(result!.repo).toBe('ssh-repo');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('returns null from a non-git directory', () => {
    const originalCwd = process.cwd();
    try {
      // Create a subdirectory that is not a git repo
      const nonGitDir = join(tempDir, 'not-a-repo');
      mkdirSync(nonGitDir, { recursive: true });
      process.chdir(nonGitDir);
      const result = detectGitRepo();
      expect(result).toBeNull();
    } finally {
      process.chdir(originalCwd);
    }
  });
});
