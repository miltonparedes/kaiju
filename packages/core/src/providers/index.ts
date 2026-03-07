import type { PullRequest } from '../types/index.js';

export interface GitProviderClient {
  fetchPR(owner: string, repo: string, number: number): Promise<PullRequest>;
}

export function createProvider(_name: string): GitProviderClient {
  return {
    async fetchPR(_owner, _repo, _number) {
      throw new Error('Not implemented');
    },
  };
}
