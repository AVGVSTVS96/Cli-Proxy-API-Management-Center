import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CodeViewItem } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { Button } from '@/components/ui/Button';
import { send, useDeck } from '../api';
import { patchDiffs, useCodeOptions } from '../code/pierre';
import { Empty } from '../components';
import { ask, notify, useAction } from '../actions';
import { fmt } from '../format';
import type { Changes as ChangeSet, RepoSummary, Workspace, WorkspaceDiff } from '../types';
import { PathTree } from './PathTree';
import { filesUrl, wsApi, wsTags } from './urls';

/** Everything a workspace changed, as one scrolling review with the commit and ship controls on top. */
export function Changes({ ws, repo }: { ws: Workspace; repo: RepoSummary }) {
  const changes = useDeck<ChangeSet>(wsApi(ws.id, '/changes'), ...wsTags(ws));
  const diff = useDeck<WorkspaceDiff>(wsApi(ws.id, '/diff'), ...wsTags(ws));
  const options = useCodeOptions();
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [focused, setFocused] = useState('');
  const revision = useRef(0);

  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (!diff.data) return [];
    const version = ++revision.current;

    return patchDiffs(diff.data.patch, `${ws.id}:${version}`).map((fileDiff) => ({
      id: fileDiff.name,
      type: 'diff',
      fileDiff,
      version,
    }));
  }, [diff.data, ws.id]);

  const files = changes.data?.files ?? null;
  const paths = useMemo(() => files?.map((f) => f.path) ?? null, [files]);
  const status = useMemo<GitStatusEntry[]>(
    () => files?.map((f) => ({ path: f.path, status: f.status })) ?? [],
    [files]
  );
  const shown = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const pick = (path: string) => {
    setFocused(path);

    if (shown.has(path)) view.current?.scrollTo({ type: 'item', id: path, behavior: 'smooth' });
  };

  if (changes.error) return <Empty>{changes.error}</Empty>;

  return (
    <div className="bench-grid review" data-open="main">
      <aside className="bench-side">
        <PathTree key={ws.id} paths={paths} status={status} selected={focused} onPick={pick} open />
      </aside>
      <div className="bench-main">
        <ShipBar ws={ws} repo={repo} changes={changes.data} />
        {diff.error ? (
          <Empty>{diff.error}</Empty>
        ) : !diff.data || !changes.data ? (
          <Empty>Reading changes…</Empty>
        ) : !changes.data.files.length ? (
          <Empty>
            {ws.name
              ? changes.data.ahead
                ? 'Everything here is committed. Ship it when ready.'
                : 'Nothing changed in this worktree yet.'
              : 'The live checkout has nothing uncommitted.'}
          </Empty>
        ) : (
          <>
            {diff.data.omitted.length > 0 && (
              <Omitted ws={ws} paths={diff.data.omitted} focused={focused} />
            )}
            <CodeView ref={view} className="code" items={items} options={options.view} />
          </>
        )}
      </div>
    </div>
  );
}

