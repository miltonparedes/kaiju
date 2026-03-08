'use client';

import type { SelectedLineRange } from '@pierre/diffs';
import { MessageSquarePlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button.js';
import { cn } from '@/lib/utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineSelectionBarProps {
  selection: SelectedLineRange;
  filePath: string;
  onCreateFinding: (selection: SelectedLineRange, filePath: string) => void;
  onDismiss: () => void;
}

// ─── LineSelectionBar (main export) ───────────────────────────────────────────

/**
 * Floating bar that appears when lines are selected in the diff.
 * Shows the selection range and a button to create a new finding.
 */
export function LineSelectionBar({
  selection,
  filePath,
  onCreateFinding,
  onDismiss,
}: LineSelectionBarProps) {
  const rangeLabel =
    selection.start === selection.end
      ? `Line ${selection.start}`
      : `Lines ${selection.start}–${selection.end}`;

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 z-50 -translate-x-1/2',
        'flex items-center gap-3 rounded-lg border border-primary/30',
        'bg-card/95 px-4 py-2 shadow-lg backdrop-blur-sm',
      )}
    >
      <span className="text-xs text-muted-foreground">
        {rangeLabel} selected in <span className="font-mono text-foreground/80">{filePath}</span>
      </span>
      <Button
        size="sm"
        className="h-7 text-xs"
        onClick={() => onCreateFinding(selection, filePath)}
      >
        <MessageSquarePlus className="mr-1 size-3" />
        Add Finding
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
