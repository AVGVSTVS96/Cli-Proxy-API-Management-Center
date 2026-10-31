import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNow } from '@/hooks/useNow';
import { useNotificationStore } from '@/stores';
import { send, useAccounts, useDeck } from './api';
import { Steps } from './chart';
import { Alert, Meter } from './components';
import { STANDING, fmt, when } from './format';
import type { Account, AccountsView, Policy, PolicyResult, Pool, UsageView } from './types';
import './deck.scss';

const WEEK = 7 * 86_400_000;
const SOON = 3 * 86_400_000;

export function AccountsPage() {
  const { accounts, pool } = useAccounts();
  const view = useDeck<AccountsView>('/accounts', 'accounts');
  const week = useDeck<UsageView>('/usage?range=7d&by=agent&measure=week&limit=200', 'usage');

  return (
    <div className="deck accounts">
      <header className="head">
        <div>
          <h1>Accounts</h1>
          <p className="lede">{pool?.decision ?? 'Waiting for the pool…'}</p>
        </div>
        <Link className="btn btn-primary" to="/oauth">
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
          <AccountCard key={a.id} account={a} pool={pool} view={view.data} week={week.data} />
        ))}
      </div>

      {pool && <PolicyEditor pool={pool} />}
    </div>
  );
}

function AccountCard({
  account: a,
  pool,
  view,
  week,
}: {
  account: Account;
  pool: Pool | undefined;
  view: AccountsView | null;
  week: UsageView | null;
}) {
  const now = useNow();
  const history = view?.history.filter((h) => h.account === a.id) ?? [];

  const top = (week?.rows ?? [])
    .map((r) => ({ row: r, points: r.byAccount.find((b) => b.account === a.id)?.week ?? 0 }))
    .filter((t) => t.points > 0)
    .sort((x, y) => y.points - x.points)
    .slice(0, 5);

  const signedOut = a.standing === 'signed-out';
  const expiring = a.signInUntil !== null && a.signInUntil - now < SOON;

  return (
    <section className="section account" aria-labelledby={`acct-${a.id}`}>
      <div className="section-head">
        {a.rank !== null && <span className="rank mono">#{a.rank}</span>}
        <div className="account-name">
          <h2 id={`acct-${a.id}`}>{a.label}</h2>
          <p className="muted small">
            {a.plan}
            {a.since &&
              ` · subscribed since ${new Date(a.since).toLocaleDateString('en', { dateStyle: 'medium' })}`}
          </p>
        </div>
        <span className="spacer" />
        <span className={`chip standing ${a.standing}`}>{STANDING[a.standing]}</span>
      </div>
      <div className="pad account-body">
        <div className="limit-meters">
          <Meter label="5 hours" window={a.fiveHour} />
          <Meter label="Week" window={a.week} />
        </div>

        <dl className="facts">
          <div>
            <dt>Seats</dt>
            <dd>
              {a.working} working · {a.idle} idle
            </dd>
          </div>
          <div>
            <dt>Sign-in</dt>
            <dd className={signedOut || expiring ? 'warn' : undefined}>
              {signedOut
                ? 'signed out'
                : a.signInUntil
                  ? `good until ${when(a.signInUntil)}`
                  : 'no expiry known'}
              {(signedOut || expiring) && (
                <Link className="btn btn-secondary btn-sm" to="/oauth">
                  Sign in again
                </Link>
              )}
            </dd>
          </div>
          {a.heldResets.map((h) => (
            <div key={h.kind}>
              <dt>Held reset</dt>
              <dd>
                {h.left} {h.kind} {h.left === 1 ? 'reset' : 'resets'}
                {h.expiresAt && `, use by ${when(h.expiresAt)}`}
              </dd>
            </div>
          ))}
          {a.atLimit?.available && (
            <div>
              <dt>Reset offer</dt>
              <dd className="warn">Claude offers a limit reset now</dd>
            </div>
          )}
        </dl>
        {a.reasons.length > 0 && (
          <ul className="reasons small">
            {a.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}

        {history.length > 0 && (
          <Steps
            caption={`${a.label}: limit use over the last 7 days`}
            from={now - WEEK}
            to={now}
            cutoffs={
              pool
                ? [
                    { label: 'week', value: pool.policy.weeklyCutoff },
                    { label: '5h', value: pool.policy.sessionCutoff },
                  ]
                : []
            }
            lines={history.map((h) => ({
              key: h.kind,
              label: h.kind === 'week' ? 'Week' : '5 hours',
              color: h.kind === 'week' ? 'ink' : 'muted',
              dashed: h.kind === 'fiveHour',
              points: h.points,
            }))}
          />
        )}

        <div className="drill">
          <h3>Top agents this week</h3>
          {top.length ? (
            <ul className="sessions">
              {top.map(({ row, points }) => (
                <li key={row.key}>
                  <Link
                    to={`/usage?range=7d&w.account=${encodeURIComponent(a.id)}&sel=${encodeURIComponent(row.key)}`}
                    className="who clip"
                  >
                    <i className="swatch" data-c={row.color} />
                    {row.label}
                    <span className="muted small">{row.detail}</span>
                  </Link>
                  <span className="num">{fmt.pts(points)} pts</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              {week ? 'No week points tied to agents yet.' : 'Reading usage…'}
            </p>
          )}
        </div>
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
