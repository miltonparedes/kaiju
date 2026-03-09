/**
 * Utilities for mapping findings and comments to @pierre/diffs lineAnnotations.
 * Converts Kaiju store data into the format required by PatchDiff.
 */

import type { DiffLineAnnotation } from '@pierre/diffs/react';

import type {
  DashboardComment,
  DashboardFinding,
} from '../routes/$provider/$org/$repo/$pr/types.js';
import { splitPatchByFile } from './diffViewerUtils.js';

// ─── Annotation types ─────────────────────────────────────────────────────────

/** Metadata attached to a finding annotation in the diff. */
export interface FindingAnnotationMeta {
  kind: 'finding';
  finding: DashboardFinding;
}

/** Metadata attached to a comment thread annotation in the diff. */
export interface CommentThreadAnnotationMeta {
  kind: 'comment-thread';
  threadId: string;
  comments: DashboardComment[];
}

/** Union type for all annotation metadata. */
export type AnnotationMeta = FindingAnnotationMeta | CommentThreadAnnotationMeta;

/** Typed annotation for our use-case. */
export type KaijuAnnotation = DiffLineAnnotation<AnnotationMeta>;

// ─── Severity helpers ─────────────────────────────────────────────────────────

/** Maps severity string to a Tailwind color class for the badge. */
export const SEVERITY_BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: {
    bg: 'bg-red-500/20 border-red-500/30',
    text: 'text-red-400',
    label: 'Critical',
  },
  bug: {
    bg: 'bg-red-500/20 border-red-500/30',
    text: 'text-red-400',
    label: 'Bug',
  },
  suggestion: {
    bg: 'bg-yellow-500/20 border-yellow-500/30',
    text: 'text-yellow-400',
    label: 'Suggestion',
  },
  nitpick: {
    bg: 'bg-blue-500/20 border-blue-500/30',
    text: 'text-blue-400',
    label: 'Nitpick',
  },
  praise: {
    bg: 'bg-green-500/20 border-green-500/30',
    text: 'text-green-400',
    label: 'Praise',
  },
};

/** Returns the severity badge style, defaulting to suggestion style for unknowns. */
export function getSeverityStyle(severity: string) {
  return SEVERITY_BADGE_STYLES[severity] ?? SEVERITY_BADGE_STYLES['suggestion']!;
}

/** Severity indicator icon (colored dot). */
export function getSeverityIcon(_severity: string): string {
  return '●';
}

// ─── Diff hunk parsing for side detection ─────────────────────────────────────

/**
 * Parse diff hunks from a single-file patch string.
 * Returns:
 * - additionLines: line numbers (new file) for `+` lines (pure additions)
 * - deletionLines: line numbers (old file) for `-` lines (pure deletions)
 * - contextNewLines: line numbers (new file) for context lines (present in both)
 * - contextOldLines: line numbers (old file) for context lines
 */
export function parseDiffSides(patch: string): {
  additionLines: Set<number>;
  deletionLines: Set<number>;
} {
  const additionLines = new Set<number>();
  const deletionLines = new Set<number>();
  const lines = patch.split('\n');

  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Parse @@ header
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1]!, 10);
      newLine = parseInt(hunkMatch[3]!, 10);
      continue;
    }

    // Skip non-diff lines (headers, etc.)
    if (oldLine === 0 && newLine === 0) {
      continue;
    }

    if (line.startsWith('+')) {
      // Pure addition — only exists in new file
      additionLines.add(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      // Pure deletion — only exists in old file
      deletionLines.add(oldLine);
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      // Context line — present in both files.
      // We add to additionLines so these are findable on the additions side.
      additionLines.add(newLine);
      oldLine++;
      newLine++;
    }
    // Ignore \ No newline at end of file
  }

  return { additionLines, deletionLines };
}

