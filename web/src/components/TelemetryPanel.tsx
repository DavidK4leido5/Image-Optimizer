import type { MetricKey, Point, RangeHours, ServiceName } from '../types';
import { METRICS } from '../api/metrics';
import { ApiError } from '../api/client';
import { LineChart } from './LineChart';

type Props = {
  enabled: boolean;
  service: ServiceName;
  range: RangeHours;
  data: Record<MetricKey, Point[]>;
  loading: boolean;
  error: Error | null;
  onService: (service: ServiceName) => void;
  onRange: (range: RangeHours) => void;
  onRetry: () => void;
};

function latest(data: Point[]): number | null {
  return data.length > 0 ? data[data.length - 1][1] : null;
}

function latestLabel(key: MetricKey, value: number): string {
  if (key === 'cpu') return value.toFixed(3) + ' cores';
  if (key === 'rss' || key === 'heap') return value.toFixed(1) + ' MB';
  if (key === 'rps') return value.toFixed(2) + ' req/s';
  return Math.round(value) + ' ms';
}

export function TelemetryPanel({
  enabled,
  service,
  range,
  data,
  loading,
  error,
  onService,
  onRange,
  onRetry,
}: Props) {
  const missingConfig = error instanceof ApiError && error.status === 503;
  const empty = METRICS.every((metric) => data[metric.key].length < 2);

  return (
    <section className="panel" aria-labelledby="telemetry-title">
      <div className="panel__head">
        <div>
          <h2 id="telemetry-title">Telemetry</h2>
          <p className="muted">OpenTelemetry through Grafana Cloud. One-minute resolution.</p>
        </div>

        <div className="segmented" role="group" aria-label="Telemetry controls">
          <div className="segmented__group" role="group" aria-label="Service">
            {(['cloudinary-api', 'cloudinary-processor'] as ServiceName[]).map((name) => (
              <button
                key={name}
                type="button"
                className={'segmented__button' + (service === name ? ' is-active' : '')}
                aria-pressed={service === name}
                onClick={() => onService(name)}
              >
                {name.replace('cloudinary-', '')}
              </button>
            ))}
          </div>

          <label className="toolbar__select toolbar__select--compact">
            <span className="sr-only">Time range</span>
            <select
              value={range}
              onChange={(event) => onRange(Number(event.target.value) as RangeHours)}
              aria-label="Time range"
            >
              <option value={1}>Last hour</option>
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
            </select>
          </label>
        </div>
      </div>

      {!enabled ? (
        <p className="muted">Connect the API to load CPU, memory, and request metrics.</p>
      ) : missingConfig ? (
        <div className="notice notice--warn" role="status">
          <div>
            <strong>Telemetry is not configured.</strong>
            <p>Add GRAFANA_PROM_URL, GRAFANA_USER, and GRAFANA_TOKEN to the API, then redeploy.</p>
          </div>
        </div>
      ) : error ? (
        <div className="notice notice--danger" role="alert">
          <div>
            <strong>Telemetry is unavailable.</strong>
            <p>{error.message}</p>
          </div>
          <button type="button" className="button button--ghost" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <div className="metrics">
          {METRICS.map((metric) => {
            const points = data[metric.key];
            const value = latest(points);
            return (
              <article className="metric-card" key={metric.key}>
                <div className="metric-card__head">
                  <span>{metric.label}</span>
                  <strong>{value === null ? '—' : latestLabel(metric.key, value)}</strong>
                </div>
                {loading && points.length === 0 ? (
                  <div className="skeleton skeleton--chart" />
                ) : (
                  <LineChart
                    id={service + '-' + metric.key}
                    points={points}
                    unit={metric.unit}
                    label={metric.label}
                    tone={metric.tone}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}

      {!missingConfig && !error && empty && !loading && (
        <p className="muted panel__note">
          No samples in this window yet. The services export once a minute.
        </p>
      )}
    </section>
  );
}
