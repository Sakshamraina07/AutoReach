# AutoReach 2.0 — Architecture

This document describes the target architecture implemented in this repository and the
reasoning behind each choice. The audit that motivated it is in `REPOSITORY_AUDIT.md`.

## 1. Guiding decisions

1. **Keep the stack, fix the foundations.** Supabase (Postgres + Auth + Storage), an Express
   backend, a React/Vite Manifest V3 extension and a React/Vite website all stay. No new
   infrastructure services are introduced (no Redis, no queue service, no separate auth).
2. **One API, two clients.** The web dashboard and the extension are both thin clients of the
   same authenticated REST API. The database is the single source of truth, so the two stay in
   sync by construction (clients refetch on focus/interval; there is no client-side cache that
   can diverge).
3. **Humans approve every send by default.** Nothing is emailed because a row exists. A message is
   sent only after an explicit "Send" (or an explicit, opt-in follow-up auto-send configuration
   with conservative caps and a global pause).
4. **Honest states.** "Sent" means Gmail accepted the message. "Open detected" means our pixel was
   fetched by *something*. "Replied" means a message from the recipient arrived in the thread.
   These are separate fields; none is inferred from another.
5. **Defence in depth for multi-user data.** Every user-scoped query runs inside a transaction that
   switches to a non-privileged database role with Row Level Security keyed on the authenticated
   user, *and* includes an explicit `user_id` predicate.
6. **TypeScript everywhere new code is written**, with shared types and validation schemas.

## 2. Repository layout

```
/                       npm workspaces root (packages/shared, backend, dashboard, extension)
├─ packages/shared/     TypeScript: enums, zod schemas, status derivation, role categories,
│                       email normalisation, template compiler, draft quality checks
├─ backend/             Express 5 + TypeScript API, background workers, migrations runner
├─ dashboard/           React 19 + Vite + TypeScript + Tailwind web dashboard (new)
├─ extension/           Manifest V3 extension: popup, side panel, Gmail assist, page capture
├─ website/             Marketing site + privacy policy (independent Vercel project)
├─ supabase/migrations/ Ordered, idempotent SQL migrations (legacy baseline + 2.0 schema)
└─ docs/                Audit, architecture, plan, setup, deployment, operations
```

`website/` is deliberately **not** a workspace member: it is an independent Vercel project on
React 18 and keeps its own lockfile.

## 3. Runtime components

```
 ┌──────────────┐      HTTPS + Supabase JWT       ┌────────────────────────────┐
 │  Dashboard   │ ───────────────────────────────▶│  Backend API (Express)     │
 │ (Vercel SPA) │◀─────────────────────────────── │  /api/*  /t/*  /track/*    │
 └──────┬───────┘                                 │  workers (in-process):     │
        │ Supabase Auth (Google)                  │   send queue · reply sync  │
 ┌──────┴───────┐      HTTPS + Supabase JWT       │   follow-ups · retention   │
 │  Extension   │ ───────────────────────────────▶│                            │
 │ popup/panel/ │                                 └──┬────────┬────────┬───────┘
 │ Gmail assist │                                    │pg (RLS)│storage │HTTPS
 └──────────────┘                                    ▼        ▼        ▼
                                              Supabase Postgres  Supabase   Gmail API,
                                                                 Storage    Google OAuth,
                                                                 (private)  AI provider
```

### 3.1 Backend

- **Express 5 + TypeScript**, compiled with `tsc`, run with Node ≥ 20.
- **Data access with `pg`** (direct Postgres connection string from Supabase) instead of
  `supabase-js` for tables. Reasons: real transactions (atomic send-state transitions, recruiter
  merges, follow-up cancellation), row locking for the queue (`FOR UPDATE SKIP LOCKED`), and the
  ability to switch roles per transaction for RLS. `supabase-js` is still used for Auth token
  verification and Storage.
- **Authentication**: the bearer token is a Supabase access token. It is verified locally with
  the project's JWT secret (HS256) when `SUPABASE_JWT_SECRET` is configured, otherwise via
  `supabase.auth.getUser(token)` (works with any signing algorithm), with a 60-second
  in-memory cache keyed by the token's SHA-256.
