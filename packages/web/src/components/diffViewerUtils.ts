/**
 * Utilities for the DiffViewer component.
 * Splits multi-file patches into individual per-file patch strings.
 */

/** A single file's patch extracted from a chunk's multi-file unified diff. */
export interface FilePatch {
  /** File path extracted from the diff header (b/ side, or a/ for deletions). */
  filePath: string;
  /** The complete unified diff text for this file, including diff --git header. */
  patch: string;
}

/**
 * Sanitize a file path string into a valid DOM id attribute value.
 * Replaces non-alphanumeric chars with hyphens.
 */
export function filePathToId(filePath: string): string {
  return `diff-file-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

/**
 * Strip surrounding double-quotes and unescape octal/backslash sequences
 * that git uses for non-ASCII or special-character paths.
 * E.g. `"a/caf\303\251.ts"` → `a/café.ts`
 */
export function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  const inner = raw.slice(1, -1);
  // Replace octal escape sequences (\NNN) with their byte values,
  // then decode the resulting bytes as UTF-8.
  const bytes: number[] = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '\\') {
      const next = inner[i + 1];
      if (next !== undefined && next >= '0' && next <= '7') {
        // Octal escape: up to 3 digits
        let octal = '';
        for (let j = 1; j <= 3 && i + j < inner.length; j++) {
          const ch = inner[i + j]!;
          if (ch >= '0' && ch <= '7') {
            octal += ch;
          } else {
            break;
          }
        }
        bytes.push(parseInt(octal, 8));
        i += 1 + octal.length;
        continue;
      }
      // Common backslash escapes
      if (next === 'n') {
        bytes.push(0x0a);
        i += 2;
        continue;
      }
      if (next === 't') {
        bytes.push(0x09);
        i += 2;
        continue;
      }
      if (next === '\\') {
        bytes.push(0x5c);
        i += 2;
        continue;
      }
      if (next === '"') {
        bytes.push(0x22);
        i += 2;
        continue;
      }
    }
    // Regular character — encode as UTF-8 bytes
    const cp = inner.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const encoded = new TextEncoder().encode(ch);
    for (const b of encoded) {
      bytes.push(b);
    }
    i += ch.length;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Extract the file path from a diff header line.
 * Handles both unquoted and quoted (non-ASCII/special chars) git diff headers:
 *   - `diff --git a/path b/path`
 *   - `diff --git "a/path" "b/path"`
 * Uses the b/ path (new file), falling back to a/ for deletions.
 */
function extractFilePath(diffSection: string): string {
  const firstLine = diffSection.split('\n')[0] ?? '';

  // Try quoted format first: diff --git "a/..." "b/..."
  const quotedMatch = firstLine.match(/^diff --git "(a\/.+?)" "(b\/.+?)"$/);
  if (quotedMatch) {
    const bPath = unquoteGitPath(`"${quotedMatch[2]!.slice(2)}"`);
    const aPath = unquoteGitPath(`"${quotedMatch[1]!.slice(2)}"`);
    return bPath || aPath || firstLine;
  }

  // Standard unquoted format: diff --git a/... b/...
  const match = firstLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
  return match ? (match[2] ?? match[1] ?? firstLine) : firstLine.replace('diff --git ', '').trim();
}

/**
 * Split a multi-file unified diff string into individual per-file patch strings.
 *
 * Each file section starts with `diff --git a/... b/...`.
 * We split on that boundary and extract the file path from the header.
 */
export function splitPatchByFile(patch: string): FilePatch[] {
  if (!patch || !patch.trim()) {
    return [];
  }

  // Split on `diff --git` boundaries. Handles both quoted and unquoted forms:
  //   diff --git a/path b/path
  //   diff --git "a/path" "b/path"
  return patch
    .split(/(?=^diff --git )/m)
    .filter((part) => part.trim().startsWith('diff --git '))
    .map((part) => {
      const trimmed = part.trim();
      return { filePath: extractFilePath(trimmed), patch: trimmed };
    });
}
