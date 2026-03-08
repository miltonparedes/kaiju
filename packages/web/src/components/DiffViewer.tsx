'use client';

import type { SelectedLineRange } from '@pierre/diffs';
import { type PatchDiffProps, PatchDiff, WorkerPoolContextProvider } from '@pierre/diffs/react';
// eslint-disable-next-line import/default -- Vite-specific ?worker&url import convention
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';
import { Columns2, Rows3 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area.js';
import { Toggle } from '@/components/ui/toggle.js';
import { cn } from '@/lib/utils.js';

import type {
  DashboardChunk,
  DashboardComment,
  DashboardFinding,
} from '../routes/$provider/$org/$repo/$pr/types.js';
import { AnnotationRenderer } from './AnnotationRenderer.js';
import { filePathToId, splitPatchByFile } from './diffViewerUtils.js';
import type { AnnotationMeta, KaijuAnnotation } from './findingsCommentsUtils.js';
import { buildFileAnnotations } from './findingsCommentsUtils.js';
import { LineSelectionBar } from './LineSelectionBar.js';

/** Extract the options type from PatchDiffProps for reuse. */
type DiffOptions = NonNullable<PatchDiffProps<AnnotationMeta>['options']>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiffViewerProps {
  chunks: DashboardChunk[];
  findings?: DashboardFinding[];
  comments?: DashboardComment[];
  expandedFindingId?: number | null;
  /** Controlled diff style (split or unified). When provided, the internal toggle still works. */
  diffStyle?: DiffStyle;
  /** Callback when diff style changes via toggle. */
  onDiffStyleChange?: (style: DiffStyle) => void;
  /** Index of the focused chunk (for scroll-into-view). */
  activeChunkIndex?: number;
}

export type DiffStyle = 'split' | 'unified';

/** Line selection state with the file context. */
interface FileLineSelection {
  filePath: string;
  range: SelectedLineRange;
}

// ─── Worker Pool wrapper ──────────────────────────────────────────────────────

function DiffWorkerProvider({ children }: { children: React.ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new Worker(WorkerUrl, { type: 'module' }),
        poolSize: 8,
      }}
      highlighterOptions={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        lineDiffType: 'word-alt',
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}

// ─── Sticky File Header ───────────────────────────────────────────────────────

function StickyFileHeader({ filePath }: { filePath: string }) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10',
        'border-b border-border bg-muted/90 backdrop-blur-sm',
        'px-4 py-2',
      )}
    >
      <span className="font-mono text-xs text-foreground/80">{filePath}</span>
    </div>
  );
}

// ─── Single File Diff ─────────────────────────────────────────────────────────

function SingleFileDiff({
  filePath,
  patch,
  options,
  findings,
  comments,
  expandedFindingId,
  onLineSelected,
}: {
  filePath: string;
  patch: string;
  options: DiffOptions;
  findings: DashboardFinding[];
  comments: DashboardComment[];
  expandedFindingId?: number | null;
  onLineSelected?: (range: SelectedLineRange | null, filePath: string) => void;
}) {
  const annotations = useMemo(
    () => buildFileAnnotations(findings, comments, filePath, patch),
    [findings, comments, filePath, patch],
  );

  const handleLineSelected = useCallback(
    (range: SelectedLineRange | null) => {
      onLineSelected?.(range, filePath);
    },
    [onLineSelected, filePath],
  );

  const fileOptions = useMemo<DiffOptions>(
    () => ({
      ...options,
      enableLineSelection: true,
      onLineSelected: handleLineSelected,
    }),
    [options, handleLineSelected],
  );

  return (
    <div id={filePathToId(filePath)} className="border-b border-border last:border-b-0">
      <StickyFileHeader filePath={filePath} />
      <div className="overflow-x-auto">
        <PatchDiff
          patch={patch}
          options={fileOptions}
          lineAnnotations={annotations}
          renderAnnotation={(annotation: KaijuAnnotation) => (
            <AnnotationRenderer
              metadata={annotation.metadata}
              expandedFindingId={expandedFindingId}
            />
          )}
        />
      </div>
    </div>
  );
}

// ─── Chunk Section ────────────────────────────────────────────────────────────

function ChunkSection({
  chunk,
  options,
  findings,
  comments,
  expandedFindingId,
  onLineSelected,
}: {
  chunk: DashboardChunk;
  options: DiffOptions;
  findings: DashboardFinding[];
  comments: DashboardComment[];
  expandedFindingId?: number | null;
  onLineSelected?: (range: SelectedLineRange | null, filePath: string) => void;
}) {
  const filePatches = useMemo(() => {
    if (!chunk.patch) {
      return [];
    }
    return splitPatchByFile(chunk.patch);
  }, [chunk.patch]);

  if (filePatches.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm italic text-muted-foreground">No patch data available</p>
      </div>
    );
  }

  return (
    <div>
      {filePatches.map((fp) => (
        <SingleFileDiff
          key={fp.filePath}
          filePath={fp.filePath}
          patch={fp.patch}
          options={options}
          findings={findings}
          comments={comments}
          expandedFindingId={expandedFindingId}
          onLineSelected={onLineSelected}
        />
      ))}
    </div>
  );
}

