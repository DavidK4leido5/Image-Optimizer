# Deploy runbook

Target: zero cost, no credit card. Render for compute, Supabase for Postgres and object storage, Cloudflare for the edge and the dashboard.

```
browser ──> pages (static dashboard)
              │
              ├──> api (render) ──> supabase postgres
              │        │
              │        └──> supabase storage (presigned PUT)
              │
              └──> worker (cloudflare) ──> api /i/ ──> supabase storage
```

## 0. Before you start

- A GitHub repo containing this code (public gives you free Actions minutes).
- Accounts: Supabase, Render, Cloudflare. None of them need a card for the free tiers used here.
- Nothing else. No domain is required; `workers.dev` and `onrender.com` hostnames are enough.

## 1. Supabase

1. **Create a project.** Pick the region closest to you. Save the database password.
2. **Create the bucket.** Storage, New bucket, name it `images`, toggle **Public bucket** on. The public flag is required, the delivery URLs are unauthenticated.
3. **Copy the S3 endpoint and region.** Storage, S3, Configuration. You will see something like:
   - endpoint: `https://<ref>.storage.supabase.co/storage/v1/s3`
   - region: `ap-southeast-1` (your project region)
   Use the storage hostname, not `<ref>.supabase.co`. It is the direct storage host and avoids a hop.
4. **Create S3 access keys.** Same page, New access key. The secret is shown once.
   These keys bypass RLS and have full access to every bucket. They live only in the server environment, never in the browser.
5. **Copy the pooler connection string.** Project Settings, Database, Connection string, **Transaction pooler**:
   ```
   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
   The username is `postgres.<ref>`, not `postgres`. The API converts this URI, forces `SslMode=Require`, caps the pool at 10, and disables Npgsql's connection reset (`No Reset On Close`). Without that last flag, Supavisor's transaction mode hangs on the first query after schema creation. The schema is created by the API on first boot; there is no migration step. Tables come up with Row Level Security enabled and no policies, so a publishable key cannot read them through PostgREST. The services connect as the table owner and bypass RLS.

## 2. Render

Push the repo, then create a Blueprint from `render.yaml`. Render reads both services and asks for the `sync: false` values.

| Variable | api | processor | Value |
|---|---|---|---|
| `DATABASE_URL` | yes | yes | Supabase pooler URI |
| `API_KEY` | yes | no | long random string, e.g. `openssl rand -hex 24` |
| `INTERNAL_KEY` | yes | yes | a different random string |
| `PROCESSOR_URL` | yes | no | `https://<processor>.onrender.com` |
| `S3_ENDPOINT` | yes | yes | `https://<ref>.storage.supabase.co/storage/v1/s3` |
| `S3_PUBLIC_ENDPOINT` | yes | yes | same as `S3_ENDPOINT` |
| `S3_PUBLIC_BASE` | yes | yes | `https://<ref>.supabase.co/storage/v1/object/public` |
| `S3_REGION` | yes | yes | project region |
| `S3_ACCESS_KEY` | yes | yes | Supabase access key id |
| `S3_SECRET_KEY` | yes | yes | Supabase secret |
| `S3_BUCKET` | yes | yes | `images` |
| `S3_PATH_STYLE` | yes | yes | `true` |

`PROCESSOR_URL` does not exist until the processor is created. Render names it `https://cloudinary-processor.onrender.com` if the name is free. If Render appends a suffix, open the processor service and copy its real URL into the api's environment, then restart the api.

Both Dockerfiles bind to `$PORT` when Render sets it and to 8080 otherwise, so no port configuration is needed.

Free services sleep after 15 minutes idle. The first request afterwards takes about 50 seconds. That is expected, not a bug.

## 3. Cloudflare Worker

```bash
cd delivery
# set ORIGIN to https://<api>.onrender.com in wrangler.toml first
npx wrangler login
npx wrangler deploy
```

Wrangler prints the URL, `https://cloudinary-delivery.<subdomain>.workers.dev`. That is your CDN. No domain, no zone, no card.

