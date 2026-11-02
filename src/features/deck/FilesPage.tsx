import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { send, useConnected, useDeck } from './api';
import { Empty } from './components';
import { notify, useAction } from './actions';
import { Browse } from './files/Browse';
import { Changes } from './files/Changes';
import { Drafts } from './files/Drafts';
import { History } from './files/History';
import { DRAFTS, filesUrl, nameFor, parseFilesRoute, wsApi, wsTags } from './files/urls';
import type { Changes as ChangeSet, Draft, RepoSummary, Workspace } from './types';
import './deck.scss';
import './workspace.scss';

/** hex's repos: browse the live files, edit in worktrees, review, commit and ship; and drafts. */
export function FilesPage() {
  const route = parseFilesRoute(useParams()['*'] ?? '');
  const repos = useDeck<RepoSummary[]>('/repos', 'repo:', 'ws:');
  const drafts = useDeck<Draft[]>('/drafts', 'drafts');
  const connected = useConnected();

  if (repos.error) return <Shell connected={connected}><Empty>{repos.error}</Empty></Shell>;

  if (!repos.data) return <Shell connected={connected}><Empty>Reading repos…</Empty></Shell>;

  if (route.view === 'none') {
    const first = repos.data[0];

    if (!first) return <Shell connected={connected}><Empty>No repos are set up. Add them under workspace.repos in the proxy's config.</Empty></Shell>;

    return <Navigate to={filesUrl.browse(first.id)} replace />;
  }

  const draftList = drafts.data ?? [];

  if (route.view === 'drafts') {
    return (
      <Shell connected={connected} repos={repos.data} drafts={draftList} current={DRAFTS}>
        <section className="bench">
          <Drafts drafts={draftList} name={route.name} repos={repos.data} />
        </section>
      </Shell>
    );
  }

  const ws = repos.data.flatMap((r) => r.workspaces).find((w) => w.id === route.ws) ?? null;
  const repo = repos.data.find((r) => r.id === (ws?.repo ?? route.ws.split('~')[0])) ?? null;

  if (!ws || !repo) {
    return (
      <Shell connected={connected} repos={repos.data} drafts={draftList} current={repo?.id ?? ''}>
        <Empty>
          No workspace {route.ws}; it may have been shipped and removed.{' '}
          {repo && <Link to={filesUrl.browse(repo.id)}>Open {repo.name}</Link>}
        </Empty>
      </Shell>
    );
  }

  return (
    <Shell connected={connected} repos={repos.data} drafts={draftList} current={repo.id}>
      <Checkouts repo={repo} ws={ws} view={route.view} file={route.view === 'browse' ? route.file : ''} />
      <section className="bench">
        {route.view === 'browse' && <Browse ws={ws} file={route.file} />}
        {route.view === 'changes' && <Changes key={ws.id} ws={ws} repo={repo} />}
        {route.view === 'history' && <History key={ws.id} ws={ws} sha={route.sha} />}
      </section>
    </Shell>
  );
}

function Shell({
  connected,
  repos = [],
  drafts = [],
  current = '',
  children,
}: {
  connected: boolean;
  repos?: RepoSummary[];
  drafts?: Draft[];
  current?: string;
  children: React.ReactNode;
}) {
  const repo = repos.find((r) => r.id === current);

  return (
    <div className="deck workspace files">
      <header className="head">
        <div>
          <h1>Files</h1>
          <p className="lede">
            {current === DRAFTS ? `${drafts.length} drafts` : repo ? `${repo.name} · ${repo.about || repo.path}` : 'hex'}
          </p>
        </div>
        <span className="live-state">
          <span className={connected ? 'dot live' : 'dot idle'} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </header>
      {repos.length > 0 && (
        <nav className="repo-tabs" aria-label="Repos">
          {repos.map((r) => (
            <Link key={r.id} to={filesUrl.browse(r.id)} aria-current={r.id === current ? 'page' : undefined}>
              {r.name}
              {r.workspaces.length > 1 && <span className="count">{r.workspaces.length - 1}</span>}
            </Link>
          ))}
          {drafts.length > 0 && (
            <Link to={filesUrl.drafts()} aria-current={current === DRAFTS ? 'page' : undefined}>
              drafts<span className="count">{drafts.length}</span>
            </Link>
          )}
        </nav>
      )}
      {children}
    </div>
  );
}

/** The live checkout and its worktrees, what the open one has pending, and its three views. */
function Checkouts({
  repo,
  ws,
  view,
  file,
}: {
  repo: RepoSummary;
  ws: Workspace;
  view: 'browse' | 'changes' | 'history';
  file: string;
}) {
  const navigate = useNavigate();
  const changes = useDeck<ChangeSet>(wsApi(ws.id, '/changes'), ...wsTags(ws));
  const [naming, setNaming] = useState<string | null>(null);
  const { busy, run } = useAction();
  const pending = changes.data?.files.length ?? 0;
  const ahead = changes.data?.ahead ?? 0;
  const target = (id: string) =>
    view === 'changes' ? filesUrl.changes(id) : view === 'history' ? filesUrl.history(id) : filesUrl.browse(id, file);

  const create = (name: string) =>
    run('new', async () => {
      const { id } = await send<{ id: string }>(`/repos/${repo.id}/workspaces`, 'POST', { name });

      setNaming(null);
      notify(`Opened worktree ${id.split('~')[1]} from ${repo.branch ?? 'HEAD'}`);
      navigate(filesUrl.browse(id, file));
    });

  return (
    <div className="checkouts">
      <nav className="ws-list" aria-label="Checkouts">
        {repo.workspaces.map((w) => (
          <Link key={w.id} to={target(w.id)} aria-current={w.id === ws.id ? 'page' : undefined}>
            <span className={w.name ? 'mark wt' : 'mark live'} aria-hidden />
            {w.name ?? `live · ${w.branch ?? 'detached'}`}
          </Link>
        ))}
        {naming === null ? (
          <button type="button" className="ws-add" onClick={() => setNaming(file ? nameFor(file) : 'edit')}>
            + Worktree
          </button>
        ) : (
          <form
            className="ws-new"
            onSubmit={(e) => {
              e.preventDefault();

              if (naming.trim()) void create(naming.trim());
            }}
          >
            <input
              autoFocus
              aria-label="Worktree name"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
            />
            <Button size="sm" type="submit" loading={busy === 'new'}>
              Open
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setNaming(null)}>
              Cancel
            </Button>
          </form>
        )}
      </nav>
      <nav className="seg views" aria-label="View">
        <Link to={filesUrl.browse(ws.id, file)} aria-current={view === 'browse' ? 'page' : undefined}>
          Files
        </Link>
        <Link to={filesUrl.changes(ws.id)} aria-current={view === 'changes' ? 'page' : undefined}>
          Changes
          {pending > 0 && <span className="count">{pending}</span>}
          {ahead > 0 && <span className="count ahead" title="Commits to ship">↑{ahead}</span>}
        </Link>
        <Link to={filesUrl.history(ws.id)} aria-current={view === 'history' ? 'page' : undefined}>
          History
        </Link>
      </nav>
    </div>
  );
}
