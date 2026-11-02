import { describe, expect, test } from 'bun:test';
import { langOf, patchDiffs } from '@/features/deck/code/pierre';

describe('code highlighting', () => {
  test('bundled grammars by name, aliases folded, the rest plain text', () => {
    expect(langOf('src/a.ts')).toBe('typescript');
    expect(langOf('notes.md')).toBe('markdown');
    expect(langOf('ci.yml')).toBe('yaml');
    expect(langOf('Makefile')).toBe('make');
    expect(langOf('main.swift')).toBe('text');
    expect(langOf('.gitignore')).toBe('text');
  });

  test('a git patch with a modified and a new file parses into two diffs', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      'index 1111111..2222222 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-const a = 1;',
      '+const a = 2;',
      'diff --git a/new.md b/new.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.md',
      '@@ -0,0 +1,2 @@',
      '+# New',
      '+text',
      '',
    ].join('\n');
    const diffs = patchDiffs(patch, 'test');

    expect(diffs.map((d) => [d.name, d.type, d.lang])).toEqual([
      ['a.ts', 'change', 'typescript'],
      ['new.md', 'new', 'markdown'],
    ]);
  });
});
