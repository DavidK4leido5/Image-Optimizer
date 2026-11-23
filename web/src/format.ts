export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return Math.round(bytes) + ' B';
}

export function formatPercent(value: number, total: number): string {
  if (!total) return '0%';
  return Math.round((value / total) * 100) + '%';
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const seconds = Math.round((time - now) / 1000);
  const absolute = Math.abs(seconds);
  const format = (value: number, unit: string) => {
    const rounded = Math.round(value);
    return seconds >= 0 ? 'in ' + rounded + ' ' + unit : rounded + ' ' + unit + ' ago';
  };
  if (absolute < 45) return seconds >= 0 ? 'just now' : 'just now';
  if (absolute < 3600) return format(absolute / 60, 'min');
  if (absolute < 86400) return format(absolute / 3600, 'h');
  if (absolute < 2592000) return format(absolute / 86400, 'd');
  return format(absolute / 2592000, 'mo');
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}
