# Audi Leads Dashboard — Google Sheets → MongoDB

A dashboard that stays in sync with a Google Sheet automatically. A single API
endpoint pulls the sheet, upserts new/changed rows into MongoDB, and the
dashboard polls the API every 10s to reflect changes — no "Sync" button
anywhere.

```
Scheduler (any) -> /api/cron/sync -> MongoDB -> Dashboard (polls the API)
```

This is a **plain Next.js app — no custom server**. `npm run dev` is just
`next dev`; `npm start` is just `next start`. There's exactly one trigger
point for the sync everywhere: `/api/cron/sync` (guarded by `CRON_SECRET`).
What calls it differs by host:

- **Local dev, or any host running a persistent `next start`/`next dev` process** (Render, Railway, Fly.io, a VPS, etc.) — `instrumentation.js` self-triggers `/api/cron/sync` over plain HTTP on a timer (`SYNC_INTERVAL_MINUTES`), as long as the process stays alive. No custom server needed for this — it's a built-in Next.js hook, not a wrapper around Next.
- **Vercel** — serverless, no persistent process for a timer to live in, so `instrumentation.js` skips itself there (detected via the `VERCEL` env var). Add a `vercel.json` `crons` entry instead (see "Deploying to Vercel"), or an external scheduler.

The admin account is lazy-seeded on first login (`lib/seedAdmin.js`, called
from `pages/api/auth/login.js`) rather than at server boot, since a plain
Next.js app has no reliable single "boot" hook for this on every host either.

## 1. Google Cloud service account setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and enable the **Google Sheets API**.
2. Create a **Service Account**, then create a JSON key for it and download it.
3. Open the target Google Sheet and **share it** (Viewer access is enough) with the service account's email address (looks like `xxxx@xxxx.iam.gserviceaccount.com`).
4. Put the downloaded key file at `./credentials/service-account.json` (gitignored), **or** set `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` env vars directly (see `.env.example`).

The first row of the sheet must be a header row. The sync recognizes columns
by name (case-insensitive) for deduplication:

- A column named `Lead ID` or `ID` → used as the primary dedupe key.
- Otherwise a column containing `phone`/`mobile`/`contact` → used as the fallback dedupe key.
- `Name`/`Full Name`/`Customer` and any `Email` column are also mapped for display; every column is stored regardless.

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in `MONGODB_URI` and either `GOOGLE_APPLICATION_CREDENTIALS` (path to the JSON key) or the inline `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY` pair.

`GOOGLE_SHEET_ID` / `GOOGLE_SHEET_NAME` / `SYNC_INTERVAL_MINUTES` only seed the initial Settings document — they can be changed later from the **Settings** page in the dashboard without restarting the server.

Also set `AUTH_SECRET` (a long random string), `ADMIN_USERNAME`, and `ADMIN_PASSWORD` — these seed the single admin login. The admin account is created/updated to match `.env` on every login attempt, so to rotate the password, change it in `.env` and just log in again.

## 3. Install & run

```bash
npm install
npm run dev      # next dev
npm run build && npm start   # next build && next start, for production
```

This syncs automatically every `SYNC_INTERVAL_MINUTES` while the process is
running (via `instrumentation.js` — see above), no extra setup needed. You
can also force an immediate sync by clicking **Save Settings**.

## How it works

- **`lib/googleSheets.js`** — authenticates with the service account and reads all rows from the configured sheet/tab.
- **`lib/syncService.js`** — for every row, hashes its contents and looks up an existing lead by Lead ID (or Phone). Inserts new rows, updates changed rows, skips unchanged rows, and writes a `SyncLog` entry every run. Takes no arguments, pushes nothing — just does the sync, callable from anywhere.
- **`pages/api/cron/sync.js`** — the one and only trigger point. Calls `runSync()`, guarded by `CRON_SECRET`. Point any scheduler at this URL.
- **`instrumentation.js`** — self-triggers `/api/cron/sync` over HTTP on a timer, for hosts with a persistent process (see above). No Node core modules imported here on purpose — an earlier version imported `lib/db.js` directly and Next's bundler couldn't resolve `dns` for this specific file, so this just calls the already-working HTTP endpoint instead of touching Mongo/Sheets code directly.
- **Dashboard (`pages/index.js`)** — Sync Status card (last sync time, total records, new leads today, online/offline), a Follow-ups reminder card (overdue/today/upcoming counts), and the Leads table (search, model filter, pagination, CSV export). Polls the API every 10s for updates.
- **Settings (`pages/settings.js`)** — admin can change the Sheet ID, Sheet Tabs, and sync interval (1/5/15 min, or Daily — this is just the Online/Offline threshold, not an actual schedule). Saving triggers an immediate (awaited) sync.

