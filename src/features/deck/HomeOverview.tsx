import { useState } from 'react';
import { useNow } from '@/hooks/useNow';
import { useAccounts, useDeck } from './api';
import { accountHue, elapsedAt, fmt, shortAccount, when } from './format';
import type { Account, AccountsView } from './types';
import './deck.scss';
import './home.scss';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Even pace: a week's limit spread over its seven days, in points of the limit. */
const ALLOWED = 100 / 7;
/** Recent use decides the pace: an account that only just started taking work has no older history. */
const RECENT = 6 * HOUR;

const dayName = new Intl.DateTimeFormat('en', { weekday: 'short' });
const dayDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const hourOf = (h: number) => `${String(h).padStart(2, '0')}:00`;

type Points = [at: number, used: number][];

/** Points of the limit used in [from, to): rises only, so a reset inside the range adds nothing. */
function usedBetween(points: Points, from: number, to: number) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const [at, used] = points[i];
    if (at < from || at >= to) continue;
    const step = used - points[i - 1][1];
    if (step > 0) sum += step;
  }
  return sum;
}

function valueAt(points: Points, at: number) {
  let value: number | null = null;
  for (const [t, used] of points) {
    if (t > at) break;
    value = used;
  }
  return value;
}

/** A plan's week: used, where it's heading at its recent rate, and when it ran out or will. */
function weekOf(a: Account, points: Points, now: number) {
  const used = a.week.used;
  const resetsAt = a.week.resetsAt;
  const gone = elapsedAt(a.week, now);
  if (used === null || resetsAt === null || gone === null) return null;

  const start = resetsAt - WEEK;
  // A drop is a reset (a plan change or a held reset spent); pace only counts what came after.
  const reset = points.reduce((t, [at, v], i) => (i && v < points[i - 1][1] - 0.5 ? at : t), 0);
  const since = Math.max(start, now - RECENT, points[0]?.[0] ?? now, reset);
  const hours = (now - since) / HOUR;
  const rate =
    hours >= 1 ? usedBetween(points, since, now + 1) / hours : gone > 0 ? used / (gone * 168) : 0;
  const limited = used >= a.week.cutoff;
  const left = Math.max(0, (resetsAt - now) / HOUR);
  const atReset = Math.min(100, used + rate * left);
  const runsOut =
    !limited && rate > 0 && atReset >= 100 ? now + ((100 - used) / rate) * HOUR : null;
  const ranOut = limited
    ? (points.find(([t, v]) => t >= start && v >= a.week.cutoff)?.[0] ?? null)
    : null;

  return {
    used,
    resetsAt,
    start,
    limited,
    runsOut,
    ranOut,
    atReset,
    pace: rate / (100 / 168),
    evenNow: gone * 100,
  };
}

type Week = NonNullable<ReturnType<typeof weekOf>>;
type Plan = { a: Account; w: Week; points: Points; hue: string };

/** The seven days of a plan's current week: used per day, or the recent pace for days ahead. */
function daysOf({ a, w, points }: Plan, now: number) {
  const rate = w.limited ? 0 : w.pace * ALLOWED;
  let budget = 100 - w.used;
  return Array.from({ length: 7 }, (_, i) => {
    const from = w.start + i * DAY;
    const to = from + DAY;
    const ahead = from > now;
    const atStart = valueAt(points, from) ?? 0;
    const locked = w.ranOut !== null && from >= w.ranOut;
    const ranOut = w.ranOut !== null && w.ranOut >= from && w.ranOut < to;
    let forecast = 0;
    if (!w.limited && to > now) {
      const share = ahead ? 1 : (to - now) / DAY;
      forecast = Math.min(budget, rate * share);
      budget -= forecast;
    }
    return {
      from,
      used: ahead ? 0 : usedBetween(points, from, Math.min(to, now + 1)),
      forecast,
      locked: locked || (atStart >= a.week.cutoff && !ahead),
      ranOut,
      today: from <= now && now < to,
    };
  });
}

