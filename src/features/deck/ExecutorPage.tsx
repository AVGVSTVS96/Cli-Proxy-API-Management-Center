import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditProvider, File, MultiFileDiff } from '@pierre/diffs/react';
import { Button } from '@/components/ui/Button';
import { putText, send, useConnected, useDeck } from './api';
import { codeFile, createEditor, useCodeOptions } from './code/pierre';
import { Empty } from './components';
import { ask, notify, useAction } from './actions';
import type { ExecutorApp, ExecutorOverview, ExecutorSource } from './types';
import './deck.scss';
import './executor.scss';

const release = (version: string | null) => {
  const n = version ? /(\d+)$/.exec(version)?.[1] : undefined;

  return n === undefined ? null : Number(n);
};

/** How many framework releases the app's pinned `apps` is behind what the host runs, or null if unknown. */
const releasesBehind = (app: ExecutorApp, framework: string | null) => {
  const pinned = release(app.pinned);
  const host = release(framework);

  return pinned === null || host === null || !app.pinned || !framework || app.pinned === framework
    ? null
    : Math.max(0, host - pinned);
};

const deployedOn = (app: ExecutorApp) =>
  app.deployedAt
    ? new Date(app.deployedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })
    : null;

type Health = 'healthy' | 'unchecked' | 'failing' | 'missing';

const healthOf = (account: { health: string | null } | undefined): Health =>
  !account ? 'missing' : account.health === null ? 'unchecked' : account.health === 'healthy' ? 'healthy' : 'failing';

const HEALTH: Record<Health, string> = {
  healthy: 'healthy',
  unchecked: 'no health check',
  failing: 'failing',
  missing: 'no account linked',
};

/** Every account an app needs, one per requirement, with its health. */
type Need = { requirement: string; label: string | null; health: Health };

const needs = (app: ExecutorApp) =>
  app.requirements.flatMap((requirement): Need[] => {
    const linked = app.accounts.filter((a) => a.requirement === requirement);

    return linked.length
      ? linked.map((a) => ({ requirement, label: a.label, health: healthOf(a) }))
      : [{ requirement, label: null, health: 'missing' }];
  });

/** The apps on Executor: what runs, which accounts they reach, and local source against what's deployed. */
export function ExecutorPage() {
  const slug = useParams().slug ?? '';
  const overview = useDeck<ExecutorOverview>('/executor', 'executor');
  const connected = useConnected();
  const data = overview.data;
  const selected = data?.apps.find((a) => a.slug === slug) ?? data?.apps[0] ?? null;
  const accounts = data?.apps.flatMap(needs) ?? [];
  const unhealthy = accounts.filter((a) => a.health === 'failing' || a.health === 'missing').length;
  const behind = data?.apps.filter((a) => releasesBehind(a, data.framework)).length ?? 0;

  return (
    <div className="deck executor">
      <header className="head">
        <div>
          <h1>Executor</h1>
          <p className="lede">
            {data
              ? [
                  `${data.apps.length} apps running`,
                  unhealthy ? `${unhealthy} accounts need you` : 'every account connected',
                  behind ? `${behind} built on an older apps release` : `host on apps@${data.framework ?? '?'}`,
                ].join(' · ')
              : 'Your apps on Executor'}
          </p>
        </div>
        <span className="ex-head-side">
          <span className="ex-live">
            <span className={connected ? 'dot live' : 'dot idle'} />
            {connected ? 'Live' : 'Connecting…'}
          </span>
          {data && (
            <a className="btn btn-secondary btn-sm" href={data.console} target="_blank" rel="noopener noreferrer">
              Open Executor ↗
            </a>
          )}
        </span>
      </header>
      {overview.error && !data && <Empty>{overview.error}</Empty>}
      {!data && !overview.error && <Empty>Asking Executor…</Empty>}
      {data && (
        <>
          <nav className="ex-apps" aria-label="Apps">
            {data.apps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                framework={data.framework}
                current={app.slug === selected?.slug}
              />
            ))}
          </nav>
          {selected && (
            <AppDetail key={selected.slug} app={selected} console={data.console} reload={overview.reload} />
          )}
        </>
      )}
    </div>
  );
}