- **Per-user isolation** (`db.withUser(userId, fn)`):
  `BEGIN; SET LOCAL ROLE autoreach_app; SELECT set_config('app.user_id', $1, true); … COMMIT`.
  Every table has RLS enabled with policies `USING (user_id = app_current_user_id())` for the
  `autoreach_app` role. `anon` and `authenticated` have **no** privileges on these tables, so the
  public anon key cannot read them through PostgREST. Background workers use
  `db.withSystem(fn)` explicitly and always filter by user.
- **Validation**: every request body/query is parsed with a zod schema from `@autoreach/shared`.
- **Errors**: a typed `AppError(code, status, message)`; the error handler never exposes stack
  traces or database messages in production and always returns a request id.
- **Logging**: `pino` with redaction of `authorization`, cookies, tokens, email bodies.
- **Security middleware**: `helmet`, CORS allowlist (dashboard origin + configured extension
  origins), body-size limits, `express-rate-limit` keyed by user id (API) or IP (pixel/OAuth).
- **Health**: `GET /healthz` (process up) and `GET /readyz` (database reachable, migrations
  applied, which integrations are configured).

### 3.2 Background workers (in-process, single instance safe, multi-instance tolerant)

| Worker | Interval | What it does | Concurrency guard |
|---|---|---|---|
| Send queue | 15 s | Sends messages the user explicitly queued/scheduled, respecting pause, daily limit, and randomised 30–90 s spacing per user | `FOR UPDATE SKIP LOCKED` + atomic `queued→sending` transition |
| Reply sync | 3 min | Incremental Gmail `history.list` per connected account; resync on 404 | Postgres advisory lock |
| Follow-ups | 5 min | Marks reminders due; only if a user explicitly enabled auto-send, sends approved follow-ups within caps | Advisory lock + per-row atomic transition |
| Retention | 6 h | Deletes tracking events past the user's retention window, expired OAuth states | Advisory lock |

These run inside the API process (as the legacy workers did) because the expected load is a
single user or a handful of users. They can be disabled with `WORKERS_ENABLED=false` and run as a
separate process (`npm run worker -w backend`) without code changes.

### 3.3 Dashboard

React 19, React Router 7, TanStack Query (refetch on focus, background polling for activity),
Recharts, Tailwind CSS 3 with CSS-variable design tokens (dark default, light optional),
lucide icons. Auth through `supabase-js` (Google OAuth, PKCE). In local development an explicit
`dev login` mode (disabled in production builds and refused by the API when
`NODE_ENV=production`) allows running the full stack without a Supabase project.

### 3.4 Extension (Manifest V3)

| Surface | Purpose |
|---|---|
| Popup | Auth status, quick-add recruiter, quick-add opportunity, recent outreach, follow-ups due, pause/resume sending, open dashboard, settings |
| Side panel | Full composer (AI draft → edit → preview attachment → send), page capture review |
| Gmail content script (`mail.google.com` only) | For recipients in a compose window or the sender of an open thread: "contacted before?" chip, outreach history, reply/open status, duplicate warning, "Draft with AutoReach" (opens side panel), "Insert draft" into the native composer. It never blocks or rewrites Gmail's own actions |
| Page capture (on click only) | `activeTab` + `scripting` inject a one-shot reader that returns page title, URL, the user's text selection and any schema.org `JobPosting` JSON-LD. The user reviews every field before saving |
| Background service worker | Auth token refresh, API calls on behalf of content scripts (so CORS is between the API and the extension origin only), badge count of due follow-ups (`alarms`) |

Permissions: `storage`, `identity`, `activeTab`, `scripting`, `sidePanel`, `alarms`;
host access only to the configured API and Supabase origins (generated into the manifest at
build time) and a content script on `https://mail.google.com/*`. Removed: `tabs`,
LinkedIn/Google API host permissions, the automatic LinkedIn content script, and the
`<all_urls>` `web_accessible_resources` exposure. The extension is built with plain Vite
builds (`extension/scripts/build.mjs`) instead of an extension bundler plugin.

## 4. Key flows

### 4.1 Gmail connection

1. Client calls `POST /api/integrations/gmail/authorize` (authenticated). The API stores a
   single-use `oauth_states` row (random state, PKCE verifier, user id, 10-minute expiry) and
   returns Google's consent URL with scopes
   `openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata`,
   `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, S256 PKCE.
2. Google redirects to `GET /api/integrations/gmail/callback`. The API looks the state up
   (without consuming it) and 303-redirects the code to where the flow started: the
   dashboard's `/gmail/callback` page, or the extension's validated
   `https://<id>.chromiumapp.org/gmail` redirect stored with the state. The parameters are
   named `gmail_code`/`gmail_error` because supabase-js treats `code`/`error` on dashboard
   pages as its own sign-in callback.