// ─── DiffViewer (main export) ─────────────────────────────────────────────────

export function DiffViewer({
  chunks,
  findings = [],
  comments = [],
  expandedFindingId,
  diffStyle: controlledDiffStyle,
  onDiffStyleChange,
  activeChunkIndex,
}: DiffViewerProps) {
  const [internalDiffStyle, setInternalDiffStyle] = useState<DiffStyle>('split');
  const diffStyle = controlledDiffStyle ?? internalDiffStyle;
  const setDiffStyle = useCallback(
    (style: DiffStyle) => {
      setInternalDiffStyle(style);
      onDiffStyleChange?.(style);
    },
    [onDiffStyleChange],
  );
  const [lineSelection, setLineSelection] = useState<FileLineSelection | null>(null);

  const diffOptions = useMemo<DiffOptions>(
    () => ({
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      diffStyle,
      lineDiffType: 'word-alt',
      hunkSeparators: 'line-info',
      overflow: 'scroll',
      themeType: 'dark',
    }),
    [diffStyle],
  );

  const handleLineSelected = useCallback((range: SelectedLineRange | null, filePath: string) => {
    if (range) {
      setLineSelection({ filePath, range });
    } else {
      setLineSelection(null);
    }
  }, []);

  const handleCreateFinding = useCallback((_selection: SelectedLineRange, _filePath: string) => {
    // TODO: open finding creation form / send to agent
    setLineSelection(null);
  }, []);

  const handleDismissSelection = useCallback(() => {
    setLineSelection(null);
  }, []);

  const hasPatches = chunks.some((c) => c.patch);

  // Scroll to active chunk when activeChunkIndex changes
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeChunkIndex == null || activeChunkIndex < 0) {
      return;
    }
    // Small delay to let DOM update
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-chunk-index="${activeChunkIndex}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [activeChunkIndex]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header with split/unified toggle */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold text-foreground">Diffs</h2>
        <div className="flex items-center gap-1">
          <Toggle
            size="sm"
            pressed={diffStyle === 'split'}
            onPressedChange={(pressed) => {
              if (pressed) {
                setDiffStyle('split');
              }
            }}
            aria-label="Split view"
            className="h-7 px-2 data-[state=on]:bg-accent"
          >
            <Columns2 className="size-3.5" />
            <span className="ml-1 text-xs">Split</span>
          </Toggle>
          <Toggle
            size="sm"
            pressed={diffStyle === 'unified'}
            onPressedChange={(pressed) => {
              if (pressed) {
                setDiffStyle('unified');
              }
            }}
            aria-label="Unified view"
            className="h-7 px-2 data-[state=on]:bg-accent"
          >
            <Rows3 className="size-3.5" />
            <span className="ml-1 text-xs">Unified</span>
          </Toggle>
        </div>
      </div>

      {/* Diff content area */}
      <ScrollArea className="min-h-0 flex-1">
        {!hasPatches ? (
          <div className="p-4">
            <p className="py-8 text-center text-sm text-muted-foreground">
              No chunks to display. Run <code>kaiju split</code> to create chunks.
            </p>
          </div>
        ) : (
          <DiffWorkerProvider>
            <div ref={scrollContainerRef}>
              {chunks.map((chunk, idx) =>
                chunk.patch ? (
                  <div
                    key={chunk.slug}
                    data-chunk-index={idx}
                    data-chunk-slug={chunk.slug}
                    className="border-b-2 border-border/50 last:border-b-0"
                  >
                    {/* Chunk title bar */}
                    <div className="bg-card/50 px-4 py-2">
                      <span className="text-sm font-semibold text-foreground">
                        {chunk.title || chunk.slug}
                      </span>
                      {chunk.description ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          — {chunk.description}
                        </span>
                      ) : null}
                    </div>
                    <ChunkSection
                      chunk={chunk}
                      options={diffOptions}
                      findings={findings}
                      comments={comments}
                      expandedFindingId={expandedFindingId}
                      onLineSelected={handleLineSelected}
                    />
                  </div>
                ) : null,
              )}
            </div>
          </DiffWorkerProvider>
        )}
      </ScrollArea>

      {/* Line selection bar */}
      {lineSelection ? (
        <LineSelectionBar
          selection={lineSelection.range}
          filePath={lineSelection.filePath}
          onCreateFinding={handleCreateFinding}
          onDismiss={handleDismissSelection}
        />
      ) : null}
    </div>
  );
}
