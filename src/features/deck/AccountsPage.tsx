import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNow } from '@/hooks/useNow';
import { useNotificationStore } from '@/stores';
import { send, useAccounts, useDeck } from './api';
import { Steps } from './chart';
import { Alert, Meter } from './components';
import { STANDING, accountHue, fmt, shortAccount, when } from './format';
import type { Account, AccountsView, Policy, PolicyResult, Pool, UsageView } from './types';
import './deck.scss';
import './accounts.scss';

const WEEK = 7 * 86_400_000;
const SOON = 3 * 86_400_000;

export function AccountsPage() {
  const { accounts, pool } = useAccounts();
  const view = useDeck<AccountsView>('/accounts', 'accounts');
  const week = useDeck<UsageView>('/usage?range=7d&by=agent&measure=week&limit=200', 'usage');
  const ids = accounts.map((a) => a.id);

  return (
    <div className="deck accounts">
      <header className="head">
        <div>
          <h1>Accounts</h1>
          <p className="lede">{pool?.decision ?? 'Waiting for the pool…'}</p>
        </div>
        <Link className="btn btn-primary btn-sm" to="/oauth">
          Add account
        </Link>
      </header>

      {view.error && <Alert>Account history could not load: {view.error}</Alert>}
      {week.error && (
        <Alert>
          Agent usage could not load: {week.error}{' '}
          <Button variant="secondary" size="sm" onClick={() => void week.reload()}>
            Retry
          </Button>
        </Alert>
      )}
      {!accounts.length && <EmptyState title="No accounts in the pool yet." />}
      <div className="cards">
        {accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            hue={accountHue(a.id, ids)}
            next={a.id === pool?.next}
            week={week.data}
          />
        ))}
      </div>

      {accounts.length > 0 && view.data && (
        <History accounts={accounts} ids={ids} view={view.data} pool={pool} />
      )}

      {pool && <PolicyEditor pool={pool} />}
    </div>
  );
}

/** Every account's week on one chart, in its own hue, with its five-hour use as a faint companion. */
function History({
  accounts,
  ids,
  view,
  pool,
}: {
  accounts: Account[];
  ids: string[];
  view: AccountsView;
  pool: Pool | undefined;
}) {
  const now = useNow();
  const lines = accounts.flatMap((a) =>
    view.history
      .filter((h) => h.account === a.id && h.points.length)
      .sort((x, y) => (x.kind === 'week' ? 1 : 0) - (y.kind === 'week' ? 1 : 0))
      .map((h) => ({
        key: `${a.id}:${h.kind}`,
        label: `${shortAccount(a.label)} · ${h.kind === 'week' ? 'week' : '5 hours'}`,
        color: accountHue(a.id, ids),
        faint: h.kind === 'fiveHour',
        end: h.kind === 'week' ? shortAccount(a.label) : undefined,
        points: h.points,
      }))
  );
  const fiveHourSince = Math.max(
    0,
    ...view.history.filter((h) => h.kind === 'fiveHour').map((h) => h.points[h.points.length - 1]?.[0] ?? 0)
  );

  return (
    <section className="section history" aria-labelledby="history-title">
      <div className="section-head">
        <h2 id="history-title">Limit use, last 7 days</h2>
        <span className="sub">
          Solid: the week · faint: five hours
          {fiveHourSince > 0 && now - fiveHourSince > 86_400_000 &&
            `, not reported since ${when(fiveHourSince)}`}
        </span>
      </div>
      <div className="pad">
        <Steps
          caption="Each account's weekly and five-hour limit use over the last 7 days"
          from={now - WEEK}
          to={now}
          cutoffs={
            pool
              ? [
                  { label: 'Week', value: pool.policy.weeklyCutoff },
                  { label: '5-hour', value: pool.policy.sessionCutoff },
                ]
              : []
          }
          lines={lines}
        />
      </div>
    </section>
  );
}

