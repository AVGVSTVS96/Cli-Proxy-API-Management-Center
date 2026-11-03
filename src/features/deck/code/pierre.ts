import { useMemo, useState } from 'react';
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

const INTERPRETERS: [RegExp, SupportedLanguages][] = [
  [/\b(bun|node|deno|tsx|ts-node)\b/, 'typescript'],
  [/\bpython[0-9.]*\b/, 'python'],
  [/\bzsh\b/, 'zsh'],
  [/\bfish\b/, 'fish'],
  [/\b(ba|da|k)?sh\b/, 'shellscript'],
  [/\blua\b/, 'lua'],
];

/** A script without an extension reads its grammar off the #! line, as bin/ scripts are written. */
function langOfScript(name: string, contents: string): SupportedLanguages {
  const lang = langOf(name);

  if (lang !== 'text' || !contents.startsWith('#!')) return lang;
  const shebang = contents.split('\n', 1)[0];

  return INTERPRETERS.find(([re]) => re.test(shebang))?.[1] ?? 'text';
}

export const codeFile = (name: string, contents: string, cacheKey?: string): FileContents => ({
  name,
  contents,
  lang: langOfScript(name, contents),
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

export type DiffStyle = 'unified' | 'split';

const STYLE_KEY = 'files.diffStyle';

/** Unified or split diffs, remembered across visits. */
export function useDiffStyle() {
  const [style, setStyle] = useState<DiffStyle>(() => (localStorage.getItem(STYLE_KEY) === 'split' ? 'split' : 'unified'));

  const choose = (next: DiffStyle) => {
    localStorage.setItem(STYLE_KEY, next);
    setStyle(next);
  };

  return [style, choose] as const;
}

/** Code options that follow the dashboard's theme rather than the system's. */
export function useCodeOptions(diffStyle: DiffStyle = 'unified') {
  const themeType = useThemeStore((state) => state.resolvedTheme);

  return useMemo(() => {
    const shared = {
      theme: THEMES,
      themeType,
      overflow: diffStyle === 'split' ? 'scroll' : 'wrap',
      preferredHighlighter: 'shiki-js',
      lineHoverHighlight: 'both',
    } as const;
    const file: FileOptions<undefined, undefined> = { ...shared, overflow: 'wrap', disableFileHeader: true };
    const diff: FileDiffOptions<undefined, undefined> = {
      ...shared,
      disableFileHeader: true,
      diffStyle,
      lineDiffType: 'word',
    };
    const view: CodeViewReactOptions<undefined, undefined> = {
      ...shared,
      diffStyle,
      lineDiffType: 'word',
      stickyHeaders: true,
      hunkSeparators: 'line-info',
    };

    return { file, diff, view };
  }, [themeType, diffStyle]);
}
