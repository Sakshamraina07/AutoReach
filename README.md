# AutoReach — Recruiter Cold Email Automation MVP

AutoReach is a Chrome Extension and Node.js backend system designed for students to automate cold email outreach to recruiters. It features dynamic templates, background queues, rate-limiter logic, email open tracking, automated follow-ups, and resume attachments directly from Supabase Storage.

## System Architecture

- **Extension:** React 18, Vite, CRXJS, TailwindCSS, Manifest V3.
- **Backend:** Node.js, Express, `express-rate-limit`.
- **Database & Auth & Storage:** Supabase (PostgreSQL).
- **Email Delivery:** Resend API.

---

## 🚀 Setup & Local Development Guide

### 1. Prerequisites
- Node.js (v18+)
- A [Supabase](https://supabase.com) Account (Free Tier)
- A [Resend](https://resend.com) Account (Free Tier)

### 2. Supabase Configuration
Create a new Supabase project. Setup the following:
1. **Authentication:** Enable Google OAuth in `Authentication -> Providers`.
2. **Storage Bucket:** Create a public bucket named `resumes`.
3. **Database Tables:** Execute the SQL schema found in the implementation plan to create `users`, `recruiters`, `email_templates`, and `email_history` tables.

### 3. Backend Setup
```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` directory:
```env
PORT=3001
API_URL=http://localhost:3001
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
RESEND_API_KEY=re_your_resend_api_key
RESEND_FROM_EMAIL=onboarding@resend.dev
```

Run the backend server (starts Express + Background workers):
```bash
node server.js
```

### 4. Extension Setup
```bash
cd extension
npm install
```

Create a `.env` file in the `extension/` directory:
```env
VITE_API_URL=http://localhost:3001
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Build the extension:
```bash
npm run build
```

Then load the unpacked extension into Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist` folder.

### 5. Start Sending
1. Click the AutoReach extension icon to open the Side Panel.
2. Sign in with Google.
3. Complete your User Profile and upload your Resume on the **Setup** tab.
4. Add or Import Recruiter contacts in the **DB** tab.
5. Write your **Templates** (Initial and Followups).
6. Head to the **Send** tab and click Start. The Node.js backend worker handles the queue.
