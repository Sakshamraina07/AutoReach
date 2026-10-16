# Deployment

AutoReach 2.0 uses the same kinds of services as v1 and adds one static site:

| Piece | Where | Config in the repo |
|---|---|---|
| Database, sign-in, résumé storage | Supabase | `supabase/migrations/*.sql` |
| API + background jobs | Railway (any Node host works) | `railway.json`, `backend/.env.example` |
| Web dashboard | Vercel (any static host works) | `dashboard/vercel.json`, `dashboard/.env.example` |
| Website + privacy policy | Vercel (existing project) | `website/vercel.json` |
| Chrome extension | Chrome (unpacked or Web Store) | `extension/.env.example` |

Nothing in this repository has been deployed by the 2.0 work. The steps below are what
you run; the verification checklist at the end tells you whether it worked.

> **The v1 API can't run against the migrated database.** The migration renames v1
> tables and columns (for example `email_history` → `email_messages`, `recruiters.hr_name`
> → `full_name`) while keeping every row. Deploy the 2.0 API right after migrating, and
> keep the backup from step 1 as your way back.

## 1. Back up before migrating

The migrations were tested against a reconstruction of the v1 schema (see
[TEST_RESULTS.md](TEST_RESULTS.md)), not against your live data, so take a full backup first.

```bash
# Supabase → Project Settings → Database → Connection string (Session pooler or direct)
pg_dump "postgresql://postgres.<ref>:<password>@<host>:5432/postgres" \
  --format=custom --no-owner --file=autoreach-v1-$(date +%Y%m%d).dump
```

