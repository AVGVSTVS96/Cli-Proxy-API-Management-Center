import { Link } from 'react-router-dom';
import { useNow } from '@/hooks/useNow';
import { useAccounts, useDeck } from './api';
import { STANDING, accountHue, elapsedAt, fmt, relativeTime, shortAccount, when } from './format';
import { useWidth } from './useWidth';
import type { Account, AccountsView } from './types';
import './deck.scss';
import './home.scss';

const WEEK = 7 * 86_400_000;

const utcDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Where a plan's week is heading if its pace holds: used share over time gone, as in Headroom. */
function paceOf(a: Account, now: number) {
  const used = a.week.used;
  const gone = elapsedAt(a.week, now);
  const resetsAt = a.week.resetsAt;

  if (used === null || gone === null || resetsAt === null) return null;
  const limited = used >= a.week.cutoff;
  const pace = gone > 0.01 ? used / 100 / gone : 0;
  const runsOut = !limited && pace > 1 ? resetsAt - WEEK + (WEEK * gone * 100) / used : null;

  return { used, gone, pace, resetsAt, limited, runsOut, atReset: Math.min(100, pace * 100) };
}

type Pace = NonNullable<ReturnType<typeof paceOf>>;

export function HomeOverview() {
  const { accounts, pool } = useAccounts();
  const view = useDeck<AccountsView>('/accounts', 'accounts');
  const now = useNow();
  const ids = accounts.map((a) => a.id);
  const plans = accounts.filter((a) => !a.credit);
  const next = accounts.find((a) => a.id === pool?.next);
  const paced = plans
    .map((a) => ({ a, p: paceOf(a, now) }))
    .filter((x): x is { a: Account; p: Pace } => x.p !== null)
    .sort(
      (x, y) =>
        Number(x.p.limited) - Number(y.p.limited) ||
        (x.p.limited ? x.p.resetsAt - y.p.resetsAt : y.p.pace - x.p.pace)
    );
  const limited = paced.filter((x) => x.p.limited).sort((x, y) => x.p.resetsAt - y.p.resetsAt);

  if (!accounts.length) return null;

  return (
    <div className="deck home">
      <header className="home-head">
        <h1>
          {next ? (
            <>
              New work runs on{' '}
              <span data-c={accountHue(next.id, ids)}>{shortAccount(next.label)}</span>.
            </>
          ) : (
            'No account can take new work.'
          )}
        </h1>
        <p className="home-sub">
          {next && <>{nextLine(next, now)} </>}
          {limited.length > 0 &&
            `${limited.length} of ${plans.length} plans are at their weekly cutoff; ${shortAccount(
              limited[0].a.label
            )} is back ${when(limited[0].p.resetsAt)}.`}
        </p>
      </header>

      <Pools accounts={accounts} ids={ids} now={now} />

      {paced.length > 0 && (
        <Pace
          paced={paced}
          ids={ids}
          view={view.data}
          now={now}
          cutoff={pool?.policy.weeklyCutoff}
        />
      )}

      <Ledger accounts={accounts} ids={ids} next={pool?.next ?? null} now={now} />
    </div>
  );
}

function nextLine(a: Account, now: number) {
  if (a.credit)
    return `API credit, ${fmt.usd(a.credit.remaining)} left of ${fmt.usd(a.credit.allowance)}.`;
  const gone = elapsedAt(a.week, now);
  const used =
    a.week.used === null ? 'no reading yet' : `${Math.round(a.week.used)}% of its week used`;

  return `${a.plan || 'Claude plan'}, ${used}${gone === null ? '' : `, ${fmt.pct(gone)} of the week gone`}.`;
}

