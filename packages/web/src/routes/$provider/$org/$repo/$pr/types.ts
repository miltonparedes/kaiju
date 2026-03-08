/** Chunk shape as returned by the server getChunks function (Drizzle select). */
export interface DashboardChunk {
  id: number;
  reviewId: number;
  slug: string;
  title: string;
  description: string;
  reviewPriority: string;
  estimatedTokens: number;
  patch: string | null;
  status: string;
  createdAt: number;
}

/** Finding shape as returned by the server getFindings function (Drizzle select). */
export interface DashboardFinding {
  id: number;
  reviewId: number;
  chunkId: number | null;
  reviewer: string;
  file: string;
  line: number | null;
  endLine: number | null;
  severity: string;
  message: string;
  suggestion: string | null;
  codeSuggestion: string | null;
  rootCause: string | null;
  impact: string | null;
  status: string;
  publish: boolean;
  inReplyTo: string | null;
  timestamp: string | null;
  createdAt: number;
}

/** Review shape as returned by the server getReview function (Drizzle select). */
export interface DashboardReview {
  id: number;
  key: string;
  provider: string;
  repo: string;
  pr: number;
  title: string;
  url: string;
  base: string;
  head: string;
  status: string;
  rawDiff?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** File entry shape as returned by the server getFiles function (Drizzle select). */
export interface DashboardFile {
  id: number;
  reviewId: number;
  path: string;
  status: string;
  additions: number;
  deletions: number;
  chunkId: number | null;
}

/** Data returned by the PR view page loader. */
export interface PRLoaderData {
  review: DashboardReview;
  chunks: DashboardChunk[];
  findings: DashboardFinding[];
  files: DashboardFile[];
}
