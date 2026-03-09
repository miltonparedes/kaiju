import type {
  DashboardChunk,
  DashboardFile,
  DashboardFinding,
} from '../routes/$provider/$org/$repo/$pr/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChunkWithStats {
  chunk: DashboardChunk;
  files: DashboardFile[];
  findings: DashboardFinding[];
  totalAdditions: number;
  totalDeletions: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  suggestion: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  nitpick: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  praise: 'bg-green-500/20 text-green-400 border-green-500/30',
};

export const SEVERITY_LABELS: Record<string, string> = {
  critical: 'bug',
  suggestion: 'suggestion',
  nitpick: 'nitpick',
  praise: 'praise',
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

// ─── Pure functions ───────────────────────────────────────────────────────────

/** Group findings by severity and return counts. */
export function countBySeverity(findings: DashboardFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

/**
 * Sort chunks by priority: critical findings first, then by reviewPriority, then by slug.
 * This must be called at the route level so all components share the same order.
 */
export function sortChunksByPriority(
  chunks: DashboardChunk[],
  findings: DashboardFinding[],
): DashboardChunk[] {
  // Build a lookup: chunkId → count of critical findings
  const criticalCounts = new Map<number, number>();
  for (const f of findings) {
    if (f.chunkId != null && f.severity === 'critical') {
      criticalCounts.set(f.chunkId, (criticalCounts.get(f.chunkId) ?? 0) + 1);
    }
  }

  return chunks.toSorted((a, b) => {
    const aCrit = criticalCounts.get(a.id) ?? 0;
    const bCrit = criticalCounts.get(b.id) ?? 0;
    if (aCrit !== bCrit) {
      return bCrit - aCrit;
    }
    const aPrio = PRIORITY_ORDER[a.reviewPriority] ?? 1;
    const bPrio = PRIORITY_ORDER[b.reviewPriority] ?? 1;
    if (aPrio !== bPrio) {
      return aPrio - bPrio;
    }
    return a.slug.localeCompare(b.slug);
  });
}

/**
 * Enrich chunks with associated files, findings, and aggregated stats.
 * Chunks are returned in the same order as the input (caller is responsible for sorting).
 */
export function buildChunkStats(
  chunks: DashboardChunk[],
  findings: DashboardFinding[],
  files: DashboardFile[],
): ChunkWithStats[] {
  // Index findings and files by chunkId
  const findingsByChunk = new Map<number, DashboardFinding[]>();
  for (const f of findings) {
    if (f.chunkId != null) {
      const arr = findingsByChunk.get(f.chunkId) ?? [];
      arr.push(f);
      findingsByChunk.set(f.chunkId, arr);
    }
  }

  const filesByChunk = new Map<number, DashboardFile[]>();
  for (const f of files) {
    if (f.chunkId != null) {
      const arr = filesByChunk.get(f.chunkId) ?? [];
      arr.push(f);
      filesByChunk.set(f.chunkId, arr);
    }
  }

  return chunks.map((chunk) => {
    const chunkFiles = filesByChunk.get(chunk.id) ?? [];
    const chunkFindings = findingsByChunk.get(chunk.id) ?? [];
    return {
      chunk,
      files: chunkFiles,
      findings: chunkFindings,
      totalAdditions: chunkFiles.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: chunkFiles.reduce((sum, f) => sum + f.deletions, 0),
    };
  });
}
