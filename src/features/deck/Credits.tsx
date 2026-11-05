import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { useNow } from '@/hooks/useNow';
import { useAccounts, useDeck } from './api';
import { relativeTime } from './format';
import type { APIGrant } from './types';
import './credits.scss';

type Credit = {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  expiresAt: number | null;
  sampledAt: number;
};

const money = (value: number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const date = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(value);
const calendarDate = (value: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    value
  );
const stamp = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'America/Los_Angeles',
  }).format(value);

export function Credits() {
  const { t } = useTranslation();
  const { accounts: pooled } = useAccounts();
  const accounts = pooled.filter((a) => a.label && !a.credit);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const view = useDeck<{ api: APIGrant[] }>(connected ? '/credits' : null, 'credits');
  const now = useNow();
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? id;
  const cloud = accounts.filter((a) => a.cloud);

  return (
    <section className="claude-credits" aria-labelledby="credits-heading">
      <div className="credits-heading">
        <h2 id="credits-heading">{t('credits.title')}</h2>
        <span>{t('credits.separate')}</span>
        <button disabled={view.fetching} onClick={() => void view.reload()}>
          {t('credits.refresh')}
        </button>
      </div>
      {view.error && (
        <p role="alert">
          {t('credits.error')}{' '}
          <button onClick={() => void view.reload()}>{t('credits.retry')}</button>
        </p>
      )}
      <div className="credits-grid">
        {view.data?.api.map((g) => {
          const expired = now >= g.expiresAt;
          return (
            <article key={g.credentialId}>
              <div className="credit-label">
                <h3>{t('credits.api')}</h3>
                {!expired && <span className="credit-status is-live">{t('credits.live')}</span>}
              </div>
              <p className="credit-account">
                {g.organization} · {label(g.account)}
              </p>
              <p className="credit-value">
                {expired ? '—' : money(g.remaining)}{' '}
                <span>{t(expired ? 'credits.expired' : 'credits.lastBalance')}</span>
              </p>
              <p className="credit-meta">
                {t('credits.apiGrant', { amount: money(g.allowance), cap: money(g.monthlyCap) })}
              </p>
              {!expired && (
                <progress
                  aria-label={t('credits.apiUsed')}
                  max={g.allowance}
                  value={g.allowance - g.remaining}
                />
              )}
              <dl>
                <div>
                  <dt>{t('credits.proxyCost')}</dt>
                  <dd>{money(g.proxyUsd)}</dd>
                </div>
                <div>
                  <dt>{t('credits.requests')}</dt>
                  <dd>{g.requests.toLocaleString()}</dd>
                </div>
              </dl>
              <p className="credit-note">
                {t('credits.estimate', { amount: money(g.recorded), date: date(g.observedAt) })}
                {g.unpriced > 0 && ` ${t('credits.unpriced', { count: g.unpriced })}`}
              </p>
              <p className="credit-meta">
                {g.lastRequestAt
                  ? t('credits.lastRequest', { when: relativeTime(g.lastRequestAt) })
                  : t('credits.noRequests')}
                <br />
                {t('credits.expires', { date: calendarDate(g.expiresAt) + ' UTC' })}
                {g.renewsAt > 0 && <> · {t('credits.next', { date: calendarDate(g.renewsAt) })}</>}
              </p>
              <footer>
                {t('credits.noBilling')}{' '}
                <a
                  href="https://platform.claude.com/settings/billing"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('credits.console')} ↗
                </a>
              </footer>
            </article>
          );
        })}
        {cloud.map((a) => {
          const c: Credit = a.cloud!;
          const expired = c.expiresAt !== null && now >= c.expiresAt;
          const stale = now - c.sampledAt > 10 * 60_000;
          return (
            <article key={a.id}>
              <div className="credit-label">
                <h3>{t('credits.cloud')}</h3>
                {!stale && !expired && (
                  <span className="credit-status is-live">{t('credits.live')}</span>
                )}
              </div>
              <p className="credit-account">{a.label}</p>
              <p className="credit-value">
                {expired ? '—' : money(c.remaining)}{' '}
                <span>{t(expired ? 'credits.expired' : 'credits.remaining')}</span>
              </p>
              <p className="credit-meta">{t('credits.cloudTotal', { amount: money(c.limit) })}</p>
              {c.limit !== null && c.limit > 0 && c.used !== null && (
                <progress
                  aria-label={t('credits.cloudUsed')}
                  max={c.limit}
                  value={Math.min(c.limit, Math.max(0, c.used))}
                />
              )}
              <dl>
                <div>
                  <dt>{t('credits.used')}</dt>
                  <dd>{money(c.used)}</dd>
                </div>
                <div>
                  <dt>{t('credits.expiresLabel')}</dt>
                  <dd>{c.expiresAt ? stamp(c.expiresAt) : '—'}</dd>
                </div>
              </dl>
              <p className="credit-note">
                {t('credits.cloudRoute')} <code>claude --cloud</code>
              </p>
              <footer>
                {t(stale ? 'credits.staleAt' : 'credits.sampled', {
                  when: relativeTime(c.sampledAt),
                })}{' '}
                {t('credits.cloudEvery')}
              </footer>
            </article>
          );
        })}
        <article className="credit-weekly">
          <div className="credit-label">
            <h3>{t('credits.weekly')}</h3>
            <a href="#/accounts">{t('credits.accounts')} →</a>
          </div>
          {!accounts.length && <p className="credit-note">{t('credits.waiting')}</p>}
          <div className="credit-weeks">
            {accounts.map((a) => (
              <div className="credit-week" key={a.id}>
                <div>
                  <span>{a.label}</span>
                  <strong>{a.week.used === null ? '—' : `${a.week.used}%`}</strong>
                </div>
                {a.week.used !== null && (
                  <progress
                    aria-label={t('credits.weekUsed', { account: a.label })}
                    max={100}
                    value={a.week.used}
                  />
                )}
                <p className="credit-meta">
                  {a.week.resetsAt
                    ? t('credits.resets', { date: stamp(a.week.resetsAt) })
                    : t('credits.resetUnknown')}
                </p>
                <p className="credit-meta">
                  {a.week.sampledAt
                    ? t(
                        now - a.week.sampledAt > 25 * 60_000
                          ? 'credits.staleAt'
                          : 'credits.sampled',
                        { when: relativeTime(a.week.sampledAt) }
                      )
                    : t('credits.waiting')}
                </p>
              </div>
            ))}
          </div>
          <footer>{t('credits.weeklyNote')}</footer>
        </article>
      </div>
      {view.data && !view.data.api.length && !cloud.length && (
        <p className="credit-note">{t('credits.noCredits')}</p>
      )}
    </section>
  );
}
