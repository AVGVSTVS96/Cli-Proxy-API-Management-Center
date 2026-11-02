import { useMemo } from 'react';
import {
  getFiletypeFromFileName,
  parsePatchFiles,
  type FileContents,
  type FileDiffMetadata,
  type SupportedLanguages,
} from '@pierre/diffs';
import { Editor, type EditorFactory } from '@pierre/diffs/edit';
import type { CodeViewReactOptions, FileDiffOptions, FileOptions } from '@pierre/diffs/react';
import { useThemeStore } from '@/stores';
import { bundledLanguages } from './shikiLangs';

const ALIASES: Record<string, string> = {
  yml: 'yaml',
  makefile: 'make',
  sh: 'shellscript',
  bash: 'shellscript',
};

const bundled = new Set<string>(Object.keys(bundledLanguages));

/** The grammar a file name highlights with, or plain text when the dashboard doesn't bundle it. */
export function langOf(name: string): SupportedLanguages {
  const lang = getFiletypeFromFileName(name);
  const canonical = ALIASES[lang] ?? lang;

  // SAFETY: every bundled name is a Shiki language id, and 'text' always is.
  return (bundled.has(canonical) ? canonical : 'text') as SupportedLanguages;
}

export const codeFile = (name: string, contents: string, cacheKey?: string): FileContents => ({
  name,
  contents,
  lang: langOf(name),
  cacheKey,
});

/** Diffs parsed from a git patch, each with a grammar the dashboard bundles. */
export function patchDiffs(patch: string, cacheKey: string): FileDiffMetadata[] {
  return parsePatchFiles(patch, cacheKey).flatMap((parsed) =>
    parsed.files.map((file) => ({ ...file, lang: langOf(file.name) }))
  );
}

export const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key);

const THEMES = { light: 'pierre-light', dark: 'pierre-dark' } as const;

/** Code options that follow the dashboard's theme rather than the system's. */
export function useCodeOptions() {
  const themeType = useThemeStore((state) => state.resolvedTheme);

  return useMemo(() => {
    const shared = { theme: THEMES, themeType, overflow: 'wrap', preferredHighlighter: 'shiki-js' } as const;
    const file: FileOptions<undefined, undefined> = { ...shared, disableFileHeader: true };
    const diff: FileDiffOptions<undefined, undefined> = {
      ...shared,
      disableFileHeader: true,
      diffStyle: 'unified',
      lineDiffType: 'word',
    };
    const view: CodeViewReactOptions<undefined, undefined> = {
      ...shared,
      diffStyle: 'unified',
      lineDiffType: 'word',
      stickyHeaders: true,
      hunkSeparators: 'line-info',
    };

    return { file, diff, view };
  }, [themeType]);
}
