# Frontend spec: image optimizer console

Current state of the UI at `web/`, deployed to GitHub Pages. This describes what exists, not what should exist. Use it as the input for a redesign.

## Product

A single-page console for one operator of a self-hosted image service. Two purposes: upload images and inspect the resulting assets; watch the two backend services and the free-tier budget. There is no login, no multi-user support, no routing, and no server-rendered state. Everything is one screen.

Stack: React 19 + TypeScript + Vite, plain CSS, no UI library, no chart library, no router, no state manager. Deployed as static files. API calls go to a .NET service on Render; images are served through a Cloudflare Worker.

## Layout

Max width 1200px, dark theme only, vertical stack of panels:

1. Header
2. Connection bar
3. Upload
4. Telemetry
5. Free tier
6. Assets

## 1. Header

- Title: `image optimizer`.
- Subtitle: `upload, inspect, and watch the two services.`
- Health pill on the right, one of `checking`, `api up`, `api down`. Polls `GET /health` every 60 seconds. No history, no latency, no manual refresh.

## 2. Connection bar

Three text inputs, persisted in `localStorage` under `img.api`, `img.key`, `img.cdn`:

| Field | Meaning | Default |
|---|---|---|
| api | base URL of the .NET API | production Render URL |
| key | sent as `X-Api-Key` on every `/v1` call, `type=password` | empty |
| cdn | base used to build image URLs | production Worker URL |

Editing any field saves it and reloads assets, limits, and telemetry. There is no save button, no test-connection button, no per-field validation. If the key is empty the UI shows `set your api key` instead of calling the API.

## 3. Upload

- Native file input, one file at a time, accepts jpeg, png, webp, gif.
- Static note: `jpeg, png, webp, gif · 20 MB cap · three variants generated`.
- Flow, all client-side:
  1. `POST /v1/assets` with `{ fileName, contentType, bytes }` -> `{ publicId, upload: { url, method, headers } }`.
  2. `PUT` the file to the presigned URL with the returned headers.
  3. `POST /v1/assets/{publicId}/complete`.
  4. Refresh the asset list and poll every 5 seconds until nothing is pending or processing.
- Inline status text under the input: `creating asset`, `uploading <name> (<n> kb)`, `processing`, `queued, waiting for the processor`, or the raw error. Button disabled while in flight.
- Not implemented: drag and drop, multi-select, progress percentage, cancel, retry, client-side resizing, paste from clipboard, camera capture.

## 4. Telemetry

Two toggles and five charts.

- Service toggle: `api` or `processor` (backend `service_name` label `cloudinary-api` / `cloudinary-processor`).
- Range: `1h`, `6h`, `24h` (step 60s or 300s).
- Refreshes every 30 seconds.

| Card | Query | Unit |
|---|---|---|
| cpu | `sum(rate(dotnet_process_cpu_time_seconds_total{...}[2m]))` | cores |
| memory (rss) | `max(dotnet_process_memory_working_set_bytes{...})` | MB |
| managed heap | `sum(dotnet_gc_last_collection_heap_size_bytes{...})` | MB |
| requests / s | `sum(rate(http_server_request_duration_seconds_count{...}[5m]))` | req/s |
| p95 latency | `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{...}[5m])))` | ms |

Each card shows the title, the latest value, and a 72px high SVG sparkline drawn with a single path. No axes, gridlines, tooltips, legend, min/max, annotations, or per-instance split. Fewer than two points shows `no data yet`.

Data comes from `GET /v1/metrics?q=...&start=...&end=...&step=...`, a proxy to Grafana Cloud's Prometheus API. If the api has no Grafana credentials it returns 503 and the panel shows an amber notice: `telemetry not available` plus the endpoint hint and raw error. No mock data, no loading skeleton, no empty chart frame.

## 5. Free tier

Three horizontal budget bars, refreshed every 60 seconds from `GET /v1/limits`:

