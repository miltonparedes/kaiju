import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import { ChunkNavigator } from '@/components/ChunkNavigator.js';
import { DiffViewer } from '@/components/DiffViewer.js';
import { ReviewSummary } from '@/components/ReviewSummary.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable.js';
import { getChunks } from '@/server/chunks.js';
import { getFiles } from '@/server/files.js';
import { getFindings } from '@/server/findings.js';
import { getReview } from '@/server/reviews.js';

import type { DashboardChunk, DashboardFile, DashboardFinding, PRLoaderData } from './types.js';

export const Route = createFileRoute('/$provider/$org/$repo/$pr/')({
  loader: async ({ params }): Promise<PRLoaderData> => {
    const reviewKey = `${params.provider}/${params.org}/${params.repo}/${params.pr}`;
    const [review, chunks, findings, files] = await Promise.all([
      getReview({ data: { key: reviewKey } }),
      getChunks({ data: { reviewKey } }),
      getFindings({ data: { reviewKey } }),
      getFiles({ data: { reviewKey } }),
    ]);
    return {
      review,
      chunks: chunks as DashboardChunk[],
      findings: findings as DashboardFinding[],
      files: files as DashboardFile[],
    };
  },
  component: PRViewPage,
});

// ─── Page ─────────────────────────────────────────────────────────────────────

function PRViewPage() {
  const { review, chunks, findings, files } = Route.useLoaderData();

  const handleFileClick = useCallback((filePath: string) => {
    // Scroll center diff viewer to the file's section
    const fileId = `diff-file-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const el = document.getElementById(fileId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

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
        {/* Left panel: Chunk Navigator */}
        <ResizablePanel defaultSize="20%" minSize="12%" maxSize="40%">
          <ChunkNavigator
            chunks={chunks}
            findings={findings}
            files={files}
            onFileClick={handleFileClick}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center panel: Diff Viewer */}
        <ResizablePanel defaultSize="55%" minSize="30%">
          <DiffViewer chunks={chunks} />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel: Review Summary */}
        <ResizablePanel defaultSize="25%" minSize="15%" maxSize="40%">
          <ReviewSummary review={review} chunks={chunks} findings={findings} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