/** Ben Davis's pool header: what's left across every account, one segment each. */
function Pools({ accounts, ids, now }: { accounts: Account[]; ids: string[]; now: number }) {
  const plans = accounts.filter((a) => !a.credit);
  const weekly = plans.filter((a) => a.week.used !== null);
  const fiveHour = plans.filter((a) => a.fiveHour.used !== null);
  const grants = accounts.flatMap((a) => (a.credit && now < a.credit.expiresAt ? [a] : []));
  const cloud = plans.flatMap((a) =>
    a.cloud && a.cloud.limit && (a.cloud.expiresAt === null || now < a.cloud.expiresAt) ? [a] : []
  );
  const nextReset = weekly
    .map((a) => a.week.resetsAt)
    .filter((t): t is number => t !== null)
    .sort((x, y) => x - y)[0];
  const nextFive = fiveHour
    .filter((a) => a.fiveHour.used! > 0)
    .map((a) => a.fiveHour.resetsAt)
    .filter((t): t is number => t !== null)
    .sort((x, y) => x - y)[0];
  const renews = grants
    .map((a) => a.credit!.renewsAt)
    .filter((t) => t > 0)
    .sort((x, y) => x - y)[0];

  return (
    <section className="pools" aria-label="What's left in each pool">
      {weekly.length > 0 && (
        <Pool
          title="Plans · this week"
          value={`${Math.round(weekly.reduce((n, a) => n + 100 - Math.min(100, a.week.used!), 0))}%`}
          of={`left of ${weekly.length * 100}%`}
          segments={weekly.map((a) => ({
            id: a.id,
            name: shortAccount(a.label),
            hue: accountHue(a.id, ids),
            left: 100 - Math.min(100, a.week.used!),
            text: `${Math.round(100 - Math.min(100, a.week.used!))}%`,
          }))}
          foot={nextReset ? `Next reset ${when(nextReset)}` : 'No reset time yet'}
        />
      )}
      {fiveHour.length > 0 && (
        <Pool
          title="Plans · five hours"
          value={`${Math.round(fiveHour.reduce((n, a) => n + 100 - Math.min(100, a.fiveHour.used!), 0))}%`}
          of={`left of ${fiveHour.length * 100}%`}
          segments={fiveHour.map((a) => ({
            id: a.id,
            name: shortAccount(a.label),
            hue: accountHue(a.id, ids),
            left: 100 - Math.min(100, a.fiveHour.used!),
            text: `${Math.round(100 - Math.min(100, a.fiveHour.used!))}%`,
          }))}
          foot={nextFive ? `Next reset ${when(nextFive)}` : undefined}
        />
      )}
      {grants.length > 0 && (
        <Pool
          title="API credit"
          value={fmt.usd(grants.reduce((n, a) => n + Math.max(0, a.credit!.remaining), 0))}
          of={`left of ${fmt.usd(grants.reduce((n, a) => n + a.credit!.allowance, 0))}`}
          segments={grants.map((a) => ({
            id: a.id,
            name: shortAccount(a.label).replace(/ API$/, ''),
            hue: accountHue(a.id, ids),
            left: (Math.max(0, a.credit!.remaining) / a.credit!.allowance) * 100,
            text: fmt.usd(Math.max(0, a.credit!.remaining)),
          }))}
          foot={renews ? `Next grant ${utcDay.format(renews)}` : undefined}
        />
      )}
      {cloud.length > 0 && (
        <Pool
          title="Cloud credit"
          value={fmt.usd(cloud.reduce((n, a) => n + (a.cloud!.remaining ?? 0), 0))}
          of={`left of ${fmt.usd(cloud.reduce((n, a) => n + (a.cloud!.limit ?? 0), 0))}`}
          segments={cloud.map((a) => ({
            id: a.id,
            name: shortAccount(a.label),
            hue: accountHue(a.id, ids),
            left: ((a.cloud!.remaining ?? 0) / a.cloud!.limit!) * 100,
            text: fmt.usd(a.cloud!.remaining ?? 0),
          }))}
          foot="claude --cloud only"
        />
      )}
    </section>
  );
}

function Pool({
  title,
  value,
  of,
  segments,
  foot,
}: {
  title: string;
  value: string;
  of: string;
  segments: { id: string; name: string; hue: string; left: number; text: string }[];
  foot?: string;
}) {
  return (
    <article className="pool">
      <h2>{title}</h2>
      <p className="pool-value">
        <b>{value}</b> <span>{of}</span>
      </p>
      <div className="pool-bar" aria-hidden>
        {segments.map((s) => (
          <span key={s.id} data-c={s.hue}>
            <i style={{ width: `${Math.max(0, Math.min(100, s.left))}%` }} />
          </span>
        ))}
      </div>
      <ul className="pool-keys">
        {segments.map((s) => (
          <li key={s.id} data-c={s.hue}>
            <i className="swatch" data-c={s.hue} aria-hidden />
            <span className="clip">{s.name}</span>
            <b className="num">{s.text}</b>
          </li>
        ))}
      </ul>
      {foot && <p className="pool-foot">{foot}</p>}
    </article>
  );
}

const PAD = { top: 26, right: 18, bottom: 28, left: 40 };
const HEIGHT = 300;