| Bar | Value | Limit |
|---|---|---|
| database | `pg_database_size` | 500 MB |
| storage | sum of original plus variant bytes | 1 GB, plus object count |
| queue | rows in `jobs` | 50 |

Each shows `used / limit`, a filled bar, and a caption (e.g. `8 objects · Supabase free: 1 GB`). The bar is always accent blue; there are no warning or danger thresholds. Caption below the panel: Render instance hours, Worker requests, and Supabase egress are only visible in their dashboards. No history, no trend, no per-bucket breakdown.

## 6. Assets

- Header shows `N total`.
- Grid of cards, newest first, auto-fill 260px columns.
- Each card:
  - Thumbnail: first variant, rendered through the cdn base. Lazy loaded. On error, retries once with `?r=<timestamp>` to bust a stale 404.
  - Public id, monospace.
  - Status pill: `pending`, `processing`, `ready`, `failed`; failed also shows the error string in red.
  - Variant list: `transform · KB`, each a link that opens the image in a new tab.
  - `copy url` copies the first variant URL. `delete` calls `DELETE /v1/assets/{publicId}` after `confirm()`.
- Polls `GET /v1/assets` every 5 seconds.
- Not implemented: search, filters by status, sorting, pagination (the API returns at most 100), bulk selection, infinite scroll, detail drawer, relative timestamps, dimensions, original file size, per-variant copy, rename, tags, upload date.

## States and errors

- `set your api key` (no key configured).
- 401 -> `unauthorized, set the api key`.
- Non-2xx -> inline red status with the HTTP code and response body, truncated to 300 chars.
- Empty gallery -> `no assets yet`.
- Telemetry 503 -> amber configuration notice.
- No global toast, no error boundary, no retry button, no offline indicator.

## Data contracts

```ts
type Variant = { transform: string; url: string; bytes: number };
type Asset = {
  id: string; publicId: string; status: 'pending' | 'processing' | 'ready' | 'failed';
  error: string | null; bytes: number; width: number | null; height: number | null;
  createdAt: string; variants: Variant[];
};
type Limits = {
  database: { bytes: number; limit: number };
  storage: { bytes: number; objects: number; limit: number };
  queue: { depth: number; limit: number };
  assets: number;
  measuredAt: string;
};
type Point = [timestampSeconds: number, value: number];
```

Endpoints:

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /health | no | `{ status, service }` |
| POST | /v1/assets | yes | create + presign |
| POST | /v1/assets/{publicId}/complete | yes | 202, 409 no object, 413 too large, 429 queue full |
| GET | /v1/assets | yes | max 100, newest first |
| DELETE | /v1/assets/{publicId} | yes | 204 |
| GET | /v1/metrics | yes | Prometheus JSON proxy |
| GET | /v1/limits | yes | measured usage |
| GET | /i/{publicId}/{transform}.{ext} | no | 302 to storage, 202 while processing |

Auth header: `X-Api-Key`.

## Constraints the UI must respect

- Upload cap 20 MB, decode cap 24 MP, three variants generated per asset (200x200 fill, 800 fit, 1600 fit; WebP, q80-82).
- Queue cap 50; `complete` returns 429 with `Retry-After` beyond it.
- Render free tier: one instance each, 0.1 CPU, 512 MB, cold start around 50 seconds after 15 minutes idle.
- Metrics resolution is 60 seconds. Charts cannot be more granular.
- Asset list is capped at 100 rows server-side.
- Processing is sequential per worker; a burst queues.
- No SSE or WebSocket; all updates are polling.

## What a redesign could improve

Multi-file and drag-drop uploads with real progress; skeletons instead of raw text; charts with axes and tooltips; filters, search, sorting, pagination; an asset detail drawer showing dimensions, dates, and all variant URLs; toasts; warning thresholds on the budget bars; per-variant copy buttons; keyboard navigation and focus states; light theme; mobile layout. All of that has to stay within the contracts and constraints above.
