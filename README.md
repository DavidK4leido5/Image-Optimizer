# Image service

A small Cloudinary: upload an image once, a worker writes immutable resized variants to object storage, a CDN serves them. Two .NET services, Postgres, S3-compatible storage, one Cloudflare Worker. Runs entirely on free tiers.

```
browser ──presign──> api ──────────────────────> postgres (assets, variants, jobs)
   │                   │                              │
   ├──PUT bytes───────>┼──> object storage             ├──claim job──> processor
   │                   │    (S3Mock / Supabase)        │                  │
   └──complete────────>┘         ▲                     │                  │
                                 └─────variants────────┼──────────────────┘
                                                       │
browser <──/i/── edge cache (cloudflare worker) <──────┘
```

## Why it is shaped this way

Free tiers do not allow request-time image work. Cloudflare Workers give 100k requests a day but 10ms of CPU per request, and serverless function bodies cap out around 4.5MB. Resizing on demand at the edge is not an option, and proxying uploads through the API is not either.

So the pipeline is:

1. The browser asks the API for a presigned PUT and uploads the bytes straight to storage.
2. The API records the asset and enqueues a job in Postgres.
3. The processor wakes, downloads once, writes every variant under a deterministic key, marks the asset ready.
4. Delivery is a redirect to an immutable object. The CDN never computes anything.

That is what makes the whole thing cost zero: compute runs once per upload, storage is write-once, and every read is cacheable forever.

## Services

| Service | Role | Scales on | Calls |
|---|---|---|---|
| `api` | control plane: presign, metadata, delivery redirects, wake the worker | requests | public |
| `processor` | data plane: decode, resize, encode, write variants | queue depth | private, `/wake` + `/health` |
| `delivery` | Cloudflare Worker: edge cache in front of `/i/` | requests | public |
| `web` | static dashboard | n/a | public |

The split is not decoration. The API is tiny and latency-sensitive. The processor is CPU-heavy, single-threaded on 512MB, and must never be publicly reachable. They share a database because they are two halves of one pipeline, not two products.

## Quick start

```bash
docker compose up -d --build
```

Then open the console. For local dev: `cd web && npm install && npm run dev`, and set the api base to `http://localhost:5080` with key `dev-local-key`. The deployed console is at https://davidk4leido5.github.io/Image-Optimizer/.

Upload an image. Within a couple of seconds you get three WebP variants and a delivery URL:

```
http://localhost:5080/i/<publicId>/w_200,h_200,c_fill,f_webp,q_80.webp
```

Local storage is Adobe S3Mock. MinIO is no longer published on Docker Hub, so the compose file uses S3Mock, which accepts presigned URLs and supports CORS. It is a test double, not production storage.

### Running the services outside Docker

```bash
docker compose up -d postgres s3
dotnet run --project src/Api         # :5080
dotnet run --project src/Processor   # :5081
```

Environment variables are read from the process, not a `.env` file. Copy `.env.example` if you export them yourself.

## API

All `/v1` routes need `X-Api-Key`. Delivery routes are public.

```bash
# 1. create the asset and get an upload target
curl -s http://localhost:5080/v1/assets \
  -H 'X-Api-Key: dev-local-key' -H 'Content-Type: application/json' \
  -d '{"fileName":"cat.jpg","contentType":"image/jpeg","bytes":32876}'

# 2. PUT the file to upload.url with upload.headers, then
curl -s -X POST http://localhost:5080/v1/assets/<publicId>/complete \
  -H 'X-Api-Key: dev-local-key'

# 3. list, inspect, delete
curl -s http://localhost:5080/v1/assets -H 'X-Api-Key: dev-local-key'
curl -s -X DELETE http://localhost:5080/v1/assets/<publicId> -H 'X-Api-Key: dev-local-key'
```

Transforms are Cloudinary-flavoured: `w_400,h_300,c_fill,f_webp,q_80`. Keys are `w`, `h`, `c` (`fit` or `fill`), `f` (`webp`, `jpeg`, `png`), `q`. Order does not matter; the canonical form is the cache identity.

Requesting a transform that was not generated eagerly enqueues it and returns `202` with `Retry-After: 2`. The next request is a `302`.

```bash
scripts/smoke.ps1    # end to end: upload, poll, fetch a variant, assert bytes
```

## How the backend stays correct

- **Deterministic keys.** `v1/{assetId}/{sha256(canonical transform)}.{ext}`. Re-running a job overwrites the same objects, so retries are idempotent and no cache purge API is needed.
- **Queue with leases.** `jobs` rows are claimed with `FOR UPDATE SKIP LOCKED` and a 3 minute lease. A crashed worker's job becomes claimable again. Three attempts, exponential backoff, then the asset is marked `failed` with the error surfaced in the dashboard.
- **Validation at the trust boundary.** Content type allowlist, size cap, magic-byte decode via `SKCodec`, 24MP decode cap, EXIF stripped.
- **Immutable caching.** Variants are written with `Cache-Control: public, max-age=31536000, immutable`.
- **One storage adapter.** The same S3 client serves local S3Mock and Supabase. Presigning uses a public endpoint, SDK calls use the internal one, which is what makes browser uploads work inside a container network.
- **Constant-time secrets.** API key and internal key comparisons hash first.

