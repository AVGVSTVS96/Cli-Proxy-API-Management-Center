import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EditProvider, File, MultiFileDiff, Virtualizer } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { Button } from '@/components/ui/Button';
import { blob, putText, send, useDeck } from '../api';
import { codeFile, createEditor, useCodeOptions } from '../code/pierre';
import { Empty, Seg } from '../components';
import { messageOf, notify, useAction } from '../actions';
import { fmt, relativeTime } from '../format';
import type { Changes, FileBody, RepoSummary, Workspace } from '../types';
import { BarTools, Side, useBench } from './bench';
import { copy } from './copy';
import { Markdown } from './Markdown';
import { PathTree } from './PathTree';
import { fileApi, filesUrl, nameFor, rawApi, wsApi, wsTags } from './urls';

const README = ['README.md', 'readme.md', 'AGENTS.md', 'CLAUDE.md', 'README'];
const IMAGE = /\.(png|jpe?g|gif|webp|avif|ico|bmp)$/i;
const MARKDOWN = /\.(md|mdx|markdown)$/i;

export function Browse({ ws, repo, file }: { ws: Workspace; repo: RepoSummary; file: string }) {
  const navigate = useNavigate();
  const files = useDeck<string[]>(wsApi(ws.id, '/files'), ...wsTags(ws));
  const changes = useDeck<Changes>(wsApi(ws.id, '/changes'), ...wsTags(ws));

  const status = useMemo<GitStatusEntry[]>(
    () => changes.data?.files.map((c) => ({ path: c.path, status: c.status })) ?? [],
    [changes.data]
  );

  const folder = useMemo(() => {
    if (!file || !files.data || files.data.includes(file)) return null;
    const inside = files.data.filter((p) => p.startsWith(`${file}/`));

    return inside.length ? inside : null;
  }, [file, files.data]);

  const readme = useMemo(() => (files.data ? (README.find((name) => files.data!.includes(name)) ?? null) : null), [files.data]);

  return (
    <div className="bench-grid">
      <Side>
        <PathTree
          key={ws.id}
          paths={files.data}
          status={status}
          selected={file}
          main
          onPick={(path) => navigate(filesUrl.browse(ws.id, path))}
        />
      </Side>
      <div className="bench-main">
        {file && folder ? (
          <Folder ws={ws} repo={repo} path={file} paths={folder} status={status} />
        ) : file ? (
          <Viewer key={`${ws.id}:${file}`} ws={ws} repo={repo} path={file} />
        ) : readme ? (
          <Viewer key={`${ws.id}:${readme}`} ws={ws} repo={repo} path={readme} overview />
        ) : (
          <Empty>{files.data ? `Pick a file from ${repo.name}.` : 'Reading files…'}</Empty>
        )}
      </div>
    </div>
  );
}

