/**
 * Hook for syntax highlighting code snippets using shiki.
 * Used for rendering code suggestions in finding annotations.
 */

import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';

/** Map common file extensions to shiki language identifiers. */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  xml: 'xml',
  php: 'php',
  lua: 'lua',
  zig: 'zig',
};

/**
 * Detect the shiki language identifier from a file path's extension.
 * Returns 'text' if the extension is unknown.
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  // Handle files like Dockerfile, Makefile
  const basename = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (basename === 'dockerfile') {
    return 'dockerfile';
  }
  if (basename === 'makefile') {
    return 'makefile';
  }
  return EXT_TO_LANG[ext] ?? 'text';
}

/**
 * React hook that highlights a code string using shiki.
 * Returns the highlighted HTML string (or null while loading).
 *
 * Uses the 'vitesse-dark' theme which works well on dark backgrounds.
 */
export function useCodeHighlight(code: string, lang: string): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Skip highlighting for plain text
    if (lang === 'text' || !code.trim()) {
      setHtml(null);
      return;
    }

    codeToHtml(code, {
      lang,
      theme: 'github-dark',
    })
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
        }
      })
      .catch(() => {
        // If language isn't supported, fall back to no highlighting
        if (!cancelled) {
          setHtml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return html;
}
