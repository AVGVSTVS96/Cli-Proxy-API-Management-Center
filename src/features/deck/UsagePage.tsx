import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { useNow } from '@/hooks/useNow';
import { useNotificationStore } from '@/stores';
import { LIVE_ORDER, api, useAccounts, useDeck, useLiveList, useParams } from './api';
import { Columns, Spark } from './chart';
import { Alert, Meter, SdkMark, Seg } from './components';
import { STANDING, fmt, shortAccount, when } from './format';
import type {
  AgentSdkUsage,
  Bucket,
  Dimension,
  GroupBy,
  LiveState,
  Measure,
  Range,
  Totals,
  UsageRow,
  UsageView,
} from './types';
import './deck.scss';
import './usage.scss';

const RANGES = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['6m', '6 months'],
] as const satisfies readonly (readonly [Range, string])[];

const GROUPS = [
  ['agent', 'Agents'],
  ['session', 'Sessions'],
  ['project', 'Projects'],
  ['model', 'Models'],
  ['harness', 'Harnesses'],
  ['entrypoint', 'Entrypoints'],
  ['device', 'Devices'],
  ['account', 'Accounts'],
] as const satisfies readonly (readonly [GroupBy, string])[];

const usdAxis = (n: number) => `$${fmt.axis(n)}`;

type Measured = Pick<UsageRow, 'amount' | 'points'>;

const MEASURES = [
  ['tokens', 'Tokens', (r: Measured) => r.amount.tokens, fmt.tokens, fmt.axis, 'Tokens'],
  ['api', 'API value', (r: Measured) => r.amount.apiUsd, fmt.usd, usdAxis, 'API $'],
  ['plan', 'Plan fee share', (r: Measured) => r.amount.planUsd, fmt.usd, usdAxis, 'Plan $'],
  [
    'fiveHour',
    '5-hour limit used',
    (r: Measured) => r.points.fiveHour ?? 0,
    fmt.limit,
    fmt.limit,
    '5-hour',
  ],
  [
    'week',
    'Weekly limit used',
    (r: Measured) => r.points.week ?? 0,
    fmt.limit,
    fmt.limit,
    'Week',
  ],
] as const satisfies readonly (readonly [
  Measure,
  string,
  (r: Measured) => number,
  (n: number) => string,
  (n: number) => string,
  string,
])[];

type MeasureDef = (typeof MEASURES)[number];

const DIMENSIONS: [Dimension, string][] = [
  ['app', 'Apps'],
  ['harness', 'Harnesses'],
  ['entrypoint', 'Entrypoints'],
  ['model', 'Models'],
  ['project', 'Projects'],
  ['device', 'Devices'],
  ['account', 'Accounts'],
];

const PAGE = 50;
const PHONE_ROWS = 10;

const oneOf = <T extends string>(
  options: readonly (readonly [T, ...unknown[]])[],
  value: string | null,
  fallback: T
) => options.find(([v]) => v === value)?.[0] ?? fallback;

function useQueryState() {
  const [params] = useParams();
  const where = DIMENSIONS.flatMap(([d]) => {
    const values = params.get(`w.${d}`);

    return values ? [[d, values.split(',')] as const] : [];
  });

  return {
    range: oneOf(RANGES, params.get('range'), '7d'),
    by: oneOf(GROUPS, params.get('by'), 'agent'),
    measure: oneOf(MEASURES, params.get('measure'), 'api'),
    where,
    q: params.get('q') ?? '',
    within: params.get('within'),
    selected: params.get('sel'),
    all: params.has('all'),
  };
}

type State = ReturnType<typeof useQueryState>;

function usageParams(
  s: Pick<State, 'range' | 'by' | 'measure' | 'where' | 'q' | 'within'>,
  extra: Record<string, string> = {}
) {
  const params = new URLSearchParams({ range: s.range, by: s.by, measure: s.measure });

  for (const [d, values] of s.where) params.set(`w.${d}`, values.join(','));

  if (s.q) params.set('q', s.q);

  if (s.within) params.set('within', s.within);

  for (const [k, v] of Object.entries(extra)) params.set(k, v);

  return params;
}

const usagePath = (...args: Parameters<typeof usageParams>) => `/usage?${usageParams(...args)}`;