/** repo / folder / folder / file, each folder a link to its listing. */
function Crumbs({ ws, repo, path, folder = false }: { ws: Workspace; repo: RepoSummary; path: string; folder?: boolean }) {
  const parts = path.split('/');

  return (
    <nav className="crumbs" aria-label="Path">
      <Link to={filesUrl.browse(ws.id)}>{repo.name}</Link>
      {parts.map((part, i) => {
        const at = parts.slice(0, i + 1).join('/');
        const last = i === parts.length - 1;

        return (
          <span key={at} className="crumb">
            <span className="sep" aria-hidden>
              /
            </span>
            {last && !folder ? (
              <b title={path}>{part}</b>
            ) : (
              <Link to={filesUrl.browse(ws.id, at)}>{part}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** One level of a folder: its subfolders with how much they hold, then its files. */
function Folder({
  ws,
  repo,
  path,
  paths,
  status,
}: {
  ws: Workspace;
  repo: RepoSummary;
  path: string;
  paths: string[];
  status: GitStatusEntry[];
}) {
  const entries = useMemo(() => {
    const dirs = new Map<string, number>();
    const files: string[] = [];

    for (const p of paths) {
      const rest = p.slice(path.length + 1);
      const slash = rest.indexOf('/');

      if (slash < 0) files.push(rest);
      else dirs.set(rest.slice(0, slash), (dirs.get(rest.slice(0, slash)) ?? 0) + 1);
    }

    return { dirs: [...dirs].sort(([a], [b]) => a.localeCompare(b)), files: files.sort() };
  }, [path, paths]);
  const changed = useMemo(() => new Map(status.map((s) => [s.path, s.status])), [status]);

  return (
    <div className="viewer">
      <div className="file-bar">
        <Crumbs ws={ws} repo={repo} path={path} folder />
        <div className="facts">
          <span>{fmt.int(paths.length)} files inside</span>
        </div>
      </div>
      <ul className="folder">
        {entries.dirs.map(([name, count]) => (
          <li key={name}>
            <Link to={filesUrl.browse(ws.id, `${path}/${name}`)}>
              <FolderIcon />
              <span className="name">{name}</span>
              <span className="muted small">{fmt.int(count)}</span>
            </Link>
          </li>
        ))}
        {entries.files.map((name) => {
          const s = changed.get(`${path}/${name}`);

          return (
            <li key={name}>
              <Link to={filesUrl.browse(ws.id, `${path}/${name}`)}>
                <FileIcon />
                <span className="name">{name}</span>
                {s && <span className={`git ${s}`}>{s === 'untracked' ? 'new' : s}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const FolderIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="icon">
    <path d="M1.75 3.5h4l1.5 1.5h7v7.75H1.75z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const FileIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="icon">
    <path d="M3.5 1.75h6l3 3v9.5h-9z M9.5 1.75v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

type Mode = 'preview' | 'code' | 'diff';

const MD_MODE_KEY = 'files.markdown';

function Viewer({ ws, repo, path, overview = false }: { ws: Workspace; repo: RepoSummary; path: string; overview?: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = !overview && ws.name !== null && params.has('edit');
  const live = useDeck<FileBody>(fileApi(ws.id, path), ...wsTags(ws));
  const options = useCodeOptions();
  const saver = useSaver(ws.id, path);
  const { busy, run } = useAction();
  const { narrow } = useBench();
  const markdown = MARKDOWN.test(path);
  const image = IMAGE.test(path);

  // While editing, the editor owns the text: our own saves come back as refetches, which must not reset it.
  const [held, setHeld] = useState<FileBody | null>(null);
  const [picked, setPicked] = useState<Mode | null>(null);

  if (editing && !held && live.data) setHeld(live.data);
  if (!editing && held) setHeld(null);

  const body = editing ? (held ?? live.data) : live.data;
  const text = body?.binary || body?.tooLarge ? null : (body?.contents ?? null);
  const original = body?.original ?? null;

  // Stable file objects: the editor keeps its own document, so typing never feeds back in here.
  const file = useMemo(
    () => (text === null ? null : codeFile(path, text, `${ws.id}:${path}:${text.length}:${text.slice(-64)}`)),
    [ws.id, path, text]
  );
  const before = useMemo(
    () => (original === null ? null : codeFile(path, original, `${ws.id}:${path}:original:${original.length}`)),
    [ws.id, path, original]
  );

  if (live.error && !body) return <Empty>{live.error}</Empty>;

  if (!body) return <Empty>Opening {path}…</Empty>;

  const changed = before !== null && text !== null && original !== text;
  const fresh = body.last === null && text !== null;
  const remembered = (localStorage.getItem(MD_MODE_KEY) as Mode | null) ?? 'preview';
  const mode: Mode = editing
    ? picked === 'diff' && changed
      ? 'diff'
      : 'code'
    : (picked ?? (markdown ? remembered : 'code'));
  const choose = (next: Mode) => {
    setPicked(next);

    if (markdown && next !== 'diff') localStorage.setItem(MD_MODE_KEY, next);
  };
  const modes: [Mode, string][] = [
    ...(markdown && !editing ? ([['preview', 'Preview']] as [Mode, string][]) : []),
    ['code', markdown ? 'Markdown' : 'Code'],
    ...(changed ? ([['diff', ws.name ? 'Since branching' : 'Uncommitted']] as [Mode, string][]) : []),
  ];

  const startEdit = () =>
    run('edit', async () => {
      if (ws.name) {
        if (overview) navigate(`${filesUrl.browse(ws.id, path)}?edit=1`);
        else setParams({ edit: '1' }, { replace: true });

        return;
      }

      const { id } = await send<{ id: string }>(`/repos/${ws.repo}/workspaces`, 'POST', { name: nameFor(path) });

      notify(`Opened worktree ${id.split('~')[1]} from ${ws.branch ?? 'HEAD'}. The live files stay as they are.`);
      navigate(`${filesUrl.browse(id, path)}?edit=1`);
    });

  const finish = () => {
    setParams({}, { replace: true });
    void live.reload();
  };

  const onChange = (next: string) => saver.save(next);
  const lines = text === null ? null : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

  return (
    <div className="viewer">
      <div className="file-bar">
        <Crumbs ws={ws} repo={repo} path={path} />
        <div className="facts">
          {body.last ? (
            <>
              <Link className="commit-link" to={filesUrl.history(ws.id, body.last.sha)} title={body.last.subject}>
                {body.last.subject}
              </Link>
              <span className="who">
                {body.last.author} · <time dateTime={new Date(body.last.at).toISOString()}>{relativeTime(body.last.at)}</time>
              </span>
            </>
          ) : (
            <span className="git untracked">{fresh ? 'Not in git yet' : 'Not committed'}</span>
          )}
          <span className="spacer" />
          {changed && !editing && <span className="git modified">{ws.name ? 'Changed in this worktree' : 'Uncommitted changes'}</span>}
          {lines !== null && <span className="num size">{fmt.int(lines)} lines</span>}
          <span className="num size">{bytes(body.size)}</span>
          {body.last && (
            <Link to={filesUrl.history(ws.id, '', path)} className="history-link">
              History
            </Link>
          )}
        </div>
        <BarTools>
          {file && modes.length > 1 && <Seg label="Show" value={mode} options={modes} onChange={choose} />}
          <button
            type="button"
            className="icon-button copy-path"
            title="Copy path"
            aria-label="Copy path"
            onClick={() => void copy(path).then(() => notify(`Copied ${path}`))}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M11 3V2.5A1.5 1.5 0 0 0 9.5 1h-6A1.5 1.5 0 0 0 2 2.5v6A1.5 1.5 0 0 0 3.5 10H4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          {file &&
            (editing ? (
              <>
                <span className="save-state">{saver.label}</span>
                <Button size="sm" onClick={finish}>
                  Done
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant={ws.name ? 'primary' : 'secondary'}
                loading={busy === 'edit'}
                onClick={startEdit}
                title={ws.name ? undefined : 'The live checkout is read-only, since running sessions read it. Editing opens a worktree.'}
              >
                {ws.name || narrow ? 'Edit' : 'Edit in a worktree'}
              </Button>
            ))}
        </BarTools>
      </div>
      {!file ? (
        image && body.binary ? (
          <Picture ws={ws.id} path={path} />
        ) : (
          <Empty>
            {body.tooLarge
              ? `${bytes(body.size)} is over the 2 MB the dashboard opens.`
              : body.binary
                ? 'A binary file, so there is no text to show.'
                : 'This file is gone from the worktree.'}
          </Empty>
        )
      ) : mode === 'preview' ? (
        <div className="prose-scroll">
          <Markdown text={text ?? ''} ws={ws.id} path={path} />
        </div>
      ) : (
        <EditProvider createEditor={createEditor}>
          <Virtualizer className="code">
            {mode === 'diff' && before ? (
              <MultiFileDiff
                oldFile={before}
                newFile={file}
                options={options.diff}
                edit={editing}
                editStateKey={`${ws.id}:${path}`}
                onEditChange={(e) => onChange(e.file.contents)}
                onEditComplete={() => 'accept'}
              />
            ) : (
              <File
                file={file}
                options={options.file}
                edit={editing}
                editStateKey={`${ws.id}:${path}`}
                onEditChange={(e) => onChange(e.file.contents)}
                onEditComplete={() => 'accept'}
              />
            )}
          </Virtualizer>
        </EditProvider>
      )}
    </div>
  );
}

/** A picture from the worktree, fetched with the key and shown on a checkerboard so transparency reads. */
function Picture({ ws, path }: { ws: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<[number, number] | null>(null);

  useEffect(() => {
    let made: string | null = null;
    let live = true;

    blob(rawApi(ws, path)).then(
      (b) => {
        made = URL.createObjectURL(b);

        if (live) setUrl(made);
      },
      (e) => live && setError(messageOf(e))
    );

    return () => {
      live = false;

      if (made) URL.revokeObjectURL(made);
    };
  }, [ws, path]);

  if (error) return <Empty>{error}</Empty>;

  if (!url) return <Empty>Opening {path}…</Empty>;

  return (
    <figure className="picture">
      <img
        src={url}
        alt={path}
        onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
      />
      {size && (
        <figcaption>
          {size[0]} × {size[1]}
        </figcaption>
      )}
    </figure>
  );
}

/** Saves the newest text, one write at a time; a burst of keystrokes ends in one more write. */
function useSaver(ws: string, path: string) {
  const queue = useRef<{ pending: string | null; chain: Promise<void> }>({
    pending: null,
    chain: Promise.resolve(),
  });
  const [label, setLabel] = useState('Saves as you type');

  const flush = async () => {
    const text = queue.current.pending;

    if (text === null) return;

    queue.current.pending = null;
    setLabel('Saving…');

    try {
      await putText(fileApi(ws, path), text);
      setLabel(queue.current.pending === null ? 'Saved' : 'Saving…');
    } catch (error) {
      setLabel('Not saved');
      notify(messageOf(error), 'error');
    }
  };

  return {
    label,
    save(text: string) {
      queue.current.pending = text;
      queue.current.chain = queue.current.chain.then(flush);
    },
  };
}
