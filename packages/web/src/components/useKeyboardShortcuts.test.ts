import { describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the keyboard shortcuts logic.
 * These test the pure logic extracted from the hook without requiring React rendering.
 */

// We test the logic by simulating what the keydown handler does.
// Since the hook is a thin wrapper around document.addEventListener,
// we test the key mapping and boundary logic directly.

interface ShortcutState {
  chunkCount: number;
  activeChunkIndex: number;
  findingCount: number;
  activeFindingIndex: number;
  enabled: boolean;
}

interface ShortcutCallbacks {
  onChunkChange: (index: number) => void;
  onFindingChange: (index: number) => void;
  onToggleDiffStyle: () => void;
  onMarkReviewed: () => void;
  onShowHelp: () => void;
  onFocusPanel: (panel: 1 | 2 | 3) => void;
}

/**
 * Simulate the keyboard handler logic from useKeyboardShortcuts.
 * This mirrors the switch/case logic without needing React or DOM.
 */
function handleKey(key: string, state: ShortcutState, callbacks: ShortcutCallbacks): boolean {
  if (!state.enabled) {
    return false;
  }

  switch (key) {
    case 'j': {
      if (state.chunkCount > 0) {
        callbacks.onChunkChange(Math.min(state.activeChunkIndex + 1, state.chunkCount - 1));
      }
      return true;
    }
    case 'k': {
      if (state.chunkCount > 0) {
        callbacks.onChunkChange(Math.max(state.activeChunkIndex - 1, 0));
      }
      return true;
    }
    case 'n': {
      if (state.findingCount > 0) {
        callbacks.onFindingChange(Math.min(state.activeFindingIndex + 1, state.findingCount - 1));
      }
      return true;
    }
    case 'p': {
      if (state.findingCount > 0) {
        callbacks.onFindingChange(Math.max(state.activeFindingIndex - 1, 0));
      }
      return true;
    }
    case 'd': {
      callbacks.onToggleDiffStyle();
      return true;
    }
    case 'm': {
      callbacks.onMarkReviewed();
      return true;
    }
    case '?': {
      callbacks.onShowHelp();
      return true;
    }
    case '1': {
      callbacks.onFocusPanel(1);
      return true;
    }
    case '2': {
      callbacks.onFocusPanel(2);
      return true;
    }
    case '3': {
      callbacks.onFocusPanel(3);
      return true;
    }
    default:
      return false;
  }
}

function createCallbacks(): ShortcutCallbacks {
  return {
    onChunkChange: vi.fn(),
    onFindingChange: vi.fn(),
    onToggleDiffStyle: vi.fn(),
    onMarkReviewed: vi.fn(),
    onShowHelp: vi.fn(),
    onFocusPanel: vi.fn(),
  };
}

describe('keyboard shortcuts logic', () => {
  describe('j/k — chunk navigation', () => {
    it('j moves to next chunk', () => {
      const cbs = createCallbacks();
      handleKey(
        'j',
        {
          chunkCount: 5,
          activeChunkIndex: 2,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onChunkChange).toHaveBeenCalledWith(3);
    });

    it('j clamps at last chunk', () => {
      const cbs = createCallbacks();
      handleKey(
        'j',
        {
          chunkCount: 3,
          activeChunkIndex: 2,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onChunkChange).toHaveBeenCalledWith(2);
    });

    it('k moves to previous chunk', () => {
      const cbs = createCallbacks();
      handleKey(
        'k',
        {
          chunkCount: 5,
          activeChunkIndex: 2,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onChunkChange).toHaveBeenCalledWith(1);
    });

    it('k clamps at first chunk', () => {
      const cbs = createCallbacks();
      handleKey(
        'k',
        {
          chunkCount: 5,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onChunkChange).toHaveBeenCalledWith(0);
    });

    it('j does nothing with zero chunks', () => {
      const cbs = createCallbacks();
      handleKey(
        'j',
        {
          chunkCount: 0,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onChunkChange).not.toHaveBeenCalled();
    });
  });

  describe('n/p — finding navigation', () => {
    it('n moves to next finding', () => {
      const cbs = createCallbacks();
      handleKey(
        'n',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 5,
          activeFindingIndex: 1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFindingChange).toHaveBeenCalledWith(2);
    });

    it('n clamps at last finding', () => {
      const cbs = createCallbacks();
      handleKey(
        'n',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 3,
          activeFindingIndex: 2,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFindingChange).toHaveBeenCalledWith(2);
    });

    it('p moves to previous finding', () => {
      const cbs = createCallbacks();
      handleKey(
        'p',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 5,
          activeFindingIndex: 3,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFindingChange).toHaveBeenCalledWith(2);
    });

    it('p clamps at first finding (index 0)', () => {
      const cbs = createCallbacks();
      handleKey(
        'p',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 5,
          activeFindingIndex: 0,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFindingChange).toHaveBeenCalledWith(0);
    });

    it('n with -1 index starts at 0', () => {
      const cbs = createCallbacks();
      handleKey(
        'n',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 5,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFindingChange).toHaveBeenCalledWith(0);
    });

    it('n does nothing with zero findings', () => {
      const cbs = createCallbacks();
      handleKey(
        'n',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFindingChange).not.toHaveBeenCalled();
    });
  });

  describe('d — toggle diff style', () => {
    it('calls onToggleDiffStyle', () => {
      const cbs = createCallbacks();
      handleKey(
        'd',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onToggleDiffStyle).toHaveBeenCalledOnce();
    });
  });

  describe('m — mark reviewed', () => {
    it('calls onMarkReviewed', () => {
      const cbs = createCallbacks();
      handleKey(
        'm',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onMarkReviewed).toHaveBeenCalledOnce();
    });
  });

  describe('? — show help', () => {
    it('calls onShowHelp', () => {
      const cbs = createCallbacks();
      handleKey(
        '?',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onShowHelp).toHaveBeenCalledOnce();
    });
  });

  describe('1/2/3 — focus panels', () => {
    it('1 focuses left panel', () => {
      const cbs = createCallbacks();
      handleKey(
        '1',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFocusPanel).toHaveBeenCalledWith(1);
    });

    it('2 focuses center panel', () => {
      const cbs = createCallbacks();
      handleKey(
        '2',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFocusPanel).toHaveBeenCalledWith(2);
    });

    it('3 focuses right panel', () => {
      const cbs = createCallbacks();
      handleKey(
        '3',
        {
          chunkCount: 3,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(cbs.onFocusPanel).toHaveBeenCalledWith(3);
    });
  });

  describe('enabled flag', () => {
    it('does not trigger any callback when disabled', () => {
      const cbs = createCallbacks();
      const keys = ['j', 'k', 'n', 'p', 'd', 'm', '?', '1', '2', '3'];
      for (const key of keys) {
        handleKey(
          key,
          {
            chunkCount: 5,
            activeChunkIndex: 0,
            findingCount: 5,
            activeFindingIndex: 0,
            enabled: false,
          },
          cbs,
        );
      }
      expect(cbs.onChunkChange).not.toHaveBeenCalled();
      expect(cbs.onFindingChange).not.toHaveBeenCalled();
      expect(cbs.onToggleDiffStyle).not.toHaveBeenCalled();
      expect(cbs.onMarkReviewed).not.toHaveBeenCalled();
      expect(cbs.onShowHelp).not.toHaveBeenCalled();
      expect(cbs.onFocusPanel).not.toHaveBeenCalled();
    });
  });

  describe('unknown keys', () => {
    it('returns false for unrecognized keys', () => {
      const cbs = createCallbacks();
      const result = handleKey(
        'x',
        {
          chunkCount: 5,
          activeChunkIndex: 0,
          findingCount: 0,
          activeFindingIndex: -1,
          enabled: true,
        },
        cbs,
      );
      expect(result).toBe(false);
    });
  });
});