A brand new Cloudflare account has no `workers.dev` subdomain yet, so the first deploy stops and prints an onboarding link. Claim a subdomain there (one time), then deploy again. TLS for a new subdomain can take a few minutes to provision; until then HTTPS fails the handshake while plain HTTP already works.

The worker only proxies GET and HEAD, caches 200 responses for a year, and leaves everything else alone. Cache hits never reach Render. They still count toward the 100k requests/day, but they cost almost no CPU.

## 4. GitHub Pages

The React console in `web/` is deployed by `.github/workflows/pages.yml`.

1. Repo, Settings, Pages, Source: **GitHub Actions**. One time only.
2. Push a change under `web/`, or run the `pages` workflow manually.

The site lands at `https://<user>.github.io/<repo>/`. Open it and fill in:

- **api base**: `https://<api>.onrender.com`
- **api key**: the `API_KEY` from Render
- **cdn base**: `https://cloudinary-delivery.<subdomain>.workers.dev`

Values are stored in the browser's localStorage. The console itself is public; the key is what gates the API.

## 5. Verify

```bash
curl -s https://<api>.onrender.com/health
# {"status":"ok","service":"api"}

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke.ps1 ^
  -Api https://<api>.onrender.com -Key <api key>
```

The smoke script uploads, waits for the worker, fetches a variant, asserts the WebP container, checks that a missing key is rejected, then deletes the asset.

Then confirm the edge cache:

```bash
curl -sI "https://<worker>.workers.dev/i/<publicId>/w_800,c_fit,f_webp,q_80.webp"
```

Expect `200`, `content-type: image/webp`, `cache-control: public, max-age=31536000, immutable`. Run it twice; the second response is served from the colo cache.

## 6. Keep it warm and observed

Render allows 750 free instance hours per workspace per month, and a 31-day month has 744 hours. One always-on service consumes almost all of it, so:

- Ping the **api** every 10 to 14 minutes with a free monitor (cron-job.org, UptimeRobot). Keep only the api warm.
- Leave the **processor** asleep. The api calls its `/wake` endpoint after enqueuing a job. It consumes hours only while awake, roughly 15 minutes per batch.
- The same ping to `/health` runs a `select 1`, which also keeps the Supabase project from pausing after a week of inactivity.

Optional tracing, on both services:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 instance:token>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

The code enables the OTLP exporter only when the endpoint variable is present.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/health` returns 503 | bad `DATABASE_URL`, paused project, or wrong pooler username | check the URI, use `postgres.<ref>`; restore the project if paused |
| Every `/v1` call returns 401 | `API_KEY` mismatch | compare with the Render env var, no quotes |
| Presigned PUT returns 403 | URL older than 10 minutes, or the `Content-Type` header was not sent exactly as issued | re-create the asset, send the headers from the response |
| Browser upload fails with CORS | the storage host rejected the origin | check the console; Supabase Storage allows all origins by default, confirm custom CORS did not narrow it |
| Images 404 through the api | bucket is private, or `S3_PUBLIC_BASE` is wrong | make the bucket public, base must end in `/object/public` |
| Asset stuck in `processing` | processor not reachable, or `INTERNAL_KEY` differs | check the processor `/health`, its logs should show `woken` |
| First request takes ~50s | Render free cold start | keep the api warm with the pinger |
| Render build fails | Dockerfile path or build context | both Dockerfiles expect the repo root as context |

## 8. The free-tier math

| Resource | Free allowance | Used here |
|---|---|---|
| Supabase storage | ~1GB, a few GB egress | 600 to 900 assets with three variants |
| Supabase Postgres | 500MB | metadata is KB per asset |
| Render | 750 instance hours/month, sleep at 15 min | api warm, processor on demand |
| Cloudflare Workers | 100k requests/day | cache hits skip Render; they still count toward the daily request cap |
| GitHub Pages | free for public repos | React console, built by Actions |
| GitHub Actions | 2000 min/month private | build and test |

The only thing that could cost money is exceeding Supabase storage or egress, which requires roughly an order of magnitude more images than a portfolio needs.
