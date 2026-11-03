import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MultiFileDiff, File, Virtualizer } from '@pierre/diffs/react';
import { Button } from '@/components/ui/Button';
import { putText, send, useDeck } from '../api';
import { codeFile, useCodeOptions, useDiffStyle } from '../code/pierre';
import { Empty, Seg } from '../components';
import { notify, useAction } from '../actions';
import type { Draft, FileBody, RepoSummary } from '../types';
import { fileApi, filesUrl, nameFor } from './urls';

/** Proposed files, each read against the live file it would replace. */
export function Drafts({ drafts, name, repos }: { drafts: Draft[]; name: string; repos: RepoSummary[] }) {
  const draft = drafts.find((d) => d.name === name) ?? null;
  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="bench-grid drafts" data-open={name ? 'main' : 'side'}>
      <aside className="bench-side">
        <ol className="commit-list">
          {drafts.map((d) => (
            <li key={d.name}>
              <Link to={filesUrl.drafts(d.name)} aria-current={d.name === name ? 'true' : undefined}>
                <span className="subject">{d.name}</span>
                <span className="meta">
                  <span className="clip">{d.target ? `replaces ${repoName(d.target.repo)}/${d.target.path}` : 'not tied to a live file'}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </aside>
      <div className="bench-main">
        {draft ? (
          <DraftView key={draft.name} draft={draft} repos={repos} />
        ) : name ? (
          <Empty>No draft named {name}.</Empty>
        ) : (
          <Empty>A draft is a proposed version of one of your files. Pick one to read it against the live file it would replace.</Empty>
        )}
      </div>
    </div>
  );
}

function DraftView({ draft, repos }: { draft: Draft; repos: RepoSummary[] }) {
  const navigate = useNavigate();
  const text = useDeck<{ contents: string }>(`/drafts/${encodeURIComponent(draft.name)}`, 'drafts');
  const target = draft.target;
  const repo = repos.find((r) => r.id === target?.repo) ?? null;
  const live = useDeck<FileBody>(target && repo ? fileApi(repo.id, target.path) : null, `repo:${target?.repo}`);
  const [style, setStyle] = useDiffStyle();
  const options = useCodeOptions(style);
  const { busy, run } = useAction();
  const proposed = text.data?.contents ?? null;
  const current = live.data?.contents ?? null;
  const name = target?.path ?? draft.name;

  const files = useMemo(
    () => ({
      proposed: proposed === null ? null : codeFile(name, proposed, `draft:${draft.name}:${proposed.length}`),
      current: current === null ? null : codeFile(name, current, `live:${name}:${current.length}`),
    }),
    [draft.name, name, proposed, current]
  );

  const take = () =>
    run('take', async () => {
      if (!target || !repo || proposed === null) return;
      const { id } = await send<{ id: string }>(`/repos/${repo.id}/workspaces`, 'POST', {
        name: `draft-${nameFor(target.path)}`,
      });

      await putText(fileApi(id, target.path), proposed);
      notify(`Draft written into worktree ${id.split('~')[1]}. Review, edit, then commit and ship.`);
      navigate(filesUrl.changes(id));
    });

  if (text.error) return <Empty>{text.error}</Empty>;

  if (!files.proposed) return <Empty>Opening {draft.name}…</Empty>;

  return (
    <div className="viewer">
      <div className="file-head">
        <nav className="crumbs" aria-label="Path">
          <Link className="back" to={filesUrl.drafts()} aria-label="Back to drafts">
            ←
          </Link>
          <b>{draft.name}</b>
          {target && repo && (
            <span className="muted small clip">
              against {repo.name}/{target.path}
            </span>
          )}
        </nav>
        <span className="spacer" />
        {files.current && (
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
        {target && repo ? (
          <Button size="sm" loading={busy === 'take'} onClick={take}>
            Take into a worktree
          </Button>
        ) : (
          <span className="muted small">No live file mapped</span>
        )}
      </div>
      <Virtualizer className="code">
        {files.current ? (
          <MultiFileDiff oldFile={files.current} newFile={files.proposed} options={options.diff} />
        ) : (
          <File file={files.proposed} options={options.file} />
        )}
      </Virtualizer>
    </div>
  );
}
