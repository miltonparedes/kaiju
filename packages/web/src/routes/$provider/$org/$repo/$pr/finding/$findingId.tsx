import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChunkNavigator } from '@/components/ChunkNavigator.js';
import type { DiffStyle } from '@/components/DiffViewer.js';
import { DiffViewer } from '@/components/DiffViewer.js';
import { ReviewSummary } from '@/components/ReviewSummary.js';
import { ShortcutsHelpDialog } from '@/components/ShortcutsHelpDialog.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable.js';
import { useKeyboardShortcuts } from '@/components/useKeyboardShortcuts.js';
import { getChunks, markChunkReviewed } from '@/server/chunks.js';
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
  initialFindingIndex: number;
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

    const typedFindings = allFindings as DashboardFinding[];
    const findingIndex = typedFindings.findIndex((f) => String(f.id) === params.findingId);
    if (findingIndex === -1) {
      throw new Error(`Finding not found: ${params.findingId}`);
    }
    const matchedFinding = typedFindings[findingIndex]!;

    return {
      review: review as DashboardReview,
      chunks: chunks as DashboardChunk[],
      findings: typedFindings,
      files: files as DashboardFile[],
      comments: comments as DashboardComment[],
      findingId: matchedFinding.id,
      initialFindingIndex: findingIndex,
    };
  },
  component: FindingDeepLinkPage,
});

function FindingDeepLinkPage() {
  const { review, chunks, findings, files, comments, findingId, initialFindingIndex } =
    Route.useLoaderData();
  const router = useRouter();
  const scrolledRef = useRef(false);

  const [activeChunkIndex, setActiveChunkIndex] = useState(0);
  const [activeFindingIndex, setActiveFindingIndex] = useState(initialFindingIndex);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split');
  const [helpOpen, setHelpOpen] = useState(false);
  const [reviewedSlugs, setReviewedSlugs] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const c of chunks) {
      if (c.status === 'reviewed') {
        set.add(c.slug);
      }
    }
    return set;
  });

  const leftPanelRef = useRef<HTMLDivElement>(null);
  const centerPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const effectiveChunks = useMemo<DashboardChunk[]>(
    () => chunks.map((c) => (reviewedSlugs.has(c.slug) ? { ...c, status: 'reviewed' } : c)),
    [chunks, reviewedSlugs],
  );

  // Auto-scroll to the finding after initial render
  useEffect(() => {
    if (scrolledRef.current) {
      return;
    }
    scrolledRef.current = true;
    const timer = setTimeout(() => {
      const findingEl = document.querySelector(`[data-finding-id="${findingId}"]`);
      if (findingEl) {
        findingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [findingId]);

  const handleFileClick = useCallback((filePath: string) => {
    const fileId = `diff-file-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const el = document.getElementById(fileId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleChunkChange = useCallback((index: number) => {
    setActiveChunkIndex(index);
    setActiveFindingIndex(-1);
  }, []);

  const handleFindingChange = useCallback(
    (index: number) => {
      setActiveFindingIndex(index);
      const finding = findings[index];
      if (finding) {
        setTimeout(() => {
          const findingEl = document.querySelector(`[data-finding-id="${finding.id}"]`);
          if (findingEl) {
            findingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }
    },
    [findings],
  );

  const handleToggleDiffStyle = useCallback(() => {
    setDiffStyle((prev) => (prev === 'split' ? 'unified' : 'split'));
  }, []);

  const handleMarkReviewed = useCallback(async () => {
    const chunk = effectiveChunks[activeChunkIndex];
    if (!chunk) {
      return;
    }
    if (reviewedSlugs.has(chunk.slug)) {
      return;
    }
    setReviewedSlugs((prev) => new Set(prev).add(chunk.slug));
    try {
      await markChunkReviewed({
        data: { reviewKey: review.key, chunkSlug: chunk.slug },
      });
      router.invalidate();
    } catch {
      setReviewedSlugs((prev) => {
        const next = new Set(prev);
        next.delete(chunk.slug);
        return next;
      });
    }
  }, [activeChunkIndex, effectiveChunks, review.key, reviewedSlugs, router]);

  const handleShowHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const handleFocusPanel = useCallback((panel: 1 | 2 | 3) => {
    const refs = [leftPanelRef, centerPanelRef, rightPanelRef];
    const ref = refs[panel - 1];
    if (ref?.current) {
      const focusable = ref.current.querySelector<HTMLElement>(
        'button, [tabindex]:not([tabindex="-1"]), a[href]',
      );
      if (focusable) {
        focusable.focus();
      } else {
        ref.current.focus();
      }
    }
  }, []);

  useKeyboardShortcuts({
    chunkCount: effectiveChunks.length,
    activeChunkIndex,
    onChunkChange: handleChunkChange,
    findingCount: findings.length,
    activeFindingIndex,
    onFindingChange: handleFindingChange,
    onToggleDiffStyle: handleToggleDiffStyle,
    onMarkReviewed: handleMarkReviewed,
    onShowHelp: handleShowHelp,
    onFocusPanel: handleFocusPanel,
    enabled: !helpOpen,
  });

  const expandedFindingId =
    activeFindingIndex >= 0 ? (findings[activeFindingIndex]?.id ?? null) : null;

  return (
    <div className="flex h-screen flex-col bg-background">
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
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="ml-auto rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize="20%" minSize="12%" maxSize="40%">
          <div ref={leftPanelRef} tabIndex={-1} className="h-full outline-none">
            <ChunkNavigator
              chunks={effectiveChunks}
              findings={findings}
              files={files}
              onFileClick={handleFileClick}
              activeChunkIndex={activeChunkIndex}
              onChunkClick={handleChunkChange}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="55%" minSize="30%">
          <div ref={centerPanelRef} tabIndex={-1} className="h-full outline-none">
            <DiffViewer
              chunks={effectiveChunks}
              findings={findings}
              comments={comments}
              expandedFindingId={expandedFindingId}
              diffStyle={diffStyle}
              onDiffStyleChange={setDiffStyle}
              activeChunkIndex={activeChunkIndex}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="25%" minSize="15%" maxSize="40%">
          <div ref={rightPanelRef} tabIndex={-1} className="h-full outline-none">
            <ReviewSummary review={review} chunks={effectiveChunks} findings={findings} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