/** Keeps the last answer on screen while a new query loads, so the frame never jumps. */
function useKept<T>(data: T | null) {
  const [kept, setKept] = useState(data);

  if (data && data !== kept) setKept(data);

  return data ?? kept;
}

const tickOf = (b: Bucket, i: number) => {
  const d = new Date(b.at);

  if (b.size === '1h')
    return d.getHours() % 3 === 0 ? d.toLocaleTimeString('en', { hour: 'numeric' }) : '';

  if (b.size === '4h')
    return d.getHours() < 4 ? d.toLocaleDateString('en', { weekday: 'short', day: 'numeric' }) : '';

  if (b.size === '1d')
    return d.getDate() === 1 || i === 0
      ? d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
      : String(d.getDate());

  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
};

const titleOf = (b: Bucket) => {
  const d = new Date(b.at);

  if (b.size === '1h') return d.toLocaleString('en', { weekday: 'short', hour: 'numeric' });

  if (b.size === '4h')
    return `${d.toLocaleString('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })}, 4 hours`;

  if (b.size === '1d')
    return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });

  return `Week of ${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })}`;
};

export function UsagePage() {
  const state = useQueryState();
  const [, setParams] = useParams();
  const { range, selected } = state;
  const path = usagePath(state, { limit: state.all ? '100000' : String(PAGE) });
  const usage = useDeck<UsageView>(path, 'usage');
  const view = useKept(usage.data);
  const [phoneAll, setPhoneAll] = useState(false);
  const onPage = view?.rows.find((r) => r.key === selected) ?? null;

  const offPage = useDeck<UsageView>(
    selected && view && !onPage && state.by === 'agent'
      ? usagePath(state, { within: selected, limit: '1' })
      : null,
    'usage'
  );

  useNow();

  if (!view)
    return (
      <div className="deck">
        <EmptyState
          title={usage.error ?? 'Reading usage…'}
          description={usage.error ? undefined : 'The first read of a range takes a few seconds.'}
        />
      </div>
    );

  const chosen = onPage ?? offPage.data?.rows.find((r) => r.key === selected) ?? null;
  const { by, measure } = view.query;
  const m = MEASURES.find(([key]) => key === measure) ?? MEASURES[1];

  return (
    <div className={usage.data ? 'deck usage' : 'deck usage dim'}>
      <header className="head">
        <div>
          <h1>Usage</h1>
          <p className="lede">
            {period(view)} · {view.period.timezone}
          </p>
        </div>
        <Seg
          label="Range"
          value={range}
          options={RANGES}
          onChange={(v) => setParams({ range: v, sel: null })}
        />
        <Button variant="ghost" size="sm" onClick={() => void exportCsv(state, view)}>
          Export CSV
        </Button>
      </header>

      <Filters state={state} view={view} />

      {usage.error && <Alert>{usage.error}. Showing the last answer.</Alert>}

      <section className="section overview" aria-labelledby="overview-title">
        <div className="overview-main">
          <Summary
            totals={view.totals}
            previous={view.previous}
            agentSdk={view.agentSdk}
            range={range}
          />
          <div className="activity">
            <h2 id="overview-title" className="sr">
              Activity
            </h2>
            <Columns
              labels={view.buckets.map(tickOf)}
              titles={view.buckets.map(titleOf)}
              series={view.series}
              format={m[3]}
              axis={m[4]}
              height={208}
              caption={`${m[1]} per ${bucketWord(view.buckets[0])} for the top seven ${by}s`}
            />
          </div>
        </div>
        <LimitsNow selected={state.where.find(([d]) => d === 'account')?.[1] ?? []} />
      </section>

      <section
        className={phoneAll ? 'section ranking open' : 'section ranking'}
        aria-labelledby="ranking-title"
      >
        <div className="section-head">
          <h2 id="ranking-title" className="sr">
            Usage by {GROUPS.find(([g]) => g === by)![1].toLowerCase()}
          </h2>
          <Seg
            label="Group by"
            value={by}
            options={GROUPS}
            onChange={(v) => setParams({ by: v, sel: null, all: null })}
          />
          <span className="spacer" />
          <Search value={state.q} />
          <div className="sort">
            <Select
              size="sm"
              fullWidth={false}
              ariaLabel="Rank by"
              value={state.measure}
              options={MEASURES.map(([value, label]) => ({
                value,
                label: `Rank by ${label.replace(/^[A-Z][a-z]/, (c) => c.toLowerCase())}`,
              }))}
              onChange={(value) => setParams({ measure: value })}
            />
          </div>
        </div>
        {selected && !chosen && (state.by !== 'agent' || offPage.data) ? (
          <p className="pad muted" aria-live="polite">
            This row has no usage in this range.{' '}
            <Button variant="ghost" size="sm" onClick={() => setParams({ sel: null })}>
              Close detail
            </Button>
          </p>
        ) : chosen ? (
          <Detail row={chosen} state={state} />
        ) : null}
        <Ranking
          view={view}
          measure={m}
          selected={selected}
          onPhoneAll={() => setPhoneAll(true)}
        />
        <div className="table-foot muted small">
          <span>
            {fmt.int(view.rowCount)} {view.rowCount === 1 ? 'group' : 'groups'} ·{' '}
            {fmt.int(view.totals.sessions)} sessions
          </span>
          {view.rowCount > view.rows.length && (
            <Button variant="secondary" size="sm" onClick={() => setParams({ all: '1' })}>
              Show all {fmt.int(view.rowCount)}
            </Button>
          )}
          {state.all && view.rowCount > PAGE && (
            <Button variant="secondary" size="sm" onClick={() => setParams({ all: null })}>
              Show top {PAGE}
            </Button>
          )}
        </div>
      </section>

      <Footer view={view} />
    </div>
  );
}