/**
 * Determine the annotation side for a given line number within a file's patch.
 *
 * The heuristic: if the line number corresponds to a `-` (deletion) line in
 * the old file, use `deletions`. Otherwise (addition, context, or unknown),
 * use `additions`. We check deletions first because deletion-side lines are
 * the special case — most annotations target the new file.
 */
export function determineAnnotationSide(
  lineNumber: number,
  filePatch: string | undefined,
): 'additions' | 'deletions' {
  if (!filePatch) {
    return 'additions';
  }

  const { additionLines, deletionLines } = parseDiffSides(filePatch);

  // If the line is a pure deletion (only in old file), use deletions side
  if (deletionLines.has(lineNumber) && !additionLines.has(lineNumber)) {
    return 'deletions';
  }

  // Otherwise (addition, context, or unknown) use additions side
  return 'additions';
}

/**
 * Build a map from file path to its individual patch string for a chunk.
 * Used to look up per-file patches for side detection.
 */
export function buildFilePatchMap(chunkPatch: string | null): Map<string, string> {
  if (!chunkPatch) {
    return new Map();
  }
  const filePatches = splitPatchByFile(chunkPatch);
  const map = new Map<string, string>();
  for (const fp of filePatches) {
    map.set(fp.filePath, fp.patch);
  }
  return map;
}

// ─── Build annotations ────────────────────────────────────────────────────────

/**
 * Build lineAnnotations for a specific file from findings.
 * Only includes findings that target the given file path.
 * Determines annotation side by parsing the diff hunks when a filePatch is provided.
 */
export function buildFindingAnnotations(
  findings: DashboardFinding[],
  filePath: string,
  filePatch?: string,
): KaijuAnnotation[] {
  return findings
    .filter((f) => f.file === filePath && f.line != null)
    .map((f) => ({
      side: determineAnnotationSide(f.line!, filePatch),
      lineNumber: f.line!,
      metadata: { kind: 'finding' as const, finding: f },
    }));
}

/**
 * Build lineAnnotations for a specific file from comments.
 * Groups comments by threadId, placing the thread at the first comment's line.
 * Determines annotation side by parsing the diff hunks when a filePatch is provided.
 */
export function buildCommentAnnotations(
  comments: DashboardComment[],
  filePath: string,
  filePatch?: string,
): KaijuAnnotation[] {
  // Filter comments for this file that have a line reference
  const fileComments = comments.filter((c) => c.file === filePath && c.line != null);

  if (fileComments.length === 0) {
    return [];
  }

  // Group by threadId
  const threadMap = new Map<string, DashboardComment[]>();
  for (const c of fileComments) {
    const list = threadMap.get(c.threadId) ?? [];
    list.push(c);
    threadMap.set(c.threadId, list);
  }

  // Sort each thread's comments by timestamp, create one annotation per thread
  const annotations: KaijuAnnotation[] = [];
  for (const [threadId, threadComments] of threadMap) {
    const sorted = [...threadComments].toSorted((a, b) => {
      const ta = a.timestamp ?? '';
      const tb = b.timestamp ?? '';
      return ta.localeCompare(tb);
    });
    const firstLine = sorted[0]?.line ?? 1;
    annotations.push({
      side: determineAnnotationSide(firstLine, filePatch),
      lineNumber: firstLine,
      metadata: { kind: 'comment-thread', threadId, comments: sorted },
    });
  }

  return annotations;
}

/**
 * Merge finding and comment annotations for a single file.
 * Sorted by line number for stable rendering.
 * Accepts an optional filePatch for accurate side detection.
 */
export function buildFileAnnotations(
  findings: DashboardFinding[],
  comments: DashboardComment[],
  filePath: string,
  filePatch?: string,
): KaijuAnnotation[] {
  const findingAnns = buildFindingAnnotations(findings, filePath, filePatch);
  const commentAnns = buildCommentAnnotations(comments, filePath, filePatch);
  return [...findingAnns, ...commentAnns].toSorted((a, b) => a.lineNumber - b.lineNumber);
}
