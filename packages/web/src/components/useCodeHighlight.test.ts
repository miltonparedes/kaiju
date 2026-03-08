import { describe, expect, it } from 'vitest';

import { detectLanguage } from './useCodeHighlight.js';

describe('detectLanguage', () => {
  it('detects TypeScript from .ts extension', () => {
    expect(detectLanguage('src/auth/session.ts')).toBe('typescript');
  });

  it('detects TSX from .tsx extension', () => {
    expect(detectLanguage('components/App.tsx')).toBe('tsx');
  });

  it('detects JavaScript from .js extension', () => {
    expect(detectLanguage('index.js')).toBe('javascript');
  });

  it('detects Python from .py extension', () => {
    expect(detectLanguage('script.py')).toBe('python');
  });

  it('detects Rust from .rs extension', () => {
    expect(detectLanguage('main.rs')).toBe('rust');
  });

  it('detects Go from .go extension', () => {
    expect(detectLanguage('handler.go')).toBe('go');
  });

  it('detects CSS from .css extension', () => {
    expect(detectLanguage('styles.css')).toBe('css');
  });

  it('detects YAML from .yaml and .yml', () => {
    expect(detectLanguage('config.yaml')).toBe('yaml');
    expect(detectLanguage('config.yml')).toBe('yaml');
  });

  it('detects Dockerfile by basename', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('path/to/Dockerfile')).toBe('dockerfile');
  });

  it('returns "text" for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBe('text');
    expect(detectLanguage('noext')).toBe('text');
  });

  it('handles case-insensitive extensions', () => {
    expect(detectLanguage('file.TS')).toBe('typescript');
    expect(detectLanguage('file.PY')).toBe('python');
  });
});