export function HomeOverview() {
  const { accounts, pool } = useAccounts();
  const view = useDeck<AccountsView>('/accounts', 'accounts');
  const now = useNow();

  // One hue per login: an API key wears the colour of the login whose credit it spends.
  const logins = accounts.filter((a) => !a.credit).map((a) => a.id);
  const hueOf = (a: Account) => accountHue(a.credit?.account ?? a.id, logins);
  const history = (id: string): Points =>
    (view.data?.history.find((h) => h.account === id && h.kind === 'week')?.points ?? []) as Points;

  const plans: Plan[] = accounts
    .filter((a) => !a.credit)
    .flatMap((a) => {
      const points = history(a.id);
      const w = weekOf(a, points, now);
      return w ? [{ a, w, points, hue: hueOf(a) }] : [];
    })
    .sort(
      (x, y) =>
        Number(x.w.limited) - Number(y.w.limited) ||
        (x.w.limited ? x.w.resetsAt - y.w.resetsAt : y.w.pace - x.w.pace)
    );
  const next = accounts.find((a) => a.id === pool?.next);
  const open = plans.filter((p) => !p.w.limited);
  const locked = plans.filter((p) => p.w.limited);
  const credit = accounts
    .filter((a) => a.credit && now < a.credit.expiresAt)
    .reduce((n, a) => n + Math.max(0, a.credit!.remaining), 0);

  if (!accounts.length) return null;

  return (
    <div className="deck home">
      <header className="home-head">
        <h1>
          {next ? (
            <>
              New work runs on <span data-c={hueOf(next)}>{shortAccount(next.label)}</span>.
            </>
          ) : (
            'No account can take new work.'
          )}
        </h1>
        <p className="home-sub">
          {open.length} of {plans.length} plans have room
          {credit > 0 && `, plus ${fmt.usd(credit)} of API credit`}.
          {locked.length > 0 &&
            ` ${shortAccount(locked[0].a.label)} is back ${when(locked[0].w.resetsAt)}.`}
        </p>
      </header>

      <Pools accounts={accounts} plans={plans} hueOf={hueOf} now={now} />

      {plans.length > 0 && <Weeks plans={plans} now={now} />}

      {plans.length > 0 && <Timeline plans={plans} now={now} />}

      {plans.length > 0 && view.data && <Activity plans={plans} now={now} />}
    </div>
  );
}

/** Ben Davis's pool header: what's left, one bar segment per account. */
function Pools({
  accounts,
  plans,
  hueOf,
  now,
}: {
  accounts: Account[];
  plans: Plan[];
  hueOf: (a: Account) => string;
  now: number;
}) {
  const grants = accounts.filter((a) => a.credit && now < a.credit.expiresAt);
  const five = plans.filter((p) => p.a.fiveHour.used !== null && !p.w.limited);
  const renews = grants
    .map((a) => a.credit!.renewsAt)
    .filter((t) => t > now)
    .sort((x, y) => x - y)[0];

  return (
    <section className="pools" aria-label="What's left">
      <Pool
        title="Plans this week"
        value={`${plans.filter((p) => !p.w.limited).length}`}
        of={`of ${plans.length} have room`}
        segments={plans.map((p) => ({
          id: p.a.id,
          name: shortAccount(p.a.label),
          hue: p.hue,
          left: 100 - Math.min(100, p.w.used),
          text: p.w.limited ? `back ${when(p.w.resetsAt)}` : `${Math.round(100 - p.w.used)}% left`,
          bad: p.w.limited,
        }))}
      />
      {five.length > 0 && (
        <Pool
          title="Five hours"
          value={`${Math.round(100 - Math.min(100, five[0].a.fiveHour.used!))}%`}
          of={`left on ${shortAccount(five[0].a.label)}`}
          segments={five.map((p) => ({
            id: p.a.id,
            name: shortAccount(p.a.label),
            hue: p.hue,
            left: 100 - Math.min(100, p.a.fiveHour.used!),
            text: p.a.fiveHour.resetsAt ? `resets ${when(p.a.fiveHour.resetsAt)}` : '',
            bad: p.a.fiveHour.used! >= p.a.fiveHour.cutoff,
          }))}
        />
      )}
      {grants.length > 0 && (
        <Pool
          title="API credit"
          value={fmt.usd(grants.reduce((n, a) => n + Math.max(0, a.credit!.remaining), 0))}
          of={`of ${fmt.usd(grants.reduce((n, a) => n + a.credit!.allowance, 0))}`}
          segments={grants.map((a) => ({
            id: a.id,
            name: shortAccount(a.label).replace(/ API$/, ''),
            hue: hueOf(a),
            left: (Math.max(0, a.credit!.remaining) / a.credit!.allowance) * 100,
            text: a.credit!.remaining < 1 ? 'empty' : fmt.usd(a.credit!.remaining),
            bad: a.credit!.remaining < 1,
          }))}
          foot={
            <>
              Estimate; the exact balance is in{' '}
              <a
                href="https://platform.claude.com/settings/billing"
                target="_blank"
                rel="noreferrer"
              >
                Console ↗
              </a>
              {renews && ` · next grant ${dayDate.format(renews)}`}
            </>
          }
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
  segments: { id: string; name: string; hue: string; left: number; text: string; bad: boolean }[];
  foot?: React.ReactNode;
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
          <li key={s.id}>
            <i className="swatch" data-c={s.hue} aria-hidden />
            <span className="clip">{s.name}</span>
            <b className={s.bad ? 'num bad' : 'num'}>{s.text}</b>
          </li>
        ))}
      </ul>
      {foot && <p className="pool-foot">{foot}</p>}
    </article>
  );
}

