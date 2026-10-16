# AutoReach — Repository Audit (pre-2.0 baseline)

Audit date: 2026-10-16
Audited revision: `c5c5ab8` ("fix: add type module to backend package.json for Node v18 compatibility"), branch `main`, 83 commits.

Everything below was verified by reading the source and by running the builds in a clean
sandbox. Where something could **not** be verified (the live database, the live deployments),
that is stated explicitly rather than assumed.

---

## 1. What was inspected

| Area | Files |
|---|---|
| Root | `package.json`, `package-lock.json`, `README.md`, `.gitignore`, 9 committed extension ZIPs |
| Backend | `backend/server.js`, `middleware/{auth,rateLimiter}.js`, `routes/{email,hr,linkedin,resume,settings,track,user}.js`, `services/{emailService,gmailService}.js`, `workers/{queueWorker,followupWorker}.js`, `package.json` |
| Extension | `vite.config.js` (inline MV3 manifest), `public/manifest.json`, `src/background.js`, `src/linkedin-scraper.js`, `src/contexts/AuthContext.jsx`, `src/utils/{api,supabase}.js`, `src/pages/*.jsx` (7 pages), 12 committed ZIPs |
| Website | `website/src/{App,Privacy,main}.jsx`, `vercel.json`, committed `website/dist`, 3 ZIPs in `public/` and `dist/` |
| History | Full `git log -p` scanned for credential patterns; earlier AI-generation commit `5b9a751` (Groq) inspected |

## 2. Technology stack (as found)

| Layer | Technology |
|---|---|
| Extension | React 19, React Router 7 (MemoryRouter), Vite 8, `@crxjs/vite-plugin` 2 beta, Tailwind CSS 3, Axios, `@supabase/supabase-js` 2, Manifest V3 side panel |
| Backend | Node.js (ESM JavaScript, no TypeScript), Express **5**, `express-rate-limit` 8, `multer` 2, `csv-parse` 6, `@supabase/supabase-js` 2 |
| Database / Auth / Storage | Supabase (Postgres, Supabase Auth with Google provider, Supabase Storage bucket `resumes`) |
| Email delivery | Gmail REST API (`users.messages.send`) with OAuth tokens. The README still says "Resend API"; `resend` and `nodemailer` are installed but **never imported** |
| Optional enrichment | Hunter.io email finder (`HUNTER_API_KEY`), pattern-based email guessing |
| Website | React 18, Vite 4, framer-motion, deployed on Vercel (`auto-reach-ext.vercel.app`) |
| Backend hosting | Railway (`autoreach-production-3c97.up.railway.app`), earlier Render (`autoreach-pjez.onrender.com`) per old build URLs |

There is no TypeScript, no test suite, no linting for the backend, no database schema/migration
files, no CI, and no `.env.example`.

## 3. Database (reconstructed — no schema exists in the repository)

The README says to "execute the SQL schema found in the implementation plan", but no SQL file,
migration, or implementation plan is committed. The schema below is reconstructed from the queries
the code issues. **The live database could not be inspected from this environment**, so column
types, defaults, constraints and RLS policies are inferred, not confirmed.

| Table | Columns used by code | Constraints implied by code |
|---|---|---|
| `recruiters` | `id`, `user_id`, `hr_name`, `company`, `email`, `role`, `source`, `status` (`Pending`/`Sent`/`Skipped`/`Failed`), `last_sent_at`, `followup_count`, `created_at` | unique `(user_id, email)` (used by `onConflict` and the `23505` handler); `status` must default to `Pending` because nothing in the code sets it on insert, yet the queue only picks `Pending` rows |
| `email_templates` | `user_id`, `type` (`initial`/`followup_1`/`followup_2`), `subject`, `body`, `updated_at` | unique `(user_id, type)` |
| `email_history` | `id` (UUID — the tracking route checks `length === 36`), `recruiter_id`, `user_id`, `subject`, `status` (`sending`/`delivered`/`failed`/`abandoned`), `sent_at`, `opened_at`, `gmail_message_id`, `gmail_thread_id`, `error_message`, `retry_count` | — |
| `user_smtp_settings` | `user_id`, `gmail_user`, `gmail_access_token`, `gmail_refresh_token`, `token_expires_at`, `updated_at` | unique `(user_id)` |
| `auth.users.user_metadata` | `name`, `degree`, `year`, `location`, `contact`, `resume_url` | profile lives in auth metadata, not a table |
| Storage bucket `resumes` | object key `${userId}-${Date.now()}.${ext}` | README instructs creating it as a **public** bucket |

Because the user's real records live in these tables, AutoReach 2.0 migrates them **in place**
(rename/extend, never drop) — see `docs/ARCHITECTURE.md` §6.

## 4. Feature-by-feature verification

Legend: ✅ works as designed · ⚠️ partially works / works with defects · ❌ broken or not implemented · 🗑️ obsolete