function AppCard({ app, framework, current }: { app: ExecutorApp; framework: string | null; current: boolean }) {
  const behind = releasesBehind(app, framework);
  const on = deployedOn(app);

  return (
    <Link to={`/executor/${app.slug}`} className="ex-app" aria-current={current ? 'page' : undefined}>
      <div className="ex-app-top">
        <b>{app.name}</b>
        <span className="mono muted">{app.slug}</span>
        <span className="spacer" />
        <span className={app.activeVersion ? 'ex-state on' : 'ex-state'}>
          <span className={app.activeVersion ? 'dot live' : 'dot idle'} />
          {app.activeVersion ? 'Running' : 'Not deployed'}
        </span>
      </div>
      <ul className="ex-needs">
        {needs(app).map((n) => (
          <li key={`${n.requirement}:${n.label}`} data-health={n.health}>
            <span className="ex-health" aria-hidden />
            <span className="clip">{n.label ?? n.requirement}</span>
            <span className="muted small">{n.health === 'healthy' ? n.requirement : HEALTH[n.health]}</span>
          </li>
        ))}
      </ul>
      <dl className="ex-facts">
        <div>
          <dt>Deployed</dt>
          <dd>
            {on ?? 'never'}
            {app.versions > 0 && <span className="muted"> · {app.versions === 1 ? '1 version' : `${app.versions} versions`}</span>}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{app.local ? 'here, in executor-apps' : 'in Executor'}</dd>
        </div>
        {app.pinned && (
          <div>
            <dt>Built on</dt>
            <dd className={behind ? 'ex-behind' : undefined} title={framework ? `The host runs apps@${framework}` : undefined}>
              apps@{app.pinned.replace(/^0\.0\.1-/, '')}
              {behind ? ` · ${behind} ${behind === 1 ? 'release' : 'releases'} behind` : ' · current'}
            </dd>
          </div>
        )}
      </dl>
    </Link>
  );
}

function AppDetail({
  app,
  console: consoleUrl,
  reload,
}: {
  app: ExecutorApp;
  console: string;
  reload: () => Promise<void>;
}) {
  const { busy, run } = useAction();

  const connect = (requirement: string) =>
    run(requirement, async () => {
      const { url } = await send<{ url: string }>(`/executor/${app.slug}/connect`, 'POST', { requirement });

      window.open(url, '_blank', 'noopener');
      notify(`Opened Executor's sign-in for ${requirement}`);
      await reload();
    });

  return (
    <div className="ex-detail">
      <section className="section" aria-labelledby="ex-accounts-title">
        <div className="section-head">
          <h2 id="ex-accounts-title">{app.name}'s accounts</h2>
          <span className="sub">Each requirement is a sign-in the app acts through.</span>
        </div>
        <ul className="ex-reqs">
          {app.requirements.map((req) => {
            const linked = app.accounts.filter((a) => a.requirement === req);

            return (
              <li key={req}>
                <span className="mono ex-req">{req}</span>
                <span className="ex-req-accounts">
                  {linked.length ? (
                    linked.map((a) => (
                      <span key={a.label} data-health={healthOf(a)}>
                        <span className="ex-health" aria-hidden />
                        {a.label}
                        <span className="muted small">{HEALTH[healthOf(a)]}</span>
                      </span>
                    ))
                  ) : (
                    <span data-health="missing">
                      <span className="ex-health" aria-hidden />
                      <span className="muted">No account linked yet</span>
                    </span>
                  )}
                </span>
                <Button size="sm" variant={linked.length ? 'secondary' : 'primary'} loading={busy === req} onClick={() => connect(req)}>
                  {linked.length ? 'Add another' : 'Connect'}
                </Button>
              </li>
            );
          })}
          {!app.requirements.length && <li className="muted">This app signs in to nothing.</li>}
        </ul>
      </section>
      {app.local ? (
        <AppSource app={app} reload={reload} />
      ) : (
        <section className="section ex-hosted">
          <p>
            <b>{app.name}</b> has no copy in executor-apps, so its source lives in Executor.{' '}
            <a href={consoleUrl} target="_blank" rel="noopener noreferrer">
              Edit it there ↗
            </a>
          </p>
        </section>
      )}
    </div>
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
    <section className="section ex-source" aria-labelledby="ex-source-title">
      <div className="section-head">
        <h2 id="ex-source-title">Source</h2>
        <span className="sub">
          {differ
            ? `${differ} of ${files.length} files here differ from what runs`
            : `The ${files.length} files in executor-apps/${app.slug} match what runs`}
        </span>
        <span className="spacer" />
        {differ > 0 && (
          <Button
            size="sm"
            loading={busy === 'deploy'}
            disabled={editing !== null}
            title={editing ? 'Save your edit first' : undefined}
            onClick={deploy}
          >
            Deploy local source
          </Button>
        )}
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
    </section>
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
  const [open, setOpen] = useState(!same);
  const shown = open || editing;
  const lines = local ? local.split('\n').length : 0;

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
    <div className="ex-file" data-open={shown}>
      <div className="ex-file-head">
        <button type="button" className="ex-file-toggle" aria-expanded={shown} onClick={() => setOpen(!open)}>
          <span className="ex-chevron" aria-hidden>
            ›
          </span>
          <span className="mono ex-file-path">{file.path}</span>
          <span className={same ? 'ex-file-state' : 'ex-file-state changed'}>
            {same ? 'same as running' : file.deployed === null ? 'not deployed yet' : 'differs from running'}
          </span>
          <span className="muted small">{lines} lines</span>
        </button>
        {editing ? (
          <Button size="sm" loading={busy === 'save'} onClick={save}>
            Save locally
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              latest.current = null;
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {!shown ? null : files.deployed && !same ? (
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
