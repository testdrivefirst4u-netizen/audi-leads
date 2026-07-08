# Audi Leads Dashboard — Google Sheets → MongoDB

A dashboard that stays in sync with a Google Sheet automatically. A background
job polls the sheet on an interval, upserts new/changed rows into MongoDB,
and the dashboard polls the API every 10s to reflect changes — no "Sync"
button anywhere.

```
Google Sheet -> Background Sync -> MongoDB -> Dashboard (polls the API)
```

This app runs in two different modes depending on where it's hosted, because
the "background job" needs a persistent process to run on a schedule, which
not every host provides:

- **Local dev / any host with a persistent Node process** (Render, Railway, Fly.io, a VPS, etc.) — `server.js` runs a custom Node server that starts `node-cron` in-process (see `lib/cron.js`) and seeds the admin account on boot.
- **Vercel** — serverless, no persistent process, so `server.js` never runs there at all. Instead, **Vercel Cron** (`vercel.json`) hits `/api/cron/sync` on a schedule, and the admin account is lazy-seeded on first login instead of at server boot. See "Deploying to Vercel" below.

Either way, the sync logic itself (`lib/syncService.js`) is identical — only what triggers it differs.

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

Also set `AUTH_SECRET` (a long random string), `ADMIN_USERNAME`, and `ADMIN_PASSWORD` — these seed the single admin login. Re-run the server to rotate the password (it re-syncs the DB with whatever is in `.env` on every boot).

## 3. Install & run

```bash
npm install
npm run dev      # development
npm run build && npm start   # production
```

The app boots a custom Node server (`server.js`) that serves Next.js, hosts
Socket.IO at `/api/socket`, and starts the cron scheduler on startup — a full
sync runs immediately, then every `syncIntervalMinutes`.

## How it works

- **`lib/googleSheets.js`** — authenticates with the service account and reads all rows from the configured sheet/tab.
- **`lib/syncService.js`** — for every row, hashes its contents and looks up an existing lead by Lead ID (or Phone). Inserts new rows, updates changed rows, skips unchanged rows, and writes a `SyncLog` entry every run. Platform-agnostic — takes no arguments, pushes nothing, just does the sync.
- **`lib/cron.js`** + **`server.js`** — local-dev-only. Schedules `runSync` with `node-cron` at the configured interval, re-reading Settings every 15s to pick up interval changes made in the UI. Never runs on Vercel.
- **`pages/api/cron/sync.js`** — the Vercel-side equivalent: calls the same `runSync()`, guarded by `CRON_SECRET`. Triggered on the schedule in `vercel.json`.
- **Dashboard (`pages/index.js`)** — shows the Sync Status card (last sync time, total records, new leads today, online/offline), a Follow-ups reminder card (overdue/today/upcoming counts), and a searchable Leads table. Polls the API every 10s for updates.
- **Settings (`pages/settings.js`)** — admin can change the Sheet ID, Sheet Tabs, and sync interval (1/5/15 min). Saving triggers an immediate (awaited) sync so the change takes effect right away.

## Deploying to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket and import it into Vercel (or `vercel deploy`). Vercel auto-detects Next.js — `npm run build` / `next build` is all it runs; it ignores `server.js` and the `dev`/`start` scripts entirely.
2. In the Vercel project's **Settings → Environment Variables**, add every variable from `.env`:
   - `MONGODB_URI`
   - `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (the service-account **JSON file won't be deployed** — it's gitignored — so these inline vars are mandatory on Vercel, not optional like they are locally)
   - `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME`, `SYNC_INTERVAL_MINUTES`
   - `AUTH_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
   - `CRON_SECRET`
3. Redeploy after adding env vars (Vercel doesn't hot-reload them into an existing deployment).
4. Log in once at `/login` — this is what actually creates the admin account on Vercel (lazy-seeded from `ADMIN_USERNAME`/`ADMIN_PASSWORD` on first login attempt, since there's no server-boot hook to do it otherwise).

**Cron frequency caveat:** `vercel.json` requests `/api/cron/sync` every 5 minutes. Vercel's **Hobby plan only allows once-per-day cron jobs** — it will silently coerce or reject a more frequent schedule. For anything more frequent than daily (including the 1-minute interval originally requested), you need a **Pro** plan or higher. If you're on Hobby, either upgrade or change the schedule in `vercel.json` to something like `"0 3 * * *"` (once daily) and accept that the dashboard's Online/Offline indicator will read "Offline" between runs, since it compares against the `syncIntervalMinutes` setting in the Settings page — set that to a value that matches your real cron cadence so the indicator isn't misleading.

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