/** Headroom's weekly comparison: each plan's week as seven day bars against even pace. */
function Weeks({ plans, now }: { plans: Plan[]; now: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  const plan = plans.find((p) => p.a.id === picked) ?? plans.find((p) => !p.w.limited) ?? plans[0];
  const early = plans.filter((p) => p.w.ranOut !== null);
  const title = early.length
    ? `${early.length} of ${plans.length} plans ran out before their reset`
    : `Every plan is on pace this week`;
  const sub = early
    .map(
      (p) =>
        `${shortAccount(p.a.label)} ${dayName.format(p.w.ranOut!)} ${when(p.w.ranOut!).replace(/^\w+ /, '')}`
    )
    .join(', ');

  return (
    <section className="panel weeks" aria-labelledby="weeks-title">
      <header className="panel-head">
        <h2 id="weeks-title">{title}</h2>
        {sub && <p>Ran out: {sub}.</p>}
      </header>
      <div className="weeks-body">
        <div className="weeks-grid" role="table" aria-label="This week by day, per plan">
          <div className="weeks-row weeks-labels" role="row">
            <span role="columnheader">Plan</span>
            <span role="columnheader">This week, by day</span>
            <span role="columnheader">Pace</span>
            <span role="columnheader">Outlook</span>
          </div>
          {plans.map((p) => (
            <button
              key={p.a.id}
              type="button"
              role="row"
              className={p === plan ? 'weeks-row picked' : 'weeks-row'}
              onClick={() => setPicked(p.a.id)}
              data-c={p.hue}
            >
              <span role="cell" className="weeks-name">
                <i className="swatch" data-c={p.hue} aria-hidden />
                <span className="clip">
                  <b>{shortAccount(p.a.label)}</b>
                  <span>{p.a.plan}</span>
                </span>
              </span>
              <span role="cell">
                <DayBars plan={p} now={now} />
              </span>
              <span role="cell">
                <span className={p.w.limited ? 'mult bad' : p.w.pace > 1.05 ? 'mult hot' : 'mult'}>
                  {p.w.limited ? 'Locked' : `${p.w.pace.toFixed(2)}×`}
                </span>
              </span>
              <span role="cell" className="weeks-outlook">
                <Outlook w={p.w} />
              </span>
            </button>
          ))}
          <p className="key">
            <span className="k used-day">Used per day</span>
            <span className="k even">Even pace, 14.3 points a day</span>
            <span className="k ahead">Ahead, if the pace holds</span>
            <span className="k locked">Locked until reset</span>
            <span className="k out">Ran out</span>
          </p>
        </div>
        <PlanDetail plan={plan} now={now} />
      </div>
    </section>
  );
}

function Outlook({ w }: { w: Week }) {
  if (w.limited)
    return (
      <>
        <b className="bad">Back {when(w.resetsAt)}</b>
        <span>at {Math.round(w.used)}%</span>
      </>
    );
  if (w.runsOut)
    return (
      <>
        <b className="bad">Runs out {when(w.runsOut)}</b>
        <span>{Math.round((w.resetsAt - w.runsOut) / HOUR)} h before reset</span>
      </>
    );
  return (
    <>
      <b>~{Math.round(w.atReset)}% at reset</b>
      <span>resets {when(w.resetsAt)}</span>
    </>
  );
}

/** Seven small day bars on the plan's own scale, with even pace dashed across. */
function DayBars({ plan, now }: { plan: Plan; now: number }) {
  const days = daysOf(plan, now);
  const top = Math.max(ALLOWED * 2, ...days.map((d) => d.used + d.forecast));
  const y = (v: number) => `${(v / top) * 100}%`;

  return (
    <span className="days" aria-hidden>
      <i className="even" style={{ bottom: y(ALLOWED) }} />
      {days.map((d) => (
        <span key={d.from} className={d.today ? 'day today' : 'day'}>
          {d.locked && <i className="lock" />}
          {d.used > 0 && (
            <i className={d.used > ALLOWED ? 'used over' : 'used'} style={{ height: y(d.used) }} />
          )}
          {d.forecast > 0 && (
            <i className="ahead" style={{ height: y(d.forecast), bottom: y(d.used) }} />
          )}
          {d.ranOut && <i className="out" />}
        </span>
      ))}
    </span>
  );
}

/** Headroom's account detail: the week in big numbers, then use per day with values on the bars. */
function PlanDetail({ plan, now }: { plan: Plan; now: number }) {
  const { a, w } = plan;
  const days = daysOf(plan, now);
  const top = Math.max(ALLOWED * 1.6, ...days.map((d) => d.used + d.forecast)) * 1.15;
  const y = (v: number) => `${(v / top) * 100}%`;

  return (
    <aside className="detail" data-c={plan.hue}>
      <header>
        <i className="swatch" data-c={plan.hue} aria-hidden />
        <div>
          <h3>{shortAccount(a.label)}</h3>
          <p>
            {a.plan} · 7-day limit · resets {when(w.resetsAt)}
          </p>
        </div>
      </header>
      <dl className="stats">
        <div>
          <dt>Used now</dt>
          <dd className={w.limited ? 'bad' : undefined}>{Math.round(w.used)}%</dd>
        </div>
        <div>
          <dt>Even pace by now</dt>
          <dd>{Math.round(w.evenNow)}%</dd>
        </div>
        <div>
          <dt>{w.limited ? 'Locked' : w.runsOut ? 'Runs out' : 'At reset'}</dt>
          <dd className={w.limited || w.runsOut ? 'bad' : undefined}>
            {w.limited
              ? `${Math.round((w.resetsAt - now) / HOUR)} h`
              : w.runsOut
                ? when(w.runsOut)
                : `~${Math.round(w.atReset)}%`}
          </dd>
        </div>
      </dl>
      <h4>
        Use per day <span>points of its limit</span>
      </h4>
      <div className="per-day" aria-label="Use per day">
        <i className="even" style={{ bottom: y(ALLOWED) }}>
          <span>{ALLOWED.toFixed(1)}</span>
        </i>
        {days.map((d) => (
          <span key={d.from} className="col">
            <span className="stack">
              {d.used + d.forecast > 0.5 && (
                <em style={{ bottom: y(d.used + d.forecast) }}>
                  {d.forecast > 0 && d.used < 0.5 ? '~' : ''}
                  {Math.round(d.used + d.forecast)}
                </em>
              )}
              {d.locked && d.used < 0.5 && <i className="lock" />}
              {d.used > 0 && (
                <i
                  className={d.used > ALLOWED ? 'used over' : 'used'}
                  style={{ height: y(d.used) }}
                />
              )}
              {d.forecast > 0 && (
                <i className="ahead" style={{ height: y(d.forecast), bottom: y(d.used) }} />
              )}
            </span>
            <span className={d.today ? 'label today' : 'label'}>{dayName.format(d.from)}</span>
          </span>
        ))}
      </div>
    </aside>
  );
}

/** Headroom's timeline: each plan's limit windows on a shared calendar, with now marked. */
function Timeline({ plans, now }: { plans: Plan[]; now: number }) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const from = today.getTime() - 6 * DAY;
  const to = from + 14 * DAY;
  const x = (t: number) => `${((Math.max(from, Math.min(to, t)) - from) / (to - from)) * 100}%`;
  const width = (a: number, b: number) =>
    `${((Math.min(to, b) - Math.max(from, a)) / (to - from)) * 100}%`;
  const days = Array.from({ length: 14 }, (_, i) => from + i * DAY);

  return (
    <section className="panel timeline" aria-labelledby="timeline-title">
      <header className="panel-head">
        <h2 id="timeline-title">
          {dayDate.format(from)} – {dayDate.format(to - DAY)}
        </h2>
        <p>Weekly windows, two weeks around today.</p>
      </header>
      <div className="tl" role="table" aria-label="Weekly windows per plan">
        <div className="tl-row tl-head" role="row">
          <span role="columnheader" className="tl-who">
            Plan
          </span>
          <span className="tl-track" role="columnheader">
            {days.map((d) => (
              <span key={d} className={d === today.getTime() ? 'tl-day today' : 'tl-day'}>
                {dayName.format(d)}
                <b>{new Date(d).getDate()}</b>
              </span>
            ))}
          </span>
        </div>
        {plans.map((p) => {
          const { w, a } = p;
          const lastStart = w.start - WEEK;
          return (
            <div key={a.id} className="tl-row" role="row" data-c={p.hue}>
              <span role="cell" className="tl-who">
                <b>{shortAccount(a.label)}</b>
                <span className="chips">
                  <Chip label="Week" value={w.used} cutoff={a.week.cutoff} />
                  {a.fiveHour.used !== null && (
                    <Chip label="5 h" value={a.fiveHour.used} cutoff={a.fiveHour.cutoff} />
                  )}
                </span>
              </span>
              <span role="cell" className="tl-track">
                {days.map((d) => (
                  <i key={d} className="tl-grid" style={{ left: x(d) }} />
                ))}
                {w.start > from && (p.points[0]?.[0] ?? now) < w.start && (
                  <span
                    className="win ended"
                    style={{ left: x(lastStart), width: width(lastStart, w.start - HOUR * 2) }}
                  >
                    Ended {dayDate.format(w.start)}
                  </span>
                )}
                <span
                  className={w.limited ? 'win now locked' : 'win now'}
                  style={{ left: x(w.start), width: width(w.start, w.resetsAt - HOUR * 2) }}
                >
                  {w.ranOut && (
                    <i
                      className="win-lock"
                      style={{ left: `${((w.ranOut - w.start) / WEEK) * 100}%` }}
                    />
                  )}
                  <span className="win-label">
                    {w.limited
                      ? `${Math.round(w.used)}% · locked until ${when(w.resetsAt)}`
                      : `${Math.round(w.used)}% used · ${when(w.resetsAt)}`}
                  </span>
                  <span className="win-bar">
                    <i style={{ width: `${Math.min(100, w.used)}%` }} />
                  </span>
                </span>
                <span
                  className="win next"
                  style={{ left: x(w.resetsAt), width: width(w.resetsAt, to) }}
                >
                  Next · {dayDate.format(w.resetsAt + WEEK)}
                </span>
              </span>
            </div>
          );
        })}
        <i
          className="tl-now"
          style={{ left: `calc(var(--who) + (100% - var(--who)) * ${(now - from) / (to - from)})` }}
        >
          <span>Now</span>
        </i>
      </div>
    </section>
  );
}