## Leads table: filtering, pagination, export

- **Search** — matches name, phone, email, Lead ID, or model.
- **Model filter** — dropdown populated from whatever models actually exist in the DB (`Lead.distinct("model")`), not hardcoded.
- **Pagination** — 20 leads per page (`pages/api/leads.js` takes `page`/`pageSize`/`model`/`search` and returns `total`/`totalPages` alongside the page of leads). The `#` column is the row's overall position (`(page-1)*pageSize + index + 1`), not just the index within the current page.
- **Export** — `pages/api/leads/export.js` takes optional `from`/`to` (filters on the lead's `createdAt` in MongoDB — i.e. when it was first synced, not the sheet's own inconsistently-formatted `created_time` column) and `model`, and streams back a CSV (opens directly in Excel; a real `.xlsx` library wasn't used because the popular one on npm, `xlsx`/SheetJS, has unpatched high-severity advisories with no fix available).

## Deploying to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket and import it into Vercel (or `vercel deploy`). Vercel auto-detects Next.js — zero config needed.
2. In the Vercel project's **Settings → Environment Variables**, add every variable from `.env`:
   - `MONGODB_URI`
   - `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (the service-account **JSON file won't be deployed** — it's gitignored — so these inline vars are mandatory on Vercel, not optional like they are locally)
   - `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME`, `SYNC_INTERVAL_MINUTES`
   - `AUTH_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
   - `CRON_SECRET`
3. Redeploy after adding env vars (Vercel doesn't hot-reload them into an existing deployment).
4. Log in once at `/login` — this is what actually creates the admin account on Vercel (lazy-seeded from `ADMIN_USERNAME`/`ADMIN_PASSWORD` on first login attempt).

**Nothing triggers the sync automatically on Vercel until you add a scheduler.** There's no `vercel.json` in this repo currently. To add automatic sync:
- Add a `vercel.json` with a `crons` entry pointing at `/api/cron/sync` (once-daily max on the Hobby plan — a more frequent schedule doesn't just get throttled, Vercel **rejects the entire deployment**), or
- Point a free external scheduler (e.g. [cron-job.org](https://cron-job.org), or a scheduled GitHub Actions workflow) at your deployed `/api/cron/sync` URL with header `Authorization: Bearer <CRON_SECRET>`, on whatever interval you want.

If you do add a schedule, set **Sync Interval** on the Settings page to match it — the Online/Offline indicator compares against that value, so a mismatch makes it look broken even when it's working as configured.

## Login

The whole dashboard sits behind a single admin login (`lib/auth.js` + `lib/seedAdmin.js`, JWT session cookie). Unauthenticated requests to any page or API route redirect to `/login` (pages) or 401 (API). Log in at `/login` with `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env`.

## CRM: remarks & follow-ups

Each lead can carry its own history, independent of the sheet sync (the sync never touches these fields):

- **Remarks** — an append-only timestamped log ("Called, interested", "Sent brochure", etc.). Add one from the **Manage** button on any lead row.
- **Follow-ups** — schedule a date + note; check it off when done. `pages/api/followups.js` aggregates every incomplete follow-up across all leads for the reminders card and the dedicated **Follow-ups** page (`/followups`), bucketed into Overdue / Due Today / Upcoming.

Reminders are in-dashboard only (no email/SMS/push) — the Follow-ups page and the dashboard card are the "reminder" surface. Ask if you also want browser push or email notifications.

## Notes on "Online / Offline"

Sync status is considered **Online** when the most recent sync run succeeded
within `2 × syncIntervalMinutes`. If the sync service crashes, MongoDB is
unreachable, or the sheet ID is misconfigured, the card flips to **Offline**
and shows the last error.
