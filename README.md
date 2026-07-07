# Audi Leads Dashboard — Google Sheets → MongoDB

A dashboard that stays in sync with a Google Sheet automatically. A background
cron job polls the sheet on an interval, upserts new/changed rows into
MongoDB, and pushes live updates to the browser over Socket.IO — no "Sync"
button anywhere.

```
Google Sheet -> Background Sync Service (node-cron) -> MongoDB -> Dashboard (Socket.IO push)
```

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
- **`lib/syncService.js`** — for every row, hashes its contents and looks up an existing lead by Lead ID (or Phone). Inserts new rows, updates changed rows, skips unchanged rows, and writes a `SyncLog` entry every run.
- **`lib/cron.js`** — schedules `runSync` with `node-cron` at the configured interval, and re-reads Settings every 15s to pick up interval changes made in the UI.
- **`server.js`** — wires Next.js, MongoDB, Socket.IO, and the cron scheduler together. After each sync it emits `sync:status` and `leads:changed` events so every open dashboard updates without a page refresh.
- **Dashboard (`pages/index.js`)** — shows the Sync Status card (last sync time, total records, new leads today, online/offline), a Follow-ups reminder card (overdue/today/upcoming counts), and a searchable Leads table, all updated live via Socket.IO.
- **Settings (`pages/settings.js`)** — admin can change the Sheet ID, Sheet Tabs, and sync interval (1/5/15 min). Saving triggers an immediate sync so the change takes effect right away.

## Login

The whole dashboard sits behind a single admin login (`lib/auth.js` + `lib/seedAdmin.js`, JWT session cookie). Unauthenticated requests to any page or API route redirect to `/login` (pages) or 401 (API/Socket.IO). Log in at `/login` with `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env`.

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
