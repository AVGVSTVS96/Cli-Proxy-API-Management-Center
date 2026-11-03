import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CodeViewItem } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { useDeck } from '../api';
import { patchDiffs, useCodeOptions, useDiffStyle } from '../code/pierre';
import { Empty, Seg } from '../components';
import { dayOf, fmt, relativeTime } from '../format';
import type { Commit, CommitDetail, Workspace } from '../types';
import { notify } from '../actions';
import { BarTools, Side, useSlashToFind } from './bench';
import { copy } from './copy';
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
  const [filter, setFilter] = useState('');
  const find = useRef<HTMLInputElement>(null);

  useSlashToFind(true, () => find.current?.focus());
  const needle = filter.trim().toLowerCase();

  const days = useMemo(() => {
    const groups: [string, Commit[]][] = [];
    const shown = (commits.data ?? []).filter(
      (c) => !needle || c.subject.toLowerCase().includes(needle) || c.sha.startsWith(needle) || c.author.toLowerCase().includes(needle)
    );

    for (const c of shown) {
      const name = dayName(c.at);
      const last = groups[groups.length - 1];

      if (last?.[0] === name) last[1].push(c);
      else groups.push([name, [c]]);
    }

    return groups;
  }, [commits.data, needle]);

  return (
    <div className="bench-grid history">
      <Side>
        <div className="side-search">
          <input
            type="search"
            ref={find}
            aria-label="Filter commits"
            placeholder="Filter commits"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {path && (
          <div className="history-filter">
            <span className="clip" title={path}>
              Only <b>{path}</b>
            </span>
            <Link to={filesUrl.history(ws.id, sha)} aria-label="Show every commit" title="Show every commit">
              ×
            </Link>
          </div>
        )}
        {commits.error ? (
          <Empty>{commits.error}</Empty>
        ) : !commits.data ? (
          <Empty>Reading history…</Empty>
        ) : !commits.data.length ? (
          <Empty>No commits yet.</Empty>
        ) : !days.length ? (
          <Empty>No commit matches “{filter.trim()}”.</Empty>
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
      </Side>
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
  const [showBody, setShowBody] = useState(false);

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
      <div className="file-bar commit-bar">
        <span className="commit-subject" title={c.subject}>
          {c.subject}
        </span>
        <div className="facts">
          <span className="who">
            {c.author} ·{' '}
            <time dateTime={new Date(c.at).toISOString()} title={new Date(c.at).toLocaleString()}>
              {relativeTime(c.at)}
            </time>
          </span>
          <button
            type="button"
            className="sha"
            title={`Copy ${c.sha}`}
            onClick={() => void copy(c.sha).then(() => notify(`Copied ${c.short}`))}
          >
            {c.short}
          </button>
          {c.signed ? <span className="signed">Signed</span> : <span className="unsigned">Unsigned</span>}
          <span className="spacer" />
          <span className="num">
            {fmt.int(paths.length)} {paths.length === 1 ? 'file' : 'files'} <span className="plus">+{fmt.int(counts.added)}</span>{' '}
            <span className="minus">−{fmt.int(counts.removed)}</span>
          </span>
          {c.body && (
            <button type="button" className="more" aria-expanded={showBody} onClick={() => setShowBody(!showBody)}>
              {showBody ? 'Less' : 'Message'}
            </button>
          )}
        </div>
        <BarTools>
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
        </BarTools>
      </div>
      {showBody && c.body && <p className="commit-body-text">{c.body}</p>}
      {c.truncated && <p className="bar-note">This commit's patch is over 2 MB, so only its first files show.</p>}
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
