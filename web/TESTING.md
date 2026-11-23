# Manual test checklist

Run against the built app (`npm run build && npm run preview`) with a real API key.

## Connection

- [ ] No key: the "Connect your API" notice appears, telemetry shows a connect message (no chart cards), budgets show a connect message, no requests are made.
- [ ] Wrong key (set `img.key` to junk): assets show "Unauthorized. Check the API key." with Retry; budgets show usage unavailable; telemetry shows an error with Retry.
- [ ] Correct key: health pill reads "API up" with a latency and a clock time. Clicking re-checks and updates the time.
- [ ] Editing the api or key in the dialog reloads assets, limits, and telemetry without a page refresh.

## Upload

- [ ] Drag three files in: all three appear in the queue; only one runs at a time.
- [ ] Each file shows create, upload, process; the upload bar fills smoothly.
- [ ] A finished file reads "Done" and the asset card appears within one poll (5 s).
- [ ] Paste an image from the clipboard: it enters the queue.
- [ ] Drop a 25 MB file: it is rejected before any request with the 20 MB message.
- [ ] Drop a PDF: rejected as unsupported.
- [ ] 429 (throttle `complete` to return 429 with `Retry-After: 7`): the item says "Queue is full. Try again in 7s." and shows the server wait.
- [ ] 413 (throttle `complete` to 413): "File is larger than the 20 MB limit."
- [ ] 409 (throttle `complete` to 409): "Upload not found in storage. Retry the file."
- [ ] Retry on an error re-runs that file; dismiss removes it; clear done empties completed rows.

## Assets

- [ ] Empty gallery: "No images yet" with an invitation to upload.
- [ ] A failed asset shows its error on the card and in the drawer.
- [ ] Search by id filters live; `/` focuses the field; Escape leaves it.
- [ ] Status filter and sort (newest, oldest, largest) work together.
- [ ] With 100 assets: "the API returns the latest 100" appears in the head and toolbar; "Show more" pages 24 at a time.
- [ ] No matches: "No images match" with a working Clear filters.
- [ ] Card click opens the drawer; Escape closes it; focus returns to the card.
- [ ] Drawer: dimensions, size, date, three variants; each variant has Open and Copy; Copy shows a toast.
- [ ] Delete asks twice, removes the card, shows a toast.

## Services

- [ ] Budgets show percentages and text labels, not color alone; 70% is amber and 90% is red; "Measured N ago" updates.
- [ ] Telemetry toggles api/processor and 1h/6h/24h; charts redraw.
- [ ] Charts show y ticks, first/last times, and a tooltip on hover; arrow keys move the cursor.
- [ ] Fewer than two points: "Not enough data yet" frame, no broken path.
- [ ] `/v1/metrics` 503: amber "Telemetry is not configured" notice with the env var hint.
- [ ] Any other telemetry error: red notice with Retry that works.

## Global

- [ ] Light and dark both meet AA; toggle persists across reload; first visit follows the OS theme.
- [ ] 360 px wide: no horizontal scroll; header wraps; the drawer is full width.
- [ ] Keyboard only: tab reaches every control with a visible ring; `/` focuses search; Enter opens a card; Escape closes dialogs.
- [ ] `prefers-reduced-motion`: drawer and progress transitions are effectively instant.
- [ ] Offline: the header shows "Offline"; going back online clears it.
- [ ] No console errors on load, upload, drawer, delete, or theme switch.