function Chip({ label, value, cutoff }: { label: string; value: number; cutoff: number }) {
  const tone = value >= cutoff ? 'bad' : value >= cutoff - 20 ? 'warn' : 'ok';
  return (
    <span className={`chip-stat ${tone}`}>
      <i aria-hidden />
      {label} <b>{Math.round(value)}%</b>
    </span>
  );
}

/** Headroom's activity matrix: limit used per hour across every plan, over the last seven days. */
function Activity({ plans, now }: { plans: Plan[]; now: number }) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => today.getTime() - (6 - i) * DAY);
  const cells = days.map((d) =>
    Array.from({ length: 24 }, (_, h) => {
      const from = d + h * HOUR;
      const to = from + HOUR;
      return {
        from,
        future: from > now,
        used: plans.reduce((n, p) => n + usedBetween(p.points, from, to), 0),
        out: plans.filter((p) => {
          const before = valueAt(p.points, from - 1) ?? 0;
          return (
            before < p.a.week.cutoff &&
            p.points.some(([t, v]) => t >= from && t < to && v >= p.a.week.cutoff)
          );
        }),
      };
    })
  );
  const lockedOn = days.map(
    (d) =>
      plans.filter((p) => (valueAt(p.points, Math.min(now, d + DAY - 1)) ?? 0) >= p.a.week.cutoff)
        .length
  );
  const byHour = Array.from({ length: 24 }, (_, h) => cells.reduce((n, row) => n + row[h].used, 0));
  let busiest = 0;
  for (let h = 0; h < 22; h++)
    if (
      byHour[h] + byHour[h + 1] + byHour[h + 2] >
      byHour[busiest] + byHour[busiest + 1] + byHour[busiest + 2]
    )
      busiest = h;
  const runOuts = cells.flat().reduce((n, c) => n + c.out.length, 0);
  const level = (v: number) => (v <= 0 ? 0 : v < 1 ? 1 : v < 3 ? 2 : v < 6 ? 3 : 4);

  return (
    <section className="panel activity" aria-labelledby="activity-title">
      <header className="panel-head">
        <h2 id="activity-title">
          Busiest {hourOf(busiest)}–{hourOf(busiest + 3)}
        </h2>
        <p>
          {runOuts} run-out{runOuts === 1 ? '' : 's'} in 7 days, across {plans.length} plans.
        </p>
      </header>
      <div className="matrix" role="img" aria-label="Weekly limit used per hour, last 7 days">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="m-hour">
            {h % 6 === 0 ? hourOf(h) : ''}
          </span>
        ))}
        <span className="m-hour">Locked</span>
        {cells.map((row, i) => (
          <div key={days[i]} className="m-row">
            <span className="m-day">
              {dayName.format(days[i])} <b>{new Date(days[i]).getDate()}</b>
            </span>
            {row.map((c) => (
              <span
                key={c.from}
                className={c.future ? 'cell future' : `cell l${level(c.used)}`}
                title={
                  c.future
                    ? undefined
                    : `${dayName.format(c.from)} ${hourOf(new Date(c.from).getHours())}: ${fmt.pts(c.used)} points${
                        c.out.length
                          ? `, ${c.out.map((p) => shortAccount(p.a.label)).join(', ')} ran out`
                          : ''
                      }`
                }
              >
                {c.out.length > 0 && <i className="out" />}
              </span>
            ))}
            <span
              className="m-lock"
              style={{ opacity: lockedOn[i] ? 0.35 + (0.65 * lockedOn[i]) / plans.length : 1 }}
            >
              {lockedOn[i] > 0 && <b>{lockedOn[i]}</b>}
            </span>
          </div>
        ))}
      </div>
      <p className="key">
        <span className="k-cells">
          Points used per hour
          <i className="cell l1" />
          <i className="cell l2" />
          <i className="cell l3" />
          <i className="cell l4" />
          under 1, 3, 6, more
        </span>
        <span className="k out">Ran out</span>
        <span className="k locked">Plans locked that day</span>
      </p>
    </section>
  );
}
