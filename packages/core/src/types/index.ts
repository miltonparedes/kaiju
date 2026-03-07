export interface GitProvider {
  name: string;
  baseUrl: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  url: string;
  provider: string;
  baseBranch: string;
  headBranch: string;
  files: string[];
}

export interface Chunk {
  id: number;
  prId: number;
  label: string;
  files: string[];
}

export interface Finding {
  id: number;
  chunkId: number;
  type: string;
  message: string;
  file: string;
  line?: number;
}
