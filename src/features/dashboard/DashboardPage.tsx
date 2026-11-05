import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HomeOverview } from '@/features/deck/HomeOverview';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useDashboardOverview } from './hooks/useDashboardOverview';
import { ThroughputChart } from './components/ThroughputChart';
import { splitWindowMinutes } from './utils';
import styles from './dashboard.module.scss';

export function DashboardPage() {
  const { t } = useTranslation();
  const { connected, traffic, refresh } = useDashboardOverview();

  useHeaderRefresh(refresh, connected);

  const windowLabel = useMemo(() => {
    if (traffic.windowMinutes <= 0) return '';
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  return (
    <div className={styles.page}>
      <HomeOverview />
      {traffic.total > 0 && (
        <div className="deck home">
          <section className="panel" aria-labelledby="traffic-title">
            <header className="panel-head">
              <h2 id="traffic-title">
                {traffic.totalFailure
                  ? `${traffic.totalFailure.toLocaleString()} of ${traffic.total.toLocaleString()} proxy requests failed`
                  : `All ${traffic.total.toLocaleString()} proxy requests went through`}
              </h2>
              {windowLabel && <p>Last {windowLabel}, in 10-minute buckets.</p>}
            </header>
            <ThroughputChart traffic={traffic} />
          </section>
        </div>
      )}
    </div>
  );
}