3. The signed-in client posts the code and state to `POST /api/integrations/gmail/complete`.
   The API consumes the state atomically **for that user only** (`DELETE … WHERE state = $1
   AND user_id = $2 AND expires_at > now()`), exchanges the code (client secret and PKCE
   verifier stay server-side), reads the account email from the OpenID userinfo endpoint,
   records the **granted** scopes and encrypts tokens with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`).
   Binding completion to the session stops a forwarded consent link from attaching
   someone else's mailbox to the account that started it.
4. Access tokens are refreshed when within 5 minutes of expiry. `invalid_grant` marks the
   connection `needs_reauth`; the UI shows a reconnect banner and sending fails with
   `GMAIL_REAUTH_REQUIRED` instead of a generic error.
5. Disconnect revokes the grant at `https://oauth2.googleapis.com/revoke` and deletes the
   stored tokens.

Why `gmail.metadata`: reply detection needs `users.history.list`, `users.threads.get` and
`users.messages.get`; all accept `gmail.metadata`, which exposes **headers and labels only —
never message bodies** (Google rejects `format=full` with this scope). It is the narrowest scope
that supports reply detection. If the user declines it on Google's granular consent screen,
sending still works and reply detection is shown as unavailable.

### 4.2 Composing and sending

```
select opportunity/role → select recruiter → select résumé → Generate (AI or template)
   → edit subject/body → quality check → preview attachment → Send (explicit)
```

- Drafts are rows in `email_messages` with `send_status='draft'`.
- `POST /api/messages/:id/send` requires an `Idempotency-Key`. Server-side checks, in order:
  ownership; status ∈ {draft, failed}; recruiter not `do_not_contact`/bounced; e-mail address not
  an unconfirmed guess; no other initial outreach to this recruiter already sent/queued/unknown
  (unless the user explicitly confirms a different opportunity); sending not paused; daily limit;
  Gmail connected; résumé present when the user requires attachments, re-downloaded from private
  storage and verified against its stored SHA-256, ≤ 10 MB and a real PDF.
- The state transition `draft|failed → sending` is a single conditional `UPDATE … RETURNING`;
  a concurrent double-click loses the race and receives `409 ALREADY_SENDING`.
- Gmail outcome mapping (never blindly retried):
  - 2xx → `sent` (+ Gmail message id, thread id, RFC `Message-ID` header fetched via metadata)
  - 400/401/403/404 → `failed` with a specific code (`GMAIL_REAUTH_REQUIRED`, `GMAIL_SCOPE_MISSING`, …)
  - 429 / `rateLimitExceeded` → `failed` + `retryable=true` (Gmail rejected it, so a retry cannot duplicate)
  - 5xx, timeouts or connection resets after the request was written → `unknown`; the UI asks the
    user to check Gmail's Sent folder and mark it sent or failed. Automatic retry here could send
    the same email twice.
- MIME is built with RFC 2047 encoded headers, `multipart/mixed` → `multipart/alternative`
  (plain + HTML), base64 wrapped at 76 columns, RFC 2231 attachment filename, and the tracking pixel
  only in the HTML part and only when tracking is enabled for that message.

### 4.3 AI drafting

- `AiProvider` interface with implementations for **Anthropic**, **OpenAI-compatible** endpoints
  (OpenAI, Groq, OpenRouter, a local Ollama server) and **Google Gemini**, selected by
  `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`. Keys exist only on the server.
- Context is built from **verified facts only**: profile, selected résumé's extracted text,
  opportunity description, recruiter name/title, company notes the user typed, previous messages.
  Each fact gets an id (`skill:3`, `project:2`, `jd`, …). The model must return JSON
  `{subject, body, facts_used[]}`.
- A deterministic **quality check** runs on every draft (AI or human): wrong or missing company /
  recruiter name, numbers not present in any fact, technology names not in the profile, referral
  or "we met" claims, leftover placeholders, generic phrases, length, missing résumé, recipient
  already contacted. Findings are shown next to the editor; none of them silently rewrite the text.
- Without an AI provider the composer still works: it fills the user's template and selects the
  most relevant projects/skills by overlap with the job description.

### 4.4 Tracking