function AccountCard({
  account: a,
  hue,
  next,
  week,
}: {
  account: Account;
  hue: string;
  next: boolean;
  week: UsageView | null;
}) {
  const now = useNow();

  const top = (week?.rows ?? [])
    .map((r) => ({ row: r, points: r.byAccount.find((b) => b.account === a.id)?.week ?? 0 }))
    .filter((t) => t.points > 0)
    .sort((x, y) => y.points - x.points)
    .slice(0, 5);
  const most = top[0]?.points || 1;

  const signedOut = a.standing === 'signed-out';
  const expiring = a.signInUntil !== null && a.signInUntil - now < SOON;

  return (
    <section
      className={next ? 'section account next' : 'section account'}
      data-c={hue}
      aria-labelledby={`acct-${a.id}`}
    >
      <div className="account-head">
        <i className="hue" aria-hidden />
        <div className="account-name">
          <h2 id={`acct-${a.id}`} className="clip" title={a.label}>
            {a.label}
          </h2>
          <p className="muted small">
            {a.plan}
            {a.since &&
              ` · since ${new Date(a.since).toLocaleDateString('en', { month: 'short', year: 'numeric' })}`}
          </p>
        </div>
        <span className={`chip standing ${a.standing}`}>{STANDING[a.standing]}</span>
      </div>

      <div className="account-meters">
        <Meter label="This week" window={a.week} hue={hue} />
        <Meter label="Five hours" window={a.fiveHour} hue={hue} size="sm" />
      </div>

      <ul className="facts small">
        <li>
          <b>{a.working}</b> working now
        </li>
        <li className={signedOut || expiring ? 'warn' : undefined}>
          {signedOut
            ? 'Signed out'
            : a.signInUntil
              ? `Signed in until ${when(a.signInUntil)}`
              : 'Sign-in expiry unknown'}
          {(signedOut || expiring) && (
            <>
              {' · '}
              <Link to="/oauth">Sign in again</Link>
            </>
          )}
        </li>
        {a.heldResets.map((h) => (
          <li key={h.kind}>
            Holds {h.left} {h.kind} {h.left === 1 ? 'reset' : 'resets'}
            {h.expiresAt && `, use by ${when(h.expiresAt)}`}
          </li>
        ))}
        {a.resetPlan && <li>{a.resetPlan}</li>}
        {a.resetsSpent?.map((at) => <li key={at}>Pool spent a reset {when(at)}</li>)}
        {a.atLimit?.available && <li className="warn">Claude offers a limit reset now</li>}
      </ul>
      {a.reasons.length > 0 && <p className="reasons muted small">{a.reasons.join(' ')}</p>}

      <div className="drill">
        <h3>Where this week went</h3>
        {top.length ? (
          <ul className="spend">
            {top.map(({ row, points }) => (
              <li key={row.key}>
                <Link
                  to={`/usage?range=7d&w.account=${encodeURIComponent(a.id)}&sel=${encodeURIComponent(row.key)}`}
                  className="clip"
                  title={`${row.label} · ${row.detail}`}
                >
                  {row.label}
                </Link>
                <span className="bar" aria-hidden>
                  <i style={{ width: `${(points / most) * 100}%` }} />
                </span>
                <span className="num">{fmt.limit(points)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">
            {week ? 'No limit use tied to agents this week.' : 'Reading usage…'}
          </p>
        )}
      </div>
    </section>
  );
}

const FIELDS: { key: keyof Policy; label: string; unit: string; max: number; about: string }[] = [
  {
    key: 'sessionCutoff',
    label: 'Five-hour cutoff',
    unit: '%',
    max: 100,
    about: 'New sessions skip an account once its five-hour use reaches this.',
  },
  {
    key: 'weeklyCutoff',
    label: 'Weekly cutoff',
    unit: '%',
    max: 100,
    about: 'The same, for the week.',
  },
  {
    key: 'agentsPerAccount',
    label: 'Agents per account',
    unit: 'agents',
    max: 500,
    about:
      'How many working agents a fresh account takes before new ones go elsewhere; fewer as it fills.',
  },
];

/** The one policy editor: change, preview what the pool would do, then save against the revision you previewed. */
function PolicyEditor({ pool }: { pool: Pool }) {
  const notify = useNotificationStore((s) => s.showNotification);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [preview, setPreview] = useState<PolicyResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const values = draft ?? pool.policy;
  const dirty = draft !== null && FIELDS.some((f) => draft[f.key] !== pool.policy[f.key]);
  const valid = FIELDS.every(
    (f) => Number.isInteger(values[f.key]) && values[f.key] >= 1 && values[f.key] <= f.max
  );
  const previewed =
    preview !== null && FIELDS.every((f) => preview.pool.policy[f.key] === values[f.key]);

  const hint = !dirty
    ? 'Change a value to preview it.'
    : !valid
      ? 'Cutoffs go from 1 to 100%, agents from 1 to 500.'
      : previewed
        ? 'Saving would do this right now:'
        : 'Preview to see what changes, then save.';

  const submit = async (save: boolean) => {
    setBusy(save ? 'save' : 'preview');

    try {
      const revision = save && preview ? preview.pool.revision : pool.revision;
      const result = await send<PolicyResult>('/accounts/policy', 'POST', {
        policy: values,
        revision,
        save,
      });

      if (result.conflict) {
        setPreview(null);
        notify(
          'The policy changed somewhere else since you previewed. Check the new values, then preview again.',
          'error'
        );
      } else if (!save) setPreview(result);
      else {
        setPreview(null);
        setDraft(null);
        notify('Policy saved. New sessions use it; running ones keep their account.', 'success');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section policy" aria-labelledby="policy-title">
      <div className="section-head">
        <h2 id="policy-title">Routing policy</h2>
        <span className={dirty ? 'chip warn' : 'sub'}>{dirty ? 'not saved' : 'in effect'}</span>
      </div>
      <div className="pad">
        <div className="policy-fields">
          {FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <span className="policy-input">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={f.max}
                  step={1}
                  value={Number.isNaN(values[f.key]) ? '' : values[f.key]}
                  onChange={(e) => {
                    setPreview(null);
                    setDraft({ ...values, [f.key]: e.currentTarget.valueAsNumber });
                  }}
                />
                <span className="muted">{f.unit}</span>
              </span>
              <span className="muted small">{f.about}</span>
            </label>
          ))}
        </div>
        <div className="policy-actions">
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'preview'}
            disabled={!dirty || !valid || busy !== null}
            onClick={() => void submit(false)}
          >
            Preview
          </Button>
          <Button
            size="sm"
            loading={busy === 'save'}
            disabled={!dirty || !previewed || busy !== null}
            onClick={() => void submit(true)}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || busy !== null}
            onClick={() => {
              setPreview(null);
              setDraft(null);
            }}
          >
            Discard
          </Button>
          <span className="muted small">{hint}</span>
        </div>
        {previewed && <PolicyChange now={pool} then={preview.pool} />}
        {pool.notes.length > 0 && (
          <details className="notes">
            <summary>How the pool picks an account</summary>
            <ul>
              {pool.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function PolicyChange({ now, then }: { now: Pool; then: Pool }) {
  const { name } = useAccounts();
  const sameOrder = now.order.join() === then.order.join();

  return (
    <ul className="changes">
      <li>
        {then.next === now.next ? (
          <>
            The next new session still goes to <b>{name(then.next)}</b>.
          </>
        ) : (
          <>
            The next new session would go to <b>{name(then.next)}</b> instead of {name(now.next)}.
          </>
        )}
      </li>
      {!sameOrder && <li>Order after it: {then.order.map(name).join(', ')}.</li>}
      {then.decision !== now.decision && <li className="muted">{then.decision}</li>}
    </ul>
  );
}
