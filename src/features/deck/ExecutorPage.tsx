import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditProvider, File, MultiFileDiff } from '@pierre/diffs/react';
import { Button } from '@/components/ui/Button';
import { putText, send, useConnected, useDeck } from './api';
import { codeFile, createEditor, useCodeOptions } from './code/pierre';
import { Empty } from './components';
import { ask, notify, useAction } from './actions';
import { relativeTime } from './format';
import type { ExecutorApp, ExecutorOverview, ExecutorSource } from './types';
import './deck.scss';
import './workspace.scss';

const behindHost = (app: ExecutorApp, framework: string | null) =>
  Boolean(app.pinned && framework && app.pinned !== framework);

const deployed = (app: ExecutorApp) =>
  app.deployedAt ? `deployed ${relativeTime(Date.parse(app.deployedAt))}` : 'not deployed';

const accountTone = (app: ExecutorApp, requirement: string) => {
  const linked = app.accounts.filter((a) => a.requirement === requirement);

  return linked.some((a) => a.health === 'healthy') ? 'live' : linked.length ? 'warn' : 'idle';
};

/** The apps on Executor: what runs, which accounts they reach, and local source against what's deployed. */
export function ExecutorPage() {
  const slug = useParams().slug ?? '';
  const overview = useDeck<ExecutorOverview>('/executor', 'executor');
  const connected = useConnected();
  const data = overview.data;
  const selected = data?.apps.find((a) => a.slug === slug) ?? data?.apps[0] ?? null;

  return (
    <div className="deck workspace executor">
      <header className="head">
        <div>
          <h1>Executor</h1>
          <p className="lede">
            {data
              ? `host runs apps@${data.framework ?? '?'} · ${data.apps.length} apps · ${data.apps.filter((a) => a.local).length} with local source`
              : 'Your Executor apps'}
          </p>
        </div>
        {data && (
          <a className="small" href={data.console} target="_blank" rel="noopener noreferrer">
            Executor console ↗
          </a>
        )}
        <span className="live-state">
          <span className={connected ? 'dot live' : 'dot idle'} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </header>
      {overview.error && !data && <Empty>{overview.error}</Empty>}
      {!data && !overview.error && <Empty>Asking Executor…</Empty>}
      {data && (
        <div className="exec-grid" data-open={slug ? 'main' : 'side'}>
          <nav className="app-list" aria-label="Apps">
            {data.apps.map((app) => (
              <Link
                key={app.id}
                to={`/executor/${app.slug}`}
                aria-current={app.slug === selected?.slug ? 'page' : undefined}
              >
                <span className="app-name">
                  {app.name}
                  <span className="mono muted">{app.slug}</span>
                </span>
                <span className="app-meta">
                  {app.requirements.map((req) => (
                    <span key={req} className={`dot ${accountTone(app, req)}`} title={req} />
                  ))}
                  <span>{deployed(app)}</span>
                  {behindHost(app, data.framework) && <span className="warn">pin behind host</span>}
                </span>
              </Link>
            ))}
          </nav>
          {selected && <AppDetail key={selected.slug} app={selected} framework={data.framework} reload={overview.reload} />}
        </div>
      )}
    </div>
  );
}