- Per-message random 128-bit `tracking_token`; pixel at `GET /t/<token>.gif`. Legacy pixels
  `GET /track/<legacy-history-id>` keep working for emails sent before the migration.
- The pixel is returned immediately; the event is recorded asynchronously with a coarse
  user-agent family only (no IP address, no location, no device).
- Classification: `suspected_self` (within 60 s of sending, or while the sender's own Gmail tab is
  viewing that recipient's thread, reported by the extension), `proxy` (Gmail image proxy — the
  open is real-ish but timing/location are the proxy's), `open_detected`. Repeat hits within
  10 minutes are de-duplicated.
- UI wording: "Open detected", "No open detected", "Tracking off". Never "read". Follow-ups are
  never triggered by opens.
- Disabled by default; enabling it in Settings shows the disclosure; it can be turned off per
  message. Events are deleted after the retention window (default 180 days).

### 4.5 Reply detection

- Cursor = Gmail `historyId` per connection. Each sync lists `messageAdded` history, keeps only
  message ids whose `threadId` belongs to a thread AutoReach sent into, and fetches **only those**
  messages' headers (`From`, `To`, `Subject`, `Date`, `Auto-Submitted`, `X-Autoreply`,
  `Precedence`, `Content-Type`, `Message-ID`, `In-Reply-To`).
- Classification: own message (label `SENT`), bounce (`mailer-daemon`/`postmaster` or
  `multipart/report; report-type=delivery-status`), auto-reply (`Auto-Submitted` ≠ `no`,
  `X-Autoreply`, `Precedence: auto_reply`, "Automatic reply/Out of office" subjects), reply
  (sender = recruiter address), possible reply (same company domain → shown for review),
  other sender (forwarded/unrelated → review queue, never auto-counted).
- On a confirmed reply: message `reply_status=replied`, recruiter `last_reply_at`, status
  `replied`, every pending follow-up for that recruiter is cancelled, activity logged.
- `404` on `history.list` (expired cursor) → bounded resync: `threads.get` (metadata) for
  tracked threads from the last 60 days, then reset the cursor from `users.getProfile`.
- Optional (off by default): also check the `From` header of new messages in *untracked* threads
  so a recruiter who starts a fresh thread is still detected.

### 4.6 Follow-ups

- When an initial message is sent, a `follow_ups` row (step 1) is created, due after the user's
  configured business-day delay (default 5) at 10:00 in the user's timezone. Sending follow-up 1
  creates step 2 (up to `max_followups`, default 2).
- `UNIQUE (original_message_id, step)` prevents duplicate follow-ups; a partial unique index
  prevents two live follow-up messages for one reminder.
- The Follow-ups page shows overdue/upcoming, the previous message, and drafts a contextual
  follow-up *in the same Gmail thread* (`threadId` + `In-Reply-To`/`References` with the real
  `Message-ID` + `Re:` subject).
- Auto-send is off by default. If enabled it requires a daily cap (≤ 10), respects pause and the
  daily limit, and re-checks at send time that the recruiter has not replied, bounced, opted out,
  or been marked do-not-contact.

## 5. Shared package (`@autoreach/shared`)

Enums (statuses, sources, tones), zod request schemas, `deriveDisplayStatus()`,
`classifyRoleCategory()`, `normalizeEmail()` and duplicate-candidate rules, `compileTemplate()`,
`runQualityChecks()`, business-day arithmetic. Used by the backend for validation and by both
clients for forms and labels, so the rules cannot drift.

## 6. Data model

All tables have `user_id uuid not null references auth.users(id) on delete cascade`, RLS
enabled, `created_at`/`updated_at` `timestamptz` (UTC). Times are displayed in the user's
timezone (`user_settings.timezone`, detected at onboarding).