No EF Core. The schema is three tables and the queries are four joins at most; `Npgsql` plus a 40-line helper keeps cold start and dependencies smaller. Add a migration tool when a second deployable starts changing tables independently.

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_URL` | both | local compose Postgres |
| `API_KEY` | api | `dev-local-key` |
| `INTERNAL_KEY` | both | `dev-internal-key` |
| `PROCESSOR_URL` | api | `http://localhost:5081` |
| `MAX_UPLOAD_BYTES` | api | 20 MiB |
| `S3_ENDPOINT` | both | `http://localhost:9090` |
| `S3_PUBLIC_ENDPOINT` | both | same as `S3_ENDPOINT` |
| `S3_PUBLIC_BASE` | both | same as `S3_ENDPOINT` |
| `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | both | local values |
| `S3_PATH_STYLE` | both | `true` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | both | unset, tracing off |

## Deploy, free, no card

Step by step, with every value and failure mode: **[DEPLOY.md](DEPLOY.md)**. The short version:

### 1. Supabase (database and storage)

1. Create a project. Create a bucket named `images` and mark it public.
2. Storage, S3 access keys: create a key pair. Endpoint is `https://<ref>.storage.supabase.co/storage/v1/s3`, region is the project region.
3. `S3_PUBLIC_BASE=https://<ref>.supabase.co/storage/v1/object/public`.
4. `DATABASE_URL`: use the pooler URI, `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`. The API converts URIs and pins `SslMode=Require`, `MaxPoolSize=10`.

Free project pauses after about a week idle. One scheduled ping to the REST endpoint keeps it awake.

### 2. Render (both services)

Free web services, Docker, no card. Point two services at `Dockerfile.api` and `Dockerfile.processor`, or apply `render.yaml`. Fill the env vars from above. Set `PROCESSOR_URL` to the processor's public URL.

Free plan is 750 instance hours across all services and sleeps after 15 minutes. Keep the API warm with a free pinger; let the processor sleep and wake it via `/wake`. First request after idle is slow, so the dashboard shows a waking state.

### 3. Cloudflare Worker (CDN)

```bash
cd delivery
npx wrangler deploy
```

Set `ORIGIN` in `wrangler.toml` to the API URL. No custom domain needed, which is the point: a free `workers.dev` hostname is a real HTTPS CDN endpoint.

Delivery uses a closed set of named presets, so a caller cannot invent a size:

| Preset | Size | Use |
|---|---|---|
| `sm` `md` `lg` `xl` | 320, 480, 768, 1024 wide, original ratio | `srcset` breakpoints |
| `2xl` `3xl` `4xl` | 1280, 1600, 1920 wide, original ratio | desktop |
| `thumb` | 160x160 fill | grid cells |
| `card` | 480x320 fill (3:2) | cards |
| `hero` | 1920x1080 fill (16:9) | banners |

`https://<worker>/i/<id>/lg.webp` generates on the first request and is cached for a year after. While a preset builds, the api redirects to the closest ready variant with `X-Fallback: 1`; the worker returns it with `no-store` so a low-res image is never pinned under a high-res URL. Upload still creates only the three original variants.

There is no cache purge on `workers.dev`, so a deleted asset's URL can keep returning the cached bytes until the one-year TTL or an eviction. The database row and the storage object are gone immediately, and storage does not count cached bytes against the 1 GB allowance. That is an accepted tradeoff on the free plan: purge needs a custom domain in a Cloudflare zone.

### 4. GitHub Pages (console)

The React console in `web/` deploys with the `pages` workflow. Enable it once in the repo: Settings, Pages, Source: **GitHub Actions**. After that, every push that touches `web/` builds and deploys.

In the console, set the API base to the Render URL, the key, and the CDN base to the Worker hostname.

## Budget

| Service | Free allowance | What it means here |
|---|---|---|
| Supabase storage | ~1GB, single-digit GB egress | roughly 600 to 900 assets with three variants |
| Supabase Postgres | 500MB | metadata is a few KB per asset, tens of thousands fit |
| Render | 750 instance hours, sleeps at 15 min | API warm 24/7 (~730h), processor on demand |
| Worker | 100k requests/day | cache hits skip Render, but still count as worker requests |
| GitHub Pages | free for public repos | React console, built by Actions |
| GitHub Actions | 2000 min/month private | build and test |
| Grafana Cloud | 10k series, 50GB logs | OTLP traces and metrics |

## Known limits

- 24MP decode cap, 20MB upload cap, sequential processing. One image at a time is deliberate on 512MB.
- No signed delivery URLs. Anyone with a public id can read a public asset. Add an HMAC query parameter validated in the worker when assets become private.
- One API key, no users. The API is a control plane for one operator.
- On-demand transforms are open to anyone who guesses a transform string. The worker's edge cache absorbs repeats; rate-limit at Cloudflare if that matters.
- `failed` assets keep their original object so you can retry after fixing the cause. Delete the asset to reclaim the bytes.
- SkiaSharp is MIT. ImageSharp 4 was the nicer API but requires a license key at build time, and 3.x carries known image-parser advisories, so it is not in this repo.

## Tests

```bash
dotnet test CloudinaryClone.slnx
```

22 tests: canonical transform and hashing, connection-string parsing, target-size math, cover-crop geometry, EXIF orientation mapping, and WebP encoding.