const period = (view: UsageView) => {
  const from = new Date(view.period.from);
  const to = new Date(view.period.to - 1);
  const day = { month: 'short', day: 'numeric' } as const;

  return from.toDateString() === to.toDateString()
    ? to.toLocaleDateString('en', { weekday: 'long', ...day })
    : `${from.toLocaleDateString('en', day)} – ${to.toLocaleDateString('en', day)}`;
};

const bucketWord = (b: Bucket | undefined) =>
  !b
    ? 'bucket'
    : b.size === '1h'
      ? 'hour'
      : b.size === '4h'
        ? '4 hours'
        : b.size === '1d'
          ? 'day'
          : 'week';

function Search({ value }: { value: string }) {
  const [, setParams] = useParams();
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);

  if (value !== seen) {
    setSeen(value);
    setText(value);
  }

  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => setParams({ q: text, sel: null }, true), 250);

    return () => clearTimeout(timer);
  }, [text, value, setParams]);

  return (
    <input
      type="search"
      className="input search"
      aria-label="Search rows"
      placeholder="Search names, projects…"
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
    />
  );
}

function Filters({ state, view }: { state: State; view: UsageView }) {
  const [, setParams] = useParams();
  const active = new Map(state.where);

  const owner = useDeck<UsageView>(
    state.within
      ? usagePath({ ...state, by: 'agent', where: [], q: '' }, { within: state.within, limit: '1' })
      : null,
    'usage'
  );

  return (
    <div className="filters" role="group" aria-label="Filters">
      {DIMENSIONS.map(([d, label]) => (
        <Facet
          key={d}
          label={label}
          options={view.facets[d] ?? []}
          chosen={active.get(d) ?? []}
          onChange={(values) => setParams({ [`w.${d}`]: values.join(','), sel: null })}
        />
      ))}
      {state.where.flatMap(([d, values]) =>
        values.map((v) => (
          <button
            key={`${d}:${v}`}
            type="button"
            className="chip"
            aria-label={`Remove filter ${v}`}
            onClick={() =>
              setParams({ [`w.${d}`]: values.filter((x) => x !== v).join(','), sel: null })
            }
          >
            {view.facets[d]?.find((f) => f.id === v)?.label ?? v} ✕
          </button>
        ))
      )}
      {state.within && (
        <button
          type="button"
          className="chip"
          aria-label="Show every session, not just this agent's"
          onClick={() => setParams({ within: null, sel: null })}
        >
          Sessions of {owner.data?.rows[0]?.label ?? 'one agent'} ✕
        </button>
      )}
      {(state.where.length > 0 || state.within) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setParams({
              ...Object.fromEntries(DIMENSIONS.map(([d]) => [`w.${d}`, null])),
              within: null,
              sel: null,
            })
          }
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

function Facet({
  label,
  options,
  chosen,
  onChange,
}: {
  label: string;
  options: { id: string; label: string; count: number }[];
  chosen: string[];
  onChange: (values: string[]) => void;
}) {
  const [find, setFind] = useState('');
  const shown = options.filter((o) => o.label.toLowerCase().includes(find.toLowerCase()));
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      // SAFETY: pointer events on the document always target a DOM node.
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };

    document.addEventListener('pointerdown', close);

    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return (
    <details
      className="facet"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !ref.current?.open) return;
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }}
    >
      <summary className="facet-button">
        {label}
        {chosen.length > 0 && <span className="count">{chosen.length}</span>}
        <span aria-hidden>▾</span>
      </summary>
      <div className="facet-menu">
        {options.length > 8 && (
          <input
            type="search"
            className="input"
            aria-label={`Find ${label.toLowerCase()}`}
            placeholder="Find…"
            value={find}
            onChange={(e) => setFind(e.currentTarget.value)}
          />
        )}
        {shown.map((o) => (
          <label key={o.id} className="facet-option">
            <input
              type="checkbox"
              checked={chosen.includes(o.id)}
              onChange={(e) =>
                onChange(
                  e.currentTarget.checked ? [...chosen, o.id] : chosen.filter((c) => c !== o.id)
                )
              }
            />
            <span>{o.label}</span>
            <span className="muted num">{o.count}</span>
          </label>
        ))}
        {!shown.length && <p className="muted small">Nothing matches.</p>}
      </div>
    </details>
  );
}

