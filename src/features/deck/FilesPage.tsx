import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { send, useConnected, useDeck } from './api';
import { Empty } from './components';
import { notify, useAction } from './actions';
import { fmt } from './format';
import { Browse } from './files/Browse';
import { Changes } from './files/Changes';
import { Drafts } from './files/Drafts';
import { History } from './files/History';
import { BenchContext, NARROW } from './files/bench';
import { DRAFTS, filesUrl, nameFor, parseFilesRoute, wsApi, wsTags, type FilesRoute } from './files/urls';
import { useWidth } from './useWidth';
import type { Changes as ChangeSet, Draft, RepoSummary, Workspace } from './types';
import './deck.scss';
import './files.scss';

type View = 'browse' | 'changes' | 'history';

const TREE_KEY = 'files.tree';

/** hex's repos: read the live files, edit in worktrees, review, commit and ship; and drafts. */
export function FilesPage() {
  const route = parseFilesRoute(useParams()['*'] ?? '');
  const repos = useDeck<RepoSummary[]>('/repos', 'repo:', 'ws:');
  const drafts = useDeck<Draft[]>('/drafts', 'drafts');
  const draftList = drafts.data ?? [];

  if (repos.error) return <Shell route={route}><Empty>{repos.error}</Empty></Shell>;

  if (!repos.data) return <Shell route={route}><Empty>Reading repos…</Empty></Shell>;

  if (route.view === 'none') {
    const first = repos.data[0];

    if (!first) return <Shell route={route}><Empty>No repos are set up. Add them under workspace.repos in the proxy's config.</Empty></Shell>;

    return <Navigate to={filesUrl.browse(first.id)} replace />;
  }

  if (route.view === 'drafts') {
    return (
      <Shell route={route} repos={repos.data} drafts={draftList} current={DRAFTS}>
        <Drafts drafts={draftList} name={route.name} repos={repos.data} />
      </Shell>
    );
  }

  const ws = repos.data.flatMap((r) => r.workspaces).find((w) => w.id === route.ws) ?? null;
  const repo = repos.data.find((r) => r.id === (ws?.repo ?? route.ws.split('~')[0])) ?? null;

  if (!ws || !repo) {
    return (
      <Shell route={route} repos={repos.data} drafts={draftList} current={repo?.id ?? ''}>
        <Empty>
          No worktree {route.ws}; it may have been shipped and removed.{' '}
          {repo && <Link to={filesUrl.browse(repo.id)}>Open {repo.name}</Link>}
        </Empty>
      </Shell>
    );
  }

  const file = route.view === 'browse' ? route.file : '';

  return (
    <Shell
      route={route}
      repos={repos.data}
      drafts={draftList}
      current={repo.id}
      nav={<Checkout repo={repo} ws={ws} view={route.view} file={file} />}
    >
      {route.view === 'browse' && <Browse ws={ws} repo={repo} file={route.file} />}
      {route.view === 'changes' && <Changes key={ws.id} ws={ws} repo={repo} />}
      {route.view === 'history' && <History key={ws.id} ws={ws} sha={route.sha} />}
    </Shell>
  );
}

/** What's open, as a key: a narrow screen's tree starts open only where nothing is picked yet. */
function picked(route: FilesRoute): [key: string, nothingPicked: boolean] {
  switch (route.view) {
    case 'browse':
      return [`${route.ws}:file:${route.file}`, !route.file];
    case 'history':
      return [`${route.ws}:history:${route.sha}`, !route.sha];
    case 'drafts':
      return [`drafts:${route.name}`, !route.name];
    case 'changes':
      return [`${route.ws}:changes`, false];
    default:
      return ['', false];
  }
}

