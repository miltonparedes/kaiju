import type { Chunk, PullRequest } from '../types/index.js';

export interface SplitterOptions {
  maxFilesPerChunk?: number;
}

export async function splitPR(_pr: PullRequest, _options?: SplitterOptions): Promise<Chunk[]> {
  throw new Error('Not implemented');
}