function AppDetail({
  app,
  framework,
  reload,
}: {
  app: ExecutorApp;
  framework: string | null;
  reload: () => Promise<void>;
}) {
  const { busy, run } = useAction();
  const behind = behindHost(app, framework);

  const connect = (requirement: string) =>
    run(requirement, async () => {
      const { url } = await send<{ url: string }>(`/executor/${app.slug}/connect`, 'POST', { requirement });

      window.open(url, '_blank', 'noopener');
      notify(`Opened Executor's sign-in for ${requirement}`);
      await reload();
    });

  return (
    <section className="app-detail">
      <Link className="back" to="/executor">
        ← Apps
      </Link>
      <div className="section">
        <div className="section-head">
          <h2>{app.name}</h2>
          <span className="chip">{app.local ? 'local source' : 'hosted'}</span>
        </div>
        <dl className="app-facts">
          <div>
            <dt>Running</dt>
            <dd>{deployed(app)}</dd>
          </div>
          <div>
            <dt>Versions</dt>
            <dd>{app.versions}</dd>
          </div>
          {app.pinned && (
            <div>
              <dt>Pins</dt>
              <dd className={behind ? 'warn' : ''}>
                apps@{app.pinned}
                {behind && ` · host runs ${framework}`}
              </dd>
            </div>
          )}
        </dl>
        {app.requirements.length > 0 && (
          <ul className="reqs">
            {app.requirements.map((req) => {
              const linked = app.accounts.filter((a) => a.requirement === req);

              return (
                <li key={req}>
                  <span className={`dot ${accountTone(app, req)}`} />
                  <span className="mono">{req}</span>
                  <span className="muted clip" title={linked.map((a) => `${a.label}: ${a.health ?? 'unknown'}`).join('\n')}>
                    {linked.map((a) => `${a.label}${a.health && a.health !== 'healthy' ? ` (${a.health})` : ''}`).join(', ') ||
                      'no account linked'}
                  </span>
                  <Button size="sm" variant="secondary" loading={busy === req} onClick={() => connect(req)}>
                    {linked.length ? 'Add account' : 'Connect'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {app.local ? (
        <AppSource app={app} reload={reload} />
      ) : (
        <Empty>{app.name} has no local source here, so it's edited in Executor itself.</Empty>
      )}
    </section>
  );
}

function AppSource({ app, reload }: { app: ExecutorApp; reload: () => Promise<void> }) {
  const source = useDeck<ExecutorSource>(`/executor/${app.slug}`, 'executor');
  const [editing, setEditing] = useState<string | null>(null);
  const { busy, run } = useAction();
  const files = source.data?.files ?? [];
  const differ = files.filter((f) => f.local !== f.deployed).length;

  const deploy = () =>
    run('deploy', async () => {
      const sure = await ask(
        `Deploy ${app.name}?`,
        `Your local source becomes the version Executor runs.`,
        'Deploy'
      );

      if (!sure) return;
      const result = await send<{ version: string | null; files: number }>(`/executor/${app.slug}/deploy`, 'POST');

      notify(`Deployed ${result.files} files${result.version ? ` as ${result.version.slice(0, 12)}` : ''}`);
      await Promise.all([source.reload(), reload()]);
    });

  if (source.error) return <Empty>{source.error}</Empty>;

  if (!source.data) return <Empty>Fetching deployed source…</Empty>;

  return (
    <div className="section">
      <div className="section-head">
        <h2>Source</h2>
        <span className="sub">
          {differ ? `${differ} of ${files.length} files differ from what runs` : `local matches what runs`}
        </span>
        <span className="spacer" />
        <Button
          size="sm"
          loading={busy === 'deploy'}
          disabled={!differ || editing !== null}
          title={editing ? 'Save your edit first' : undefined}
          onClick={deploy}
        >
          {differ ? 'Deploy local source' : 'Up to date'}
        </Button>
      </div>
      <EditProvider createEditor={createEditor}>
        {files.map((f) => (
          <SourceFile
            key={f.path}
            slug={app.slug}
            file={f}
            editing={editing === f.path}
            setEditing={(on) => setEditing(on ? f.path : null)}
            onSaved={source.reload}
          />
        ))}
      </EditProvider>
    </div>
  );
}

function SourceFile({
  slug,
  file,
  editing,
  setEditing,
  onSaved,
}: {
  slug: string;
  file: ExecutorSource['files'][number];
  editing: boolean;
  setEditing: (on: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const options = useCodeOptions();
  const latest = useRef<string | null>(null);
  const { busy, run } = useAction();
  const local = file.local ?? '';
  const same = file.local === file.deployed;

  const files = useMemo(
    () => ({
      local: codeFile(file.path, local, `${slug}:${file.path}:local:${local.length}`),
      deployed:
        file.deployed === null ? null : codeFile(file.path, file.deployed, `${slug}:${file.path}:deployed:${file.deployed.length}`),
    }),
    [slug, file.path, local, file.deployed]
  );

  const save = () =>
    run('save', async () => {
      if (latest.current !== null) {
        await putText(`/executor/${slug}/file?path=${encodeURIComponent(file.path)}`, latest.current);
        notify(`Saved ${file.path} locally`);
        await onSaved();
      }

      setEditing(false);
    });

  return (
    <div className="source-file">
      <div className="viewer-head">
        <span className={same ? 'dot live' : 'dot warn'} />
        <span className="path">{file.path}</span>
        <span className="muted small">
          {same ? 'same as running' : file.deployed === null ? 'not deployed yet' : 'differs from running'}
        </span>
        <span className="spacer" />
        {editing ? (
          <Button size="sm" loading={busy === 'save'} onClick={save}>
            Save locally
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              latest.current = null;
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {files.deployed && !same ? (
        <MultiFileDiff
          oldFile={files.deployed}
          newFile={files.local}
          options={options.diff}
          edit={editing}
          onEditChange={(e) => (latest.current = e.file.contents)}
          onEditComplete={() => 'accept'}
        />
      ) : (
        <File
          file={files.local}
          options={options.file}
          edit={editing}
          onEditChange={(e) => (latest.current = e.file.contents)}
          onEditComplete={() => 'accept'}
        />
      )}
    </div>
  );
}
