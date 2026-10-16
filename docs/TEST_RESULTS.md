# Test results

Everything on this page was run on 17 October 2026 (IST) against the code in this
repository, in a Linux sandbox with **Node 22.22.0**, **PostgreSQL 16.15** and **Chromium
141.0.7390.37** (Playwright's build). Nothing here ran against your Supabase, Railway, Vercel,
Google or AI-provider accounts; the sandbox can't reach them. Those are listed under
[Not tested](#not-tested), with the manual checks in [DEPLOYMENT.md](DEPLOYMENT.md#8-verify).

## Automated checks

```bash
npm run check   # typecheck → lint → tests → production builds
```

Result: **exit code 0**: TypeScript type checks for all four workspaces, ESLint with no
errors or warnings, **171 of 171 tests passed**, and the production builds of the API,
dashboard and extension completed with no warnings.

| Workspace | Test files | Tests | What they run against |
|---|---|---|---|
| `packages/shared` | 1 | 26 | Pure functions (validation, status rules, quality checks, templates, dates) |
| `backend` | 6 | 98 | The Express app over HTTP (supertest) and a **real PostgreSQL 16** started by the test harness; Google and AI calls go through recorded fake transports |
| `dashboard` | 2 | 13 | React components in jsdom (Testing Library) |
| `extension` | 7 | 34 | Service-worker modules, the Gmail content script and the build's manifest, in jsdom with a stubbed `chrome` API |
| **Total** | **16** | **171** | |

Each backend test file gets its own fresh database; the migrations run from scratch, including
a reconstruction of the v1 schema, so the migration tests start from v1-shaped data.

### Checks that the tests catch the bugs they target

Some of the new tests were run against deliberately broken code to make sure they fail:

* With the per-user lock in `lockSendSlot` removed, the daily-limit tests failed in each of
  three runs (two sends approved at the same moment both went out under a limit of one).
* With the message lock at the start of `deleteResume` removed, the résumé-deletion test
  failed after about a second: PostgreSQL detected the deadlock between deleting the default
  résumé and a send holding that résumé's email.
* With the Gmail card's backoff removed, the two backoff tests failed (the card asked the
  API again on every Gmail re-render).

The code was restored afterwards and the full suite passed (above).

## End-to-end runs in a browser

These ran with Playwright against the local stack: the API (`ENABLE_DEV_LOGIN=true`), the
Vite dashboard, a local PostgreSQL database migrated from empty, and the fictional demo data
from `npm run seed:demo -w @autoreach/backend`. Gmail wasn't connected (there is no Google
access from the sandbox), so no email was actually sent.

