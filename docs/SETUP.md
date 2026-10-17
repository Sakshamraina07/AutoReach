# Local setup

This guide gets the API, the web dashboard and the Chrome extension running on your
computer. For production, see [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.13 or newer (see `.nvmrc`) | Set in `engines`; Vite 8 and Vitest 5 need it |
| npm | 10+ | Comes with Node |
| PostgreSQL | 15 or 16 | Only for fully local development and for the API tests. A Supabase project works instead |
| Chrome | 116+ | For the extension (side panel API) |

## 2. Install

```bash
git clone https://github.com/Sakshamraina07/AutoReach.git
cd AutoReach
npm ci            # installs every workspace: packages/shared, backend, dashboard, extension
npm run build:shared
```

`website/` is a separate project with its own lockfile (`cd website && npm ci`).

## 3. Choose a database

### Option A: local PostgreSQL (no Supabase needed)

Best for trying AutoReach or developing without touching real data.

```bash
createdb autoreach                       # or: psql -c 'create database autoreach'
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/autoreach
STORAGE_DRIVER=local
ENABLE_DEV_LOGIN=true
DEV_JWT_SECRET=<any long random string>
TOKEN_ENCRYPTION_KEY=<output of: npm run gen:key -w @autoreach/backend>
```

Leave the Supabase variables empty. Local Postgres has no `auth.users` table, so the
first migration needs a small development-only stand-in:

```bash
ALLOW_AUTH_SHIM=true npm run db:migrate
```

`ENABLE_DEV_LOGIN` lets you sign in with just an email address. The API refuses it when
`NODE_ENV=production` or when `DATABASE_URL` is not a local host.

### Option B: a Supabase project

Use this when you want real Google sign-in. Create a project at supabase.com, then fill
in `backend/.env` from `backend/.env.example`:

* `DATABASE_URL`: Project Settings → Database → Connection string → **Session pooler**.
* `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: Project Settings → API.
* `SUPABASE_JWT_SECRET` (optional): Project Settings → API → JWT settings (legacy secret).
  Without it, tokens are verified by calling Supabase, which also works.
* Google sign-in: Authentication → Providers → Google (see [GMAIL_OAUTH.md](GMAIL_OAUTH.md#supabase-sign-in)).

```bash
npm run db:migrate
```

If the database already holds AutoReach v1 data, **back it up first** (see
[DEPLOYMENT.md](DEPLOYMENT.md#1-back-up-before-migrating)). The migrations keep every v1
recruiter, email record, template and Gmail connection, but a backup is the only way back.

## 4. Optional demo data

To explore the dashboard without your own data:

```bash
npm run seed:demo -w @autoreach/backend
```

It refuses to run against anything but a local database or with `NODE_ENV=production`.
It creates the user `aditi.demo@autoreach.example` with fictional recruiters at fictional
companies (all addresses use the reserved `.example` domain, so nothing can be emailed).
Running it again replaces that user's data. Sign in with the development sign-in.

## 5. Run

In three terminals:

```bash
npm run dev:api          # API on http://localhost:3001 (also runs the background jobs)
npm run dev:dashboard    # dashboard on http://localhost:5173
npm run dev:extension    # builds the extension into extension/dist (development mode)
```

Dashboard settings live in `dashboard/.env.local` (copy `dashboard/.env.example`):

```env
VITE_API_URL=http://localhost:3001
VITE_DEV_LOGIN=true                # local Option A only
VITE_SUPABASE_URL=...              # Option B
VITE_SUPABASE_ANON_KEY=...         # Option B
```

Extension settings live in `extension/.env.development.local` (copy `extension/.env.example`).
Load it in Chrome as described in [EXTENSION.md](EXTENSION.md).

Check the API: `curl http://localhost:3001/readyz` lists which integrations are configured.

## 6. What works without which settings

| Missing setting | What happens |
|---|---|
| Google OAuth client (`GOOGLE_CLIENT_ID`/`SECRET`) | Everything except sending and reply detection. Settings and the send dialog say so; drafts can still be written and saved |
| AI provider (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`) | Drafts come from your templates and profile instead. See [AI_PROVIDERS.md](AI_PROVIDERS.md) |
| `API_PUBLIC_URL` on https | Open tracking can't be turned on (mail apps can't reach a local pixel) |
| `HUNTER_API_KEY` | Address suggestions show only common patterns, all labelled unverified |

## 7. Checks

```bash
npm run check     # typecheck + lint + all tests + production builds
```

The API tests start a throw-away PostgreSQL cluster from the local server binaries
(`initdb`, `pg_ctl`). If those aren't installed, set `TEST_DATABASE_URL` to a server where
the tests may create databases. Details and the latest results: [TEST_RESULTS.md](TEST_RESULTS.md).
