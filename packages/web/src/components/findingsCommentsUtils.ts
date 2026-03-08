/**
 * Utilities for mapping findings and comments to @pierre/diffs lineAnnotations.
 * Converts Kaiju store data into the format required by PatchDiff.
 */

import type { DiffLineAnnotation } from '@pierre/diffs/react';

import type {
  DashboardComment,
  DashboardFinding,
} from '../routes/$provider/$org/$repo/$pr/types.js';

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
export function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'critical':
    case 'bug':
      return '●';
    case 'suggestion':
      return '●';
    case 'nitpick':
      return '●';
    case 'praise':
      return '●';
    default:
      return '●';
  }
}

// ─── Build annotations ────────────────────────────────────────────────────────

/**
 * Build lineAnnotations for a specific file from findings.
 * Only includes findings that target the given file path.
 * Each finding becomes an annotation at its line number on the additions side.
 */
export function buildFindingAnnotations(
  findings: DashboardFinding[],
  filePath: string,
): KaijuAnnotation[] {
  return findings
    .filter((f) => f.file === filePath && f.line != null)
    .map((f) => ({
      side: 'additions' as const,
      lineNumber: f.line!,
      metadata: { kind: 'finding' as const, finding: f },
    }));
}

/**
 * Build lineAnnotations for a specific file from comments.
 * Groups comments by threadId, placing the thread at the first comment's line.
 */
export function buildCommentAnnotations(
  comments: DashboardComment[],
  filePath: string,
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
    const sorted = [...threadComments].sort((a, b) => {
      const ta = a.timestamp ?? '';
      const tb = b.timestamp ?? '';
      return ta.localeCompare(tb);
    });
    const firstLine = sorted[0]?.line ?? 1;
    annotations.push({
      side: 'additions',
      lineNumber: firstLine,
      metadata: { kind: 'comment-thread', threadId, comments: sorted },
    });
  }

  return annotations;
}

/**
 * Merge finding and comment annotations for a single file.
 * Sorted by line number for stable rendering.
 */
export function buildFileAnnotations(
  findings: DashboardFinding[],
  comments: DashboardComment[],
  filePath: string,
): KaijuAnnotation[] {
  const findingAnns = buildFindingAnnotations(findings, filePath);
  const commentAnns = buildCommentAnnotations(comments, filePath);
  return [...findingAnns, ...commentAnns].sort((a, b) => a.lineNumber - b.lineNumber);
}
