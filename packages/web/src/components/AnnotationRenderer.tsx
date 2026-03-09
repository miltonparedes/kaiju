'use client';

import { CommentThread } from './CommentThread.js';
import { FindingAnnotation } from './FindingAnnotation.js';
import type { AnnotationMeta } from './findingsCommentsUtils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnotationRendererProps {
  metadata: AnnotationMeta;
  expandedFindingId?: number | null;
}

// ─── AnnotationRenderer (main export) ─────────────────────────────────────────

/**
 * Renders the correct annotation component based on the metadata kind.
 * Used as the `renderAnnotation` callback for @pierre/diffs PatchDiff.
 */
export function AnnotationRenderer({ metadata, expandedFindingId }: AnnotationRendererProps) {
  switch (metadata.kind) {
    case 'finding': {
      return (
        <FindingAnnotation
          finding={metadata.finding}
          defaultExpanded={metadata.finding.id === expandedFindingId}
        />
      );
    }
    case 'comment-thread': {
      return <CommentThread threadId={metadata.threadId} comments={metadata.comments} />;
    }
    default: {
      return null;
    }
  }
}
