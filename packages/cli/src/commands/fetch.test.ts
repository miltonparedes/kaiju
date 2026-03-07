import { describe, expect, it } from 'vitest';

import { fetchCommand } from './fetch.js';

describe('fetch command', () => {
  it('has the correct name', () => {
    expect(fetchCommand.name()).toBe('fetch');
  });

  it('accepts a pr-url argument', () => {
    const args = fetchCommand.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!.name()).toBe('pr-url');
  });

  it('has a --provider option', () => {
    expect(fetchCommand.options.some((option) => option.long === '--provider')).toBe(true);
  });
});