| Flow | Result |
|---|---|
| **Fresh database** | Migrations applied 3 of 3 on an empty database; a second run applied none |
| **Onboarding** for a new user | Résumé upload opened the extraction dialog; pattern-based suggestions (no AI configured) were labelled "replaces yours" / "adds to yours" and applied only after "Use selected fields"; the run went through all seven steps, and finishing led to the Overview |
| **Recruiter CRM** | Added a recruiter; adding `PAT.LEE@…` for an existing `pat.lee@…` showed "already saved as Pat Lee" with **Open existing recruiter**, and nothing was saved (the only console error was that 409 response) |
| **Composer** | Template draft filled from the profile; the send dialog showed "Gmail sending isn't set up on this server yet…" and the Send button was disabled |
| **Composer, fresh instance** | With text typed for one recruiter, the sidebar's **New outreach** opened an empty composer; saving a draft (which adds `?draft=` to the address) kept the composer's state |
| **Scheduling** | The time field showed "Asia/Kolkata time (your time zone in Settings)" and a minimum of the current time; a past time was refused with "That time has already passed…" and nothing was queued |
| **"Connect Gmail" from the send dialog** (API with a Google client configured, unsaved draft) | The draft was saved, and the page went to Settings → Gmail and stayed there |
| **Failed draft save before sending** | With the draft's save request forced to fail, **Send email** showed the save error and made **no** send request (it no longer falls back to the last saved version) |
| **Address from the Gmail card** (`/outreach/new?email=…&name=…`) | The add-recruiter dialog opened with the address and name filled in |
| **Gmail connection, dashboard** (API given a placeholder Google client; the second user was brand-new) | The consent URL asked for `openid email gmail.send gmail.metadata` with S256 PKCE and a state stored for the signed-in user. Google's redirect to the API was handed to `/gmail/callback`, which removed the code from the address bar and completed the connection; the token exchange then failed with `ENOTFOUND` (no route to Google from the sandbox), the page said so, and the state was used up. Opening the same kind of link while signed in as **another user** showed "started from a different AutoReach account…" and left the first user's state untouched. A declined consent showed "access was declined" with **Back to settings**. An unknown state got the API's own 400 page |
| **Extension popup and side panel** (unpacked development build) | Development sign-in; follow-ups badge `5`; recent outreach; adding an existing recruiter warned "already saved … and you've emailed them once"; the side-panel composer drafted from the template, and its review screen showed the Gmail notice with Send disabled |
| **Gmail assist** (a local page served at `https://mail.google.com/…` that reproduces the attributes Gmail uses for people) | Reading a thread with a known recruiter recorded the "probably you" window; composing to a known and an unknown address showed the duplicate warning and "Not in AutoReach"; inserting a draft filled subject and body and refused to overwrite existing text; **Write with AutoReach** opened the side panel; turning the assist off removed the card. No page errors |
| **Gmail connection, extension** (a local HTTPS stand-in answered for `accounts.google.com`) | `chrome.identity` opened the consent page with the expected scopes; the API's callback redirected to `https://<id>.chromiumapp.org/gmail`, which `launchWebAuthFlow` captured; the service worker completed the connection as the signed-in user; the token exchange failed with `ENOTFOUND` (sandbox) and the popup showed that error |
| **Session storage closed to content scripts** | With a throwaway test extension on Chromium 141: after `chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})`, a content script's `chrome.storage.local.get` threw "Access to storage is not allowed from this context", while `chrome.storage.sync` stayed readable |
| **Production mode** (`NODE_ENV=production`, built `dist/`) | `npm run db:migrate:prod` applied none of 3 (already applied); `/healthz` → `{"status":"ok"}`; `/readyz` → database ok, no pending migrations, each missing integration named; `POST /api/dev/login` → 404; `/api/me` without a token → 401 `UNAUTHENTICATED`; starting with `ENABLE_DEV_LOGIN=true` was refused ("must not be set in production"), and so was a malformed `EXTENSION_IDS` |
| **Extension packaging** | `npm run package -w @autoreach/extension` refused a build pointing at `localhost` |

## Not tested

* **Real Google:** consent, token exchange, refresh and revocation; sending through the Gmail
  API; `history.list` reply detection. The code paths are covered against fake transports that
  return Google's documented response shapes.
* **Real Supabase:** Google sign-in for the dashboard and extension, JWT verification against
  your project, private résumé storage.
* **Real AI providers** (Anthropic, OpenAI, Gemini, Groq, OpenAI-compatible): covered with a
  fake provider.
