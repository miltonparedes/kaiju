import { describe, expect, it } from 'vitest';

import { formatShowStartup, formatShowJson, showCommand } from './show.js';

describe('show command', () => {
  it('has the correct name', () => {
    expect(showCommand.name()).toBe('show');
  });

  it('has a description', () => {
    expect(showCommand.description()).toBeTruthy();
  });

  it('accepts an optional pr-ref argument', () => {
    const args = showCommand.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!.name()).toBe('pr-ref');
  });

  it('has a --port option with default 1954', () => {
    const portOpt = showCommand.options.find((o) => o.long === '--port');
    expect(portOpt).toBeDefined();
    expect(portOpt!.defaultValue).toBe('1954');
  });

  it('has a --all option', () => {
    expect(showCommand.options.some((o) => o.long === '--all')).toBe(true);
  });

  it('has a --json option', () => {
    expect(showCommand.options.some((o) => o.long === '--json')).toBe(true);
  });
});

describe('formatShowStartup', () => {
  it('includes the URL with correct port', () => {
    const output = formatShowStartup({ port: 1954, url: 'http://localhost:1954' });
    expect(output).toContain('http://localhost:1954');
  });

  it('includes the URL with custom port', () => {
    const output = formatShowStartup({ port: 3456, url: 'http://localhost:3456' });
    expect(output).toContain('http://localhost:3456');
  });

  it('includes a startup message', () => {
    const output = formatShowStartup({ port: 1954, url: 'http://localhost:1954' });
    expect(output).toContain('Kaiju');
    expect(output).toContain('1954');
  });
});

describe('formatShowJson', () => {
  it('outputs valid JSON', () => {
    const json = formatShowJson({ port: 1954, url: 'http://localhost:1954' });
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes url and port', () => {
    const parsed = JSON.parse(formatShowJson({ port: 1954, url: 'http://localhost:1954' }));
    expect(parsed.url).toBe('http://localhost:1954');
    expect(parsed.port).toBe(1954);
  });
});