The dump contains personal data (recruiter contacts, emails, Gmail tokens from v1). Store it
privately and delete it when you no longer need it. Also download the `resumes` storage
bucket if you want a copy of the files (the migration doesn't move or delete them).

To rehearse, restore the dump into a **new, empty Supabase project** (it has the same roles,
`auth` schema and extensions as the original) and migrate that copy first:

```bash
pg_restore --no-owner --no-privileges --dbname="<new project's connection string>" autoreach-v1-YYYYMMDD.dump
DATABASE_URL="<new project's connection string>" npm run db:migrate
```

`pg_restore` may report errors for objects Supabase already created in the new project
(schemas, extensions, its own tables); those are expected. What matters is that
`auth.users` and the v1 `public` tables are restored. Then compare row counts of
`recruiters` and `email_messages` with v1's `recruiters` and `email_history`, and sign in to
a dashboard pointed at the copy.

To roll back after a real migration: restore the dump into the project (or a new project)
and redeploy the v1 code.

## 2. Supabase

1. **Auth → Providers → Google:** enabled with a Google OAuth client
   ([GMAIL_OAUTH.md](GMAIL_OAUTH.md#supabase-sign-in)).
2. **Auth → URL Configuration:** Site URL = the dashboard URL; Redirect URLs = the dashboard
   URL with `/**`, `http://localhost:5173/**` for development, and
   `https://<extension-id>.chromiumapp.org/**`.
3. **Project Settings → API:** note the project URL, anon key and service-role key.
   The service-role key goes only into the API's environment.
4. Storage: the migration makes the `resumes` bucket private. v1 stored public URLs to
   résumés; after the migration those URLs stop working and résumés are served only through
   the API to their owner.

## 3. API on Railway

1. Railway service → Settings → **Root directory: `/`** (the repository root, not `backend/`:
   the API depends on the shared workspace package). `railway.json` sets:
   * build: `npm run build:shared && npm run build -w @autoreach/backend`
   * pre-deploy: `npm run db:migrate:prod -w @autoreach/backend` (applies pending migrations; a
     failed migration stops the deploy)
   * start: `npm run start -w @autoreach/backend`, health check `/healthz`
2. Variables (see `backend/.env.example` for every option):

   ```env
   NODE_ENV=production
   API_PUBLIC_URL=https://<api domain>          # https, so open tracking can work
   DASHBOARD_URL=https://<dashboard domain>
   DATABASE_URL=<Supabase session pooler URL>
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   SUPABASE_JWT_SECRET=...                       # optional, faster token checks
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   TOKEN_ENCRYPTION_KEY=...                      # 32 random bytes, base64; keep it stable
   AI_PROVIDER=none                              # or see AI_PROVIDERS.md
   TRUST_PROXY_HOPS=1
   ```

   Do not set `ENABLE_DEV_LOGIN` (the API refuses to start with it in production).
3. The API runs the background jobs (send queue, reply sync, follow-ups, retention) in the
   same process. With more than one instance they coordinate through Postgres advisory locks.
   To run them separately, set `WORKERS_ENABLED=false` on the web service and add a second
   service with start command `npm run worker -w @autoreach/backend`.
4. Keep the existing domain (`autoreach-production-3c97.up.railway.app`) if you can: the
   v1 tracking pixels in already-sent emails point at `/track/<id>` on it, and 2.0 still
   answers them.

## 4. Dashboard on Vercel

1. New Vercel project from the same repository, **Root Directory: `dashboard`**.
   `dashboard/vercel.json` installs and builds from the repository root (keep "Include files
   outside the root directory in the build step" enabled, which is the default).
2. Environment variables:

   ```env
   VITE_API_URL=https://<api domain>
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_EXTENSION_URL=<optional: Web Store listing or release page>
   ```
3. Add the dashboard domain to Supabase redirect URLs and set `DASHBOARD_URL` on the API to it.

## 5. Website

The existing Vercel project for `website/` keeps working. Optional variables:
`VITE_DASHBOARD_URL` (adds an "Open the dashboard" button) and `VITE_EXTENSION_URL` (where
"Get the Chrome extension" points; defaults to [EXTENSION.md](EXTENSION.md) on GitHub). The
v1 extension ZIPs were removed from the site because they call API routes that 2.0 replaced.

## 6. Google OAuth

Add `https://<api domain>/api/integrations/gmail/callback` to the web client's redirect URIs
and decide on testing vs. production publishing ([GMAIL_OAUTH.md](GMAIL_OAUTH.md#5-publishing-status-verification-and-the-7-day-limit)).

## 7. Extension

```bash
cp extension/.env.example extension/.env.production   # fill in production values
npm run package -w @autoreach/extension
```

Install `extension/dist` unpacked, or upload `extension/release/autoreach-extension-2.0.0.zip`
to the Chrome Web Store. Add its `https://<id>.chromiumapp.org/**` redirect in Supabase.

## 8. Verify

1. `GET https://<api>/healthz` → `{"status":"ok"}`.
2. `GET https://<api>/readyz` → `"database":"ok"`, `"pending_migrations":[]`, and each
   integration either `configured` or the reason it isn't.
3. Sign in to the dashboard; v1 users should see their recruiters and sent emails (marked v1).
4. Settings → Gmail → Connect (or check the carried-over v1 connection).
5. Add yourself as a recruiter with a second address you own, send one email with your
   résumé, and confirm it arrives with the attachment and appears in Gmail's Sent folder.
6. Reply to it from that second address; within about 3 minutes (or after "Check for replies
   now") it shows **Replied** and the follow-up reminder is cancelled.
7. If you enabled open tracking, open the email in a client that loads images: an
   "open detected" signal appears (opens from your own Gmail tab right after sending are
   labelled as probably yours).
8. Extension: sign in, check the badge and the popup, open the side panel.

## Operations

* **Pause everything:** the sidebar's "Pause all sending" (or the popup's) stops queued,
  scheduled and automatic sends for that user immediately.
* **Logs:** JSON lines (pino). They never contain email bodies, tokens or authorization
  headers; each error response carries a `request_id` that appears in the logs.
* **Rotating `TOKEN_ENCRYPTION_KEY`:** every user must reconnect Gmail afterwards.
* **Data requests:** users export and delete their own data in Settings → Data and privacy.
