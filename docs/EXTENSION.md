# Chrome extension

The extension is a companion to the dashboard. It talks to the same AutoReach API, so
anything you do in one shows up in the other on the next refresh.

| Part | What it does |
|---|---|
| **Popup** (toolbar button) | Sign-in, Gmail connection and pause status, emails sent today, follow-ups due (also shown as the toolbar badge), recent outreach, and quick actions: write email, add opportunity, add recruiter, open the dashboard, pause or resume all sending |
| **Side panel** | The composer: pick or add a recruiter, choose the role and résumé, draft from your template or with AI, refine, see the quality check, review and send (or approve for the queue). Optional: put the text into a Gmail compose window instead |
| **Gmail assist** (mail.google.com only) | When you write to, or read a conversation with, someone in AutoReach: whether you've emailed them before, whether they replied, open signals, do-not-contact and repeat-outreach warnings, with "Write with AutoReach" and "History" buttons. A small card in the bottom-left corner; it never changes Gmail's own buttons and can be hidden or turned off |
| **Add opportunity** | Reads the current page only when you click it: title, address, the text you selected, and the job details the site publishes for search engines (schema.org `JobPosting`). You review every field before anything is saved. Email addresses are suggested only if they appear in your selection |

The v1 extension's automatic LinkedIn scraper and email-address guessing were removed.
Address suggestions now live in the dashboard's add-recruiter form, always labelled
unverified (see [DEPLOYMENT.md](DEPLOYMENT.md) for the optional Hunter.io key).

## Permissions

| Permission | Why |
|---|---|
| `storage` | Your sign-in session (closed to content scripts, see below) and the Gmail-assist on/off preference (synced storage, the only value the Gmail script reads) |
| `identity` | Google sign-in and connecting Gmail, both through `chrome.identity.launchWebAuthFlow` |
| `activeTab` + `scripting` | Read the current page once, after you click "Add opportunity" |
| `sidePanel` | The composer |
| `alarms` | Refresh the follow-ups badge every 15 minutes |
| Host access: your API and your Supabase project | API calls and sign-in. Both come from the build settings |
| Content script on `https://mail.google.com/*` | The Gmail assist |

No `tabs`, no `<all_urls>`, no LinkedIn access, no remotely hosted code. Every API call is
made by the service worker. The Gmail content script can ask it for three things only:
look up the addresses on screen, record that you're reading a thread with a recruiter (so
opens of your own sent email are labelled "probably you"), and open the composer. Your
session lives in `chrome.storage.local` once the service worker has restricted it to the
extension's own pages (`setAccessLevel('TRUSTED_CONTEXTS')`, verified on Chrome 141). If a
Chrome version refuses that, the session is kept in `chrome.storage.session` instead, which
content scripts can't read either; you'll then sign in again after restarting Chrome.

## Build

1. Copy `extension/.env.example` to `extension/.env.production` (release) or
   `extension/.env.development.local` (local) and fill in:

   ```env
   VITE_API_URL=https://<your API host>
   VITE_DASHBOARD_URL=https://<your dashboard host>
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>        # public by design; never the service-role key
   VITE_DEV_LOGIN=false
   ```

2. Build:

   ```bash
   npm run build -w @autoreach/extension          # production → extension/dist
   npm run build:dev -w @autoreach/extension      # development (source maps, dev sign-in if enabled)
   npm run package -w @autoreach/extension        # build + extension/release/autoreach-extension-<version>.zip
   ```

   The manifest is generated from these settings, so host permissions always match
   `VITE_API_URL` and `VITE_SUPABASE_URL`. `http://` is accepted only for localhost.
   Packaging refuses a build that points at localhost or has the development sign-in on.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose `extension/dist`.
3. Pin AutoReach from the puzzle-piece menu.

After rebuilding, press the reload icon on the extension's card.

## Sign-in

The extension signs in with Supabase's Google provider through `chrome.identity`. Supabase
must allow the extension's redirect URL:

1. Find the extension ID on `chrome://extensions` (32 letters, a–p).
2. Supabase → Authentication → URL Configuration → Redirect URLs → add
   `https://<extension-id>.chromiumapp.org/**`.

The ID of an unpacked extension depends on the folder it was loaded from, so it can differ
between computers. A Chrome Web Store listing has one fixed ID; add that one for published
builds. If sign-in fails with "did not return a code", this redirect URL is the usual cause.

For local development without Supabase, build with `VITE_DEV_LOGIN=true` against a local
API that has `ENABLE_DEV_LOGIN=true` ([SETUP.md](SETUP.md)).

No CORS setting is needed for the extension: its service worker has host access to the API.

## Connecting Gmail from the extension

If Gmail isn't connected, the popup shows **Connect**. Google's consent page opens in a
separate window (`chrome.identity`). When you allow access, Google returns to the API, which
hands the result to the extension's `https://<extension-id>.chromiumapp.org/gmail` address;
the service worker then finishes the connection as you. The popup may close while the
Google window is open; reopen it to see Gmail connected. No Supabase or Google Cloud setting
is needed for this redirect: the API only accepts `chromiumapp.org` addresses here, and with
`EXTENSION_IDS` set on the API, only your extension's.

## Recovering from problems

| Situation | What you see |
|---|---|
| API unreachable or offline | "Can't reach AutoReach (…)" with **Try again**. Nothing is lost; drafts are saved on the server |
| Session expired | The service worker refreshes the session once; if that fails, the popup asks you to sign in again |
| Gmail access expired | A **Reconnect** banner in the popup; the send button explains why it's disabled |
| Extension updated or reloaded while Gmail was open | The old Gmail card removes itself. Chrome only adds the new version's script to pages loaded afterwards, so **reload the Gmail tab** to get the card back. Reopen the popup or side panel too |
| API unreachable while Gmail is open | The Gmail card stays hidden and checks again after 5 s, 10 s, 20 s … up to every 5 minutes; when signed out or turned off, every 3 minutes |
| A send whose result is unknown (network dropped mid-send) | It is marked "outcome unknown", never retried automatically; check Gmail's Sent folder and resolve it in the dashboard |

## Publishing to the Chrome Web Store (optional)

`npm run package -w @autoreach/extension` produces the ZIP to upload. The listing needs the
privacy policy URL (`/privacy` on the website) and a justification for each permission
(use the table above). Because the extension reads data from mail.google.com pages, the
"single purpose" and data-use answers should match the privacy policy.