| Claimed feature | Verdict | Evidence |
|---|---|---|
| Recruiter storage (list/add/delete) | ✅ | `routes/hr.js`; scoped by `user_id`; duplicate email → 409 |
| CSV import | ⚠️ | Works, but the response promises "Imported N" using the *valid* count, not the inserted count; generic-role addresses (`hr@`, `info@` …) are silently dropped; no preview; no length limits |
| Templates with variables | ✅ | `compileTemplate` replaces `{name} {company} {role} {year} {degree} {location} {user_name} {contact}` |
| Template preview | ✅ | `/email/preview` with sample recruiter data |
| "Start Sending" button | ❌ | `POST /email/send` does nothing except return `"Email queue started"`. The queue worker runs permanently regardless |
| Automated queue sending | ⚠️ | `queueWorker.js` polls **every 10 s across all users** and sends to the oldest `Pending` recruiter. Consequences: (1) a recruiter is emailed automatically as soon as it is added — the LinkedIn page even labels the button "Add to Queue & Send"; (2) the advertised 30–90 s random delay is ineffective because `isProcessing` is reset *before* the sleep while `setInterval` keeps firing every 10 s; (3) **head-of-line blocking** — if the oldest pending recruiter's owner hit the daily limit or has no template, the worker returns without changing that row, so every other user's queue stalls; (4) **infinite retry loop** — on a send failure the recruiter stays `Pending` and a *new* `email_history` row is inserted each cycle with `retry_count` 0→1, so the `abandoned` branch (`retry_count >= 3`) is unreachable; failures repeat every ~10 s until the daily limit counts them |
| Daily warm-up limits | ⚠️ | 5/10/25 per day by *account age*, counted from server-local midnight (not the user's timezone); failed attempts count toward the limit; two personal Gmail addresses are hard-coded to bypass limits (`BYPASS_WARMUP_EMAILS`) |
| Gmail sending | ⚠️ | `gmailService.sendViaGmail` builds MIME by hand. Defects: `Subject`/`From` not RFC 2047-encoded (non-ASCII breaks); body base64 not line-wrapped; every attachment is labelled `application/pdf` and named `Resume.pdf` even when a DOCX was uploaded (the upload form accepts `.doc/.docx`); recipient data is inserted into HTML unescaped |
| Gmail message/thread IDs | ✅ | Stored on success (`gmail_message_id`, `gmail_thread_id`) |
| Gmail OAuth + token refresh | ⚠️ | Code flow via `chrome.identity.launchWebAuthFlow`, exchanged server-side (good: client secret stays server-side). Scope is `gmail.send` only. Refresh works when a refresh token exists. Defects: access **and refresh tokens stored in plaintext** (the Privacy Policy states they are encrypted); "Disconnect" deletes the DB row but never revokes the grant at Google (Privacy Policy says it "immediately revokes"); no handling of `invalid_grant` (expired/revoked) beyond a thrown error; OAuth client IDs hard-coded in `background.js` and the manifest |
| Follow-ups | ❌/⚠️ | `followupWorker.js` uses the **anon** Supabase client with no user JWT. With RLS enabled (Supabase default for dashboard-created tables) every query returns zero rows and follow-ups never send; with RLS disabled the anon key (which ships inside the public extension ZIP) could read every user's data. Which case applies could not be verified without DB access — both are defects. Logic issues regardless: it follows up only when the email was **not opened** (inverts the usual meaning), never checks for replies, sends without user approval, and threads with `In-Reply-To: <gmail API id>` — the Gmail API id is **not** the RFC 5322 `Message-ID`, so recipient-side threading is wrong |
| Email-open tracking | ❌/⚠️ | Pixel `GET /track/:history_id` uses the anon client to update `email_history` — same RLS dichotomy as above (never records with RLS on; forgeable by anyone with the anon key if RLS is off). The tracking id is the row's primary key, so it doubles as a guessable-by-enumeration capability for anyone who sees one URL. Only `opened_at` (first open) is stored; no dedupe, no self-open handling, no scanner/proxy awareness, no opt-out, no disclosure, always on |
| Resume upload / attachment | ⚠️ | Upload works; stored in a **public** bucket and the **public URL** is saved in user metadata and fetched over HTTP at send time. Anyone with the URL can download the résumé. Old uploads are never deleted. If the fetch fails the email is sent **without** the résumé, silently |
| Profile setup | ✅ | `name/degree/year/location/contact` in auth `user_metadata` |
| LinkedIn "scraper" | 🗑️ | Two implementations: a content script that runs automatically on **every** `linkedin.com/in/*` page visit and stores the profile, and an on-demand DOM scraper injected via `chrome.scripting`. Combined with pattern guessing (`first.last@company.com`) and Hunter.io, it fabricates addresses that the UI then labels "✅ Auto-guessed". This conflicts with LinkedIn's terms on automated extraction and with the 2.0 requirement never to present inferred addresses as verified |
| AI email generation | 🗑️ | Existed in commit `5b9a751` (Groq Llama 3.1 via `GROQ_API_KEY`) and was later removed. Not present at HEAD |
| Dashboard | ❌ | Extension "Overview" shows only "Sent today"; "Automated Queue — Active" and "/ Limit" are hard-coded; "Recent activity" is a static placeholder. No web dashboard exists |
| Reply detection | ❌ | Not implemented (the website claims follow-ups "stop automatically when someone replies") |
| Pause sending | ❌ | Not implemented (Privacy Policy claims users "can pause or stop email sending at any time") |
| Data export / account deletion | ❌ | Not implemented (Privacy Policy says deletion is by e-mail request) |

## 5. Security and privacy findings

| # | Severity | Finding |
|---|---|---|
| S1 | High | Gmail access and refresh tokens stored in plaintext (`user_smtp_settings`) |
| S2 | High | Résumés in a public storage bucket, referenced by public URL |
| S3 | High (conditional) | Workers and the tracking route use the anon key. Either RLS blocks them (features silently broken) or RLS is off and the shipped anon key exposes all users' rows |
| S4 | Medium | Tracking endpoint is unauthenticated and keyed by the primary key; open events can be forged by anyone holding the URL; no rate limit |
| S5 | Medium | `cors()` with no origin allowlist on an API that accepts bearer tokens |
| S6 | Medium | Auth middleware returns raw Supabase error objects (`details: error`); all routes return `error.message` from database errors |
| S7 | Medium | No input validation or length limits on any route; CSV upload has no size limit (`multer` memory storage without `limits`) |
| S8 | Medium | Extension manifest exposes `index.html` and all assets as `web_accessible_resources` to `<all_urls>`; requests `tabs` and host access to `linkedin.com`, `googleapis.com`, `accounts.google.com` that are not needed |
| S9 | Low | Supabase anon key prefix and URL logged to the console; Supabase anon key is embedded in the extension (expected — the anon key is designed to be public — but only safe when RLS is correct) |
| S10 | Low | Hard-coded personal addresses in `BYPASS_WARMUP_EMAILS` |
| S11 | Info | Git history scanned for common credential formats (Supabase JWTs, Google client secrets `GOCSPX-`, Groq `gsk_`, Resend `re_`, OpenAI-style `sk-`): **no secrets found in committed source**. The shipped ZIPs contain only the Supabase URL and an **anon**-role key |
| S12 | Info | Privacy Policy statements contradicted by code: token encryption, revocation on disconnect, ability to pause, "follow-ups stop on reply" |

## 6. Dependencies

`npm audit --omit=dev` in `backend/` (run 2026-10-16) reports advisories in `body-parser`,
`csv-parse` (<7.0.2, prototype replacement via `columns`), `ip-address` (via
`express-rate-limit`), and `multer` (≤2.2.0). `resend` and `nodemailer` are unused. The root
`package.json` duplicates backend dependencies with older majors (Express 4, multer 1, csv-parse 5)
and is not used by any code. Extension and website depend on their own lockfiles.

## 7. Baseline: builds, tests, lint (executed 2026-10-16 in a clean clone)

| Command | Result |
|---|---|
| `backend: npm ci` | ✅ installs |
| `backend: npm test` | ❌ `Error: no test specified` (no tests exist) |
| `backend: node --check` on every `.js` file | ✅ all parse |
| `backend: node server.js` without env | ❌ crashes at import: `supabaseUrl is required` (no config validation / no helpful message) |
| `extension: npm ci && npm run build` | ✅ builds (`dist/` 482 kB main chunk) |
| `extension: npm run lint` | ❌ **59 errors** (`chrome` undefined ×~45, unused vars, `process` undefined) |
| `website: npm ci && npm run build` | ✅ builds |
| Live deployments (Railway, Render, Vercel) | Not reachable from the audit sandbox's network allowlist — **not verified** |

## 8. Repository hygiene

- 21 binary ZIP builds committed (root, `extension/`, `website/public`, `website/dist`), each a
  stale snapshot pointing at a hard-coded API URL.
- `website/dist` is committed build output.
- `extension/public/manifest.json` (v1.1.0) is dead: the build uses the inline manifest in
  `vite.config.js` (v3.0.0).
- `extension/README.md` is the Vite template README.
- Root `package.json` is an orphan.

## 9. What is worth preserving

1. **User data**: `recruiters`, `email_templates`, `email_history` (including Gmail message and
   thread IDs and first-open timestamps), profile fields in auth metadata, résumé files.
2. **Supabase Auth with Google** sign-in in the extension (`launchWebAuthFlow` + implicit flow).
3. **Server-side OAuth code exchange** for Gmail (client secret never in the extension).
4. **Gmail API sending** with real attachments and stored message/thread IDs.
5. **Templates** (initial / follow-up 1 / follow-up 2) — kept as user-editable writing guides and
   as a non-AI fallback.
6. **Warm-up / daily-limit concept and randomised spacing** for queued sends — kept, fixed and made
   configurable.
7. **CSV import** with validation and duplicate prevention — kept and extended (preview, export).
8. **Legacy tracking URLs** (`/track/<history-id>`) already embedded in sent emails — must keep
   resolving after migration.

## 10. What 2.0 must change (summary)

Fixes for every ❌/⚠️ above, plus the new requirements: web dashboard, CRM with opportunities,
AI drafting with fact-grounding, explicit-approval sending, honest tracking states, reply detection,
reminder-first follow-ups, minimal-permission extension, encryption of tokens, private résumés,
per-user database isolation, migrations, tests, and documentation. Details: `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`.
