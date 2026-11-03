import { useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CodeViewItem } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { useDeck } from '../api';
import { patchDiffs, useCodeOptions, useDiffStyle } from '../code/pierre';
import { Empty, Seg } from '../components';
import { dayOf, fmt, relativeTime } from '../format';
import type { Commit, CommitDetail, Workspace } from '../types';
import { PathTree } from './PathTree';
import { filesUrl, wsApi, wsTags } from './urls';

const LIMIT = 150;

const dayName = (at: number) => {
  const start = new Date();

  start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - at) / 86_400_000) + 1;

  return at >= start.getTime() ? 'Today' : days === 1 ? 'Yesterday' : dayOf(at);
};

const clock = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

/** The worktree's commits by day, or one file's, and the picked commit as a review of its files. */
export function History({ ws, sha }: { ws: Workspace; sha: string }) {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const query = `/commits?limit=${LIMIT}${path ? `&path=${encodeURIComponent(path)}` : ''}`;
  const commits = useDeck<Commit[]>(wsApi(ws.id, query), ...wsTags(ws));
  const picked = sha || commits.data?.[0]?.sha || '';

  const days = useMemo(() => {
    const groups: [string, Commit[]][] = [];

    for (const c of commits.data ?? []) {
      const name = dayName(c.at);
      const last = groups[groups.length - 1];

      if (last?.[0] === name) last[1].push(c);
      else groups.push([name, [c]]);
    }

    return groups;
  }, [commits.data]);

  return (
    <div className="bench-grid history" data-open={sha ? 'main' : 'side'}>
      <aside className="bench-side">
        {path && (
          <div className="history-filter">
            <span className="clip" title={path}>
              Commits to <b>{path.split('/').pop()}</b>
            </span>
            <Link to={filesUrl.history(ws.id, sha)} aria-label="Show every commit">
              All
            </Link>
          </div>
        )}
        {commits.error ? (
          <Empty>{commits.error}</Empty>
        ) : !commits.data ? (
          <Empty>Reading history…</Empty>
        ) : !commits.data.length ? (
          <Empty>No commits yet.</Empty>
        ) : (
          days.map(([name, list]) => (
            <section key={name} className="day">
              <h3>{name}</h3>
              <ol className="commit-list">
                {list.map((c) => (
                  <li key={c.sha}>
                    <Link
                      to={filesUrl.history(ws.id, c.sha, path)}
                      aria-current={c.sha === picked ? 'true' : undefined}
                    >
                      <span className="subject">{c.subject}</span>
                      <span className="meta">
                        <span className="mono">{c.short}</span>
                        <span>{clock.format(c.at)}</span>
                        {!c.signed && <span className="unsigned">unsigned</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </aside>
      <div className="bench-main">
        {picked ? <CommitView key={picked} ws={ws} sha={picked} focus={path} /> : !commits.data ? null : <Empty>No commits yet.</Empty>}
      </div>
    </div>
  );
}

function CommitView({ ws, sha, focus }: { ws: Workspace; sha: string; focus: string }) {
  const detail = useDeck<CommitDetail>(wsApi(ws.id, `/commits/${sha}`));
  const [style, setStyle] = useDiffStyle();
  const options = useCodeOptions(style);
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);

  const diffs = useMemo(() => (detail.data ? patchDiffs(detail.data.patch, `${sha}:${style}`) : []), [detail.data, sha, style]);
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => diffs.map((fileDiff) => ({ id: fileDiff.name, type: 'diff', fileDiff })),
    [diffs]
  );
  const paths = useMemo(() => diffs.map((d) => d.name), [diffs]);
  const status = useMemo<GitStatusEntry[]>(
    () =>
      diffs.map((d) => ({
        path: d.name,
        status: d.type === 'new' ? 'added' : d.type === 'deleted' ? 'deleted' : 'modified',
      })),
    [diffs]
  );
  const counts = useMemo(() => {
    let added = 0;
    let removed = 0;

    for (const d of diffs) {
      for (const h of d.hunks) {
        added += h.additionLines;
        removed += h.deletionLines;
      }
    }

    return { added, removed };
  }, [diffs]);

  if (detail.error) return <Empty>{detail.error}</Empty>;

  if (!detail.data) return <Empty>Opening {sha.slice(0, 7)}…</Empty>;
  const c = detail.data;
  const many = paths.length > 1;

  return (
    <div className="viewer">
      <div className="commit-head">
        <Link className="back" to={filesUrl.history(ws.id, '', focus)}>
          ← History
        </Link>
        <h2>{c.subject}</h2>
        {c.body && <p className="body">{c.body}</p>}
        <div className="meta">
          <span>{c.author}</span>
          <time dateTime={new Date(c.at).toISOString()} title={new Date(c.at).toLocaleString()}>
            {relativeTime(c.at)}
          </time>
          <span className="mono" title={c.sha}>
            {c.short}
          </span>
          {c.signed ? <span className="signed">Signed</span> : <span className="unsigned">Unsigned</span>}
          <span>
            {fmt.int(paths.length)} {paths.length === 1 ? 'file' : 'files'}{' '}
            <span className="plus">+{fmt.int(counts.added)}</span> <span className="minus">−{fmt.int(counts.removed)}</span>
          </span>
          <span className="spacer" />
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
        </div>
        {c.truncated && <p className="muted small">This commit's patch is over 2 MB, so only its first files show.</p>}
      </div>
      {items.length ? (
        <div className={many ? 'commit-body split-files' : 'commit-body'}>
          {many && (
            <PathTree
              key={sha}
              paths={paths}
              status={status}
              selected={focus && paths.includes(focus) ? focus : ''}
              open
              search={paths.length > 20}
              onPick={(path) => view.current?.scrollTo({ type: 'item', id: path, behavior: 'smooth' })}
            />
          )}
          <CodeView ref={view} className="code" items={items} options={options.view} />
        </div>
      ) : (
        <Empty>No file changes in this commit.</Empty>
      )}
    </div>
  );
}
