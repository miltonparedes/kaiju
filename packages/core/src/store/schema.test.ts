import { describe, expect, it } from 'vitest';

import { chunkDeps, chunks, comments, files, findings, imports, reviews } from './schema.js';

describe('schema', () => {
  it('defines reviews table', () => {
    expect(reviews).toBeDefined();
  });

  it('defines files table', () => {
    expect(files).toBeDefined();
  });

  it('defines imports table', () => {
    expect(imports).toBeDefined();
  });

  it('defines chunks table', () => {
    expect(chunks).toBeDefined();
  });

  it('defines chunkDeps table', () => {
    expect(chunkDeps).toBeDefined();
  });

  it('defines comments table', () => {
    expect(comments).toBeDefined();
  });

  it('defines findings table', () => {
    expect(findings).toBeDefined();
  });
});
