# career-ops and AutoReach on one computer

[career-ops](https://github.com/career-ops-hq/career-ops) (open source, MIT) finds job postings and
scores them against your CV. AutoReach turns the good ones into emails to the people who hire
for them. Both run on your computer. They share nothing except files: career-ops writes a
report for every job it evaluates, and AutoReach reads those reports.

```
career-ops                                  AutoReach
  scan job boards ─▶ score each job ─▶ report ─▶ From career-ops page ─▶ Write emails ─▶ job page
  (D:\career-ops)              (reports\*.md)       (sorted by score)                      (fit + one email per person)
```

AutoReach only **reads** `reports\`, `jds\` and `data\applications.md` in the career-ops
folder. The one thing it ever writes there is `cv.md`, and only when you click **Create
cv.md in career-ops** and the file doesn't exist yet.

## 1. Install career-ops next to AutoReach

You need Node.js 22.13 or later (the same one AutoReach uses). In PowerShell:

```powershell
cd D:\
npx @santifer/career-ops init
```

`init` downloads career-ops into `D:\career-ops` and installs what it needs, including the
Chromium browser it uses to read job pages and make PDFs. If `npm run doctor` (step 3) says
Chromium is missing, run `npx playwright install chromium` in `D:\career-ops`.

## 2. Connect AutoReach to it

Open `D:\AutoReach\backend\.env` in Notepad and add two lines (forward slashes are fine on
Windows and avoid any backslash surprises):

```
CAREER_OPS_DIR=D:/career-ops
CAREER_OPS_OWNER_EMAIL=the email you sign in to AutoReach with
```

Then apply the database update and restart the API:

```powershell
cd D:\AutoReach
npm run db:migrate
npm run dev:api
```

The sidebar now has **From career-ops**. If the folder is wrong, that page says which path
it tried.

## 3. Give career-ops your CV and targets

1. In AutoReach, open **From career-ops** and click **Create cv.md in career-ops**. It is
   built from your AutoReach profile, using only what your profile says.
2. Copy the starter settings:

   ```powershell
   cd D:\career-ops
   copy config\profile.example.yml config\profile.yml
   copy modes\_profile.template.md modes\_profile.md
   copy templates\portals.example.yml portals.yml
   ```

3. Edit them in Notepad:
   - `config\profile.yml`: your name, email, location (India), target roles.
   - `portals.yml`: under `title_filter`, the words that must appear in a job title, for
     example `intern`, `backend`, `software engineer`, `sde`. **This filter decides what
     career-ops even looks at.** A list written for someone else's career quietly hides the
     jobs you want, so read it once.
4. Check everything: `npm run doctor`. It lists anything still missing.

If you use an AI coding tool such as Claude Code or Codex, you can skip steps 2–3: open it
in `D:\career-ops` and it sets these files up by chatting.

## 4. Choose how career-ops scores jobs

- **With your Gemini key (no extra tool needed).** Copy `.env.example` to `.env` in
  `D:\career-ops` and set `GEMINI_API_KEY=` to your key from aistudio.google.com. The same
  key AutoReach uses works. On Gemini's free tier, Google may use what you send to improve its
  products; see [AI_PROVIDERS.md](AI_PROVIDERS.md).
- **With an AI coding tool** (Claude Code, Codex, Gemini CLI and others): open it in
  `D:\career-ops` and use `/career-ops` commands. See career-ops' own README.

## 5. The daily routine

In `D:\career-ops` (PowerShell):

```powershell
npm run scan                                      # find new postings (uses no AI)
node batch-evaluate-gemini.mjs --limit=10         # score up to 10 of them with Gemini
```

The second command also adds the scored jobs to career-ops' own tracker.

Then in AutoReach:

1. **From career-ops** → **Check for new reports**. Jobs scored 4.0 or higher show first.
   Low scores and jobs you marked SKIP or Rejected in career-ops are hidden until you click
   **Show all**.
2. **Write emails** on a job. AutoReach reads its description, checks it the same way as a
   pasted one, and opens the job page with your fit. The score from career-ops appears under
   the title.
3. Paste the people to write to, read each email, and click **Send cold email**.

## Where the description comes from

For each report, AutoReach uses the first of these that works:

1. **The posting's job board**, when the link is on Greenhouse, Lever or Ashby. Those boards
   publish their postings' text for exactly this, so it is the most faithful copy. AutoReach
   asks only their API servers.
2. **A copy career-ops saved in `jds\`** for that report: the file name must start with the
   report's number and the same company as the report (`.md`, `.txt` or `.pdf`).
3. **The report's own "Job Description" section**, when it is the posting's text. It skips a
   section that is shorter than a real posting, only points to another file, is a sign-in or
   error page, or says it is a paraphrase or summary. It also skips the section in reports
   written by career-ops' Gemini or OpenRouter scripts (they carry a `**Tool:**` line),
   because there the section is the model's retyping of the posting, not the posting.
4. Otherwise the row says **No description saved**, and **Paste description** opens New job
   with the link filled in and the company and role suggested.

The same Greenhouse, Lever and Ashby reading is on the **New job** page: paste a link and
click **Get description**.

## Good to know

- Each report becomes one AutoReach job. Clicking **Write emails** again opens the same job.
  If you already added the job by hand with the same link, AutoReach uses that job.
- AutoReach doesn't change career-ops' tracker. Mark the application in career-ops yourself
  (for example `node set-status.mjs`), or ask your AI tool to.
- Who can read the folder: outside production, AutoReach serves career-ops only to requests
  from this computer, so another device on your Wi-Fi can't read it.
  `CAREER_OPS_OWNER_EMAIL` also limits it to your account; it is required if you ever run the
  API with `NODE_ENV=production`.
- If you moved career-ops' data with a `.career-ops-data` file, AutoReach follows it, and that
  is where it reads reports and writes `cv.md`. It doesn't read the `CAREER_OPS_ROOT` variable;
  if you use that, set `CAREER_OPS_DIR` to the data folder instead.
- career-ops is a separate project with its own updates (`npm run update` in its folder) and
  its own trademark policy for the name.