function Shell({
  route,
  repos = [],
  drafts = [],
  current = '',
  nav,
  children,
}: {
  route: FilesRoute;
  repos?: RepoSummary[];
  drafts?: Draft[];
  current?: string;
  nav?: React.ReactNode;
  children: React.ReactNode;
}) {
  const connected = useConnected();
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width > 0 && width < NARROW;
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [sideShown, setSideShown] = useState(() => localStorage.getItem(TREE_KEY) !== 'hidden');
  const [key, nothingPicked] = picked(route);
  const [drawer, setDrawer] = useState<{ key: string; open: boolean } | null>(null);
  const drawerOpen = drawer?.key === key ? drawer.open : nothingPicked;
  const treeOpen = narrow ? drawerOpen : sideShown;

  const setTree = useCallback(
    (open: boolean) => {
      if (narrow) return setDrawer({ key, open });
      localStorage.setItem(TREE_KEY, open ? 'shown' : 'hidden');
      setSideShown(open);
    },
    [narrow, key]
  );

  useEffect(() => {
    if (!narrow || !drawerOpen) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setTree(false);

    document.addEventListener('keydown', close);

    return () => document.removeEventListener('keydown', close);
  }, [narrow, drawerOpen, setTree]);

  const bench = useMemo(() => ({ slot, narrow, treeOpen, setTree }), [slot, narrow, treeOpen, setTree]);
  const sideLabel = current === DRAFTS ? 'drafts' : route.view === 'history' ? 'commits' : 'files';

  return (
    <div className="deck files" ref={ref}>
      <header className="files-head">
        <h1>Files</h1>
        {repos.length > 0 && (
          <nav className="repo-tabs" aria-label="Repos">
            {repos.map((r) => (
              <Link
                key={r.id}
                to={filesUrl.browse(r.id)}
                title={r.about || r.path}
                aria-current={r.id === current ? 'page' : undefined}
              >
                {r.name}
              </Link>
            ))}
            {drafts.length > 0 && (
              <Link
                to={filesUrl.drafts()}
                title="Proposed files, each read against the live file it would replace"
                aria-current={current === DRAFTS ? 'page' : undefined}
              >
                Drafts<span className="count">{drafts.length}</span>
              </Link>
            )}
          </nav>
        )}
        <span className="live-state" title={connected ? 'Live: changes on disk show up here as they happen' : 'Connecting…'}>
          <span className={connected ? 'dot live' : 'dot idle'} />
          <span className="live-label">{connected ? 'Live' : 'Connecting…'}</span>
        </span>
      </header>
      <section className="bench" data-tree={treeOpen ? 'open' : 'closed'} data-narrow={narrow ? '' : undefined}>
        {repos.length > 0 && (
          <div className="bench-bar">
            <button
              type="button"
              className="icon-button tree-toggle"
              aria-expanded={treeOpen}
              aria-label={treeOpen ? `Hide ${sideLabel}` : `Show ${sideLabel}`}
              title={treeOpen ? `Hide ${sideLabel}` : `Show ${sideLabel}`}
              onClick={() => setTree(!treeOpen)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6 3v10" stroke="currentColor" strokeWidth="1.3" />
                {treeOpen && <path d="M2.5 3.5h3v9h-3z" fill="currentColor" opacity="0.35" />}
              </svg>
            </button>
            {nav}
            <div className="bar-slot" ref={setSlot} />
          </div>
        )}
        <BenchContext.Provider value={bench}>{children}</BenchContext.Provider>
      </section>
    </div>
  );
}

/** Which checkout is open (live or a worktree), a menu to switch or start one, and its three views. */
function Checkout({ repo, ws, view, file }: { repo: RepoSummary; ws: Workspace; view: View; file: string }) {
  const changes = useDeck<ChangeSet>(wsApi(ws.id, '/changes'), ...wsTags(ws));
  const [params] = useSearchParams();
  const pending = changes.data?.files.length ?? 0;
  const ahead = changes.data?.ahead ?? 0;
  const tracked = changes.data?.files.filter((f) => f.status !== 'untracked').length ?? 0;

  return (
    <div className="bench-tools">
      <CheckoutMenu repo={repo} ws={ws} view={view} file={file} />
      <nav className="views" aria-label="View">
        <Link to={filesUrl.browse(ws.id, file)} aria-current={view === 'browse' ? 'page' : undefined}>
          Code
        </Link>
        <Link
          to={filesUrl.changes(ws.id)}
          aria-current={view === 'changes' ? 'page' : undefined}
          title={pending > tracked ? `${fmt.int(tracked)} changed, ${fmt.int(pending - tracked)} untracked` : undefined}
        >
          Changes
          {pending > 0 && <span className="count">{fmt.tokens(tracked || pending)}</span>}
          {ahead > 0 && (
            <span className="count ahead" title="Commits to ship">
              ↑{ahead}
            </span>
          )}
        </Link>
        <Link
          to={filesUrl.history(ws.id, '', view === 'history' ? (params.get('path') ?? '') : '')}
          aria-current={view === 'history' ? 'page' : undefined}
        >
          History
        </Link>
      </nav>
    </div>
  );
}

function CheckoutMenu({ repo, ws, view, file }: { repo: RepoSummary; ws: Workspace; view: View; file: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const { busy, run } = useAction();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) {
        setOpen(false);
        setNaming(null);
      }
    };

    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);

    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const target = (id: string) =>
    view === 'changes' ? filesUrl.changes(id) : view === 'history' ? filesUrl.history(id) : filesUrl.browse(id, file);

  const create = (name: string) =>
    run('new', async () => {
      const { id } = await send<{ id: string }>(`/repos/${repo.id}/workspaces`, 'POST', { name });

      setNaming(null);
      setOpen(false);
      notify(`Opened worktree ${id.split('~')[1]} from ${repo.branch ?? 'HEAD'}`);
      navigate(filesUrl.browse(id, file));
    });

  const label = (w: Workspace) => w.name ?? 'live';

  return (
    <div className="checkout" ref={root}>
      <button
        type="button"
        className="checkout-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={ws.name ? 'mark wt' : 'mark live'} aria-hidden />
        <span className="checkout-name">{label(ws)}</span>
        <span className="checkout-branch">{ws.branch ?? 'detached'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && (
        <div className="checkout-menu" role="menu">
          <p className="menu-label">Checkouts of {repo.name}</p>
          {repo.workspaces.map((w) => (
            <Link
              key={w.id}
              role="menuitem"
              to={target(w.id)}
              aria-current={w.id === ws.id ? 'true' : undefined}
              onClick={() => setOpen(false)}
            >
              <span className={w.name ? 'mark wt' : 'mark live'} aria-hidden />
              <span className="checkout-name">{label(w)}</span>
              <span className="checkout-branch">{w.name ? `${w.branch} → ${w.base}` : `${w.branch ?? 'detached'} · read-only`}</span>
            </Link>
          ))}
          {naming === null ? (
            <button type="button" role="menuitem" className="menu-new" onClick={() => setNaming(file ? nameFor(file) : 'edit')}>
              <span aria-hidden>+</span> New worktree from {repo.branch ?? 'HEAD'}
            </button>
          ) : (
            <form
              className="menu-form"
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
              />
              <Button size="sm" type="submit" loading={busy === 'new'}>
                Open
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
