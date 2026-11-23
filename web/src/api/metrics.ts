import type { MetricKey, ServiceName } from '../types';

export type MetricDefinition = {
  key: MetricKey;
  label: string;
  unit: string;
  tone: 'accent' | 'ok' | 'warn' | 'danger';
  query: (service: ServiceName) => string;
  convert: (value: number) => number;
};

const selector = (service: ServiceName) => '{service_name="' + service + '"}';

export const METRICS: MetricDefinition[] = [
  {
    key: 'cpu',
    label: 'CPU',
    unit: 'cores',
    tone: 'accent',
    query: (service) => 'sum(rate(dotnet_process_cpu_time_seconds_total' + selector(service) + '[2m]))',
    convert: (value) => value,
  },
  {
    key: 'rss',
    label: 'Memory (RSS)',
    unit: 'MB',
    tone: 'ok',
    query: (service) => 'max(dotnet_process_memory_working_set_bytes' + selector(service) + ')',
    convert: (value) => value / (1024 * 1024),
  },
  {
    key: 'heap',
    label: 'Managed heap',
    unit: 'MB',
    tone: 'ok',
    query: (service) => 'sum(dotnet_gc_last_collection_heap_size_bytes' + selector(service) + ')',
    convert: (value) => value / (1024 * 1024),
  },
  {
    key: 'rps',
    label: 'Requests / s',
    unit: 'req/s',
    tone: 'warn',
    query: (service) => 'sum(rate(http_server_request_duration_seconds_count' + selector(service) + '[5m]))',
    convert: (value) => value,
  },
  {
    key: 'p95',
    label: 'p95 latency',
    unit: 'ms',
    tone: 'danger',
    query: (service) =>
      'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket' +
      selector(service) +
      '[5m])))',
    convert: (value) => value * 1000,
  },
];
