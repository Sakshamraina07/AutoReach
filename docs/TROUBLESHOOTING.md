# Troubleshooting

Every API error has a `code`, a plain-language `message` and a `request_id`; the dashboard
and extension show the message and the reference. Search the API logs for the
`request_id` to see what happened.

## Start-up and configuration

| Symptom | Cause and fix |
|---|---|
| API exits with a list of configuration problems | `loadConfig` validates the environment before starting. Each line names the variable to fix (see `backend/.env.example`) |
| `/readyz` shows `pending_migrations` | Run `npm run db:migrate` (or redeploy on Railway, which migrates before starting) |
| `auth.users does not exist` when migrating | You're pointing at a plain Postgres. Use your Supabase connection string, or for local development `ALLOW_AUTH_SHIM=true npm run db:migrate` |
| Migration warning "applied migrations changed on disk" | A migration file was edited after it ran. Don't edit applied migrations; add a new one |
| Dashboard says "Can't reach the AutoReach API at …" | `VITE_API_URL` is wrong or the API is down; also check `DASHBOARD_URL` on the API matches the dashboard's origin exactly (CORS) |
| "This build has no Supabase settings" on the sign-in page | Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and rebuild |
| `UNKNOWN_TIMEZONE` when saving settings | The database doesn't know that zone name. Old aliases such as `Asia/Calcutta` are converted automatically; pick another name for the same zone if it still fails |

## Sign-in

| Symptom | Fix |
|---|---|
| Dashboard Google sign-in returns to the login page | Add the dashboard URL (with `/**`) to Supabase → Auth → Redirect URLs, and set the Site URL |
| Extension: "Google sign-in did not return a code" | Add `https://<extension-id>.chromiumapp.org/**` to Supabase Redirect URLs ([EXTENSION.md](EXTENSION.md#sign-in)) |
| Extension: "Sign-in was cancelled" | The Google window was closed; try again |
| `SESSION_EXPIRED` | The session couldn't be refreshed; sign in again |

## Gmail

| Code | Meaning | What to do |
|---|---|---|
| `GMAIL_NOT_CONFIGURED` | The API has no Google client or encryption key | Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` ([GMAIL_OAUTH.md](GMAIL_OAUTH.md)) |
| `GMAIL_NOT_CONNECTED` | You haven't connected Gmail | Settings → Gmail → Connect |
| `GMAIL_REAUTH_REQUIRED` | Google rejected the saved access (revoked, password change, or the 7-day limit of an app in Testing) | Settings → Gmail → Reconnect |
| `GMAIL_SCOPE_MISSING` | The connection lacks the send or header permission | Reconnect and keep the boxes ticked on Google's screen |
| `REPLY_DETECTION_DISABLED` | The server runs with `GMAIL_REPLY_DETECTION=false` | Mark replies on each email, or enable it on the server |
| `OAUTH_STATE_INVALID` | The connection link expired (10 minutes), was already used, or was finished while signed in as a different AutoReach user | Start the connection again from Settings → Gmail while signed in as the account that should send |
| "This Gmail connection link has expired or was already used" (page on the API's address) | Same as above, seen when Google's redirect arrives after the link expired or a second time | Start again |
| Extension: "the Google window was closed" / "access was declined" (`GMAIL_CONNECT_CANCELLED`, `GMAIL_CONNECT_DECLINED`) | The consent window was closed or Cancel was pressed | Click Connect again and allow both permissions |
| Google shows `redirect_uri_mismatch` | The callback isn't registered | Add `${API_PUBLIC_URL}/api/integrations/gmail/callback` to the OAuth client exactly |
| Google shows "This app is blocked" / "unverified" | The consent screen is in Testing and your address isn't a test user, or the app isn't verified | Add yourself under Audience → Test users |

## Sending

| Code | Meaning |
|---|---|
| `SENDING_PAUSED` | Sending is paused; resume from the sidebar or popup |
| `DAILY_LIMIT_REACHED` | You've hit your daily limit (Settings → Sending); queued emails continue tomorrow |
| `DUPLICATE_OUTREACH` | You already sent a first email to this person; confirm in the send dialog if it's for a different role, or write a follow-up |
| `RECRUITER_REPLIED` | They replied already; answer in Gmail, or confirm if you really want to send |
| `DO_NOT_CONTACT` / `RECIPIENT_BOUNCED` | The recruiter is marked do-not-contact, or a previous email bounced. Fix the address or status first |
| `UNVERIFIED_EMAIL` | The address was marked as a guess; confirm you checked it |
| `QUALITY_CHECK_FAILED` | The quality check found an error (wrong company or name, placeholder left, …); fix it or confirm the override |
| `RESUME_REQUIRED` | Settings require a résumé and none is selected |
| `RESUME_FILE_MISSING`, `RESUME_CHECKSUM_MISMATCH`, `RESUME_CORRUPT`, `RESUME_TOO_LARGE` | The selected résumé file can't be attached safely. Nothing was sent; re-upload the PDF |
| `GMAIL_RATE_LIMITED`, `GMAIL_QUOTA_EXCEEDED` | Gmail asked to slow down. The email is marked **failed** (not sent); try again later |
| `GMAIL_REJECTED` | Gmail refused the message (for example an invalid recipient). Marked **failed** |
| `SEND_OUTCOME_UNKNOWN` / status **Outcome unknown** | The connection dropped or Gmail returned a server error after the request was sent, so it may or may not have gone out. AutoReach never retries these automatically. Check Gmail's Sent folder, then click **It was sent** or **It was not sent** on the message |
| `IDEMPOTENCY_KEY_REUSED` | The request's Idempotency-Key was already used to send a *different* message (a client bug or a reused key). Nothing was sent; reopen the composer, which makes a new key |
| `SEND_AT_IN_PAST` | The scheduled time had already passed (often a wrong day or time zone). Nothing was sent or queued; pick a later time. The time you enter is read in your AutoReach time zone (Settings → Sending) |
| `SEND_PREPARATION_TIMEOUT` | Preparing the email (loading the résumé, refreshing Gmail access) took so long that the attempt was stopped before reaching Gmail. It was **not** sent; send it again |
| `RESUME_STORAGE_TIMEOUT` | The résumé file didn't load from storage within a minute. Nothing was sent; try again, and check the storage service if it keeps happening |

A message stuck in **Sending** for more than a few minutes (for example after a server
restart) is moved to **Outcome unknown** automatically, for the same reason.

## Replies, follow-ups and tracking

| Symptom | Explanation |
|---|---|
| A reply isn't detected | Detection runs every 3 minutes and only for threads AutoReach started. A reply that starts a new thread is matched only if "Also notice replies that start a new thread" is on. You can always set the reply status on the message page |
| "Needs review" item | Someone other than the recruiter (for example a colleague at the same company) wrote in the thread. Decide whether it counts as a reply |
| Follow-up reminders didn't appear | Reminders are created a few business days after each sent email, up to the maximum in Settings, and are cancelled by a reply, a bounce, do-not-contact, or marking the recruiter as replied, interviewing or not interested |
| No opens recorded | Open tracking is off by default, needs an https `API_PUBLIC_URL`, and many mail apps block images. "No open detected" doesn't mean unread |
| An open was recorded seconds after sending | Probably you or a security scanner; those signals are labelled and not counted |

## Tests

| Symptom | Fix |
|---|---|
| `PostgreSQL server binaries not found` | Install PostgreSQL (the tests use `initdb`/`pg_ctl`), or set `TEST_DATABASE_URL` |
| `initdb` refuses to run as root | The test helper runs it as the `postgres` OS user automatically; set `PG_RUN_AS` if that user has another name |
