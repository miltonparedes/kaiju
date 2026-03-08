import { describe, expect, it } from 'vitest';

import { reviewCommand } from './review.js';

describe('review command', () => {
  it('has the correct name', () => {
    expect(reviewCommand.name()).toBe('review');
  });

  it('has a description', () => {
    expect(reviewCommand.description()).toBeTruthy();
  });

  it('accepts a required pr-ref argument', () => {
    const args = reviewCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('pr-ref');
    expect(args[0]!.required).toBe(true);
  });

  it('has a --port option with default 1954', () => {
    const portOpt = reviewCommand.options.find((o) => o.long === '--port');
    expect(portOpt).toBeDefined();
    expect(portOpt!.defaultValue).toBe('1954');
  });

  it('has a --json option', () => {
    expect(reviewCommand.options.some((o) => o.long === '--json')).toBe(true);
  });

  it('has a --strategy option', () => {
    expect(reviewCommand.options.some((o) => o.long === '--strategy')).toBe(true);
  });
});
