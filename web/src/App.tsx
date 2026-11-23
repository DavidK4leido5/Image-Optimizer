import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Asset, Limits, Point } from './api';
import {
  deleteAsset,
  getLimits,
  health,
  listAssets,
  loadConfig,
  queryMetric,
  saveConfig,
  upload,
} from './api';
import { Spark } from './Spark';

type Telemetry = { cpu: Point[]; rss: Point[]; heap: Point[]; rps: Point[]; p95: Point[] };
const EMPTY: Telemetry = { cpu: [], rss: [], heap: [], rps: [], p95: [] };

// These are the names the .NET runtime meter exports through Grafana's OTel to
// Prometheus translation, not the OpenTelemetry semconv names.
const QUERIES = (service: string) => ({
  cpu: 'sum(rate(dotnet_process_cpu_time_seconds_total{service_name="' + service + '"}[2m]))',
  rss: 'max(dotnet_process_memory_working_set_bytes{service_name="' + service + '"})',
  heap: 'sum(dotnet_gc_last_collection_heap_size_bytes{service_name="' + service + '"})',
  rps: 'sum(rate(http_server_request_duration_seconds_count{service_name="' + service + '"}[5m]))',
  p95: 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service_name="' + service + '"}[5m])))',
});

function bytes(value: number): string {
  if (value > 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + ' MB';
  if (value > 1024) return (value / 1024).toFixed(0) + ' KB';
  return value + ' B';
}

function latest(points: Point[]): number | null {
  return points.length ? points[points.length - 1][1] : null;
}

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [service, setService] = useState('cloudinary-api');
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY);
  const [telemetryError, setTelemetryError] = useState('');
  const [limits, setLimits] = useState<Limits | null>(null);
  const [rangeHours, setRangeHours] = useState(1);

  useEffect(() => saveConfig(config), [config]);

  useEffect(() => {
    let alive = true;
    health().then((value) => alive && setHealthy(value));
    const timer = setInterval(() => health().then((value) => alive && setHealthy(value)), 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [config.api]);

  const refresh = useCallback(async () => {
    if (!config.key) {
      setStatus('set your api key');
      return;
    }
    try {
      const next = await listAssets();
      setAssets(next);
      setStatus((current) =>
        current === 'queued, waiting for the processor' &&
        next.every((asset) => asset.status === 'ready' || asset.status === 'failed')
          ? ''
          : current,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [config.api, config.key]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const loadTelemetry = useCallback(async () => {
    if (!config.key) {
      setTelemetry(EMPTY);
      setTelemetryError('');
      return;
    }
    const queries = QUERIES(service);
    const end = Math.floor(Date.now() / 1000);
    const start = end - rangeHours * 3600;
    const step = rangeHours <= 1 ? '60s' : '300s';
    try {
      const [cpu, rss, heap, rps, p95] = await Promise.all([
        queryMetric(queries.cpu, start, end, step),
        queryMetric(queries.rss, start, end, step),
        queryMetric(queries.heap, start, end, step),
        queryMetric(queries.rps, start, end, step),
        queryMetric(queries.p95, start, end, step),
      ]);
      setTelemetry({ cpu, rss, heap, rps, p95 });
      setTelemetryError('');
    } catch (error) {
      setTelemetryError(error instanceof Error ? error.message : String(error));
    }
  }, [config.api, config.key, service, rangeHours]);

  const loadLimits = useCallback(async () => {
    if (!config.key) {
      setLimits(null);
      return;
    }
    try {
      setLimits(await getLimits());
    } catch {
      // keep the last good reading
    }
  }, [config.api, config.key]);

  useEffect(() => {
    loadLimits();
    const timer = setInterval(loadLimits, 60000);
    return () => clearInterval(timer);
  }, [loadLimits]);

  useEffect(() => {
    loadTelemetry();
    const timer = setInterval(loadTelemetry, 30000);
    return () => clearInterval(timer);
  }, [loadTelemetry]);

  const imageBase = useMemo(
    () => (config.cdn.trim() || config.api).replace(/\/$/, ''),
    [config.cdn, config.api],
  );

  async function onUpload(file: File) {
    setBusy(true);
    try {
      await upload(file, setStatus);
      setStatus('queued, waiting for the processor');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(publicId: string) {
    if (!confirm('delete ' + publicId + ' and every variant?')) return;
    try {
      await deleteAsset(publicId);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="shell">
      <header>
        <div>
          <h1>image optimizer</h1>
          <p className="sub">upload, inspect, and watch the two services.</p>
        </div>
        <div className={'dot ' + (healthy === null ? 'wait' : healthy ? 'up' : 'down')}>
          {healthy === null ? 'checking' : healthy ? 'api up' : 'api down'}
        </div>
      </header>

      <section className="settings">
        <label>
          api
          <input value={config.api} onChange={(e) => setConfig({ ...config, api: e.target.value })} />
        </label>
        <label>
          key
          <input
            type="password"
            value={config.key}
            placeholder="X-Api-Key"
            onChange={(e) => setConfig({ ...config, key: e.target.value })}
          />
        </label>
        <label>
          cdn
          <input value={config.cdn} onChange={(e) => setConfig({ ...config, cdn: e.target.value })} />
        </label>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>upload</h2>
          <span className="muted">
            jpeg, png, webp, gif · 20 MB cap · three variants generated
          </span>
        </div>
        <div className="upload-row">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
          {busy && <span className="muted">working…</span>}
        </div>
        {status && <p className="status">{status}</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>telemetry</h2>
          <div className="segmented">
            {['cloudinary-api', 'cloudinary-processor'].map((name) => (
              <button
                key={name}
                className={service === name ? 'active' : ''}
                onClick={() => setService(name)}
              >
                {name.replace('cloudinary-', '')}
              </button>
            ))}
            <select
              aria-label="time range"
              value={rangeHours}
              onChange={(event) => setRangeHours(Number(event.target.value))}
            >
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
            </select>
          </div>
        </div>

        {telemetryError ? (
          <div className="notice">
            <strong>telemetry not available.</strong> Add GRAFANA_PROM_URL, GRAFANA_USER and
            GRAFANA_TOKEN to the api, then redeploy.
            <pre>{telemetryError}</pre>
          </div>
        ) : (
          <div className="metrics">
            <Metric
              title="cpu"
              value={
                latest(telemetry.cpu) === null ? '—' : (latest(telemetry.cpu) as number).toFixed(3) + ' cores'
              }
              points={telemetry.cpu}
              color="#4f8cff"
            />
            <Metric
              title="memory (rss)"
              value={latest(telemetry.rss) === null ? '—' : bytes(latest(telemetry.rss) as number)}
              points={telemetry.rss}
              color="#5ddc8a"
            />
            <Metric
              title="managed heap"
              value={latest(telemetry.heap) === null ? '—' : bytes(latest(telemetry.heap) as number)}
              points={telemetry.heap}
              color="#7ee0a3"
            />
            <Metric
              title="requests / s"
              value={latest(telemetry.rps) === null ? '—' : (latest(telemetry.rps) as number).toFixed(2)}
              points={telemetry.rps}
              color="#f0b429"
            />
            <Metric
              title="p95 latency"
              value={
                latest(telemetry.p95) === null
                  ? '—'
                  : ((latest(telemetry.p95) as number) * 1000).toFixed(0) + ' ms'
              }
              points={telemetry.p95}
              color="#c792ea"
            />
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>free tier</h2>
          <span className="muted">measured · refreshed every 60s</span>
        </div>
        {limits ? (
          <div className="budgets">
            <Budget
              label="database"
              used={limits.database.bytes}
              limit={limits.database.limit}
              detail="Supabase free: 500 MB"
            />
            <Budget
              label="storage"
              used={limits.storage.bytes}
              limit={limits.storage.limit}
              detail={limits.storage.objects + ' objects · Supabase free: 1 GB'}
            />
            <Budget
              label="queue"
              used={limits.queue.depth}
              limit={limits.queue.limit}
              detail="jobs pending or leased"
              format={(value) => String(value)}
            />
          </div>
        ) : (
          <p className="muted">set your api key to load usage</p>
        )}
        <p className="muted small">
          Render instance hours, Worker requests and Supabase egress are only visible in their dashboards.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>assets</h2>
          <span className="muted">{assets.length} total</span>
        </div>
        <div className="grid">
          {assets.map((asset) => (
            <article className="card" key={asset.id}>
              <div className="thumb">
                {asset.variants.length ? (
                  <img
                    src={imageBase + asset.variants[0].url}
                    alt={asset.publicId}
                    loading="lazy"
                    onError={(event) => {
                      const image = event.currentTarget;
                      if (image.dataset.retried) return;
                      image.dataset.retried = '1';
                      image.src = image.src.split('?')[0] + '?r=' + Date.now();
                    }}
                  />
                ) : (
                  <div className="placeholder">{asset.status}</div>
                )}
              </div>
              <div className="meta">
                <div className="row">
                  <code>{asset.publicId}</code>
                  <span className={'pill ' + asset.status}>{asset.status}</span>
                </div>
                {asset.error && <p className="error">{asset.error}</p>}
                <div className="variants">
                  {asset.variants.map((variant) => (
                    <a key={variant.transform} href={imageBase + variant.url} target="_blank" rel="noreferrer">
                      {variant.transform} · {bytes(variant.bytes)}
                    </a>
                  ))}
                </div>
                <div className="actions">
                  <button
                    onClick={() => navigator.clipboard.writeText(imageBase + (asset.variants[0]?.url ?? ''))}
                    disabled={!asset.variants.length}
                  >
                    copy url
                  </button>
                  <button className="danger" onClick={() => onDelete(asset.publicId)}>
                    delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Budget(props: {
  label: string;
  used: number;
  limit: number;
  detail: string;
  format?: (value: number) => string;
}) {
  const format = props.format ?? bytes;
  const percent = Math.min(100, (props.used / props.limit) * 100);
  return (
    <div className="budget">
      <div className="budget-head">
        <span>{props.label}</span>
        <strong>
          {format(props.used)} / {format(props.limit)}
        </strong>
      </div>
      <div className="bar">
        <div style={{ width: percent.toFixed(1) + '%' }} />
      </div>
      <span className="muted">{props.detail}</span>
    </div>
  );
}

function Metric(props: { title: string; value: string; points: Point[]; color: string }) {
  return (
    <div className="metric">
      <div className="metric-head">
        <span>{props.title}</span>
        <strong>{props.value}</strong>
      </div>
      <Spark points={props.points} color={props.color} />
    </div>
  );
}