const PRIOR: Record<Range, string> = {
  today: 'yesterday',
  yesterday: 'the day before',
  '7d': 'the 7 days before',
  '30d': 'the 30 days before',
  '6m': 'the 6 months before',
};

function Delta({ now, then, range }: { now: number; then: number | undefined; range: Range }) {
  if (then === undefined || then === 0) return null;
  const change = (now - then) / then;

  return (
    <span className="delta" title={`Against ${PRIOR[range]}`}>
      {change >= 0 ? '+' : '−'}
      {Math.abs(Math.round(change * 100))}% vs {PRIOR[range]}
    </span>
  );
}

/** The range's headline: API value, then the figures that explain it. */
function Summary({
  totals,
  previous,
  agentSdk,
  range,
}: {
  totals: Totals;
  previous: Totals | null;
  agentSdk: AgentSdkUsage;
  range: Range;
}) {
  const cells = [
    {
      label: 'Output tokens',
      value: fmt.tokens(totals.output),
      title: `${fmt.int(totals.output)} output tokens`,
    },
    {
      label: 'Requests',
      value: fmt.tokens(totals.requests),
      title: `${fmt.int(totals.requests)} requests in ${fmt.int(totals.sessions)} sessions`,
    },
    {
      label: 'Cache hits',
      value: fmt.pct(totals.cacheHitRate),
      title: `${fmt.tokens(totals.cacheRead)} of ${fmt.tokens(totals.tokens)} tokens read from cache`,
    },
    {
      label: 'Weekly limits used',
      value: fmt.limit(totals.points.week),
      title: "Summed over accounts; 100% is one account's full week",
    },
    {
      label: 'On the Agent SDK',
      value: totals.apiUsd ? fmt.pct(agentSdk.share) : '–',
      title: `Share of API value from claude -p and SDK apps. A five-hour limit charges them ${agentSdk.factor}×; the week charges them the same as interactive work.`,
    },
  ];

  return (
    <div className="summary">
      <div className="headline">
        <span className="muted small">API value</span>
        <span className="figure">{fmt.usd(totals.apiUsd)}</span>
        <span className="muted small">
          <Delta now={totals.apiUsd} then={previous?.apiUsd} range={range} />
          {previous ? ' · ' : ''}what this work would cost at API prices, not a bill
        </span>
      </div>
      <dl className="figures-row">
        {cells.map((c) => (
          <div key={c.label} title={c.title}>
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Each agent row's liveliest running session, so the dots follow the stream rather than the last usage read. */
function useLiveRows() {
  const live = new Map<string, LiveState>();

  for (const [, s] of useLiveList('s:')) {
    const seen = live.get(s.row);

    if (!seen || LIVE_ORDER[s.state] < LIVE_ORDER[seen]) live.set(s.row, s.state);
  }

  return live;
}

function Ranking({
  view,
  measure,
  selected,
  onPhoneAll,
}: {
  view: UsageView;
  measure: MeasureDef;
  selected: string | null;
  onPhoneAll: () => void;
}) {
  const [, setParams] = useParams();
  const [key, , value] = measure;
  const { name } = useAccounts();
  const liveRows = useLiveRows();
  const liveOf = (r: UsageRow) =>
    view.query.by === 'agent' ? (liveRows.get(r.key) ?? null) : r.live;
  const total = value({ amount: view.totals, points: view.totals.points });
  const max = Math.max(...view.rows.map(value), 0) || 1;
  const toggle = (row: string) => setParams({ sel: row === selected ? null : row });
  const columns = MEASURES.filter(([k]) => k !== 'fiveHour' || (view.totals.points.fiveHour ?? 0) > 0);

  if (!view.rows.length)
    return (
      <EmptyState
        title={
          view.query.search || Object.keys(view.query.where).length
            ? 'Nothing matches these filters and search.'
            : 'No usage in this range yet.'
        }
      />
    );

  return (
    <div className="table-wrap">
      <table className="table rank">
        <caption className="sr">
          Usage ranked by {measure[1].toLowerCase()}. Select a row for its sessions and limit
          detail.
        </caption>
        <thead>
          <tr>
            <th className="n idx">#</th>
            <th>Name</th>
            <th className="share">Share · over the range</th>
            <th className="accts">Accounts</th>
            {columns.map(([k, , , , , label]) => (
              <th key={k} className="n" aria-sort={k === key ? 'descending' : undefined}>
                <button type="button" onClick={() => setParams({ measure: k })}>
                  {label}
                  {k === key && ' ↓'}
                </button>
              </th>
            ))}
            <th className="n last">Last</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, i) => {
            const state = liveOf(r);

            return (
              <tr
                key={r.key}
                data-row
                tabIndex={0}
                aria-selected={r.key === selected}
                onClick={() => toggle(r.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  toggle(r.key);
                }}
              >
                <td className="n idx mono">{String(i + 1).padStart(2, '0')}</td>
                <td className="name">
                  <span className="who">
                    <i className="swatch" data-c={r.color} />
                    <b>{r.label}</b>
                    <SdkMark share={r.agentSdk} />
                    {state && <span className={`dot ${state}`} title={state} aria-label={state} />}
                  </span>
                  <span className="muted small">
                    {r.detail} · {fmt.int(r.sessions)} {r.sessions === 1 ? 'session' : 'sessions'}
                  </span>
                </td>
                <td className="share">
                  <span className="bar" data-c={r.color}>
                    <i style={{ width: `${(value(r) / max) * 100}%` }} />
                  </span>
                  <span className="share-value muted small">
                    {total ? fmt.pct(value(r) / total) : '–'} of total
                  </span>
                  <Spark values={r.series} color={r.color} />
                </td>
                <td className="accts muted small">
                  {r.byAccount
                    .filter((a) => (a.week ?? 0) + (a.fiveHour ?? 0) > 0)
                    .map((a) => shortAccount(name(a.account)))
                    .join(' · ') || '–'}
                </td>
                {columns.map(([k, , valueOf, format, , label]) => (
                  <td
                    key={k}
                    className={k === key ? 'n on' : valueOf(r) === 0 ? 'n zero' : 'n'}
                    data-label={label}
                  >
                    {k === 'fiveHour' || k === 'week' ? fmt.limit(r.points[k]) : format(valueOf(r))}
                  </td>
                ))}
                <td className="n last muted" data-label="Last">
                  {when(r.lastActiveAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view.rows.length > PHONE_ROWS && (
        <Button variant="secondary" size="sm" className="phone-more" onClick={onPhoneAll}>
          Show {view.rows.length - PHONE_ROWS} more
        </Button>
      )}
    </div>
  );
}

/** Each account's week now; picking one filters the page to its usage. */
function LimitsNow({ selected }: { selected: readonly string[] }) {
  const [, setParams] = useParams();
  const { accounts, pool } = useAccounts();

  return (
    <aside className="limits-now" aria-labelledby="limits-title">
      <div className="limits-head">
        <h2 id="limits-title">Limits now</h2>
        <Link to="/accounts">Accounts →</Link>
      </div>
      {!accounts.length && <p className="muted small">No account readings yet.</p>}
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          className="limit-pick"
          aria-pressed={selected.includes(a.id)}
          title={`Show only ${a.label}'s usage`}
          onClick={() =>
            setParams({
              'w.account': selected.length === 1 && selected[0] === a.id ? null : a.id,
              sel: null,
            })
          }
        >
          <span className="limit-name">
            <b className="clip">{a.label}</b>
            {a.id === pool?.next ? (
              <span className="chip next">next</span>
            ) : (
              a.standing !== 'open' && <span className="muted small">{STANDING[a.standing]}</span>
            )}
          </span>
          <Meter label="Week" window={a.week} size="sm" />
          {a.fiveHour.used !== null && <Meter label="5 hours" window={a.fiveHour} size="sm" />}
        </button>
      ))}
    </aside>
  );
}

function Detail({ row, state }: { row: UsageRow; state: State }) {
  const [, setParams] = useParams();
  const { name } = useAccounts();
  const detail = useRef<HTMLElement>(null);

  useEffect(() => {
    detail.current?.scrollIntoView({ block: 'nearest' });
  }, [row.key]);

  const drills = state.by === 'agent' && row.sessions > 1;

  const sessions = useDeck<UsageView>(
    drills ? usagePath({ ...state, by: 'session', q: '' }, { within: row.key, limit: '12' }) : null,
    'usage'
  );

  const weekTotal = row.byAccount.reduce((n, a) => n + (a.week ?? 0), 0) || 1;

  return (
    <section
      ref={detail}
      className="section detail"
      aria-labelledby="detail-title"
      aria-live="polite"
    >
      <div className="section-head">
        <div>
          <h2 id="detail-title">{row.label}</h2>
          <p className="muted small">{row.detail}</p>
        </div>
        <span className="spacer" />
        {row.who && 'href' in row.who && row.who.href && (
          <a href={row.who.href} target="_blank" rel="noreferrer">
            Open ↗
          </a>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setParams({ sel: null })}
          aria-label="Close detail"
        >
          ✕
        </Button>
      </div>
      <div className="pad">
        <div className="figures">
          <div>
            <span className="figure">{fmt.limit(row.points.week)}</span>
            <span className="muted small">of a weekly limit</span>
          </div>
          {(row.points.fiveHour ?? 0) > 0 && (
            <div>
              <span className="figure">{fmt.limit(row.points.fiveHour)}</span>
              <span className="muted small">of a five-hour limit</span>
            </div>
          )}
          <div>
            <span className="figure">{fmt.usd(row.amount.apiUsd)}</span>
            <span className="muted small">{fmt.tokens(row.amount.tokens)} tokens</span>
          </div>
        </div>

        {row.byAccount.length > 0 ? (
          <table className="table by-account">
            <caption className="sr">Limit use by account</caption>
            <thead>
              <tr>
                <th>Account</th>
                <th className="n">5h</th>
                <th className="n">Week</th>
                <th className="share">Share of week</th>
              </tr>
            </thead>
            <tbody>
              {row.byAccount.map((a) => (
                <tr key={a.account}>
                  <td>{name(a.account)}</td>
                  <td className="n">{fmt.limit(a.fiveHour)}</td>
                  <td className="n">{fmt.limit(a.week)}</td>
                  <td className="share">
                    <span className="bar">
                      <i style={{ width: `${((a.week ?? 0) / weekTotal) * 100}%` }} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">
            No limit readings cover this row's use, so its share of account limits is unknown.
          </p>
        )}

        {drills && (
          <div className="drill">
            <h3>Sessions</h3>
            {sessions.data ? (
              <ul className="sessions">
                {sessions.data.rows.map((s) => (
                  <li key={s.key}>
                    {s.who?.kind === 'action' ? (
                      <a className="clip" href={s.who.href} target="_blank" rel="noreferrer">
                        {s.label} ↗
                      </a>
                    ) : (
                      <span className="clip">{s.label}</span>
                    )}
                    <span className="num">{fmt.tokens(s.amount.tokens)}</span>
                    <span className="num">{fmt.usd(s.amount.apiUsd)}</span>
                    <span className="num muted">{when(s.lastActiveAt)}</span>
                  </li>
                ))}
                {sessions.data.rowCount > sessions.data.rows.length && (
                  <li className="more muted small">
                    and {sessions.data.rowCount - sessions.data.rows.length} more ·{' '}
                    <Link
                      to={`/usage?${usageParams({ ...state, by: 'session', q: '', within: row.key })}`}
                    >
                      see all
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <p className="muted small">{sessions.error ?? 'Reading sessions…'}</p>
            )}
          </div>
        )}

        <p className="muted small">
          Limit shares are estimates: each rise in an account's reading is split across the sessions
          using it then, by API value.
        </p>
      </div>
    </section>
  );
}

/** Where the numbers come from and what they leave out, in one quiet line. */
function Footer({ view }: { view: UsageView }) {
  const { t } = useTranslation();
  const { coverage, sources } = view;
  const selected = view.query.where.account;
  const unassigned = coverage.unassigned
    .filter((u) => u.kind === 'week' && (!selected?.length || selected.includes(u.account)))
    .reduce((sum, u) => sum + u.points, 0);
  const unnamed = Math.max(0, coverage.totalApiUsd - coverage.namedApiUsd);
  const github = sources.devices.filter((d) => d.label.startsWith('GitHub '));
  const machines = sources.devices.filter((d) => !d.label.startsWith('GitHub '));
  const newest = Math.max(0, ...github.map((d) => d.syncedAt ?? 0));

  return (
    <footer className="foot muted small">
      {machines.map((d) => (
        <span key={d.id}>
          {d.label} synced {d.syncedAt ? when(d.syncedAt) : 'never'}
        </span>
      ))}
      {github.length > 0 && (
        <span title={github.map((d) => `${d.label}: ${d.syncedAt ? when(d.syncedAt) : 'never'}`).join('\n')}>
          {github.length} GitHub {github.length === 1 ? 'repo' : 'repos'}, newest run {newest ? when(newest) : 'never'}
        </span>
      )}
      <span>
        {sources.proxySince
          ? t('deck.proxy_history', { since: when(sources.proxySince) })
          : t('deck.proxy_history_empty')}
      </span>
      <span>Limit readings since {coverage.limitsSince ? when(coverage.limitsSince) : 'never'}</span>
      {unassigned > 0 && <span>{fmt.limit(unassigned)} of weekly limits has no matching session</span>}
      {unnamed > 0 && coverage.totalApiUsd > 0 && (
        <span>{fmt.pct(unnamed / coverage.totalApiUsd)} of API value has no agent name; it counts under its project</span>
      )}
    </footer>
  );
}

const CSV: [string, (r: UsageRow) => string | number | null][] = [
  ['key', (r) => r.key],
  ['label', (r) => r.label],
  ['detail', (r) => r.detail],
  ['tokens', (r) => r.amount.tokens],
  ['input', (r) => r.amount.input],
  ['output', (r) => r.amount.output],
  ['cacheRead', (r) => r.amount.cacheRead],
  ['cacheWrite', (r) => r.amount.cacheWrite],
  ['requests', (r) => r.amount.requests],
  ['apiUsd', (r) => r.amount.apiUsd.toFixed(4)],
  ['planUsd', (r) => r.amount.planUsd.toFixed(4)],
  ['fiveHourPoints', (r) => r.points.fiveHour],
  ['weekPoints', (r) => r.points.week],
  ['sessions', (r) => r.sessions],
  ['lastActive', (r) => new Date(r.lastActiveAt).toISOString()],
];

const csvCell = (v: string | number | null) => {
  const text = String(v ?? '');

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

async function exportCsv(state: State, view: UsageView) {
  try {
    const all = await api<UsageView>(
      usagePath(state, { limit: String(Math.max(view.rowCount, 1)) })
    );
    const lines = all.rows.map((r) => CSV.map(([, cell]) => csvCell(cell(r))).join(','));
    const link = document.createElement('a');

    link.href = URL.createObjectURL(
      new Blob([[CSV.map(([head]) => head).join(','), ...lines].join('\n')], { type: 'text/csv' })
    );
    link.download = `usage-${state.range}-${state.by}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    useNotificationStore
      .getState()
      .showNotification(error instanceof Error ? error.message : String(error), 'error');
  }
}