| Entity | Table | Notes |
|---|---|---|
| UserProfile | `profiles` | Created from legacy `auth.users.raw_user_meta_data` |
| UserSettings | `user_settings` | Tracking, sending limits, pause, follow-up policy, timezone, retention |
| Resume | `resumes` | Private storage path, SHA-256, size, extracted text, label, role tags, one default per user |
| Company | `companies` | Normalised name per user; created implicitly |
| Recruiter | `recruiters` (legacy table, extended) | `email_normalized` unique per user among non-merged rows; `merged_into_id`; `email_verification`; `do_not_contact`; tags |
| JobOpportunity | `opportunities` | Status pipeline; required skills; role category |
| RecruiterOpportunity | `recruiter_opportunities` | Many-to-many |
| EmailMessage | `email_messages` (legacy `email_history`, renamed in place) | Send state, Gmail ids, tracking aggregates, reply status, AI metadata, attachment snapshot |
| EmailEvent | `email_events` | Tracking events with classification |
| EmailThread | `email_threads` + `thread_messages` | Gmail threads AutoReach participates in, and inbound/outbound headers seen during sync |
| FollowUp | `follow_ups` | Reminder sequence per original message |
| OutreachCampaign | `campaigns` | Optional grouping for analytics |
| ActivityLog | `activity_log` | Typed events for the activity feed |
| OAuthConnection | `oauth_connections` | Encrypted tokens, granted scopes, sync cursor, health |
| — | `oauth_states` | Single-use OAuth state + PKCE verifier |
| — | `email_templates` (legacy, kept) | Initial / follow-up templates |

### Legacy migration (in place, nothing dropped)

| Legacy | 2.0 |
|---|---|
| `recruiters.hr_name` | renamed `full_name` |
| `recruiters.role` | renamed `target_role` (it held the role the user applied for) |
| `recruiters.status` | renamed `legacy_status`; new `outreach_status`: `Sent`→`contacted`, everything else→`new` (so nothing is auto-sent after migration) |
| `recruiters.last_sent_at` | kept; copied into `last_contacted_at` |
| case-variant duplicate e-mails | oldest row kept; others get `merged_into_id` and their history is re-pointed (no rows deleted) |
| `email_history` | renamed `email_messages`; `status` → `legacy_status`; `delivered`→`sent`, `failed`/`abandoned`→`failed`, `sending`→`unknown`; `opened_at`→`first_open_at`, plus one legacy `email_events` row; `tracking_token` = old id so old pixels resolve |
| `user_smtp_settings` | tokens imported, encrypted, into `oauth_connections` by the backend on first boot with `TOKEN_ENCRYPTION_KEY`; plaintext columns then nulled. Table kept until a later cleanup |
| `auth.users.user_metadata` | copied to `profiles` (`name`, `degree`, `location`, `contact`→`phone` or `primary_email`, `year`→`legacy_year`) |
| public résumé URL | `resumes` row pointing at the same object path, only when the key is the user's own v1 upload (`<user id>-<timestamp>.<ext>`; metadata is user-editable) and only on the first run; bucket switched to private. At runtime a résumé row is read or deleted only if its key belongs to its owner |

## 7. Configuration

All configuration is environment-based and validated at boot (`backend/src/config.ts`).
Missing optional integrations disable the feature with an explicit status in `/readyz` and in the
UI (e.g. "AI drafting is not configured on the server"). See `.env.example` and
`docs/SETUP.md`.

## 8. Testing strategy

- **Unit** (shared, backend services, extension parsers): template compiler, quality checks,
  normalisation, role classification, MIME builder, reply classifier, tracking classifier,
  business days, crypto, AI response parsing.
- **Integration** (backend, real PostgreSQL 16 started by the test harness via `initdb`): migrations
  from a seeded *legacy* schema, RLS isolation between two users, CRM dedupe/merge, opportunity
  links, send state machine with a fake Gmail transport (success, 401 re-auth, 429, 5xx → unknown,
  double submit, simultaneous sends against the daily limit, an attempt taken over while
  preparing, past schedule times, missing résumé, checksum mismatch), queue fairness between
  users, reply sync (reply, bounce, delay notice, auto-reply, ambiguous sender, deleted
  messages, truncated history, expired cursor), the two-step Gmail connection (completion bound
  to the user who started it, extension redirect, declined consent), follow-up
  creation/cancellation, tracking token mapping and dedupe, analytics from stored rows.
- **Dashboard**: component and flow tests (status/caveat rendering, settings, the Gmail callback
  page, stacked dialogs); a Playwright run against the real API in dev-login mode produces the
  screenshots in `docs/screenshots/`.
- **Extension**: the service-worker API proxy (refresh once on 401, sender checks), page
  capture parsing, Gmail DOM reading, the Gmail card's backoff and shutdown after an update,
  the Gmail connect flow, and the generated manifest's permissions.
- External services (Gmail, Google OAuth, AI providers, Supabase Storage) are exercised through
  their HTTP clients with injected transports in tests. Real-credential calls are **not** part of
  the automated suite and are listed as manual verification steps in `docs/DEPLOYMENT.md` (§8).
