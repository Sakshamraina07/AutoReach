# AutoReach 2.0: what changed

This compares 2.0 with the v1 code audited in [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md).
"Verified" below means covered by the automated tests in [TEST_RESULTS.md](TEST_RESULTS.md)
or exercised end to end against the local API; nothing here has been run against your live
Supabase, Railway or Gmail accounts.

## Retained

| v1 feature | In 2.0 |
|---|---|
| Google sign-in through Supabase | Same Supabase project and provider, for the dashboard and the extension (PKCE instead of the implicit flow) |
| Recruiter list, add, delete, CSV import | Kept, with the v1 rows migrated in place (no data dropped) |
| Email templates with `{name} {company} {role} {year} {degree} {location} {user_name} {contact}` | The same three template types and variables still work; new variables added |
| Profile fields (`name`, `degree`, `year`, `location`, `contact`) | Copied from Supabase user metadata into the new `profiles` table |
| Sending from the user's own Gmail with the résumé attached | Kept, rebuilt (see Improved) |
| Gmail message and thread IDs stored per email | Kept, plus the RFC 5322 Message-ID for correct threading |
| Open-tracking pixel URLs in already-sent v1 emails (`/track/<id>`) | Still answered and attributed to the right email |
| Hunter.io lookups (`HUNTER_API_KEY`) | Kept as an optional suggestion source, always labelled unverified |
| Railway + Supabase + Vercel hosting | Same providers |

## Improved

| Area | v1 | 2.0 |
|---|---|---|
| Sending | A worker emailed every new recruiter automatically every 10 s across all users; failures retried forever; delays didn't apply | Nothing is sent without an explicit Send or an explicit "approve for the queue". Idempotency keys stop double sends; one email per recruiter can be in flight; failures are final and visible; ambiguous outcomes are marked "unknown" and never retried automatically; per-user queue with pause, daily limit (default 25) and random 30–90 s spacing |
| Résumé attachment | Public bucket and public URL fetched at send time; email sent without the résumé if the fetch failed; every file named `Resume.pdf` | Private storage, PDF only (checked by content), up to 10 MB, SHA-256 verified before every send; the send stops if the file is missing, empty, changed or corrupt; several labelled résumés; optional custom attachment name |
| Gmail OAuth | Tokens in plain text; disconnect didn't revoke; expired grants crashed sends | Tokens encrypted (AES-256-GCM), single-use state + PKCE, revoke on disconnect, `invalid_grant` → "Reconnect Gmail" banner, v1 tokens encrypted on first start |
| MIME | Non-ASCII subjects and names broke; no line wrapping; HTML unescaped | RFC 2047/2231 encoding, wrapped base64, escaped HTML alternative, correct `In-Reply-To`/`References` |
| Follow-ups | Sent automatically only when an email was *not opened*; used the anon key (broken with RLS, a data exposure without it); wrong threading | Reminders after a configurable number of business days, drafted in the same thread from your template or AI, reviewed before sending; cancelled by replies, bounces, do-not-contact or a closed status; optional auto-send only from your own template, capped per day, off by default |
| Open tracking | Always on, forgeable, keyed by the row id, first open only | Off by default and disclosed; random 128-bit tokens; each signal classified (open detected / image proxy / probably you / probably a scanner) and de-duplicated; per-email opt-out; retention and delete-all; shown as approximate everywhere |
| Data access | Anon key in workers; no CORS allowlist; raw database errors returned | Per-request row-level security with a dedicated database role plus explicit user filters; CORS allowlist; validated inputs; rate limits; errors with request IDs and no internals |
| Duplicate contacts | Case-sensitive unique email | Normalised email uniqueness (case-variant v1 duplicates merged without losing history), merge suggestions for likely duplicates, merge that keeps every email |
| Daily limits | 5/10/25 by account age in server time, two hard-coded bypass addresses | One user-set limit (default 25) counted in the user's time zone; no bypass list |
| Extension | React side panel calling v1 routes, broad permissions, automatic LinkedIn scraping | Rebuilt in TypeScript (see Added); minimal permissions |
| Privacy policy and website | Claimed encryption, revocation, pause and reply-stopping that didn't exist | Rewritten to match what 2.0 does |

## Added

* **Web dashboard** (React 19): Overview with KPIs and previous-period trends, recent outreach,
  follow-ups due, activity, "where to focus next"; Recruiters CRM (search; filter by status,
  source, tag, role, date added; sort; CSV import preview and export; duplicate merge; detail
  drawer with history); Opportunities (status pipeline, linked recruiters, profile match);
  Outreach (history, message detail with reply and open details); composer; Follow-ups;
  Analytics; Settings; dark and light themes; responsive down to phone width.