* **Deployment** to Railway and Vercel, and the Chrome Web Store.
* **Live Gmail pages:** the assist was tested on a fixture page, not on mail.google.com.
* **Your v1 data:** the migration was tested on a reconstruction of the v1 schema built from the
  v1 code, and on a copy of your production project's actual v1 table and column layout
  (taken from `information_schema`), not on its rows. Take the backup in [DEPLOYMENT.md](DEPLOYMENT.md#1-back-up-before-migrating) first.

## Every automated test

Generated from the test runner's JSON output for the run above.

### `packages/shared/src/shared.test.ts` (26)

- email helpers › normalizes case and whitespace only
- email helpers › validates addresses
- email helpers › builds duplicate suggestion keys cautiously
- email helpers › flags shared mailboxes
- email helpers › parses address headers
- email helpers › normalizes company names
- skills › extracts skills without false positives on prose
- skills › matches by canonical names and counts only
- roles › classifies role titles
- roles › extracts experience requirements
- templates › fills v1 variables and reports missing/unknown ones
- templates › finds leftover placeholders
- quality checks › passes a grounded draft without errors
- quality checks › flags fabricated metrics and skills
- quality checks › flags the wrong company and wrong greeting name as errors
- quality checks › flags missing attachment, placeholders, previous contact and referral claims
- quality checks › recognises résumé mentions with accents and punctuation
- quality checks › extracts claim numbers but ignores years, small counts and phones
- status derivation › keeps send, open and reply facts distinct
- status derivation › never shows an open when tracking was off
- business days › skips weekends in the user timezone
- schemas › rejects javascript: URLs and invalid emails
- schemas › validates spacing bounds
- profile completeness › scores what the drafting assistant uses
- time zones › maps old aliases to current IANA names and leaves current names alone
- scheduling in the user’s time zone › reads a datetime-local value as wall-clock time in the AutoReach time zone

### `backend/test/api.ai.test.ts` (7)

- AI drafting › sends only verified facts for the right role, company and recruiter to the provider
- AI drafting › flags fabricated claims and the wrong company in AI output instead of hiding them
- AI drafting › refines with a specific instruction and keeps the follow-up subject threaded
- AI drafting › retries once on unreadable output, then reports a clear error
- AI drafting › can be bypassed to use the template composer
- AI drafting › refuses to draft for another user’s recruiter
- without an AI provider › builds a role-aware template draft from verified profile facts

### `backend/test/api.crm.test.ts` (14)

- authentication › rejects missing and invalid tokens
- onboarding and profile › starts incomplete, saves partial steps, then completes
- onboarding and profile › validates profile input
- onboarding and profile › extracts profile suggestions from pasted résumé text without saving them
- recruiter CRM › creates recruiters and blocks duplicates by normalised email (server-side)
- recruiter CRM › searches, filters and sorts
- recruiter CRM › isolates users: another user cannot read, edit or delete
- recruiter CRM › updates without clobbering fields that were not sent
- recruiter CRM › imports CSV with a dry-run preview, then commits only new valid rows
- recruiter CRM › exports CSV with formula-injection protection
- recruiter CRM › suggests possible duplicates and merges them without losing history
- recruiter CRM › marks do-not-contact and cancels pending follow-ups
- opportunities › creates an opportunity, derives role category and skills, links recruiters, explains match
- settings › stores current time-zone names even when the browser reports an old alias

### `backend/test/api.send.test.ts` (27)

- résumé storage › stores PDFs privately with checksums; first upload becomes default
- résumé storage › rejects non-PDF uploads
- sending › sends the edited draft with the selected résumé and records Gmail ids
- sending › names the attachment from Settings when set, keeping the file intact
- sending › prevents duplicate outreach to the same recruiter unless explicitly confirmed
- sending › handles double submission: same key replays, concurrent keys send once
- sending › requires an Idempotency-Key
- sending › marks rejected sends as failed (distinct from sent) and allows a retry
- sending › classifies rate limits as failed-retryable and 5xx / dropped connections as unknown
- sending › fails safely (nothing sent) when the résumé file is missing from storage
- sending › detects a tampered résumé via checksum
- sending › requires a résumé when the setting is on, and blocks quality errors unless overridden
- sending › respects pause, the daily limit, do-not-contact and unverified addresses
- sending › does not let one user send or read another user’s message
- sending › recovers gracefully when Gmail access has expired and refresh is revoked
- sending › refreshes an expiring access token transparently
- tracking › embeds a unique pixel only when enabled, maps events to the right message, de-dupes and ignores self-opens
- tracking › keeps legacy v1 pixel URLs working
- scheduled and queued sending › queues, respects pause, re-checks at send time and sends via the worker
- scheduled and queued sending › turns messages stuck in "sending" into "unknown", never re-sending them
- send safety › refuses a schedule in the past instead of sending immediately
- send safety › does not let a draft point at another user’s campaign
- send safety › keeps simultaneous sends within the daily limit
- send safety › stops before Gmail when the attempt was taken over while preparing
- send safety › resolving an old v1 "unknown" as sent uses its creation time and creates no reminder
- send safety › deleting the default résumé while a send holds its message does not deadlock
- send safety › serves other users’ queues while one user is waiting on spacing

### `backend/test/api.sync.test.ts` (21)

- inbound classification › distinguishes replies, bounces, auto-replies, colleagues and unrelated senders
- reply sync › first sync sets the cursor; a recruiter reply marks replied and cancels follow-ups
- reply sync › records bounces and auto-replies without counting them as replies
- reply sync › sends ambiguous senders to a review queue for manual confirmation
- reply sync › resynchronises safely when the Gmail history cursor has expired
- reply sync › skips messages that were deleted before the sync instead of getting stuck
- reply sync › treats a delivery-delay notice as information, not a bounce
- reply sync › recognises an out-of-office that starts a new thread (opt-in new-thread scanning)
- reply sync › resumes from where it stopped when a run hits its message limit
- reply sync › skips reply detection (without failing) when the metadata scope was not granted
- follow-ups › lists due reminders, drafts an in-thread follow-up, sends it and schedules the next step
- follow-ups › ends reminders when the user marks the conversation as answered or closed by hand
- follow-ups › auto-sends only when explicitly enabled, from the user’s own template, within the cap
- Gmail OAuth connection › builds a consent URL with minimal scopes, PKCE and single-use state; completes only for the user who started it
- Gmail OAuth connection › hands the result back to the extension through its chrome.identity redirect
- Gmail OAuth connection › can be set up to send only, without the restricted header permission
- Gmail OAuth connection › returns to the onboarding wizard when the connection was started there
- Gmail OAuth connection › refuses a connection where the user unticked the send permission
- Gmail OAuth connection › encrypts v1 plaintext tokens on start-up and clears the plaintext
- analytics from stored records › reports KPIs, time series, breakdowns and insights from real rows
- account data rights › exports without secrets and deletes everything for the user only

### `backend/test/migrations.test.ts` (13)

- v1 → v2 migration preserves data › keeps every recruiter row and maps statuses without re-queuing anyone
- v1 → v2 migration preserves data › renames email_history to email_messages and maps send outcomes honestly
- v1 → v2 migration preserves data › creates legacy open events, threads, reminders and activity
- v1 → v2 migration preserves data › copies profile metadata and the résumé reference
- v1 → v2 migration preserves data › is idempotent when the v2 file is applied a second time
- v1 → v2 migration preserves data › enforces per-user isolation for the application role and locks out public roles
- migration on a hand-made v1 schema with enum types and a unique index › converts enum columns, drops the case-sensitive unique index and keeps history on recruiter delete
- migration on the production v1 schema › keeps recruiter names from either v1 column and lets 2.0 save a recruiter without a company
- migration on the production v1 schema › shows v1 email bodies as plain text and survives a missing subject
- migration on the production v1 schema › fills profiles and the résumé from the older users table only where metadata had nothing
- migration on the production v1 schema › keeps the newest template per type and adds the key 2.0 saves against
- migration on the production v1 schema › closes the older users table to the public API roles
- migration on the production v1 schema › imports v1 Gmail tokens, skipping rows without a live account

### `backend/test/unit.test.ts` (16)

- crypto › round-trips with AES-256-GCM and detects tampering
- crypto › computes RFC 7636 S256 challenges
- MIME builder › encodes non-ASCII headers, blocks header injection and threads replies
- tracking classification › keeps only coarse user-agent families and is conservative
- Gmail client error mapping › maps statuses to outcomes that decide whether a retry could duplicate an email
- Gmail client error mapping › retries idempotent reads on transient errors
- AI JSON parsing › tolerates fences and prose but rejects arrays
- résumé heuristics › extracts only what is present
- résumé heuristics › separates the college from the degree and dates
- configuration › fails fast with actionable messages
- configuration › disables optional integrations with an explicit reason
- contact discovery suggestions › labels every pattern guess unverified and never claims verification
- contact discovery suggestions › uses Hunter.io when configured, keeps its source and still marks it unverified
- contact discovery suggestions › degrades to patterns when the lookup service fails
- résumé storage ownership › accepts only the user’s own 2.0 and v1 object keys
- EXTENSION_IDS › accepts Chrome extension IDs and rejects anything else

### `dashboard/src/test/components.test.tsx` (8)

- StatusTrack › keeps sent, open and reply as separate facts in its accessible summary
- StatusTrack › labels opens as approximate and never as read
- StatusTrack › shows an unknown send outcome distinctly from a failure
- gmailProblem › allows sending only with a healthy connection that can send
- profile form › turns blank optional fields into nulls and drops empty rows before saving
- Settings › keeps open tracking off and explains why when the server cannot host the pixel
- Settings › only enables saving after a change and rejects an impossible spacing range
- Settings › describes Gmail access as headers-only and offers reconnecting when access expired

### `dashboard/src/test/flows.test.tsx` (5)

- Gmail connection callback page › finishes the connection as the signed-in user and returns to where it started
- Gmail connection callback page › explains a declined consent without calling the API
- Gmail connection callback page › shows the API’s reason when completing fails
- stacked overlays › closes a dialog nested inside a drawer first, even when both open together
- stacked overlays › closes only the innermost one on Escape

### `extension/src/test/api.test.ts` (9)

- service-worker API client › sends the bearer token, JSON body and idempotency key
- service-worker API client › refreshes once on 401 and retries with the new token
- service-worker API client › reports an expired session when refresh fails, without looping
- service-worker API client › does not call the API when signed out
- service-worker API client › passes API error codes through and explains network failures
- service-worker API client › handles 204 and non-JSON errors
- message senders › trusts extension pages, even when opened in a tab
- message senders › limits the Gmail content script to its read-only helpers
- message senders › rejects other extensions and other sites

### `extension/src/test/capture.test.ts` (4)

- page capture › uses the JobPosting the site publishes, including @graph and nested places
- page capture › falls back to the title and the user’s selection without inventing anything
- page capture › reads only title, URL, selection, meta and JSON-LD from a page
- page capture › decodes entities and strips scripts

### `extension/src/test/gmail.test.ts` (6)

- Gmail DOM reading › reads recipients from compose chips and hidden inputs, ignoring other text
- Gmail DOM reading › ignores dialogs that are not compose windows
- Gmail DOM reading › reads conversation participants from headers only
- assist card content › warns about repeat outreach only while composing
- assist card content › shows replies, bounces and do-not-contact distinctly
- assist card content › marks unknown people without guessing anything about them

### `extension/src/test/gmailAssist.test.ts` (5)

- Gmail assist › backs off after a failed lookup instead of asking on every Gmail re-render
- Gmail assist › waits minutes, not seconds, while signed out
- Gmail assist › shuts itself down when the extension behind it was updated or removed
- Gmail assist › does not ask again about an address the server returned nothing for
- Gmail assist › shows the card once a lookup succeeds

### `extension/src/test/gmailConnect.test.ts` (5)

- Gmail connection from the extension › starts with the chromiumapp.org redirect and completes with the returned code
- Gmail connection from the extension › rejects a response for a different connection attempt
- Gmail connection from the extension › reports a declined consent and a closed window without completing
- Gmail connection from the extension › passes the API error through when completion fails
- dashboard fallback link › carries an unsaved address from the Gmail card so the dashboard can offer to add it

### `extension/src/test/manifest.test.ts` (3)

- manifest › asks only for the permissions the features need
- manifest › runs the Gmail assist only on Gmail
- manifest › accepts http only for localhost

### `extension/src/test/secureStore.test.ts` (2)

- where the session is stored › uses local storage once it is closed to content scripts
- where the session is stored › falls back to session storage when local storage cannot be restricted
