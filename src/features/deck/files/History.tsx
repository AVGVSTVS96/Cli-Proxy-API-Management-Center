import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { CodeViewItem } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';
import { useDeck } from '../api';
import { patchDiffs, useCodeOptions } from '../code/pierre';
import { Empty } from '../components';
import { when } from '../format';
import type { Commit, CommitDetail, Workspace } from '../types';
import { filesUrl, wsApi, wsTags } from './urls';

const LIMIT = 100;

/** The workspace's recent commits, and the picked one as a review of its patch. */
export function History({ ws, sha }: { ws: Workspace; sha: string }) {
  const commits = useDeck<Commit[]>(wsApi(ws.id, `/commits?limit=${LIMIT}`), ...wsTags(ws));
  const picked = sha || commits.data?.[0]?.sha || '';

  return (
    <div className="bench-grid history" data-open={sha ? 'main' : 'side'}>
      <aside className="bench-side">
        {commits.error ? (
          <Empty>{commits.error}</Empty>
        ) : !commits.data ? (
          <Empty>Reading history…</Empty>
        ) : (
          <ol className="commit-list">
            {commits.data.map((c) => (
              <li key={c.sha}>
                <Link
                  to={filesUrl.history(ws.id, c.sha)}
                  aria-current={c.sha === picked ? 'true' : undefined}
                >
                  <span className="subject">{c.subject}</span>
                  <span className="meta">
                    <span className="mono">{c.short}</span>
                    <span>{when(c.at)}</span>
                    {!c.signed && <span className="unsigned">unsigned</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </aside>
      <div className="bench-main">
        {picked ? <CommitView key={picked} ws={ws} sha={picked} /> : <Empty>No commits yet.</Empty>}
      </div>
    </div>
  );
}

function CommitView({ ws, sha }: { ws: Workspace; sha: string }) {
  const detail = useDeck<CommitDetail>(wsApi(ws.id, `/commits/${sha}`));
  const options = useCodeOptions();

  const items = useMemo<CodeViewItem<undefined>[]>(
    () =>
      detail.data
        ? patchDiffs(detail.data.patch, sha).map((fileDiff) => ({
            id: fileDiff.name,
            type: 'diff',
            fileDiff,
          }))
        : [],
    [detail.data, sha]
  );

  if (detail.error) return <Empty>{detail.error}</Empty>;

  if (!detail.data) return <Empty>Opening {sha.slice(0, 7)}…</Empty>;
  const c = detail.data;

  return (
    <div className="viewer">
      <div className="commit-head">
        <Link className="back" to={filesUrl.history(ws.id)}>
          ← History
        </Link>
        <h2>{c.subject}</h2>
        {c.body && <p className="body">{c.body}</p>}
        <p className="meta">
          <span>{c.author}</span>
          <span>{new Date(c.at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          <span className="mono">{c.sha}</span>
          {c.signed ? <span className="chip">signed</span> : <span className="chip warn">unsigned</span>}
          <span>
            {items.length} {items.length === 1 ? 'file' : 'files'}
          </span>
        </p>
        {c.truncated && <p className="muted small">This commit's patch is over 2 MB, so only the start shows.</p>}
      </div>
      {items.length ? (
        <CodeView className="code" items={items} options={options.view} />
      ) : (
        <Empty>No file changes in this commit.</Empty>
      )}
    </div>
  );
}
