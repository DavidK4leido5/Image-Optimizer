import type { Asset, Limits, Point } from '../types';
import { readConfig } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfter?: number;

  constructor(status: number, body: string, retryAfter?: number) {
    super(status > 0 ? 'HTTP ' + status + ': ' + body : body || 'network error');
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

function baseUrl(): string {
  return readConfig().api.replace(/\/$/, '');
}

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { key } = readConfig();
  const headers = new Headers(init?.headers);
  if (key) headers.set('X-Api-Key', key);
  if (init?.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(baseUrl() + path, { ...init, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new ApiError(response.status, text.slice(0, 300), parseRetryAfter(response));
  }

  return (text ? JSON.parse(text) : undefined) as T;
}

export type CreateAssetInput = {
  fileName: string;
  contentType: string;
  bytes: number;
};

export type UploadTarget = {
  url: string;
  method: string;
  headers: Record<string, string>;
};

export type CreatedAsset = {
  id: string;
  publicId: string;
  status: string;
  upload: UploadTarget;
  expiresAt: string;
};

export async function checkHealth(): Promise<number> {
  const started = performance.now();
  const response = await fetch(baseUrl() + '/health');
  const latency = Math.round(performance.now() - started);
  if (!response.ok) throw new ApiError(response.status, (await response.text()).slice(0, 300));
  return latency;
}

export const listAssets = () => request<Asset[]>('/v1/assets');

export const getLimits = () => request<Limits>('/v1/limits');

export const createAsset = (input: CreateAssetInput) =>
  request<CreatedAsset>('/v1/assets', { method: 'POST', body: JSON.stringify(input) });

export async function completeAsset(publicId: string): Promise<void> {
  await request<unknown>('/v1/assets/' + publicId + '/complete', { method: 'POST' });
}

export async function deleteAsset(publicId: string): Promise<void> {
  await request<unknown>('/v1/assets/' + publicId, { method: 'DELETE' });
}

export async function queryMetric(
  query: string,
  start: number,
  end: number,
  step: string,
): Promise<Point[]> {
  const body = await request<{ data?: { result?: { values?: [number, string][] }[] } }>(
    '/v1/metrics?q=' +
      encodeURIComponent(query) +
      '&start=' +
      start +
      '&end=' +
      end +
      '&step=' +
      encodeURIComponent(step),
  );

  const values = body.data?.result?.[0]?.values ?? [];
  return values
    .map(([time, value]) => [time, Number(value)] as Point)
    .filter(([, value]) => Number.isFinite(value));
}

export function uploadFile(
  target: UploadTarget,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(target.method, target.url);

    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new ApiError(request.status, request.responseText.slice(0, 300)));
    };

    request.onerror = () => reject(new ApiError(0, 'network error while uploading'));
    request.onabort = () => reject(new ApiError(0, 'upload cancelled'));

    request.send(file);
  });
}
