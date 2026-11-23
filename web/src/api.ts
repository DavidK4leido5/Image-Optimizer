export type Variant = { transform: string; url: string; bytes: number };

export type Asset = {
  id: string;
  publicId: string;
  status: string;
  error: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  variants: Variant[];
};

export type Config = { api: string; key: string; cdn: string };

export type Point = [number, number];

const DEFAULTS: Config = {
  api: 'https://cloudinary-api-k1t3.onrender.com',
  key: '',
  cdn: 'https://cloudinary-delivery.k4leido5.workers.dev',
};

export function loadConfig(): Config {
  const read = (name: string, fallback: string) => localStorage.getItem(name) ?? fallback;
  return {
    api: read('img.api', DEFAULTS.api),
    key: read('img.key', DEFAULTS.key),
    cdn: read('img.cdn', DEFAULTS.cdn),
  };
}

export function saveConfig(config: Config) {
  localStorage.setItem('img.api', config.api);
  localStorage.setItem('img.key', config.key);
  localStorage.setItem('img.cdn', config.cdn);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const config = loadConfig();
  const headers = new Headers(init?.headers);
  headers.set('X-Api-Key', config.key);
  if (init?.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(config.api.replace(/\/$/, '') + path, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 300) || String(response.status));
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function health(): Promise<boolean> {
  const config = loadConfig();
  try {
    const response = await fetch(config.api.replace(/\/$/, '') + '/health');
    return response.ok;
  } catch {
    return false;
  }
}

export const listAssets = () => call<Asset[]>('/v1/assets');

export const deleteAsset = (publicId: string) =>
  call<void>('/v1/assets/' + publicId, { method: 'DELETE' });

export async function upload(file: File, status: (message: string) => void) {
  const created = await call<{
    publicId: string;
    upload: { url: string; method: string; headers: Record<string, string> };
  }>('/v1/assets', {
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, contentType: file.type, bytes: file.size }),
  });

  status('uploading ' + file.name);
  const put = await fetch(created.upload.url, {
    method: created.upload.method,
    headers: created.upload.headers,
    body: file,
  });
  if (!put.ok) throw new Error('storage ' + put.status + ' ' + (await put.text()).slice(0, 200));

  status('processing');
  await call('/v1/assets/' + created.publicId + '/complete', { method: 'POST' });
}

export async function queryMetric(query: string, start: number, end: number): Promise<Point[]> {
  const body = await call<{
    data?: { result?: { values?: [number, string][] }[] };
  }>('/v1/metrics?q=' + encodeURIComponent(query) + '&start=' + start + '&end=' + end + '&step=60s');

  const values = body?.data?.result?.[0]?.values ?? [];
  return values
    .map(([time, value]) => [time, Number(value)] as Point)
    .filter(([, value]) => Number.isFinite(value));
}
