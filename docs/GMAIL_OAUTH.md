# Gmail and Google sign-in setup

AutoReach uses Google in two separate ways:

| Purpose | Who handles it | Google client |
|---|---|---|
| **Signing in** to AutoReach (dashboard and extension) | Supabase Auth | The OAuth client configured in Supabase → Authentication → Providers → Google |
| **Sending and reply detection** from your Gmail | The AutoReach API (`/api/integrations/gmail/*`) | A **Web application** OAuth client whose ID and secret go in `backend/.env` |

They can be the same Google Cloud project and even the same OAuth client (it just needs
both redirect URIs). AutoReach v1 already had a web client
(`865030703352-08belajskesjt2fcqbi91tnfi4ld1bsu.apps.googleusercontent.com`); you can keep
using it by adding the 2.0 redirect URI below.

## 1. Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and select (or create) the project.
2. **APIs & Services → Library → Gmail API → Enable.**

## 2. Consent screen

In **Google Auth platform** (older consoles: APIs & Services → OAuth consent screen):

1. **Branding:** app name "AutoReach", support email, and the privacy policy URL
   (`https://<your website>/privacy`; the policy in `website/src/Privacy.jsx` describes 2.0).
2. **Audience:** user type **External** (personal Gmail accounts can't use Internal).
   While the app is in **Testing**, add every Gmail address that will use AutoReach under
   **Test users**.
3. **Data Access → Add or Remove Scopes:** add
   * `openid`, `.../auth/userinfo.email`
   * `https://www.googleapis.com/auth/gmail.send`: "Send email on your behalf" (Google classes it as *sensitive*)
   * `https://www.googleapis.com/auth/gmail.metadata`: "View your email message metadata such as labels and headers, but not the email body" (Google classes it as *restricted*). Skip this one if you run with `GMAIL_REPLY_DETECTION=false` (section 5).

## 3. OAuth client for sending

**Google Auth platform → Clients** (older consoles: APIs & Services → Credentials):

1. Use the existing web client or **Create client → Web application**.
2. **Authorized redirect URIs:** add exactly
   ```
   ${API_PUBLIC_URL}/api/integrations/gmail/callback
   ```
   for example `https://autoreach-production-3c97.up.railway.app/api/integrations/gmail/callback`,
   and `http://localhost:3001/api/integrations/gmail/callback` for local development.
3. Copy the client ID and secret into the API environment:

```env
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=...          # npm run gen:key -w @autoreach/backend
API_PUBLIC_URL=https://<your API host>
DASHBOARD_URL=https://<your dashboard host>
```

`TOKEN_ENCRYPTION_KEY` encrypts Gmail tokens (AES-256-GCM). Keep it stable: if it changes,
stored connections can't be decrypted and everyone has to reconnect Gmail once.

## 4. How the connection works

1. In Settings → Gmail (or onboarding, or the extension popup) the user clicks **Connect Gmail**.
2. The API creates a single-use `state` (10 minutes) and a PKCE verifier, and sends the
   browser to Google with `access_type=offline` and `prompt=consent`.
3. Google redirects to `/api/integrations/gmail/callback`. The API checks that the state
   exists and hasn't expired, then hands the code back to where the connection started:
   the dashboard's `/gmail/callback` page, or the extension's
   `https://<extension-id>.chromiumapp.org/gmail` address (caught by `chrome.identity`, so
   no tab is left open). Nothing is exchanged at this point.
4. That signed-in page (or the extension's service worker) calls
   `POST /api/integrations/gmail/complete`. The API consumes the state **only if it belongs to
   the signed-in user**, exchanges the code with the PKCE verifier, refuses the connection
   if the send permission was unticked, and encrypts and stores the tokens. A consent link
   forwarded to someone else therefore can't attach their mailbox to your account.
5. Access tokens are refreshed shortly before they expire. If Google answers
   `invalid_grant` (revoked, password change, or an expired test-mode token), the
   connection is marked **needs reconnecting**: sending stops with a clear message and the
   dashboard shows a "Reconnect Gmail" banner. Nothing is retried blindly.
6. **Disconnect** revokes the token at Google and deletes it from the database.

v1 stored Gmail tokens in plain text. On start-up the 2.0 API encrypts any v1 tokens it
finds and clears the plain-text copies, so v1 users can keep sending without reconnecting.
v1 only had the send permission, so reply detection stays off for them until they
reconnect once (Settings → Gmail says so).

## 5. Publishing status, verification and the 7-day limit

Google's rules decide how long a connection lasts and who can use the app:

* **Testing** (no verification needed, up to 100 test users): Google issues refresh tokens
  that **expire after 7 days** whenever Gmail scopes are requested. Each week AutoReach
  will show "Gmail access expired, reconnect" and sending pauses until you reconnect.
  This is fine for a personal job search.
* **In production** for other people: `gmail.send` requires Google's verification of a
  sensitive scope, and `gmail.metadata` is a **restricted** scope. Google requires restricted
  scope verification and, because AutoReach stores data derived from it on its server, a
  third-party security assessment.

If you want to publish without the restricted scope, set

```env
GMAIL_REPLY_DETECTION=false
```

AutoReach then asks only for `gmail.send` (plus `openid`/`email`), never reads anything from
Gmail, and doesn't detect replies; you mark replies on each email (the dashboard and
extension say so). Everything else works the same.

Users can also untick the header permission on Google's consent screen; AutoReach then
connects for sending only and Settings explains how to enable reply detection later.

## 6. What reply detection reads

With `gmail.metadata` AutoReach can read headers only. It:

* starts from the Gmail history ID saved at the last sync and asks only for messages added
  since then (`users.history.list`), so it never downloads the mailbox;
* looks at messages in threads AutoReach started (and, only if the user turns on
  "Also notice replies that start a new thread", the sender of other new messages, matched
  against recruiters already emailed);
* reads `From`, `Subject`, `Date`, `Auto-Submitted` and similar headers to tell a reply from
  a bounce, an out-of-office reply or a colleague writing back (the latter waits in
  "Needs review");
* when Google says the saved history ID is too old (HTTP 404), re-reads the tracked threads
  once and starts a fresh cursor.

It runs every 3 minutes in the background and on "Check for replies now".

## Supabase sign-in

For signing in to AutoReach itself:

1. Google Cloud: in the same or another web client, add the Supabase callback
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
2. Supabase → Authentication → Providers → **Google**: enable, paste that client's ID and secret.
3. Supabase → Authentication → URL Configuration → **Redirect URLs**: add
   * your dashboard URL, e.g. `https://app.example.com/**` and `http://localhost:5173/**`;
   * the extension's redirect, `https://<extension-id>.chromiumapp.org/**`
     (see [EXTENSION.md](EXTENSION.md#sign-in) for how to find the ID).

Sign-in only needs `openid email profile`; it is unaffected by the 7-day testing limit.