* **Onboarding wizard** with résumé upload, field-by-field confirmed suggestions from the
  résumé (AI or pattern-based), profile completeness indicator.
* **Job opportunity tracker** with required skills, experience, deadline, status pipeline and a
  many-to-many link to recruiters.
* **AI drafting** (optional; Anthropic, OpenAI, Gemini, Groq or any OpenAI-compatible server):
  drafts grounded in numbered profile facts, refine actions (concise, personalised, projects,
  tone, regenerate), and a quality check that flags wrong names or companies, invented numbers or
  skills, claimed referrals, placeholders, generic or long text, attachment mismatches and
  repeat outreach. Template drafting without AI.
* **Reply detection** with Gmail header access only (`gmail.metadata`): incremental history sync,
  resync on expired cursors, replies vs bounces vs automatic replies vs colleagues ("Needs
  review"), manual correction. Optional send-only mode without this permission.
* **Analytics**: response rate by role category, company and campaign with small-sample labels;
  "what correlates with replies" insights marked directional; recommendations.
* **Chrome extension 2.0**: popup, side-panel composer, Gmail assist, "Add opportunity" from the
  current page with review, follow-ups badge.
* **Pause all sending**, **data export** (JSON and CSV) and **self-service account deletion**.
* **Optional address suggestions** in the add-recruiter form, always unverified, requiring
  confirmation before any send.
* TypeScript across the API, dashboard, extension and a shared package; database migrations;
  131 automated tests; deployment config for Railway and Vercel.

## Removed

| v1 behaviour | Why |
|---|---|
| Automatic sending of every newly added recruiter | Emails now require approval |
| LinkedIn content script that ran on every profile visit, and on-demand LinkedIn DOM scraping | Conflicts with LinkedIn's terms and with "never present inferred addresses as verified"; replaced by user-initiated "Add opportunity" that reads only the page title, your selection and published job data |
| Email guessing shown as "✅ Auto-guessed" | Suggestions are now labelled unverified and need confirmation |
| v1 API routes (`/email/*`, `/hr/*`, `/linkedin/*`, …) and the v1 extension ZIPs on the website | Replaced by the 2.0 API; the old ZIPs would call routes that no longer exist |
| Committed build ZIPs in the repository | Release artifacts are built with `npm run package -w @autoreach/extension` (they remain in git history) |

## Deferred

* **Gmail push notifications** (Pub/Sub). Polling `history.list` every 3 minutes is enough for a
  personal job search and needs no extra Google Cloud resources.
* **Automatic warm-up ramp** of the daily limit. The limit is a single user setting.
* **Team or multi-account use.** The data model is per user; there are no shared workspaces.
* **Chrome Web Store listing and Google OAuth verification.** These need your accounts
  (see [GMAIL_OAUTH.md](GMAIL_OAUTH.md#5-publishing-status-verification-and-the-7-day-limit)).
* **Attachments other than PDF.** v1 accepted Word files but always labelled them PDF; 2.0
  accepts PDF only.
* **Holiday calendars** for business-day follow-up timing (weekends are skipped; holidays aren't).

## Known limitations

* **Nothing was deployed or run against your live services.** The network sandbox used for this
  work could not reach Railway, Vercel or Supabase, so the migration of your real v1 data, real
  Google sign-in, real Gmail sending and reply detection, and the real AI providers were not
  exercised. Their code paths are covered by tests against a real PostgreSQL 16 database with
  fake Google/AI transports. Follow the backup and verification steps in [DEPLOYMENT.md](DEPLOYMENT.md).
* The v1 database schema was reconstructed from the v1 code (no schema existed in the
  repository). The legacy migration handles the columns the code used and adds any that are
  missing, but a column that only exists in your database is left untouched.
* Google issues 7-day refresh tokens while the OAuth app is in Testing, so you will reconnect
  Gmail weekly until the app is verified. `gmail.metadata` is a restricted scope.
* Open tracking is inherently approximate and off by default.
* The Gmail assist depends on the hover-card attributes Gmail uses for people
  (`email`, `data-hovercard-id`); if Google changes them, the card stops appearing (nothing else
  breaks). It was tested against a fixture page, not live Gmail.
* Reply detection matches replies in the threads AutoReach started; replies sent in a new thread
  are matched only when "Also notice replies that start a new thread" is on.
* The extension's sign-in requires adding its `chromiumapp.org` redirect to Supabase; an
  unpacked extension's ID depends on the folder it was loaded from.
