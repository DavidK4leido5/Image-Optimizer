import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, Limits, MetricKey, Point, RangeHours, ServiceName } from './types';
import {
  ApiError,
  checkHealth,
  deleteAsset,
  getLimits,
  listAssets,
  queryMetric,
} from './api/client';
import { METRICS } from './api/metrics';
import { useConfig } from './hooks/useConfig';
import { useTheme } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { useOnline } from './hooks/useOnline';
import { usePolling } from './hooks/usePolling';
import { useUploadQueue } from './hooks/useUploadQueue';
import { Header, type HealthState } from './components/Header';
import { ConnectionDialog } from './components/ConnectionDialog';
import { UploadZone } from './components/UploadZone';
import { UploadQueue } from './components/UploadQueue';
import { AssetToolbar, type SortOrder, type StatusFilter } from './components/AssetToolbar';
import { AssetGrid } from './components/AssetGrid';
import { AssetDrawer } from './components/AssetDrawer';
import { BudgetMeters } from './components/BudgetMeters';
import { TelemetryPanel } from './components/TelemetryPanel';
import { Toasts } from './components/Toasts';

const PAGE_SIZE = 24;
const EMPTY_TELEMETRY: Record<MetricKey, Point[]> = { cpu: [], rss: [], heap: [], rps: [], p95: [] };

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Unauthorized. Check the API key.';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const { config, update } = useConfig();
  const { theme, toggle } = useTheme();
  const online = useOnline();
  const { toasts, notify, dismiss } = useToasts();
  const queue = useUploadQueue();
  const { add: addUploads, syncAssets, retry, dismiss: dismissUpload, clearDone } = queue;

  const [connectionOpen, setConnectionOpen] = useState(false);
  const [health, setHealth] = useState<HealthState>({ status: 'checking', latency: null, checkedAt: null });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [service, setService] = useState<ServiceName>('cloudinary-api');
  const [range, setRange] = useState<RangeHours>(1);
  const [telemetry, setTelemetry] = useState<Record<MetricKey, Point[]>>(EMPTY_TELEMETRY);
  const [telemetryLoading, setTelemetryLoading] = useState(true);
  const [telemetryError, setTelemetryError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [page, setPage] = useState(1);
  const [configEpoch, setConfigEpoch] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const appliedConfig = useRef(config.api + '|' + config.key);

  // Typing a key should not fire a request per keystroke; save immediately, reload once idle.
  useEffect(() => {
    const next = config.api + '|' + config.key;
    if (next === appliedConfig.current) return;
    const timer = window.setTimeout(() => {
      appliedConfig.current = next;
      setConfigEpoch((epoch) => epoch + 1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [config.api, config.key]);

  const imageBase = (config.cdn.trim() || config.api).replace(/\/$/, '');
  const hasKey = config.key.trim().length > 0;

  const probe = useCallback(async () => {
    try {
      const latency = await checkHealth();
      setHealth({ status: 'up', latency, checkedAt: Date.now() });
    } catch {
      setHealth({ status: 'down', latency: null, checkedAt: Date.now() });
    }
  }, []);

  const loadAssets = useCallback(async () => {
    if (!config.key) {
      setAssets([]);
      setAssetsError(null);
      setAssetsLoading(false);
      return;
    }
    try {
      const next = await listAssets();
      setAssets(next);
      setAssetsError(null);
      syncAssets(next);
    } catch (error) {
      setAssetsError(describe(error));
    } finally {
      setAssetsLoading(false);
    }
  }, [config.key, config.api, syncAssets]);

  const loadLimits = useCallback(async () => {
    if (!config.key) {
      setLimits(null);
      setLimitsError(null);
      return;
    }
    try {
      setLimits(await getLimits());
      setLimitsError(null);
    } catch (error) {
      setLimitsError(describe(error));
    }
  }, [config.key, config.api]);

  const loadTelemetry = useCallback(async () => {
    if (!config.key) {
      setTelemetry(EMPTY_TELEMETRY);
      setTelemetryError(null);
      setTelemetryLoading(false);
      return;
    }

    const end = Math.floor(Date.now() / 1000);
    const start = end - range * 3600;
    const step = range === 1 ? '60s' : '300s';

    try {
      setTelemetryLoading(true);
      const entries = await Promise.all(
        METRICS.map(async (metric) => {
          const points = await queryMetric(metric.query(service), start, end, step);
          return [
            metric.key,
            points.map(([time, value]) => [time, metric.convert(value)] as Point),
          ] as const;
        }),
      );
      setTelemetry(Object.fromEntries(entries) as Record<MetricKey, Point[]>);
      setTelemetryError(null);
    } catch (error) {
      setTelemetryError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setTelemetryLoading(false);
    }
  }, [config.key, config.api, service, range]);

  usePolling(probe, 60000, true);
  usePolling(loadAssets, 5000, hasKey, String(configEpoch));
  usePolling(loadLimits, 60000, hasKey, String(configEpoch));
  usePolling(loadTelemetry, 30000, hasKey, configEpoch + '|' + service + '|' + range);

  useEffect(() => {
    setPage(1);
  }, [search, status, sort]);

  useEffect(() => {
    if (hasKey) return;
    setAssets([]);
    setLimits(null);
    setTelemetry(EMPTY_TELEMETRY);
    setAssetsError(null);
    setLimitsError(null);
    setTelemetryError(null);
    setAssetsLoading(false);
  }, [hasKey]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = assets.filter((asset) => {
      if (status !== 'all' && asset.status !== status) return false;
      if (term && !asset.publicId.toLowerCase().includes(term)) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      if (sort === 'largest') return b.bytes - a.bytes;
      const delta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sort === 'oldest' ? -delta : delta;
    });
  }, [assets, search, status, sort]);

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;
  const hasFilters = status !== 'all' || search.trim().length > 0;

  const copy = useCallback(
    async (text: string, message = 'Copied to clipboard.') => {
      try {
        await navigator.clipboard.writeText(text);
        notify(message, 'ok');
      } catch {
        notify('Could not copy. Select the text and copy it manually.', 'danger');
      }
    },
    [notify],
  );

  const remove = useCallback(
    async (publicId: string) => {
      try {
        await deleteAsset(publicId);
        setSelected(null);
        setAssets((current) => current.filter((asset) => asset.publicId !== publicId));
        notify('Asset deleted.', 'ok');
        void loadAssets();
        void loadLimits();
      } catch (error) {
        notify('Delete failed. ' + describe(error), 'danger');
        throw error;
      }
    },
    [notify, loadAssets, loadLimits],
  );

  const handleAdd = useCallback(
    (files: File[]) => {
      addUploads(files);
    },
    [addUploads],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const refreshAll = useCallback(() => {
    void probe();
    void loadAssets();
    void loadLimits();
    void loadTelemetry();
  }, [probe, loadAssets, loadLimits, loadTelemetry]);

  return (
    <div className="app">
      <Header
        health={health}
        online={online}
        theme={theme}
        config={config}
        onToggleTheme={toggle}
        onRecheck={() => void probe()}
        onOpenConnection={() => setConnectionOpen(true)}
      />

      <ConnectionDialog
        open={connectionOpen}
        config={config}
        onClose={() => setConnectionOpen(false)}
        onChange={update}
      />

      <main className="app__main">
        {!hasKey && (
          <div className="notice notice--warn" role="status">
            <div>
              <strong>Connect your API.</strong>
              <p>Add the API base URL and key to load assets, budgets, and telemetry.</p>
            </div>
            <button type="button" className="button button--primary" onClick={() => setConnectionOpen(true)}>
              Open connection
            </button>
          </div>
        )}

        <UploadZone onFiles={handleAdd} />

        <UploadQueue
          items={queue.items}
          onRetry={retry}
          onDismiss={dismissUpload}
          onClearDone={clearDone}
        />

        {assetsError && (
          <div className="notice notice--danger" role="alert">
            <div>
              <strong>Assets could not load.</strong>
              <p>{assetsError}</p>
            </div>
            <button type="button" className="button button--ghost" onClick={refreshAll}>
              Retry
            </button>
          </div>
        )}

        <section className="panel" aria-labelledby="assets-title">
          <div className="panel__head">
            <div>
              <h2 id="assets-title">Assets</h2>
              <p className="muted">
                {assets.length} {assets.length === 1 ? 'image' : 'images'}
                {assets.length >= 100 ? ' · the API returns the latest 100' : ''}
              </p>
            </div>

          </div>

          <AssetToolbar
            search={search}
            onSearch={setSearch}
            status={status}
            onStatus={setStatus}
            sort={sort}
            onSort={setSort}
            total={assets.length}
            shown={visible.length}
            capped={assets.length >= 100}
            searchRef={searchRef}
          />

          {assetsLoading && assets.length === 0 ? (
            <div className="asset-grid" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <div className="asset-card asset-card--skeleton" key={index}>
                  <div className="skeleton skeleton--thumb" />
                  <div className="asset-card__meta">
                    <div className="skeleton skeleton--line" />
                    <div className="skeleton skeleton--line skeleton--short" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <AssetGrid
              assets={visible}
              total={assets.length}
              hasFilters={hasFilters}
              hasMore={hasMore}
              imageBase={imageBase}
              onOpen={setSelected}
              onShowMore={() => setPage((current) => current + 1)}
              onClearFilters={() => {
                setSearch('');
                setStatus('all');
              }}
            />
          )}
        </section>

        <div className="services">
          <BudgetMeters
            enabled={hasKey}
            limits={limits}
            error={limitsError}
            onRetry={() => void loadLimits()}
          />
          <TelemetryPanel
            enabled={hasKey}
            service={service}
            range={range}
            data={telemetry}
            loading={telemetryLoading}
            error={telemetryError}
            onService={setService}
            onRange={setRange}
            onRetry={() => void loadTelemetry()}
          />
        </div>
      </main>

      <AssetDrawer
        asset={selected}
        imageBase={imageBase}
        onClose={() => setSelected(null)}
        onDelete={remove}
        onCopy={copy}
      />

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
