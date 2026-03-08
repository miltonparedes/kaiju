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
 * Extract the file path from a diff header line.
 * Uses the b/ path (new file), falling back to a/ for deletions.
 */
function extractFilePath(diffSection: string): string {
  const firstLine = diffSection.split('\n')[0] ?? '';
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

  return patch
    .split(/(?=^diff --git )/m)
    .filter((part) => part.trim().startsWith('diff --git '))
    .map((part) => {
      const trimmed = part.trim();
      return { filePath: extractFilePath(trimmed), patch: trimmed };
    });
}
