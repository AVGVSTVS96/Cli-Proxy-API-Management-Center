import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CodeViewItem, FileDiffContentsLoader } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { Button } from '@/components/ui/Button';
import { api, send, useDeck } from '../api';
import { codeFile, patchDiffs, useCodeOptions, useDiffStyle } from '../code/pierre';
import { Empty, Seg } from '../components';
import { ask, notify, useAction } from '../actions';
import { fmt } from '../format';
import type { Change, Changes as ChangeSet, FileBody, RepoSummary, Workspace, WorkspaceDiff } from '../types';
import { PathTree } from './PathTree';
import { fileApi, filesUrl, wsApi, wsTags } from './urls';

/** Past this many new files, they fold into a summary and open one at a time from the tree. */
const UNTRACKED_SHOWN = 24;

const plural = (n: number, word: string) => `${fmt.int(n)} ${word}${n === 1 ? '' : 's'}`;

/** Where new files pile up: their top folders, biggest first. */
function piles(files: Change[]) {
  const counts = new Map<string, number>();

  for (const f of files) {
    const slash = f.path.indexOf('/');
    const top = slash < 0 ? '(top level)' : `${f.path.slice(0, slash)}/`;

    counts.set(top, (counts.get(top) ?? 0) + 1);
  }

  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** A worktree's edits as one review: edits first, new files after, with commit and ship on top. */
export function Changes({ ws, repo }: { ws: Workspace; repo: RepoSummary }) {
  const changes = useDeck<ChangeSet>(wsApi(ws.id, '/changes'), ...wsTags(ws));
  const diff = useDeck<WorkspaceDiff>(wsApi(ws.id, '/diff'), ...wsTags(ws));
  const [style, setStyle] = useDiffStyle();
  const code = useCodeOptions(style);
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [focused, setFocused] = useState('');

  // Both sides of a file in full, so the folded unchanged lines between hunks open on a click.
  const options = useMemo(() => {
    const loadDiffFiles: FileDiffContentsLoader = async (fileDiff) => {
      const body = await api<FileBody>(fileApi(ws.id, fileDiff.name));
      const newFile = codeFile(fileDiff.name, body.contents ?? '', `${ws.id}:${fileDiff.name}:full`);

      return { oldFile: codeFile(fileDiff.name, body.original ?? '', `${ws.id}:${fileDiff.name}:base`), newFile };
    };

    return { ...code, view: { ...code.view, loadDiffFiles } };
  }, [code, ws.id]);
  const [opened, setOpened] = useState<string[]>([]);
  const revision = useRef(0);

  const files = changes.data?.files ?? null;
  const edited = useMemo(() => files?.filter((f) => f.status !== 'untracked') ?? [], [files]);
  const fresh = useMemo(() => files?.filter((f) => f.status === 'untracked') ?? [], [files]);
  const folded = fresh.length > UNTRACKED_SHOWN;
  const byPath = useMemo(() => new Map(files?.map((f) => [f.path, f]) ?? []), [files]);

  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (!diff.data) return [];
    const version = ++revision.current;
    const all = patchDiffs(diff.data.patch, `${ws.id}:${version}`);
    const isNew = (name: string) => byPath.get(name)?.status === 'untracked';
    const shown = all.filter((d) => !isNew(d.name) || !folded || opened.includes(d.name));

    return shown
      .sort((a, b) => Number(isNew(a.name)) - Number(isNew(b.name)))
      .map((fileDiff) => ({ id: fileDiff.name, type: 'diff', fileDiff, version }));
  }, [diff.data, ws.id, byPath, folded, opened]);

  const paths = useMemo(() => files?.map((f) => f.path) ?? null, [files]);
  const status = useMemo<GitStatusEntry[]>(() => files?.map((f) => ({ path: f.path, status: f.status })) ?? [], [files]);
  const openFolders = useMemo(() => (edited.length ? edited.map((f) => f.path) : fresh.length <= 300 ? fresh.map((f) => f.path) : []), [edited, fresh]);
  const decorate = useCallback(
    (path: string) => {
      const f = byPath.get(path);

      if (!f || (!f.added && !f.removed)) return null;

      return {
        text: `+${f.added} −${f.removed}`,
        parts: [
          { text: `+${fmt.tokens(f.added)}`, color: 'var(--ws-add)' },
          ...(f.removed ? [{ text: `\u2002−${fmt.tokens(f.removed)}`, color: 'var(--ws-del)' }] : []),
        ],
      };
    },
    [byPath]
  );

  const pick = (path: string) => {
    setFocused(path);

    if (folded && byPath.get(path)?.status === 'untracked' && !opened.includes(path)) setOpened([...opened, path]);

    requestAnimationFrame(() => view.current?.scrollTo({ type: 'item', id: path, behavior: 'smooth' }));
  };

  if (changes.error) return <Empty>{changes.error}</Empty>;

  const omitted = new Set(diff.data?.omitted ?? []);
  const missing = folded ? [...omitted].filter((p) => byPath.get(p)?.status !== 'untracked') : [...omitted];

  return (
    <div className="bench-grid review" data-open="main">
      <aside className="bench-side">
        <PathTree key={ws.id} paths={paths} status={status} selected={focused} onPick={pick} open={openFolders} decorate={decorate} />
      </aside>
      <div className="bench-main">
        <ShipBar ws={ws} repo={repo} changes={changes.data} edited={edited} fresh={fresh}>
          {items.length > 0 && (
            <Seg
              label="Diff layout"
              value={style}
              options={[
                ['unified', 'Unified'],
                ['split', 'Split'],
              ]}
              onChange={setStyle}
            />
          )}
        </ShipBar>
        {diff.error ? (
          <Empty>{diff.error}</Empty>
        ) : !diff.data || !changes.data ? (
          <Empty>Reading changes…</Empty>
        ) : !changes.data.files.length ? (
          <Empty>
            {ws.name
              ? changes.data.ahead
                ? `Everything here is committed: ${plural(changes.data.ahead, 'commit')} ready to ship.`
                : 'Nothing changed in this worktree yet.'
              : 'Nothing uncommitted in the live checkout.'}
          </Empty>
        ) : (
          <div className="review-body">
            {folded && (
              <div className="fold-note">
                <b>{plural(fresh.length, 'new file')}</b> git doesn't track yet, folded so the edits stay readable:{' '}
                {piles(fresh)
                  .slice(0, 4)
                  .map(([top, n]) => `${top} ${fmt.int(n)}`)
                  .join(', ')}
                . Pick one in the tree to read it here.
              </div>
            )}
            {missing.length > 0 && <Omitted ws={ws} paths={missing} focused={focused} />}
            {items.length ? (
              <CodeView ref={view} className="code" items={items} options={options.view} />
            ) : (
              <Empty>No edits to tracked files. {folded ? 'Pick a new file in the tree to read it.' : ''}</Empty>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Omitted({ ws, paths, focused }: { ws: Workspace; paths: string[]; focused: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fold-note">
      <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {plural(paths.length, 'file')} not shown
      </button>
      <span className="muted">: binary, over 2 MB, or past the 4 MB a review shows at once. Open one to read it.</span>
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

function ShipBar({
  ws,
  repo,
  changes,
  edited,
  fresh,
  children,
}: {
  ws: Workspace;
  repo: RepoSummary;
  changes: ChangeSet | null;
  edited: Change[];
  fresh: Change[];
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const { busy, run } = useAction();
  const added = edited.reduce((sum, f) => sum + f.added, 0);
  const removed = edited.reduce((sum, f) => sum + f.removed, 0);
  const ahead = changes?.ahead ?? 0;
  const behind = changes?.behind ?? 0;

  const summary = changes && (
    <p className="summary-line">
      {edited.length > 0 && (
        <>
          <b>{plural(edited.length, 'file')} edited</b>{' '}
          <span className="plus">+{fmt.int(added)}</span>
          {removed > 0 && <span className="minus"> −{fmt.int(removed)}</span>}
        </>
      )}
      {edited.length > 0 && fresh.length > 0 && <span className="sep"> · </span>}
      {fresh.length > 0 && <span>{plural(fresh.length, 'new file')}</span>}
      {!edited.length && !fresh.length && <span>No changes</span>}
    </p>
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
          <p className="muted small">
            Live checkout on <b>{ws.branch ?? 'a detached HEAD'}</b>, read-only here since running sessions read it.
          </p>
        </div>
        <div className="ship-actions">
          {children}
          {!repo.review && (repo.unpushed ?? 0) > 0 && (
            <Button size="sm" variant="secondary" loading={busy === 'push'} onClick={push}>
              Push {plural(repo.unpushed ?? 0, 'commit')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const commit = () =>
    run('commit', async () => {
      const result = await send<{ sha: string; signed: boolean }>(wsApi(ws.id, '/commit'), 'POST', { message });

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
      const unshipped = ahead > 0 || changes?.dirty;
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

  return (
    <div className="ship-bar worktree">
      <div className="ship-state">
        {summary}
        <p className="muted small">
          <span className="branch">{ws.branch}</span> → <span className="branch">{ws.base}</span> · {plural(ahead, 'commit')} to ship
          {behind > 0 && ` · ${plural(behind, 'newer commit')} on ${ws.base}, rebased on ship`}
        </p>
      </div>
      <div className="ship-actions">
        {children}
        <Button size="sm" variant="ghost" type="button" loading={busy === 'remove'} onClick={remove}>
          Remove
        </Button>
        <Button
          size="sm"
          variant={changes?.dirty ? 'secondary' : 'primary'}
          type="button"
          loading={busy === 'ship'}
          disabled={!changes || changes.dirty || ahead === 0}
          title={changes?.dirty ? 'Commit first' : undefined}
          onClick={ship}
        >
          {repo.review ? `Open a PR into ${ws.base}` : `Ship to ${ws.base}`}
        </Button>
      </div>
      {changes?.dirty && (
        <form
          className="commit-form"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <input
            aria-label="Commit message"
            placeholder="Commit message, like fix(rules): say when to ask"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button size="sm" type="submit" loading={busy === 'commit'} disabled={!message.trim()}>
            Commit, signed
          </Button>
        </form>
      )}
    </div>
  );
}
