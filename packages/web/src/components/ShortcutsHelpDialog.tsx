'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';

// ─── Shortcut data ────────────────────────────────────────────────────────────

const SHORTCUTS = [
  { key: 'j / k', description: 'Navigate between chunks' },
  { key: 'n / p', description: 'Next / previous finding' },
  { key: 'd', description: 'Toggle split / unified diff' },
  { key: 'm', description: 'Mark chunk as reviewed' },
  { key: '1 / 2 / 3', description: 'Focus left / center / right panel' },
  { key: '?', description: 'Show this help' },
  { key: 'Esc', description: 'Close dialog' },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShortcutsHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShortcutsHelpDialog({ open, onOpenChange }: ShortcutsHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-border bg-card" data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle className="text-foreground">Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Available shortcuts in the PR review view.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.key} className="flex items-center justify-between gap-4">
              <kbd className="inline-flex min-w-[72px] items-center justify-center rounded border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {shortcut.key}
              </kbd>
              <span className="flex-1 text-sm text-muted-foreground">{shortcut.description}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
