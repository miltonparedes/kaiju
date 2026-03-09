import { describe, expect, it } from 'vitest';

import {
  type GitRunner,
  parseLocalBranchRef,
  validateGhAuth,
  validatePRReference,
} from './localProvider.js';

// ─── parseLocalBranchRef ────────────────────────────────────────────────────────

describe('parseLocalBranchRef', () => {
  it('parses a simple branch name', () => {
    const result = parseLocalBranchRef('feature-branch');
    expect(result).toEqual({ branch: 'feature-branch', baseBranch: undefined });
  });

  it('parses branch with explicit base (branch..base)', () => {
    const result = parseLocalBranchRef('feature-branch..develop');
    expect(result).toEqual({ branch: 'feature-branch', baseBranch: 'develop' });
  });

  it('throws on empty branch name', () => {
    expect(() => parseLocalBranchRef('')).toThrow();
  });

  it('handles branch names with slashes', () => {
    const result = parseLocalBranchRef('feature/my-feature');
    expect(result).toEqual({ branch: 'feature/my-feature', baseBranch: undefined });
  });

  it('handles branch names with dots that are not separators', () => {
    const result = parseLocalBranchRef('v2.0-release');
    expect(result).toEqual({ branch: 'v2.0-release', baseBranch: undefined });
  });
});

// ─── validatePRReference ────────────────────────────────────────────────────────

describe('validatePRReference', () => {
  it('returns an error for invalid PR reference format', () => {
    const result = validatePRReference('not-a-valid-ref');
    expect(result).toBeDefined();
    expect(result!.type).toBe('invalid_url');
    expect(result!.message).toContain('Expected formats');
  });

  it('returns null for valid shorthand', () => {
    const result = validatePRReference('acme/widgets#42');
    expect(result).toBeNull();
  });

  it('returns null for valid URL', () => {
    const result = validatePRReference('https://github.com/acme/widgets/pull/42');
    expect(result).toBeNull();
  });

  it('error message shows expected formats', () => {
    const result = validatePRReference('garbage input');
    expect(result).toBeDefined();
    expect(result!.message).toContain('org/repo#N');
    expect(result!.message).toContain('github.com');
  });
});

// ─── validateGhAuth ─────────────────────────────────────────────────────────────

describe('validateGhAuth', () => {
  it('returns null when gh is authenticated', async () => {
    const mockRunner: GitRunner = async () => 'github.com';
    const result = await validateGhAuth(mockRunner);
    expect(result).toBeNull();
  });

  it('returns an error when gh is not authenticated', async () => {
    const mockRunner: GitRunner = async () => {
      throw new Error('not logged in');
    };
    const result = await validateGhAuth(mockRunner);
    expect(result).toBeDefined();
    expect(result!.type).toBe('auth');
    expect(result!.message).toContain('gh auth');
  });
});
