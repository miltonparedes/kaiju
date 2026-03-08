'use client';

import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible.js';
import { ScrollArea } from '@/components/ui/scroll-area.js';
import { cn } from '@/lib/utils.js';

import type {
  DashboardChunk,
  DashboardFile,
  DashboardFinding,
} from '../routes/$provider/$org/$repo/$pr/types.js';
import {
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  buildSortedChunks,
  countBySeverity,
} from './chunkNavigatorUtils.js';
import type { ChunkWithStats } from './chunkNavigatorUtils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChunkNavigatorProps {
  chunks: DashboardChunk[];
  findings: DashboardFinding[];
  files: DashboardFile[];
  onFileClick?: (filePath: string) => void;
}

// ─── FindingBadges ────────────────────────────────────────────────────────────

function FindingBadges({ findings }: { findings: DashboardFinding[] }) {
  const counts = countBySeverity(findings);
  const severityOrder = ['critical', 'suggestion', 'nitpick', 'praise'];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {severityOrder.map((sev) => {
        const count = counts[sev];
        if (!count) {
          return null;
        }
        return (
          <Badge
            key={sev}
            variant="outline"
            className={cn('px-1.5 py-0 text-[10px]', SEVERITY_COLORS[sev])}
          >
            {count} {SEVERITY_LABELS[sev] ?? sev}
            {count > 1 ? 's' : ''}
          </Badge>
        );
      })}
    </div>
  );
}

// ─── FileTree ─────────────────────────────────────────────────────────────────

function FileTree({
  files,
  onFileClick,
}: {
  files: DashboardFile[];
  onFileClick?: (filePath: string) => void;
}) {
  return (
    <ul className="space-y-0.5 py-1">
      {files.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            onClick={() => onFileClick?.(file.path)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs',
              'hover:bg-accent/50 transition-colors',
              onFileClick && 'cursor-pointer',
            )}
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-foreground/80">{file.path}</span>
            <span className="shrink-0 font-mono text-[10px]">
              <span className="text-green-400">+{file.additions}</span>{' '}
              <span className="text-red-400">-{file.deletions}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── ChunkItem ────────────────────────────────────────────────────────────────

function ChunkItem({
  data,
  index,
  onFileClick,
}: {
  data: ChunkWithStats;
  index: number;
  onFileClick?: (filePath: string) => void;
}) {
  const { chunk, files, findings, totalAdditions, totalDeletions } = data;
  const [open, setOpen] = useState(false);
  const isReviewed = chunk.status === 'reviewed';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <li className="rounded-md border border-border bg-card/50">
        <CollapsibleTrigger className="flex w-full items-start gap-2 px-3 py-2 text-left">
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            {/* Title row */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{index + 1}.</span>
              <span className="truncate text-sm font-medium text-foreground">
                {chunk.title || chunk.slug}
              </span>
              {isReviewed ? (
                <Badge
                  variant="outline"
                  className="ml-auto border-green-500/30 bg-green-500/10 px-1.5 py-0 text-[10px] text-green-400"
                >
                  reviewed
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="ml-auto px-1.5 py-0 text-[10px] text-muted-foreground"
                >
                  pending
                </Badge>
              )}
            </div>

            {/* Aggregate stats row (always visible) */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="text-green-400">{totalAdditions}+</span>{' '}
                <span className="text-red-400">{totalDeletions}-</span>
              </span>
              <span>~{chunk.estimatedTokens.toLocaleString()} tok</span>
              {files.length > 0 ? <span>{files.length} files</span> : null}
            </div>

            {/* Finding badges */}
            {findings.length > 0 ? (
              <div className="mt-1.5">
                <FindingBadges findings={findings} />
              </div>
            ) : null}
          </div>
        </CollapsibleTrigger>

        {/* Expanded: file tree */}
        <CollapsibleContent>
          <div className="border-t border-border/50 px-3 pb-2">
            {files.length > 0 ? (
              <FileTree files={files} onFileClick={onFileClick} />
            ) : (
              <p className="py-2 text-xs text-muted-foreground/60">No files in this chunk</p>
            )}
          </div>
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

// ─── ChunkNavigator (main export) ─────────────────────────────────────────────

export function ChunkNavigator({ chunks, findings, files, onFileClick }: ChunkNavigatorProps) {
  const sortedChunks = buildSortedChunks(chunks, findings, files);

  const handleFileClick = useCallback(
    (filePath: string) => {
      onFileClick?.(filePath);
    },
    [onFileClick],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Changes</h2>
        <p className="text-xs text-muted-foreground">
          {chunks.length} chunk{chunks.length !== 1 ? 's' : ''} · {files.length} file
          {files.length !== 1 ? 's' : ''}
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {sortedChunks.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No chunks yet. Run <code className="text-primary">kaiju split</code> first.
            </p>
          ) : (
            <ul className="space-y-1">
              {sortedChunks.map((data, i) => (
                <ChunkItem
                  key={data.chunk.slug}
                  data={data}
                  index={i}
                  onFileClick={handleFileClick}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
