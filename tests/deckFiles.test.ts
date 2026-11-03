import { describe, expect, test } from 'bun:test';
import { codeFile } from '@/features/deck/code/pierre';
import { filesUrl, nameFor, parseFilesRoute, resolveLink } from '@/features/deck/files/urls';

const parse = (url: string) => parseFilesRoute(url.replace(/^\/files\/?/, ''));

describe('Files routes', () => {
  test('round-trip every view, with paths that need encoding', () => {
    expect(parse(filesUrl.browse('hex'))).toEqual({ view: 'browse', ws: 'hex', file: '' });
    expect(parse(filesUrl.browse('hex~agents-md', 'a dir/AGENTS.md'))).toEqual({
      view: 'browse',
      ws: 'hex~agents-md',
      file: 'a dir/AGENTS.md',
    });
    expect(parse(filesUrl.changes('core'))).toEqual({ view: 'changes', ws: 'core' });
    expect(parse(filesUrl.history('core', 'abc123'))).toEqual({ view: 'history', ws: 'core', sha: 'abc123' });
    expect(parse(filesUrl.history('core'))).toEqual({ view: 'history', ws: 'core', sha: '' });
    expect(parse(filesUrl.drafts('HEX.md'))).toEqual({ view: 'drafts', name: 'HEX.md' });
    expect(parse('/files')).toEqual({ view: 'none' });
  });

  test('worktree names come from the file name', () => {
    expect(nameFor('claude/.claude/CLAUDE.md')).toBe('claude-md');
    expect(nameFor('AGENTS.md')).toBe('agents-md');
  });
});

describe('Markdown links', () => {
  test('relative links resolve inside the repo, from the linking file', () => {

    expect(resolveLink('instructions/prompting.md', 'architecture.md')).toBe('instructions/architecture.md');
    expect(resolveLink('instructions/prompting.md', '../AGENTS.md#rules')).toBe('AGENTS.md');
    expect(resolveLink('a/b.md', '/SOUL.md')).toBe('SOUL.md');
    expect(resolveLink('a/b.md', './my%20notes.md?raw')).toBe('a/my notes.md');
  });

  test('links that leave the repo stay ordinary links', () => {

    expect(resolveLink('AGENTS.md', 'https://example.com')).toBeNull();
    expect(resolveLink('AGENTS.md', 'mailto:x@example.com')).toBeNull();
    expect(resolveLink('AGENTS.md', '#working')).toBeNull();
    expect(resolveLink('AGENTS.md', '../outside.md')).toBeNull();
  });
});

test('history can follow one file', () => {
  expect(filesUrl.history('hex', '', 'memory/LOG.txt')).toBe('/files/hex/history?path=memory%2FLOG.txt');
  expect(parse(filesUrl.history('hex', 'abc123', 'a.md').split('?')[0])).toEqual({ view: 'history', ws: 'hex', sha: 'abc123' });
});

describe('Code grammars', () => {
  test('a script without an extension reads its grammar off the #! line', () => {
    expect(codeFile('bin/job', '#!/usr/bin/env bun\nconst a = 1;\n').lang).toBe('typescript');
    expect(codeFile('bin/backup', '#!/usr/bin/env bash\nset -e\n').lang).toBe('shellscript');
    expect(codeFile('bin/guard', '#!/usr/bin/env python3\n').lang).toBe('python');
    expect(codeFile('bin/notes', 'no shebang here').lang).toBe('text');
    expect(codeFile('a.ts', '#!/bin/sh\n').lang).toBe('typescript');
  });
});
