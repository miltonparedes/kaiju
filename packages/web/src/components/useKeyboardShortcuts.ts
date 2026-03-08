import { useCallback, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeyboardShortcutsOptions {
  /** Total number of chunks available. */
  chunkCount: number;
  /** Currently focused chunk index (0-based). */
  activeChunkIndex: number;
  /** Callback when chunk index changes via j/k. */
  onChunkChange: (index: number) => void;

  /** Total number of findings available. */
  findingCount: number;
  /** Currently focused finding index (0-based, -1 for none). */
  activeFindingIndex: number;
  /** Callback when finding index changes via n/p. */
  onFindingChange: (index: number) => void;

  /** Callback to toggle split/unified diff style. */
  onToggleDiffStyle: () => void;

  /** Callback when m is pressed to mark current chunk as reviewed. */
  onMarkReviewed: () => void;

  /** Callback when ? is pressed to show shortcuts help. */
  onShowHelp: () => void;

  /** Callback when 1/2/3 is pressed to focus a panel. */
  onFocusPanel: (panel: 1 | 2 | 3) => void;

  /** Whether shortcuts are enabled (disabled when dialogs/inputs are focused). */
  enabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the event target is an input, textarea, or contenteditable. */
function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }
  const tagName = target.tagName?.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return false;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook that registers keyboard shortcuts for the PR view.
 *
 * Shortcuts:
 * - j/k: navigate chunks
 * - n/p: navigate findings
 * - d: toggle split/unified
 * - m: mark chunk reviewed
 * - ?: show shortcuts help
 * - 1/2/3: focus panels
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const {
    chunkCount,
    activeChunkIndex,
    onChunkChange,
    findingCount,
    activeFindingIndex,
    onFindingChange,
    onToggleDiffStyle,
    onMarkReviewed,
    onShowHelp,
    onFocusPanel,
    enabled = true,
  } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) {
        return;
      }

      // Don't intercept when typing in inputs
      if (isEditableTarget(event)) {
        return;
      }

      // Don't intercept modified keys (Ctrl, Alt, Meta) except for ?
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      switch (event.key) {
        case 'j': {
          // Next chunk
          if (chunkCount > 0) {
            const next = Math.min(activeChunkIndex + 1, chunkCount - 1);
            onChunkChange(next);
          }
          event.preventDefault();
          break;
        }
        case 'k': {
          // Previous chunk
          if (chunkCount > 0) {
            const prev = Math.max(activeChunkIndex - 1, 0);
            onChunkChange(prev);
          }
          event.preventDefault();
          break;
        }
        case 'n': {
          // Next finding
          if (findingCount > 0) {
            const next = Math.min(activeFindingIndex + 1, findingCount - 1);
            onFindingChange(next);
          }
          event.preventDefault();
          break;
        }
        case 'p': {
          // Previous finding
          if (findingCount > 0) {
            const prev = Math.max(activeFindingIndex - 1, 0);
            onFindingChange(prev);
          }
          event.preventDefault();
          break;
        }
        case 'd': {
          onToggleDiffStyle();
          event.preventDefault();
          break;
        }
        case 'm': {
          onMarkReviewed();
          event.preventDefault();
          break;
        }
        case '?': {
          onShowHelp();
          event.preventDefault();
          break;
        }
        case '1': {
          onFocusPanel(1);
          event.preventDefault();
          break;
        }
        case '2': {
          onFocusPanel(2);
          event.preventDefault();
          break;
        }
        case '3': {
          onFocusPanel(3);
          event.preventDefault();
          break;
        }
        default:
          break;
      }
    },
    [
      enabled,
      chunkCount,
      activeChunkIndex,
      onChunkChange,
      findingCount,
      activeFindingIndex,
      onFindingChange,
      onToggleDiffStyle,
      onMarkReviewed,
      onShowHelp,
      onFocusPanel,
    ],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