/** Headroom's pace view: each plan's week from window start to reset, against even pace. */
function Pace({
  paced,
  ids,
  view,
  now,
  cutoff = 100,
}: {
  paced: { a: Account; p: Pace }[];
  ids: string[];
  view: AccountsView | null;
  now: number;
  cutoff?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (f: number) => PAD.left + Math.max(0, Math.min(1, f)) * plotW;
  const y = (v: number) => PAD.top + plotH * (1 - Math.max(0, Math.min(100, v)) / 100);
  const lead = paced.find((x) => !x.p.limited) ?? paced[0];
  const name = (a: Account) => shortAccount(a.label);

  const title = lead.p.limited
    ? `Every plan is at its weekly cutoff`
    : lead.p.used < 1
      ? `${name(lead.a)} has its full week left`
      : Math.abs(lead.p.pace - 1) < 0.05
        ? `${name(lead.a)} is right on even pace`
        : `${name(lead.a)} is ${lead.p.pace.toFixed(1)}× even pace`;
  const early = lead.p.runsOut ? Math.round((lead.p.resetsAt - lead.p.runsOut) / 3_600_000) : 0;
  const sub = lead.p.limited
    ? `First back: ${name(lead.a)}, ${when(lead.p.resetsAt)}.`
    : lead.p.used < 1
      ? `Its week resets ${when(lead.p.resetsAt)}.`
      : early >= 1
        ? `Runs out ${when(lead.p.runsOut!)} if the pace holds, ${early} h before its reset.`
        : `On pace to end its week near ${Math.round(lead.p.atReset)}%.`;

  return (
    <section className="section pace" aria-labelledby="pace-title">
      <div className="pace-head">
        <h2 id="pace-title">{title}</h2>
        <p className="muted">{sub}</p>
      </div>
      <div className="pace-body">
        <div className="pace-chart" ref={ref}>
          {width > 0 && (
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              aria-label="Each plan's weekly use against even pace"
            >
              <defs>
                <pattern
                  id="pace-hatch"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
                </pattern>
              </defs>
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line className="grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} />
                  <text className="axis" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
                    {v}%
                  </text>
                </g>
              ))}
              {(['Window start', '¼', '½', '¾', 'Reset'] as const).map((label, i) =>
                plotW < 420 && i % 2 ? null : (
                  <text
                    key={label}
                    className="axis"
                    x={x(i / 4)}
                    y={HEIGHT - 8}
                    textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
                  >
                    {label}
                  </text>
                )
              )}
              <line className="even" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(100)} />
              <text className="even-label" x={x(0.86)} y={y(86) - 8} textAnchor="middle">
                Even pace
              </text>
              {cutoff < 100 && (
                <line className="cut" x1={x(0)} x2={x(1)} y1={y(cutoff)} y2={y(cutoff)} />
              )}
              {paced.map(({ a, p }) => {
                const start = p.resetsAt - WEEK;
                const points =
                  (view?.history ?? [])
                    .find((h) => h.account === a.id && h.kind === 'week')
                    ?.points.filter(([at]) => at >= start && at <= now)
                    .map(([at, used]) => [(at - start) / WEEK, used] as const) ?? [];
                const line = [[0, 0] as const, ...points, [p.gone, p.used] as const];
                const lockFrom = p.limited ? p.gone : p.runsOut ? (p.runsOut - start) / WEEK : null;
                return (
                  <g key={a.id} data-c={accountHue(a.id, ids)}>
                    {lockFrom !== null && (
                      <rect
                        className="locked"
                        x={x(lockFrom)}
                        y={y(100) - 6}
                        width={Math.max(0, x(1) - x(lockFrom))}
                        height={6}
                        fill="url(#pace-hatch)"
                      />
                    )}
                    <polyline
                      className="used"
                      points={line.map(([f, v]) => `${x(f)},${y(v)}`).join(' ')}
                    />
                    {!p.limited && (
                      <line
                        className="projected"
                        x1={x(p.gone)}
                        y1={y(p.used)}
                        x2={x(p.runsOut ? (p.runsOut - start) / WEEK : 1)}
                        y2={y(p.runsOut ? 100 : p.atReset)}
                      />
                    )}
                    {p.runsOut && (
                      <circle
                        className="runs-out"
                        cx={x((p.runsOut - start) / WEEK)}
                        cy={y(100)}
                        r={4.5}
                      />
                    )}
                    <circle className="now" cx={x(p.gone)} cy={y(p.used)} r={4} />
                    {!p.limited && (
                      <text
                        className="now-label"
                        x={x(p.gone) + 8}
                        y={y(p.used) + (p.used > 92 ? 14 : -8)}
                      >
                        {Math.round(p.used)}%
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <ol className="pace-list" aria-label="Plans, fastest first">
          {paced.map(({ a, p }) => (
            <li key={a.id} data-c={accountHue(a.id, ids)}>
              <i className="swatch" data-c={accountHue(a.id, ids)} aria-hidden />
              <span className="clip">{name(a)}</span>
              <b className="num">{p.limited ? '—' : `${p.pace.toFixed(1)}×`}</b>
              <span className={p.limited || p.runsOut ? 'num bad' : 'num muted'}>
                {p.limited
                  ? `back ${when(p.resetsAt)}`
                  : p.runsOut
                    ? `runs out ${when(p.runsOut)}`
                    : `~${Math.round(p.atReset)}% at reset`}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="pace-key small muted">
        <span className="k used">Used so far</span>
        <span className="k projected">If the pace holds</span>
        <span className="k locked">At the cutoff until reset</span>
      </p>
    </section>
  );
}

/** Theo's quota ledger: one row per credential, each window side by side. */
function Ledger({
  accounts,
  ids,
  next,
  now,
}: {
  accounts: Account[];
  ids: string[];
  next: string | null;
  now: number;
}) {
  return (
    <section className="section ledger" aria-labelledby="ledger-title">
      <div className="section-head">
        <h2 id="ledger-title">Credentials</h2>
        <span className="spacer" />
        <Link to="/accounts" className="small">
          Accounts →
        </Link>
      </div>
      <div className="ledger-rows" role="table" aria-label="Every credential's limits">
        <div className="ledger-row ledger-labels" role="row">
          <span role="columnheader">Credential</span>
          <span role="columnheader">Week or credit</span>
          <span role="columnheader">Five hours</span>
          <span role="columnheader">Working</span>
          <span role="columnheader">Status</span>
        </div>
        {accounts.map((a) => {
          const hue = accountHue(a.id, ids);
          const read = a.week.sampledAt ?? a.fiveHour.sampledAt;
          const stale = !a.credit && read !== null && now - read > 25 * 60_000;
          return (
            <div
              key={a.id}
              className={a.id === next ? 'ledger-row next' : 'ledger-row'}
              role="row"
              data-c={hue}
            >
              <span role="cell" className="ledger-name">
                <i className="swatch" data-c={hue} aria-hidden />
                <span className="clip">
                  <b title={a.label}>{shortAccount(a.label)}</b>
                  <span className="muted small">
                    {a.plan || 'Claude plan'}
                    {stale && <span className="warn"> · read {relativeTime(read!)}</span>}
                  </span>
                </span>
              </span>
              <span role="cell">
                {a.credit ? (
                  <Bar
                    share={(Math.max(0, a.credit.remaining) / a.credit.allowance) * 100}
                    text={`${fmt.usd(Math.max(0, a.credit.remaining))} left`}
                    foot={`expires ${utcDay.format(a.credit.expiresAt)} UTC`}
                    bad={a.credit.remaining < 1 || now >= a.credit.expiresAt}
                    left
                  />
                ) : (
                  <Bar
                    share={a.week.used}
                    text={a.week.used === null ? 'no reading' : `${Math.round(a.week.used)}%`}
                    foot={a.week.resetsAt ? `resets ${when(a.week.resetsAt)}` : ''}
                    bad={a.week.used !== null && a.week.used >= a.week.cutoff}
                  />
                )}
              </span>
              <span role="cell">
                {a.credit ? null : (
                  <Bar
                    share={a.fiveHour.used}
                    text={
                      a.fiveHour.used === null ? 'no reading' : `${Math.round(a.fiveHour.used)}%`
                    }
                    foot={
                      a.fiveHour.resetsAt && a.fiveHour.used
                        ? `resets ${when(a.fiveHour.resetsAt)}`
                        : ''
                    }
                    bad={a.fiveHour.used !== null && a.fiveHour.used >= a.fiveHour.cutoff}
                  />
                )}
              </span>
              <span role="cell" className="num">
                {a.working}
              </span>
              <span role="cell">
                <span className={`chip standing ${a.standing}`}>{STANDING[a.standing]}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Bar({
  share,
  text,
  foot,
  bad,
  left = false,
}: {
  share: number | null;
  text: string;
  foot: string;
  bad: boolean;
  /** The share is what's left, not what's used. */
  left?: boolean;
}) {
  return (
    <span className={share === null ? 'bar-cell unread' : 'bar-cell'}>
      <span className="bar-line">
        <span className="bar-track" aria-hidden>
          {share !== null && (
            <i
              className={bad ? 'bad' : left ? 'left' : undefined}
              style={{ width: `${Math.min(100, share)}%` }}
            />
          )}
        </span>
        <b className={bad ? 'num bad' : 'num'}>{text}</b>
      </span>
      {foot && <span className="muted small">{foot}</span>}
    </span>
  );
}
