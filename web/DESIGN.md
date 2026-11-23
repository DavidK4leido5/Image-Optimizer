# Design notes

## Direction

An operator's console: dense, quiet, scannable. Assets are the primary surface, so the upload zone and grid sit at the top. Services (budgets, telemetry) follow in a two-column band on wide screens. Settings moved into a dialog; the header keeps a chip with the API host and a health pill.

Typeface is IBM Plex Sans, tabular numerals for every number, monospace only for public ids and warehouse codes. One accent (blue) and three semantics (ok, warn, danger). No gradients, no decorative motion. Motion is limited to the drawer entering and the upload progress fill.

## Tokens

Defined in `src/styles/tokens.css`, switched by `data-theme` on `<html>`.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f4f5f7` | `#0b0d10` |
| `--surface-1` | `#ffffff` | `#14171c` |
| `--surface-2` | `#eceef2` | `#1a1e24` |
| `--surface-3` | `#e2e5ea` | `#22272f` |
| `--line` | `#d6dae1` | `#2a3038` |
| `--text` | `#16191f` | `#e7eaef` |
| `--text-muted` | `#5a626d` | `#9aa3ae` |
| `--accent` | `#1f6feb` | `#6ea8ff` |
| `--ok` | `#177245` | `#5ddc8a` |
| `--warn` | `#8a5300` | `#f3b64b` |
| `--danger` | `#b42318` | `#ff8a80` |

Type scale: 12, 13, 15, 17, 20, 24 px. Spacing: 4, 8, 12, 16, 20, 24, 32, 48. Radii: 6, 10, 14, pill. Shadows: one hairline for panels, one deep for dialogs and toasts.

Theme resolution: an inline script in `index.html` reads `img.theme`, falls back to `prefers-color-scheme`, and sets `data-theme` before first paint. The header toggle writes `img.theme`.

## Component inventory

| Component | Responsibility |
|---|---|
| `Header` | Brand, health pill (latency, last check, click to recheck), connection chip, theme toggle, offline badge |
| `ConnectionDialog` | Native `<dialog>` with api, key, cdn. Writes through on every edit |
| `UploadZone` | Drop, browse, paste. Delegates validation to the queue |
| `UploadQueue` | Per-file three-stage track, progress, retry, dismiss, clear done |
| `AssetToolbar` | Search with `/` shortcut, status filter, sort, count and cap note |
| `AssetGrid` | Empty states, paged grid, show more, clear filters |
| `AssetCard` | Thumbnail with one retry, id, status, dimensions, size, relative time, variant count |
| `AssetDrawer` | Native `<dialog>`, preview, meta, per-variant copy/open, two-step delete |
| `BudgetMeters` | Database, storage, queue; 70%/90% thresholds with text labels and percentages; measured-at age |
| `TelemetryPanel` | Service and range toggles, five charts, 503 configuration notice, retry |
| `LineChart` | Hand-written SVG, y ticks, time labels, pointer and keyboard cursor, aria summary |
| `Toasts` | Copy, delete, and error notifications |
| `ErrorBoundary` | Last-resort crash screen with reload |

Hooks: `usePolling` (visibility-aware), `useUploadQueue` (sequential XHR pipeline), `useConfig`, `useTheme`, `useToasts`, `useOnline`.

API layer: `api/client.ts` is the only place `X-Api-Key` is attached. `ApiError` normalizes status, body (300 chars), and `Retry-After`. `api/metrics.ts` owns the exact PromQL and unit conversion.

## Layout sketch

```
┌ header ─────────────────────────────────────────────┐
│ mark  image console              health  host  theme │
├ main ───────────────────────────────────────────────┤
│ [ connect notice, only without a key ]              │
│ ┌ upload zone ─────────────────────────────────────┐ │
│ └──────────────────────────────────────────────────┘ │
│ ┌ upload queue, only while files exist ────────────┐ │
│ └──────────────────────────────────────────────────┘ │
│ ┌ assets ──────────────────────────────────────────┐ │
│ │ title + count        search  status  sort        │ │
│ │ [card] [card] [card] [card]                      │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌ free tier ───────┐ ┌ telemetry ─────────────────┐ │
│ │ meters           │ │ toggles + five charts      │ │
│ └──────────────────┘ └────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Assumptions about the API

- `/health` returns no timing, so latency is measured around the fetch.
- `createdAt` is ISO-8601; relative times are computed client-side.
- `Retry-After` is seconds. The API now exposes the header via CORS, otherwise cross-origin JS cannot read it.
- The asset list is capped at 100 and is newest-first; the UI pages 24 at a time and never asks for more.
- Variants carry no width, so the drawer picks the preview by parsing `w_<n>` from the transform.
- Upload retry restarts at create. A retry after a 429 re-uploads the file, which can leave an unreferenced original object; there is no cleanup endpoint to call.
- Delete is optimistic: the card disappears on 204, then the list refreshes.
- Polling pauses on `visibilitychange` and resumes immediately.
- `img.theme` is a new localStorage key; `img.api`, `img.key`, and `img.cdn` are unchanged.
