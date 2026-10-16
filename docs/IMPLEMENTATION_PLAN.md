# AutoReach 2.0 — Implementation Plan

Status legend in the final report: Retained · Improved · Added · Deferred.

## Phase 1 — Audit and preservation ✔
- Read every source file; reconstruct the database schema from queries (`REPOSITORY_AUDIT.md` §3).
- Baseline builds/lint/tests recorded (`REPOSITORY_AUDIT.md` §7).
- Decide migration strategy: rename/extend legacy tables in place; never drop user data.

## Phase 2 — Foundations
1. npm workspaces at the root (`packages/shared`, `backend`, `dashboard`, `extension`); remove the
   orphan root dependencies and the committed build ZIPs (they remain in git history).
2. `@autoreach/shared`: enums, zod schemas, normalisation, status derivation, template compiler,
   quality checks, role categories, business days.
3. `supabase/migrations/`:
   - `20261016000000_legacy_baseline.sql` — creates the legacy tables **only if absent** (fresh
     installs and tests start from the same shape as production), adds any legacy column the old
     code relied on if missing.
   - `20261016000100_autoreach_v2.sql` — 2.0 schema, in-place legacy transformation, RLS,
     `autoreach_app` role, indexes, constraints, private résumé bucket.
   - Migration runner `npm run db:migrate -w backend` recording applied files in
     `public.autoreach_migrations`; every statement idempotent so re-running is safe.
4. Backend rewrite in TypeScript (same Express 5 + Supabase stack): config validation, `pg`
   pool with `withUser`/`withSystem`, auth verification, logging, errors, rate limits, CORS,
   health checks, legacy Gmail token import (encryption).
5. Test harness that boots a throw-away PostgreSQL 16 cluster.

Risk controls: the legacy `/track/:id` route keeps working; the legacy queue worker is **not**
ported (it auto-sent on insert) — instead, `outreach_status` for old `Pending` rows becomes `new`.

## Phase 3 — CRM, opportunities, profile, résumés
- Recruiters: CRUD, search/filter/sort/paginate, tags, notes, CSV import with preview, CSV export,
  duplicate detection (exact normalised email = blocked; name+company / gmail dot/plus variants =
  merge suggestions), merge preserving history, opportunity links, do-not-contact.
- Opportunities: CRUD, status pipeline with activity log, recruiter links, required skills, role
  category, deadline, pasted job description.
- Profile: full onboarding fields, completeness score, tone and writing-style settings.
- Résumés: private upload (PDF, ≤ 10 MB, magic-byte check), SHA-256, extracted text, labels,
  role tags, default résumé, authenticated download, extraction to profile suggestions (explicit
  confirmation before saving).

## Phase 4 — AI drafting and sending
- Provider abstraction (Anthropic, OpenAI-compatible incl. Groq/OpenRouter/Ollama, Gemini).
- Fact-grounded generation + refine actions (concise, personalise, emphasise projects, change
  tone, regenerate); template fallback without AI.
- Deterministic quality checks.
- Drafts, idempotent send, scheduled send, cancel, resolve-unknown, Gmail error mapping,
  attachment verification, MIME builder, daily limit, pause.

## Phase 5 — Tracking, replies, follow-ups
- Tracking tokens, pixel routes (new + legacy), event classification/dedupe, retention, opt-in.
- Gmail metadata sync worker, reply classification, manual correction, review queue.
- Follow-up reminders, drafts in-thread, reschedule/dismiss/complete, cancellation on reply,
  optional capped auto-send with pause.

## Phase 6 — Dashboard
- Pages: Overview, Recruiters (+ detail drawer), Opportunities (+ detail), Outreach (history +
  composer + message detail), Follow-ups, Analytics, Settings (Profile, Résumés, Gmail, Sending,
  Tracking, AI, Templates, Data & privacy), Onboarding wizard, Login.
- Design system: dark-first tokens, light theme, compact tables, empty/loading/error states.

## Phase 7 — Extension
- MV3 rebuild in TypeScript: popup, side panel composer, page capture with confirmation,
  Gmail assist content script, background API proxy and badge, minimal permissions, recovery from
  expired auth/offline/API failures.

## Phase 8 — Analytics, copilot, polish
- KPIs with previous-period deltas, time series, breakdowns by role category/company/campaign,
  small-sample labels, subject-style insights, outreach readiness and recommendations, profile-to-
  role match (counts of matched/missing skills, no invented score).
- Accessibility pass (labels, focus states, contrast), responsive layouts.

## Phase 9 — Release readiness
- `.env.example` files, `docs/SETUP.md`, `docs/GMAIL_OAUTH.md`, `docs/AI_PROVIDERS.md`,
  `docs/EXTENSION.md`, `docs/DEPLOYMENT.md`, `docs/TROUBLESHOOTING.md`, `docs/TEST_RESULTS.md`.
- Updated website copy and privacy policy (scopes, tracking, AI processing, deletion/export).
- Full run: typecheck, lint, unit + integration tests, production builds of every package;
  screenshots of the real dashboard; independent review of the diff.

## Explicit non-goals / deferrals (to be confirmed in the final report)
- Automated LinkedIn scraping (removed by design).
- Mass contact discovery or automatic emailing of discovered addresses.
- Gmail push notifications (Pub/Sub) — polling with `history.list` is sufficient at this scale
  and needs no extra Google Cloud resources.
