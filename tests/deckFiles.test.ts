import { describe, expect, test } from 'bun:test';
import { filesUrl, nameFor, parseFilesRoute } from '@/features/deck/files/urls';

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
