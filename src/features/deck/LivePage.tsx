import { Link } from 'react-router-dom';
import { useNow } from '@/hooks/useNow';
import { LIVE_ORDER, useAccounts, useDeck, useLiveList } from './api';
import { Alert, SdkMark, isAgentSdk } from './components';
import { useWidth } from './useWidth';
import { STANDING, accountHue, shortAccount, when } from './format';
import type { Account, AccountsView, LiveSession, Move, MoveCause } from './types';
import './deck.scss';
import './live.scss';

const APP_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  t3: 'T3 Code',
  buzz: 'Buzz',
  voice: 'Voice',
};

const appName = (app: string | null) => (app ? (APP_LABEL[app] ?? app) : 'Jobs and agents');

const CAUSE: Record<MoveCause, string> = {
  start: 'started',
  restart: 'restarted',
  early: 'moved early',
  over: 'moved off a cutoff',
  limit: 'moved off a limit',
};

const DAY = 86_400_000;

/** "now", "12m", "4h", "3d": how long something has been so, short enough for a column. */
const span = (since: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;

  return `${Math.floor(minutes / 1440)}d`;
};

const home = (cwd: string) => cwd.replace(/^\/(home|Users)\/[^/]+/, '~') || '~';

/** Each account in the hue Accounts and Usage draw it in. */
function useAccountHues(accounts: Account[]) {
  const ids = accounts.map((a) => a.id);

  return (id: string | null) => (id ? accountHue(id, ids) : 'muted');
}

