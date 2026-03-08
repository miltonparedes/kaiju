'use client';

import { type PatchDiffProps, PatchDiff, WorkerPoolContextProvider } from '@pierre/diffs/react';
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';
import { Columns2, Rows3 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area.js';
import { Toggle } from '@/components/ui/toggle.js';
import { cn } from '@/lib/utils.js';

import type { DashboardChunk } from '../routes/$provider/$org/$repo/$pr/types.js';
import { filePathToId, splitPatchByFile } from './diffViewerUtils.js';

/** Extract the options type from PatchDiffProps for reuse. */
type DiffOptions = NonNullable<PatchDiffProps<undefined>['options']>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiffViewerProps {
  chunks: DashboardChunk[];
}

type DiffStyle = 'split' | 'unified';

// ─── Worker Pool wrapper ──────────────────────────────────────────────────────

/**
 * Wraps children with the @pierre/diffs WorkerPoolContextProvider.
 * Uses the pierre-dark theme and word-alt line diff type for async highlighting.
 */
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
}: {
  filePath: string;
  patch: string;
  options: DiffOptions;
}) {
  return (
    <div id={filePathToId(filePath)} className="border-b border-border last:border-b-0">
      <StickyFileHeader filePath={filePath} />
      <div className="overflow-x-auto">
        <PatchDiff patch={patch} options={options} />
      </div>
    </div>
  );
}

// ─── Chunk Section ────────────────────────────────────────────────────────────

function ChunkSection({ chunk, options }: { chunk: DashboardChunk; options: DiffOptions }) {
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
        />
      ))}
    </div>
  );
}

// ─── DiffViewer (main export) ─────────────────────────────────────────────────

export function DiffViewer({ chunks }: DiffViewerProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split');

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

  const hasPatches = chunks.some((c) => c.patch);

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
            <div>
              {chunks.map((chunk) =>
                chunk.patch ? (
                  <div key={chunk.slug} className="border-b-2 border-border/50 last:border-b-0">
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
                    <ChunkSection chunk={chunk} options={diffOptions} />
                  </div>
                ) : null,
              )}
            </div>
          </DiffWorkerProvider>
        )}
      </ScrollArea>
    </div>
  );
}
