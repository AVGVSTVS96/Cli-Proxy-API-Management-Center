import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EditProvider, File, MultiFileDiff, Virtualizer } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { Button } from '@/components/ui/Button';
import { putText, send, useDeck } from '../api';
import { codeFile, createEditor, useCodeOptions } from '../code/pierre';
import { Empty, Seg } from '../components';
import { messageOf, notify, useAction } from '../actions';
import type { Changes, FileBody, Workspace } from '../types';
import { PathTree } from './PathTree';
import { fileApi, filesUrl, nameFor, wsApi, wsTags } from './urls';

export function Browse({ ws, file }: { ws: Workspace; file: string }) {
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

  return (
    <div className="bench-grid" data-open={file ? 'main' : 'side'}>
      <aside className="bench-side">
        <PathTree
          key={ws.id}
          paths={files.data}
          status={status}
          selected={file}
          onPick={(path) => navigate(filesUrl.browse(ws.id, path))}
        />
      </aside>
      <div className="bench-main">
        {file && folder ? (
          <Folder ws={ws} path={file} paths={folder} />
        ) : file ? (
          <Viewer key={`${ws.id}:${file}`} ws={ws} path={file} />
        ) : (
          <Empty>
            {ws.name
              ? 'Pick a file to edit in this worktree. Edits save as you type.'
              : 'Pick a file. The live checkout is read-only here, since running sessions read it; Edit opens a worktree.'}
          </Empty>
        )}
      </div>
    </div>
  );
}

function Folder({ ws, path, paths }: { ws: Workspace; path: string; paths: string[] }) {
  return (
    <div className="viewer">
      <div className="viewer-head">
        <Link className="back" to={filesUrl.browse(ws.id)}>
          ← Files
        </Link>
        <span className="path">{path}/</span>
        <span className="muted small">{paths.length} files</span>
      </div>
      <ul className="folder">
        {paths.map((p) => (
          <li key={p}>
            <Link to={filesUrl.browse(ws.id, p)}>{p.slice(path.length + 1)}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Viewer({ ws, path }: { ws: Workspace; path: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = ws.name !== null && params.has('edit');
  const live = useDeck<FileBody>(fileApi(ws.id, path), ...wsTags(ws));
  const options = useCodeOptions();
  const saver = useSaver(ws.id, path);
  const { busy, run } = useAction();

  // While editing, the editor owns the text: our own saves come back as refetches, which must not reset it.
  const [held, setHeld] = useState<FileBody | null>(null);
  const [mode, setMode] = useState<'file' | 'diff' | null>(null);

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

  const back = (
    <Link className="back" to={filesUrl.browse(ws.id)}>
      ← Files
    </Link>
  );

  if (!file) {
    return (
      <div className="viewer">
        <div className="viewer-head">
          {back}
          <span className="path">{path}</span>
        </div>
        <Empty>
          {body.tooLarge
            ? 'This file is over 2 MB, so it stays out of the dashboard.'
            : body.binary
              ? 'A binary file. Nothing to show here.'
              : 'This file is gone from the workspace.'}
        </Empty>
      </div>
    );
  }

  const changed = before !== null && original !== text;
  const shown = changed ? (mode ?? 'diff') : 'file';

  const startEdit = () =>
    run('edit', async () => {
      if (ws.name) return setParams({ edit: '1' }, { replace: true });

      const { id } = await send<{ id: string }>(`/repos/${ws.repo}/workspaces`, 'POST', {
        name: nameFor(path),
      });

      notify(`Opened worktree ${id.split('~')[1]} from ${ws.branch ?? 'HEAD'}. The live files stay as they are.`);
      navigate(`${filesUrl.browse(id, path)}?edit=1`);
    });

  const finish = () => {
    setParams({}, { replace: true });
    void live.reload();
  };

  const onChange = (text: string) => saver.save(text);

  return (
    <div className="viewer">
      <div className="viewer-head">
        {back}
        <span className="path" title={path}>
          {path}
        </span>
        <span className="spacer" />
        {changed && (
          <Seg
            label="Show"
            value={shown}
            options={[
              ['file', 'File'],
              ['diff', ws.name ? 'Since branching' : 'Uncommitted'],
            ]}
            onChange={setMode}
          />
        )}
        {editing && <span className="muted small save-state">{saver.label}</span>}
        {editing ? (
          <Button size="sm" onClick={finish}>
            Done
          </Button>
        ) : (
          <Button size="sm" loading={busy === 'edit'} onClick={startEdit}>
            {ws.name ? 'Edit' : 'Edit in a worktree'}
          </Button>
        )}
      </div>
      <EditProvider createEditor={createEditor}>
        <Virtualizer className="code">
          {shown === 'diff' && before ? (
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
    </div>
  );
}

/** Saves the newest text, one write at a time; a burst of keystrokes ends in one more write. */
function useSaver(ws: string, path: string) {
  const queue = useRef<{ pending: string | null; chain: Promise<void> }>({
    pending: null,
    chain: Promise.resolve(),
  });
  const [label, setLabel] = useState('Edits save to the worktree');

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
