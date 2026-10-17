-- =====================================================================
-- AutoReach v1 baseline (reconstructed from the v1 source code).
--
-- Purpose: give fresh installs, CI and tests the SAME starting shape as an
-- existing v1 production database, so the 2.0 migration is always exercised
-- against v1 data.
--
-- On an existing v1 database this file changes nothing except adding a v1
-- column that the v1 code relied on but that happens to be missing.
-- It is skipped entirely once the 2.0 migration has been applied.
-- =====================================================================

do $baseline$
begin
  -- Already migrated to 2.0? Then this baseline must not touch anything.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recruiters' and column_name = 'outreach_status'
  ) then
    raise notice 'AutoReach 2.0 schema present; legacy baseline skipped';
    return;
  end if;

  create table if not exists public.recruiters (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    hr_name text,
    company text,
    email text not null,
    role text,
    source text default 'manual',
    status text default 'Pending',
    last_sent_at timestamptz,
    followup_count integer not null default 0,
    created_at timestamptz not null default now(),
    constraint recruiters_user_id_email_key unique (user_id, email)
  );
  alter table public.recruiters add column if not exists hr_name text;
  alter table public.recruiters add column if not exists company text;
  alter table public.recruiters add column if not exists role text;
  alter table public.recruiters add column if not exists source text default 'manual';
  alter table public.recruiters add column if not exists status text default 'Pending';
  alter table public.recruiters add column if not exists last_sent_at timestamptz;
  alter table public.recruiters add column if not exists followup_count integer not null default 0;
  alter table public.recruiters add column if not exists created_at timestamptz not null default now();

  create table if not exists public.email_templates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    type text not null default 'initial',
    subject text,
    body text,
    updated_at timestamptz not null default now(),
    constraint email_templates_user_id_type_key unique (user_id, type)
  );

  -- email_history may already have been renamed by a partially applied run.
  if to_regclass('public.email_messages') is null then
    create table if not exists public.email_history (
      id uuid primary key default gen_random_uuid(),
      recruiter_id uuid references public.recruiters (id) on delete cascade,
      user_id uuid references auth.users (id) on delete cascade,
      subject text,
      status text,
      sent_at timestamptz default now(),
      opened_at timestamptz,
      gmail_message_id text,
      gmail_thread_id text,
      error_message text,
      retry_count integer default 0
    );
    alter table public.email_history add column if not exists user_id uuid;
    alter table public.email_history add column if not exists subject text;
    alter table public.email_history add column if not exists status text;
    alter table public.email_history add column if not exists sent_at timestamptz default now();
    alter table public.email_history add column if not exists opened_at timestamptz;
    alter table public.email_history add column if not exists gmail_message_id text;
    alter table public.email_history add column if not exists gmail_thread_id text;
    alter table public.email_history add column if not exists error_message text;
    alter table public.email_history add column if not exists retry_count integer default 0;
  end if;

  create table if not exists public.user_smtp_settings (
    user_id uuid primary key references auth.users (id) on delete cascade,
    gmail_user text,
    gmail_access_token text,
    gmail_refresh_token text,
    token_expires_at timestamptz,
    updated_at timestamptz default now()
  );
end
$baseline$;
