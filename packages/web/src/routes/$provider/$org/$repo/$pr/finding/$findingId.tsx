import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';

import { ChunkNavigator } from '@/components/ChunkNavigator.js';
import { DiffViewer } from '@/components/DiffViewer.js';
import { ReviewSummary } from '@/components/ReviewSummary.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable.js';
import { getChunks } from '@/server/chunks.js';
import { getComments } from '@/server/comments.js';
import { getFiles } from '@/server/files.js';
import { getFindings } from '@/server/findings.js';
import { getReview } from '@/server/reviews.js';

import type {
  DashboardChunk,
  DashboardComment,
  DashboardFile,
  DashboardFinding,
  DashboardReview,
} from '../types.js';

export interface FindingDeepLinkData {
  review: DashboardReview;
  chunks: DashboardChunk[];
  findings: DashboardFinding[];
  files: DashboardFile[];
  comments: DashboardComment[];
  findingId: number;
}

export const Route = createFileRoute('/$provider/$org/$repo/$pr/finding/$findingId')({
  loader: async ({ params }): Promise<FindingDeepLinkData> => {
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    const [review, chunks, allFindings, files, comments] = await Promise.all([
      getReview({ data: { key: reviewKey } }),
      getChunks({ data: { reviewKey } }),
      getFindings({ data: { reviewKey } }),
      getFiles({ data: { reviewKey } }),
      getComments({ data: { reviewKey } }),
    ]);

    const finding = allFindings.find((f) => String(f.id) === params.findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${params.findingId}`);
    }

    return {
      review,
      chunks: chunks as DashboardChunk[],
      findings: allFindings as DashboardFinding[],
      files: files as DashboardFile[],
      comments: comments as DashboardComment[],
      findingId: finding.id,
    };
  },
  component: FindingDeepLinkPage,
});

function FindingDeepLinkPage() {
  const { review, chunks, findings, files, comments, findingId } = Route.useLoaderData();
  const scrolledRef = useRef(false);

  const handleFileClick = useCallback((filePath: string) => {
    const fileId = `diff-file-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const el = document.getElementById(fileId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Auto-scroll to the finding after initial render
  useEffect(() => {
    if (scrolledRef.current) {
      return;
    }
    scrolledRef.current = true;
    // Give @pierre/diffs time to render the annotations
    const timer = setTimeout(() => {
      const findingEl = document.querySelector(`[data-finding-id="${findingId}"]`);
      if (findingEl) {
        findingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [findingId]);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link to="/" className="text-sm font-bold text-primary">
          Kaiju
        </Link>
        <span className="text-border">│</span>
        <span className="text-sm text-muted-foreground">{review.repo}</span>
        <span className="text-sm text-primary">#{review.pr}</span>
        {review.title ? (
          <span className="truncate text-sm text-foreground">— {review.title}</span>
        ) : null}
      </header>

      {/* 3-panel layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize="20%" minSize="12%" maxSize="40%">
          <ChunkNavigator
            chunks={chunks}
            findings={findings}
            files={files}
            onFileClick={handleFileClick}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="55%" minSize="30%">
          <DiffViewer
            chunks={chunks}
            findings={findings}
            comments={comments}
            expandedFindingId={findingId}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="25%" minSize="15%" maxSize="40%">
          <ReviewSummary review={review} chunks={chunks} findings={findings} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
