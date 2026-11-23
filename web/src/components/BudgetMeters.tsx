import type { Limits } from '../types';
import { formatBytes, formatPercent, relativeTime } from '../format';

type Props = {
  enabled: boolean;
  limits: Limits | null;
  error: string | null;
  onRetry: () => void;
};

type Meter = {
  label: string;
  used: number;
  limit: number;
  detail: string;
  format: (value: number) => string;
};

function tone(percent: number): 'ok' | 'warn' | 'danger' {
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warn';
  return 'ok';
}

const toneLabel = { ok: 'Plenty left', warn: 'Getting close', danger: 'Almost full' } as const;

export function BudgetMeters({ enabled, limits, error, onRetry }: Props) {
  return (
    <section className="panel" aria-labelledby="budget-title">
      <div className="panel__head">
        <div>
          <h2 id="budget-title">Free tier</h2>
          <p className="muted">Measured from the database, refreshed every 60s.</p>
        </div>
        {enabled && limits && <span className="muted">Measured {relativeTime(limits.measuredAt)}</span>}
      </div>

      {!enabled ? (
        <p className="muted">Connect the API to measure database, storage, and queue usage.</p>
      ) : error ? (
        <div className="notice notice--danger" role="alert">
          <div>
            <strong>Usage is unavailable.</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="button button--ghost" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : !limits ? (
        <div className="meters" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div className="meter meter--skeleton" key={index}>
              <div className="skeleton skeleton--line" />
              <div className="skeleton skeleton--bar" />
            </div>
          ))}
        </div>
      ) : (
        <div className="meters">
          {(
            [
              {
                label: 'Database',
                used: limits.database.bytes,
                limit: limits.database.limit,
                detail: 'Supabase free plan: 500 MB',
                format: formatBytes,
              },
              {
                label: 'Storage',
                used: limits.storage.bytes,
                limit: limits.storage.limit,
                detail: limits.storage.objects + ' objects · Supabase free plan: 1 GB',
                format: formatBytes,
              },
              {
                label: 'Job queue',
                used: limits.queue.depth,
                limit: limits.queue.limit,
                detail: 'Pending or leased jobs',
                format: (value: number) => String(value),
              },
            ] satisfies Meter[]
          ).map((meter) => {
            const percent = Math.min(100, (meter.used / meter.limit) * 100);
            const state = tone(percent);
            return (
              <div className="meter" key={meter.label}>
                <div className="meter__head">
                  <span className="meter__label">{meter.label}</span>
                  <span className="meter__value">
                    {meter.format(meter.used)} / {meter.format(meter.limit)}
                  </span>
                </div>
                <div
                  className={'meter__track meter__track--' + state}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percent)}
                  aria-label={meter.label + ' usage'}
                >
                  <span className="meter__fill" style={{ width: percent.toFixed(1) + '%' }} />
                </div>
                <div className="meter__foot">
                  <span className={'meter__tone meter__tone--' + state}>
                    {formatPercent(meter.used, meter.limit)} used · {toneLabel[state]}
                  </span>
                  <span className="muted">{meter.detail}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted panel__note">
        Render instance hours, Worker requests, and Supabase egress are only visible in their dashboards.
      </p>
    </section>
  );
}