export function LivePage() {
  const sessions = useLiveList('s:').map(([, s]) => s);
  const { accounts, pool, name } = useAccounts();
  const view = useDeck<AccountsView>('/accounts', 'accounts');
  const hue = useAccountHues(accounts);
  const now = useNow();
  const cutoff = now - DAY;

  const sorted = [...sessions].sort(
    (a, b) => LIVE_ORDER[a.state] - LIVE_ORDER[b.state] || b.since - a.since
  );
  const waiting = sorted.filter((s) => s.state === 'blocked' && s.since >= cutoff);
  const stale = sorted.filter((s) => s.state === 'blocked' && s.since < cutoff);
  const running = sorted.filter((s) => s.state !== 'blocked');
  const working = running.filter((s) => s.state === 'working').length;
  const groups = groupByApp(running);
  const hosts = new Set(sessions.map((s) => s.host));
  const moves = (view.data?.moves ?? []).filter((m) => m.at >= cutoff).sort((a, b) => b.at - a.at);
  const moved = moves.filter((m) => m.cause !== 'start');
  const started = moves.length - moved.length;

  const row = (s: LiveSession) => (
    <SessionRow key={s.id} session={s} now={now} account={s.account ? shortAccount(name(s.account)) : null} hue={hue(s.account)} />
  );

  return (
    <div className="deck live">
      <header className="head">
        <div>
          <h1>Live</h1>
          <p className="lede">
            {waiting.length} waiting on you · {working} working · {running.length - working} idle, on{' '}
            {[...hosts].join(', ') || 'no host'}
          </p>
        </div>
        <Channels />
      </header>

      {(waiting.length > 0 || stale.length > 0) && (
        <section className="section lv-waiting" aria-labelledby="waiting-title">
          <div className="section-head">
            <h2 id="waiting-title">Waiting on you</h2>
            <span className="sub">Sessions stopped on a question for you, newest first</span>
          </div>
          {waiting.length > 0 ? (
            <ul className="lv-rows">{waiting.map(row)}</ul>
          ) : (
            <p className="pad muted">Nothing from the last day.</p>
          )}
          {stale.length > 0 && (
            <details className="lv-stale">
              <summary>
                {stale.length} more, waiting over a day
              </summary>
              <ul className="lv-rows">{stale.map(row)}</ul>
            </details>
          )}
        </section>
      )}

      <div className="lv-grid">
        <section className="section lv-running" aria-labelledby="running-title">
          <div className="section-head">
            <h2 id="running-title">Running now</h2>
            <span className="sub">
              {working} working · {running.length - working} idle
            </span>
          </div>
          {running.length ? (
            groups.map(([app, list]) => (
              <div key={app ?? 'jobs'} className="lv-group" role="group" aria-label={appName(app)}>
                <div className="lv-group-head">
                  <span>{appName(app)}</span>
                  <span className="num">{list.length}</span>
                </div>
                <ul className="lv-rows">{list.map(row)}</ul>
              </div>
            ))
          ) : (
            <p className="pad muted">Nothing is running right now.</p>
          )}
        </section>

        <aside className="lv-side">
          <section className="section" aria-labelledby="load-title">
            <div className="section-head">
              <h2 id="load-title">Sessions by account</h2>
            </div>
            <AccountLoad
              accounts={accounts}
              sessions={running}
              next={pool?.next ?? null}
              hue={hue}
            />
          </section>

          <section className="section" aria-labelledby="moves-title">
            <div className="section-head">
              <h2 id="moves-title">Last 24 hours</h2>
              <span className="sub">
                {started.toLocaleString('en')} started · {moved.length} moved
              </span>
            </div>
            {view.error ? (
              <div className="pad">
                <Alert>{view.error}</Alert>
              </div>
            ) : !view.data ? (
              <p className="pad muted">Reading moves…</p>
            ) : moves.length ? (
              <>
                <Lanes moves={moves} accounts={accounts} from={cutoff} hue={hue} />
                {moved.length > 0 && (
                <details className="lv-moves">
                  <summary>
                    {moved.length} {moved.length === 1 ? 'move' : 'moves'}, newest first
                  </summary>
                  <ol>
                    {moved.map((m) => (
                      <li key={`${m.at}:${m.session}`}>
                        <span className="num muted">{when(m.at)}</span>
                        <span className="clip">
                          <b>{m.label ?? m.session.slice(0, 8)}</b>{' '}
                          <span className={`lv-cause ${m.cause}`}>{CAUSE[m.cause]}</span>
                        </span>
                        <span className="muted small lv-path">
                          {m.from ? `${shortAccount(name(m.from))} → ` : 'onto '}
                          {shortAccount(name(m.to))}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
                )}
              </>
            ) : (
              <p className="pad muted">No starts or moves in the last day.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Thread apps in a fixed order, then everything without a thread. */
function groupByApp(sessions: LiveSession[]) {
  const order = Object.keys(APP_LABEL);
  const groups = new Map<string | null, LiveSession[]>();

  for (const s of sessions) groups.set(s.app, [...(groups.get(s.app) ?? []), s]);

  const rank = (app: string | null) => (app === null ? 99 : order.indexOf(app) + 1 || 50);

  return [...groups].sort(([a], [b]) => rank(a) - rank(b));
}

function SessionRow({
  session: s,
  now,
  account,
  hue,
}: {
  session: LiveSession;
  now: number;
  account: string | null;
  hue: string;
}) {
  const verb = s.state === 'blocked' ? 'waiting' : s.state === 'working' ? 'working' : 'idle';

  return (
    <li className="lv-row" data-state={s.state}>
      <span className="lv-name">
        <span className={`dot ${s.state}`} role="img" aria-label={verb} />
        <Link to={`/usage?sel=${encodeURIComponent(s.row)}`} className="clip">
          {s.label}
        </Link>
        {isAgentSdk(s.entrypoint) && <SdkMark share={1} />}
        {s.state === 'blocked' && s.app && <span className="lv-app">{appName(s.app)}</span>}
      </span>
      <span className="lv-account">
        {account ? (
          <>
            <i className="swatch" data-c={hue} aria-hidden />
            <span className="clip">{account}</span>
          </>
        ) : (
          <span className="muted" title="The pool hasn't seated this session on an account">
            no seat
          </span>
        )}
      </span>
      <span className="lv-folder mono muted clip" title={s.cwd}>
        {home(s.cwd)}
      </span>
      <span className="lv-since num" title={`Since ${new Date(s.since).toLocaleString()}`}>
        {span(s.since, now)}
      </span>
    </li>
  );
}

/** Who carries the work now: each account's working and idle sessions, from the live list. */
function AccountLoad({
  accounts,
  sessions,
  next,
  hue,
}: {
  accounts: Account[];
  sessions: LiveSession[];
  next: string | null;
  hue: (id: string | null) => string;
}) {
  const rows = accounts.map((a) => ({
    id: a.id as string | null,
    label: shortAccount(a.label),
    standing: a.standing,
    working: sessions.filter((s) => s.account === a.id && s.state === 'working').length,
    idle: sessions.filter((s) => s.account === a.id && s.state === 'idle').length,
  }));
  const unseated = sessions.filter((s) => !s.account || !accounts.some((a) => a.id === s.account));

  if (unseated.length) {
    rows.push({
      id: null,
      label: 'no seat',
      standing: 'open',
      working: unseated.filter((s) => s.state === 'working').length,
      idle: unseated.filter((s) => s.state === 'idle').length,
    });
  }

  const max = Math.max(1, ...rows.map((r) => r.working + r.idle));

  if (!rows.length) return <p className="pad muted">No accounts in the pool.</p>;

  return (
    <ul className="lv-load">
      {rows.map((r) => (
        <li key={r.id ?? 'none'} data-c={hue(r.id)}>
          <div className="lv-load-label">
            <span className="clip">{r.label}</span>
            {r.id === next && <span className="lv-next">next</span>}
            {r.id && r.standing !== 'open' && r.standing !== 'next' && (
              <span className={`lv-standing ${r.standing}`}>{STANDING[r.standing]}</span>
            )}
            <span className="spacer" />
            <span className="num">
              <b>{r.working}</b> <span className="muted">working · {r.idle} idle</span>
            </span>
          </div>
          <div className="lv-load-bar" aria-hidden>
            <span className="w" style={{ width: `${(r.working / max) * 100}%` }} />
            <span className="i" style={{ width: `${(r.idle / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const LANE = 50;
const BINS = 48;

/**
 * One lane per account across the last day: how many sessions started on it each half hour, and a
 * mark for each session the pool moved onto it. Thousands of one-shot runs start a day, so starts
 * read as a density, and moves, the rare decisions, as marks above it.
 */
function Lanes({
  moves,
  accounts,
  from,
  hue,
}: {
  moves: Move[];
  accounts: Account[];
  from: number;
  hue: (id: string | null) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const label = new Map(accounts.map((a) => [a.id, shortAccount(a.label)]));
  const ids = [...new Set([...accounts.map((a) => a.id), ...moves.map((m) => m.to)])];
  const bin = (t: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((t - from) / DAY) * BINS)));
  const starts = new Map(ids.map((id) => [id, new Array<number>(BINS).fill(0)]));

  for (const m of moves) if (m.cause === 'start') starts.get(m.to)![bin(m.at)]++;

  const peak = Math.max(1, ...[...starts.values()].flat());
  const pad = 2;
  const step = Math.max(0, width - pad * 2) / BINS;
  const x = (t: number) => pad + ((t - from) / DAY) * step * BINS;
  const height = ids.length * LANE + 18;
  const hours = [0, 6, 12, 18, 24].map((h) => from + h * 3_600_000);
  const barTop = 24;
  const barHeight = LANE - barTop - 4;

  return (
    <div className="lv-lanes pad" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Sessions started per half hour and moves in the last 24 hours, by account`}
        >
          {hours.map((t) => (
            <line key={t} className="lv-hour" x1={x(t)} x2={x(t)} y1={0} y2={height - 16} />
          ))}
          {ids.map((id, i) => {
            const counts = starts.get(id)!;
            const total = counts.reduce((sum, n) => sum + n, 0);

            return (
              <g key={id} transform={`translate(0 ${i * LANE})`} data-c={hue(id)}>
                <text className="lv-lane-label" x={pad} y={11}>
                  {label.get(id) ?? id}
                  <tspan className="lv-lane-count" dx={6}>
                    {total.toLocaleString('en')} started
                  </tspan>
                </text>
                <line className="lv-lane-base" x1={pad} x2={width - pad} y1={LANE - 3.5} y2={LANE - 3.5} />
                {counts.map((n, b) =>
                  n ? (
                    <rect
                      key={b}
                      className="lv-bin"
                      x={pad + b * step + 0.5}
                      width={Math.max(1, step - 1)}
                      y={barTop + barHeight * (1 - Math.sqrt(n / peak))}
                      height={Math.max(1.5, barHeight * Math.sqrt(n / peak))}
                      rx={1}
                    >
                      <title>{`${n} started, ${when(from + (b * DAY) / BINS)}`}</title>
                    </rect>
                  ) : null
                )}
                {moves
                  .filter((m) => m.to === id && m.cause !== 'start')
                  .map((m) => (
                    <path
                      key={`${m.at}:${m.session}`}
                      className={`lv-move ${m.cause}`}
                      d={`M${x(m.at)} ${barTop - 1}l3.5 -4.5h-7z`}
                    >
                      <title>{`${m.label ?? m.session} ${CAUSE[m.cause]}, ${when(m.at)}`}</title>
                    </path>
                  ))}
              </g>
            );
          })}
          {hours.map((t, i) => (
            <text
              key={t}
              className="lv-axis"
              x={x(t)}
              y={height - 3}
              textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
              display={width < 360 && i % 2 ? 'none' : undefined}
            >
              {i === 4 ? 'now' : i === 0 ? '24h ago' : `${24 - i * 6}h`}
            </text>
          ))}
        </svg>
      )}
      <div className="lv-key">
        <span>
          <i className="lv-key-bin" /> sessions started
        </span>
        <span>
          <i className="lv-key-move restart" /> moved early or restarted
        </span>
        <span>
          <i className="lv-key-move limit" /> moved off a limit
        </span>
      </div>
    </div>
  );
}

/** hex's apps, each with whether its hub socket is up. */
function Channels() {
  const apps = useLiveList('app:');

  if (!apps.length) return null;

  const down = apps.filter(([, a]) => !a.connected).length;

  return (
    <Link
      to="/claude-plugins"
      className="lv-channels"
      title={down ? `${down} not connected` : 'Every channel is connected'}
    >
      {apps.map(([app, { connected }]) => (
        <span key={app} className={connected ? 'on' : 'off'}>
          <span className={connected ? 'dot live' : 'dot'} />
          {appName(app)}
          <span className="sr">{connected ? ' connected' : ' not connected'}</span>
        </span>
      ))}
    </Link>
  );
}