function Omitted({ ws, paths, focused }: { ws: Workspace; paths: string[]; focused: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="omitted">
      <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {fmt.int(paths.length)} more {paths.length === 1 ? 'file' : 'files'} not shown here
      </button>
      <span className="muted"> · binary, over 2 MB, or past the 4 MB the review shows at once</span>
      {(open || paths.includes(focused)) && (
        <ul>
          {(open ? paths : [focused]).map((path) => (
            <li key={path}>
              <Link to={filesUrl.browse(ws.id, path)}>{path}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Shipped = { branch: string; commits: number; head?: string; pr?: string };

function ShipBar({ ws, repo, changes }: { ws: Workspace; repo: RepoSummary; changes: ChangeSet | null }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const { busy, run } = useAction();
  const added = changes?.files.reduce((sum, f) => sum + f.added, 0) ?? 0;
  const removed = changes?.files.reduce((sum, f) => sum + f.removed, 0) ?? 0;
  const count = changes?.files.length ?? 0;
  const plural = (n: number, word: string) => `${fmt.int(n)} ${word}${n === 1 ? '' : 's'}`;

  const summary = changes && (
    <span className="summary-line">
      <b>{plural(count, 'file')}</b> {ws.name ? 'changed since branching' : 'uncommitted'}
      {count > 0 && (
        <>
          {' '}
          <span className="plus">+{fmt.int(added)}</span> <span className="minus">−{fmt.int(removed)}</span>
        </>
      )}
    </span>
  );

  const push = () =>
    run('push', async () => {
      await send(`/repos/${repo.id}/push`, 'POST');
      notify(`Pushed ${repo.branch}`);
    });

  if (!ws.name) {
    return (
      <div className="ship-bar">
        <div className="ship-state">
          {summary}
          <span className="muted">
            Live checkout on <b>{ws.branch ?? 'a detached HEAD'}</b>. Running sessions read these files, so
            edits go through a worktree.
          </span>
        </div>
        {!repo.review && (repo.unpushed ?? 0) > 0 && (
          <Button size="sm" variant="secondary" loading={busy === 'push'} onClick={push}>
            Push {plural(repo.unpushed ?? 0, 'commit')} on {repo.branch}
          </Button>
        )}
      </div>
    );
  }

  const commit = () =>
    run('commit', async () => {
      const result = await send<{ sha: string; signed: boolean }>(wsApi(ws.id, '/commit'), 'POST', {
        message,
      });

      setMessage('');
      notify(
        result.signed ? `Committed ${result.sha.slice(0, 7)}, signed` : `Committed ${result.sha.slice(0, 7)}, NOT signed`,
        result.signed ? 'success' : 'error'
      );
    });

  const ship = () =>
    run('ship', async () => {
      const result = await send<Shipped>(wsApi(ws.id, '/ship'), 'POST');
      const commits = plural(result.commits, 'commit');

      notify(result.pr ? `Pull request for ${commits}: ${result.pr}` : `Shipped ${commits} to ${result.branch} (${result.head})`);

      if (result.pr) window.open(result.pr, '_blank', 'noopener');
    });

  const remove = () =>
    run('remove', async () => {
      const unshipped = (changes?.ahead ?? 0) > 0 || changes?.dirty;
      const sure = await ask(
        'Remove this worktree?',
        unshipped
          ? `Its commits stay on branch ${ws.branch}; edits that aren't committed are lost.`
          : `Worktree ${ws.name} has nothing unshipped.`,
        'Remove',
        true
      );

      if (!sure) return;
      const result = await send<{ branchKept: string | null }>(wsApi(ws.id), 'DELETE');

      notify(result.branchKept ? `Removed. Branch ${result.branchKept} kept.` : `Removed worktree ${ws.name}`);
      navigate(filesUrl.changes(repo.id), { replace: true });
    });

  const ahead = changes?.ahead ?? 0;
  const behind = changes?.behind ?? 0;

  return (
    <div className="ship-bar">
      <div className="ship-state">
        {summary}
        <span className="muted">
          <span className="chip">{ws.branch}</span> → <span className="chip">{ws.base}</span>{' '}
          {plural(ahead, 'commit')} to ship
          {behind > 0 && `, ${plural(behind, 'new commit')} on ${ws.base} to rebase onto`}
        </span>
      </div>
      <form
        className="commit-form"
        onSubmit={(e) => {
          e.preventDefault();
          void commit();
        }}
      >
        <textarea
          aria-label="Commit message"
          placeholder={changes?.dirty ? 'Commit message' : 'Nothing to commit'}
          value={message}
          rows={1}
          disabled={!changes?.dirty}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit();
          }}
        />
        <Button size="sm" type="submit" loading={busy === 'commit'} disabled={!changes?.dirty || !message.trim()}>
          Commit, signed
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          loading={busy === 'ship'}
          disabled={!changes || changes.dirty || ahead === 0}
          title={changes?.dirty ? 'Commit first' : undefined}
          onClick={ship}
        >
          {repo.review ? `Open a PR into ${ws.base}` : `Ship to ${ws.base}`}
        </Button>
        <Button size="sm" variant="ghost" type="button" loading={busy === 'remove'} onClick={remove}>
          Remove worktree
        </Button>
      </form>
    </div>
  );
}
