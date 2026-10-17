-- =====================================================================
-- AutoReach 2.0 schema + in-place migration of v1 data.
--
-- Rules followed in this file:
--   * Nothing that holds user data is dropped. Legacy tables are renamed or
--     extended; legacy columns are renamed (e.g. status -> legacy_status).
--   * Every statement is idempotent: re-applying the file is a no-op.
--   * Row Level Security is enabled on every table. The API switches to the
--     non-privileged role `autoreach_app` per request and sets `app.user_id`;
--     the public `anon` / `authenticated` roles get no table privileges.
--
-- BEFORE RUNNING ON PRODUCTION: take a backup (Supabase dashboard ->
-- Database -> Backups, or `pg_dump`). See docs/DEPLOYMENT.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Application role, current-user helper, updated_at trigger
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'autoreach_app') then
    create role autoreach_app nologin;
  end if;
end
$$;

-- Allow the role running migrations (and the API, which must use the same
-- database user) to `SET ROLE autoreach_app`.
grant autoreach_app to current_user;
grant usage on schema public to autoreach_app;

create or replace function public.app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

grant execute on function public.app_current_user_id() to autoreach_app;

create or replace function public.autoreach_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Helper used only inside this migration: does a column exist?
create or replace function pg_temp.col_exists(t text, c text)
returns boolean
language sql
as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t and column_name = c
  )
$$;

-- ---------------------------------------------------------------------
-- 1. Profiles (v1 kept these in auth.users.raw_user_meta_data)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  primary_email text,
  phone text,
  degree text,
  specialization text,
  university text,
  graduation_month smallint check (graduation_month between 1 and 12),
  graduation_year smallint check (graduation_year between 1990 and 2100),
  current_location text,
  preferred_locations text[] not null default '{}',
  job_types text[] not null default '{}',
  target_roles text[] not null default '{}',
  skills text[] not null default '{}',
  projects jsonb not null default '[]'::jsonb,
  experience jsonb not null default '[]'::jsonb,
  links jsonb not null default '{"github": null, "linkedin": null, "portfolio": null, "other": []}'::jsonb,
  preferred_tone text not null default 'professional'
    check (preferred_tone in ('professional', 'friendly', 'enthusiastic', 'formal', 'direct')),
  writing_style text,
  signature text,
  legacy_year text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profiles (user_id, full_name, primary_email, phone, degree, current_location, legacy_year, graduation_year)
select
  u.id,
  coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), ''),
  coalesce(
    case when (u.raw_user_meta_data ->> 'contact') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then btrim(u.raw_user_meta_data ->> 'contact') end,
    u.email
  ),
  case when (u.raw_user_meta_data ->> 'contact') ~ '@' then null else nullif(btrim(u.raw_user_meta_data ->> 'contact'), '') end,
  nullif(btrim(u.raw_user_meta_data ->> 'degree'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'location'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'year'), ''),
  case when btrim(u.raw_user_meta_data ->> 'year') ~ '^(19|20|21)[0-9]{2}$' then (btrim(u.raw_user_meta_data ->> 'year'))::smallint end
from auth.users u
on conflict (user_id) do nothing;

-- Earlier v1 versions kept the profile (and résumé link) in a public.users table
-- before moving it to user_metadata. Fill only what the metadata didn't have, and
-- only on the first run (user_settings is created further down by this file).
do $$
begin
  if to_regclass('public.user_settings') is null and to_regclass('public.users') is not null
     and pg_temp.col_exists('users', 'id') and pg_temp.col_exists('users', 'name') and pg_temp.col_exists('users', 'degree')
     and pg_temp.col_exists('users', 'year') and pg_temp.col_exists('users', 'location') and pg_temp.col_exists('users', 'contact') then
    execute $sql$
      update public.profiles p
      set
        full_name = coalesce(nullif(p.full_name, ''), nullif(btrim(pu.name), ''), ''),
        phone = coalesce(p.phone, case when pu.contact ~ '@' then null else nullif(btrim(pu.contact), '') end),
        degree = coalesce(p.degree, nullif(btrim(pu.degree), '')),
        current_location = coalesce(p.current_location, nullif(btrim(pu.location), '')),
        legacy_year = coalesce(p.legacy_year, nullif(btrim(pu.year), '')),
        graduation_year = coalesce(p.graduation_year, case when btrim(pu.year) ~ '^(19|20|21)[0-9]{2}$' then btrim(pu.year)::smallint end)
      from public.users pu
      where pu.id = p.user_id
    $sql$;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Résumés (private storage; v1 stored a public URL in user metadata)
-- ---------------------------------------------------------------------
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null default 'Résumé',
  file_name text not null,
  storage_path text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null default 0,
  sha256 text,
  extracted_text text,
  role_tags text[] not null default '{}',
  is_default boolean not null default false,
  legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resumes_user_storage_path_key unique (user_id, storage_path)
);
create unique index if not exists resumes_one_default_per_user on public.resumes (user_id) where is_default;

-- Only on the first run (user_settings is created further down by this file), so a
-- re-run never brings back a v1 résumé the user has since deleted.
do $$
begin
  if to_regclass('public.user_settings') is null then
    insert into public.resumes (user_id, label, file_name, storage_path, mime_type, is_default, legacy)
    select
      u.id,
      'Résumé (from AutoReach v1)',
      case
        when lower(substring(u.raw_user_meta_data ->> 'resume_url' from '\.([A-Za-z0-9]+)(\?.*)?$')) = 'pdf' then 'Resume.pdf'
        else 'Resume.' || coalesce(lower(substring(u.raw_user_meta_data ->> 'resume_url' from '\.([A-Za-z0-9]+)(\?.*)?$')), 'pdf')
      end,
      substring(u.raw_user_meta_data ->> 'resume_url' from '/storage/v1/object/public/resumes/([^?#]+)'),
      case lower(coalesce(substring(u.raw_user_meta_data ->> 'resume_url' from '\.([A-Za-z0-9]+)(\?.*)?$'), 'pdf'))
        when 'pdf' then 'application/pdf'
        when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        when 'doc' then 'application/msword'
        else 'application/octet-stream'
      end,
      not exists (select 1 from public.resumes r where r.user_id = u.id and r.is_default),
      true
    from auth.users u
    where substring(u.raw_user_meta_data ->> 'resume_url' from '/storage/v1/object/public/resumes/([^?#]+)') is not null
      -- v1 named uploads `${userId}-${timestamp}.${ext}`. user_metadata is editable by the user,
      -- so a URL pointing at anyone else's object (or a nested path) is ignored.
      and substring(u.raw_user_meta_data ->> 'resume_url' from '/storage/v1/object/public/resumes/([^?#]+)') ~ ('^' || u.id::text || '-[A-Za-z0-9._-]+$')
    on conflict (user_id, storage_path) do nothing;

    -- Same rules for a résumé link kept in the older public.users table.
    if to_regclass('public.users') is not null and pg_temp.col_exists('users', 'resume_url') then
      execute $sql$
        insert into public.resumes (user_id, label, file_name, storage_path, mime_type, is_default, legacy)
        select
          pu.id,
          'Résumé (from AutoReach v1)',
          case
            when lower(substring(pu.resume_url from '\.([A-Za-z0-9]+)(\?.*)?$')) = 'pdf' then 'Resume.pdf'
            else 'Resume.' || coalesce(lower(substring(pu.resume_url from '\.([A-Za-z0-9]+)(\?.*)?$')), 'pdf')
          end,
          substring(pu.resume_url from '/storage/v1/object/public/resumes/([^?#]+)'),
          case lower(coalesce(substring(pu.resume_url from '\.([A-Za-z0-9]+)(\?.*)?$'), 'pdf'))
            when 'pdf' then 'application/pdf'
            when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            when 'doc' then 'application/msword'
            else 'application/octet-stream'
          end,
          true,
          true
        from public.users pu
        join auth.users u on u.id = pu.id
        where substring(pu.resume_url from '/storage/v1/object/public/resumes/([^?#]+)') ~ ('^' || pu.id::text || '-[A-Za-z0-9._-]+$')
          and not exists (select 1 from public.resumes r where r.user_id = pu.id)
        on conflict (user_id, storage_path) do nothing
      $sql$;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Settings
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'UTC',
  tracking_enabled boolean not null default false,
  tracking_retention_days integer not null default 180 check (tracking_retention_days between 7 and 730),
  followup_delay_business_days integer not null default 5 check (followup_delay_business_days between 1 and 30),
  max_followups integer not null default 2 check (max_followups between 0 and 3),
  followup_autosend_enabled boolean not null default false,
  followup_autosend_daily_cap integer not null default 3 check (followup_autosend_daily_cap between 1 and 10),
  daily_send_limit integer not null default 25 check (daily_send_limit between 1 and 200),
  send_spacing_min_seconds integer not null default 30 check (send_spacing_min_seconds between 15 and 600),
  send_spacing_max_seconds integer not null default 90 check (send_spacing_max_seconds between 15 and 1800),
  sending_paused boolean not null default false,
  require_resume_attachment boolean not null default true,
  reply_scan_new_threads boolean not null default false,
  default_resume_id uuid references public.resumes (id) on delete set null,
  attachment_filename text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_spacing_order check (send_spacing_min_seconds <= send_spacing_max_seconds)
);

insert into public.user_settings (user_id, default_resume_id)
select u.id, (select r.id from public.resumes r where r.user_id = u.id and r.is_default limit 1)
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 4. Companies
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_user_normalized_key unique (user_id, normalized_name)
);

-- ---------------------------------------------------------------------
-- 5. Recruiters (v1 table, extended in place)
-- ---------------------------------------------------------------------
do $$
begin
  if pg_temp.col_exists('recruiters', 'hr_name') and not pg_temp.col_exists('recruiters', 'full_name') then
    alter table public.recruiters rename column hr_name to full_name;
  end if;
  if pg_temp.col_exists('recruiters', 'role') and not pg_temp.col_exists('recruiters', 'target_role') then
    alter table public.recruiters rename column role to target_role;
  end if;
  if pg_temp.col_exists('recruiters', 'status') and not pg_temp.col_exists('recruiters', 'legacy_status') then
    alter table public.recruiters rename column status to legacy_status;
  end if;
  -- v1 may have used enum types; normalise to text so 2.0 values fit.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recruiters' and column_name = 'source' and data_type = 'USER-DEFINED'
  ) then
    alter table public.recruiters alter column source type text using source::text;
  end if;
  if pg_temp.col_exists('recruiters', 'legacy_status') then
    alter table public.recruiters alter column legacy_status drop default;
    alter table public.recruiters alter column legacy_status drop not null;
  end if;
end
$$;

alter table public.recruiters add column if not exists full_name text;
alter table public.recruiters add column if not exists target_role text;
alter table public.recruiters add column if not exists legacy_status text;
alter table public.recruiters add column if not exists email_normalized text;
alter table public.recruiters add column if not exists company_id uuid references public.companies (id) on delete set null;
alter table public.recruiters add column if not exists title text;
alter table public.recruiters add column if not exists linkedin_url text;
alter table public.recruiters add column if not exists company_website text;
alter table public.recruiters add column if not exists source_url text;
alter table public.recruiters add column if not exists outreach_status text not null default 'new';
alter table public.recruiters add column if not exists email_verification text not null default 'provided';
alter table public.recruiters add column if not exists do_not_contact boolean not null default false;
alter table public.recruiters add column if not exists notes text;
alter table public.recruiters add column if not exists tags text[] not null default '{}';
alter table public.recruiters add column if not exists last_contacted_at timestamptz;
alter table public.recruiters add column if not exists last_reply_at timestamptz;
alter table public.recruiters add column if not exists merged_into_id uuid references public.recruiters (id) on delete set null;
alter table public.recruiters add column if not exists self_view_until timestamptz;
alter table public.recruiters add column if not exists updated_at timestamptz not null default now();
alter table public.recruiters alter column source set default 'manual';

-- Drop v1's case-sensitive unique (user_id, email) first: it is superseded by the
-- normalised key below, it would block re-adding a merged address, and trimming
-- whitespace-variant addresses (" a@x.io" next to "a@x.io") would violate it.
do $$
declare
  con record;
  idx record;
begin
  for con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.recruiters'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['email', 'user_id']
  loop
    execute format('alter table public.recruiters drop constraint %I', con.conname);
  end loop;
  for idx in
    select i.indexrelid::regclass::text as name
    from pg_index i
    where i.indrelid = 'public.recruiters'::regclass
      and i.indisunique
      and not i.indisprimary
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(i.indkey) k
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k
      ) = array['email', 'user_id']
  loop
    execute format('drop index %s', idx.name);
  end loop;
end
$$;

-- A v1 check on source (an inline column check gets the default name
-- recruiters_source_check) would reject 2.0's values, including the mapping below.
-- Drop it; 2.0's own check is added after the mapping.
do $$
declare
  con record;
begin
  for con in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.recruiters'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ '\msource\M'
  loop
    execute format('alter table public.recruiters drop constraint %I', con.conname);
  end loop;
end
$$;

-- 2.0 lets a recruiter be saved without a company (some v1 databases required one).
alter table public.recruiters alter column company drop not null;
update public.recruiters set created_at = now() where created_at is null;
alter table public.recruiters alter column created_at set default now();
alter table public.recruiters alter column created_at set not null;

-- Some v1 databases also have a `name` column next to `hr_name` (now full_name):
-- keep whichever one v1 filled in.
do $$
begin
  if pg_temp.col_exists('recruiters', 'name') and pg_temp.col_exists('recruiters', 'email_normalized') then
    execute $sql$
      update public.recruiters
      set full_name = btrim(name)
      where email_normalized is null and coalesce(btrim(full_name), '') = '' and coalesce(btrim(name), '') <> ''
    $sql$;
  end if;
end
$$;

-- Map v1 rows exactly once (rows not yet normalised are v1 rows).
update public.recruiters
set
  email = btrim(email),
  email_normalized = lower(btrim(email)),
  outreach_status = case when legacy_status::text = 'Sent' then 'contacted' else 'new' end,
  last_contacted_at = coalesce(last_contacted_at, case when legacy_status::text = 'Sent' then last_sent_at end),
  source = case
    when source is null or btrim(source) = '' then 'legacy'
    when source in ('manual', 'csv', 'browser_capture', 'company_site', 'linkedin', 'referral', 'legacy', 'other') then source
    else 'other'
  end
where email_normalized is null;

-- Case-variant duplicates (v1's unique key was case-sensitive): keep the oldest
-- row, mark the others as merged into it. No rows are deleted.
with ranked as (
  select
    id,
    first_value(id) over (partition by user_id, email_normalized order by created_at, id) as keeper
  from public.recruiters
  where merged_into_id is null
)
update public.recruiters r
set merged_into_id = ranked.keeper
from ranked
where r.id = ranked.id and ranked.id <> ranked.keeper;


alter table public.recruiters alter column email_normalized set not null;
create unique index if not exists recruiters_user_email_normalized_key
  on public.recruiters (user_id, email_normalized) where merged_into_id is null;
create index if not exists recruiters_user_created_idx on public.recruiters (user_id, created_at desc);
create index if not exists recruiters_user_last_contacted_idx on public.recruiters (user_id, last_contacted_at desc nulls last);
create index if not exists recruiters_user_company_idx on public.recruiters (user_id, company_id);
create index if not exists recruiters_tags_idx on public.recruiters using gin (tags);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recruiters_outreach_status_check') then
    alter table public.recruiters add constraint recruiters_outreach_status_check
      check (outreach_status in ('new', 'contacted', 'replied', 'interviewing', 'not_interested', 'bounced', 'do_not_contact'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recruiters_email_verification_check') then
    alter table public.recruiters add constraint recruiters_email_verification_check
      check (email_verification in ('provided', 'confirmed', 'unverified_guess'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recruiters_source_check') then
    alter table public.recruiters add constraint recruiters_source_check
      check (source in ('manual', 'csv', 'browser_capture', 'company_site', 'linkedin', 'referral', 'legacy', 'other'));
  end if;
  -- Ensure an ownership FK exists (v1 schema was created by hand). NOT VALID so
  -- pre-existing rows are not re-checked; new rows are enforced.
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.recruiters'::regclass and c.contype = 'f' and a.attname = 'user_id'
  ) then
    alter table public.recruiters add constraint recruiters_user_fk
      foreign key (user_id) references auth.users (id) on delete cascade not valid;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Opportunities, recruiter links, campaigns
-- ---------------------------------------------------------------------
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  company_name text not null,
  title text not null,
  role_category text not null default 'other',
  description text,
  job_url text,
  location text,
  employment_type text not null default 'unknown'
    check (employment_type in ('internship', 'full_time', 'graduate_program', 'contract', 'part_time', 'unknown')),
  required_skills text[] not null default '{}',
  experience_requirements text,
  discovered_at date not null default current_date,
  deadline date,
  status text not null default 'saved'
    check (status in ('saved', 'researching', 'ready', 'contacted', 'applied', 'interviewing', 'offer', 'rejected', 'closed')),
  source text not null default 'manual' check (source in ('manual', 'browser_capture', 'import', 'other')),
  source_url text,
  notes text,
  company_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists opportunities_user_status_idx on public.opportunities (user_id, status);
create index if not exists opportunities_user_created_idx on public.opportunities (user_id, created_at desc);

create table if not exists public.recruiter_opportunities (
  user_id uuid not null references auth.users (id) on delete cascade,
  recruiter_id uuid not null references public.recruiters (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recruiter_id, opportunity_id)
);
create index if not exists recruiter_opportunities_opp_idx on public.recruiter_opportunities (opportunity_id);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_user_name_key unique (user_id, name)
);

-- ---------------------------------------------------------------------
-- 7. Email messages (v1 email_history, renamed and extended in place)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.email_history') is not null and to_regclass('public.email_messages') is null then
    alter table public.email_history rename to email_messages;
  end if;
  if pg_temp.col_exists('email_messages', 'status') and not pg_temp.col_exists('email_messages', 'legacy_status') then
    alter table public.email_messages rename column status to legacy_status;
  end if;
  if pg_temp.col_exists('email_messages', 'opened_at') and not pg_temp.col_exists('email_messages', 'first_open_at') then
    alter table public.email_messages rename column opened_at to first_open_at;
  end if;
  if pg_temp.col_exists('email_messages', 'legacy_status') then
    alter table public.email_messages alter column legacy_status drop default;
    alter table public.email_messages alter column legacy_status drop not null;
  end if;
end
$$;

alter table public.email_messages add column if not exists legacy_status text;
alter table public.email_messages add column if not exists first_open_at timestamptz;
alter table public.email_messages add column if not exists opportunity_id uuid references public.opportunities (id) on delete set null;
alter table public.email_messages add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.email_messages add column if not exists resume_id uuid references public.resumes (id) on delete set null;
alter table public.email_messages add column if not exists follow_up_id uuid;
alter table public.email_messages add column if not exists parent_message_id uuid references public.email_messages (id) on delete set null;
alter table public.email_messages add column if not exists kind text not null default 'initial';
alter table public.email_messages add column if not exists recipient_email text;
alter table public.email_messages add column if not exists recipient_name text;
alter table public.email_messages add column if not exists body_text text not null default '';
alter table public.email_messages add column if not exists manual_role text;
alter table public.email_messages add column if not exists send_status text;
alter table public.email_messages add column if not exists scheduled_for timestamptz;
alter table public.email_messages add column if not exists queued_at timestamptz;
alter table public.email_messages add column if not exists sending_started_at timestamptz;
alter table public.email_messages add column if not exists failed_at timestamptz;
alter table public.email_messages add column if not exists error_code text;
alter table public.email_messages add column if not exists attempt_count integer not null default 0;
alter table public.email_messages add column if not exists idempotency_key text;
alter table public.email_messages add column if not exists rfc_message_id text;
alter table public.email_messages add column if not exists tracking_enabled boolean not null default false;
alter table public.email_messages add column if not exists tracking_token text;
alter table public.email_messages add column if not exists last_open_at timestamptz;
alter table public.email_messages add column if not exists open_event_count integer not null default 0;
alter table public.email_messages add column if not exists reply_status text not null default 'none';
alter table public.email_messages add column if not exists replied_at timestamptz;
alter table public.email_messages add column if not exists reply_from text;
alter table public.email_messages add column if not exists ai_generated boolean not null default false;
alter table public.email_messages add column if not exists generation_meta jsonb;
alter table public.email_messages add column if not exists attachment_snapshot jsonb;
alter table public.email_messages add column if not exists legacy boolean not null default false;
alter table public.email_messages add column if not exists created_at timestamptz not null default now();
alter table public.email_messages add column if not exists updated_at timestamptz not null default now();
alter table public.email_messages add column if not exists retry_count integer default 0;
alter table public.email_messages alter column sent_at drop default;

-- Ownership backfill for v1 rows inserted without user_id.
update public.email_messages m
set user_id = r.user_id
from public.recruiters r
where m.user_id is null and r.id = m.recruiter_id;

-- Re-point history of recruiters merged above to the surviving row.
update public.email_messages m
set recruiter_id = r.merged_into_id
from public.recruiters r
where m.recruiter_id = r.id and r.merged_into_id is not null;

-- Map v1 rows exactly once (v1 rows have send_status NULL).
update public.email_messages m
set
  legacy = true,
  kind = case when m.subject ilike 're:%' then 'follow_up' else 'initial' end,
  recipient_email = coalesce(m.recipient_email, r.email, ''),
  recipient_name = coalesce(m.recipient_name, r.full_name),
  send_status = case lower(coalesce(m.legacy_status::text, ''))
    when 'delivered' then 'sent'
    when 'sent' then 'sent'
    when 'failed' then 'failed'
    when 'abandoned' then 'failed'
    else 'unknown'
  end,
  failed_at = case when lower(coalesce(m.legacy_status::text, '')) in ('failed', 'abandoned') then m.sent_at end,
  error_code = case
    when lower(coalesce(m.legacy_status::text, '')) in ('failed', 'abandoned') then 'LEGACY_SEND_FAILED'
    when lower(coalesce(m.legacy_status::text, '')) not in ('delivered', 'sent') then 'LEGACY_OUTCOME_UNKNOWN'
  end,
  attempt_count = coalesce(m.retry_count, 0) + 1,
  -- v1 always embedded a pixel whose URL used this row's id.
  tracking_enabled = true,
  tracking_token = m.id::text,
  last_open_at = m.first_open_at,
  open_event_count = case when m.first_open_at is not null then 1 else 0 end,
  created_at = coalesce(m.sent_at, m.created_at)
from public.recruiters r
where m.send_status is null and r.id = m.recruiter_id;

-- Same mapping for v1 rows whose recruiter no longer exists.
update public.email_messages m
set
  legacy = true,
  kind = case when m.subject ilike 're:%' then 'follow_up' else 'initial' end,
  recipient_email = coalesce(m.recipient_email, ''),
  send_status = case lower(coalesce(m.legacy_status::text, ''))
    when 'delivered' then 'sent' when 'sent' then 'sent'
    when 'failed' then 'failed' when 'abandoned' then 'failed'
    else 'unknown'
  end,
  failed_at = case when lower(coalesce(m.legacy_status::text, '')) in ('failed', 'abandoned') then m.sent_at end,
  error_code = case
    when lower(coalesce(m.legacy_status::text, '')) in ('failed', 'abandoned') then 'LEGACY_SEND_FAILED'
    when lower(coalesce(m.legacy_status::text, '')) not in ('delivered', 'sent') then 'LEGACY_OUTCOME_UNKNOWN'
  end,
  attempt_count = coalesce(m.retry_count, 0) + 1,
  tracking_enabled = true,
  tracking_token = m.id::text,
  last_open_at = m.first_open_at,
  open_event_count = case when m.first_open_at is not null then 1 else 0 end,
  created_at = coalesce(m.sent_at, m.created_at)
where m.send_status is null;

-- Some v1 databases kept the sent body in `body`: show it as plain text.
do $$
begin
  if pg_temp.col_exists('email_messages', 'body') then
    execute $sql$
      update public.email_messages
      set body_text = btrim(
        replace(replace(replace(replace(replace(replace(
          regexp_replace(
            regexp_replace(body, '<\s*(br\s*/?|/p|/div|/li)\s*>', E'\n', 'gi'),
            '<[^>]*>', '', 'g'),
          '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&'), E' \n\r\t')
      where legacy and body_text = '' and coalesce(body, '') <> ''
    $sql$;
  end if;
end
$$;

-- v1 stamped sent_at when the attempt *started*; only keep it for real sends.
update public.email_messages
set sent_at = null
where legacy and send_status <> 'sent' and sent_at is not null;

alter table public.email_messages alter column send_status set default 'draft';
alter table public.email_messages alter column send_status set not null;
alter table public.email_messages alter column recipient_email set default '';
update public.email_messages set recipient_email = '' where recipient_email is null;
alter table public.email_messages alter column recipient_email set not null;
update public.email_messages set subject = '' where subject is null;
alter table public.email_messages alter column subject set default '';
alter table public.email_messages alter column subject set not null;

do $$
declare
  con record;
begin
  if not exists (select 1 from pg_constraint where conname = 'email_messages_send_status_check') then
    alter table public.email_messages add constraint email_messages_send_status_check
      check (send_status in ('draft', 'queued', 'sending', 'sent', 'failed', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_messages_reply_status_check') then
    alter table public.email_messages add constraint email_messages_reply_status_check
      check (reply_status in ('none', 'replied', 'auto_reply', 'bounced', 'needs_review'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_messages_kind_check') then
    alter table public.email_messages add constraint email_messages_kind_check check (kind in ('initial', 'follow_up'));
  end if;
  -- Deleting a recruiter must not delete the history of what was sent.
  for con in
    select c.conname, c.confdeltype
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.email_messages'::regclass and c.contype = 'f' and a.attname = 'recruiter_id'
  loop
    if con.confdeltype <> 'n' then
      execute format('alter table public.email_messages drop constraint %I', con.conname);
    end if;
  end loop;
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.email_messages'::regclass and c.contype = 'f' and a.attname = 'recruiter_id'
  ) then
    alter table public.email_messages add constraint email_messages_recruiter_fk
      foreign key (recruiter_id) references public.recruiters (id) on delete set null not valid;
  end if;
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.email_messages'::regclass and c.contype = 'f' and a.attname = 'user_id'
  ) then
    alter table public.email_messages add constraint email_messages_user_fk
      foreign key (user_id) references auth.users (id) on delete cascade not valid;
  end if;
end
$$;

create unique index if not exists email_messages_tracking_token_key on public.email_messages (tracking_token) where tracking_token is not null;
create unique index if not exists email_messages_user_idempotency_key on public.email_messages (user_id, idempotency_key) where idempotency_key is not null;
-- At most one message per recruiter can be in flight at a time.
create unique index if not exists email_messages_one_inflight_per_recruiter
  on public.email_messages (recruiter_id) where send_status in ('queued', 'sending') and recruiter_id is not null;
create index if not exists email_messages_user_created_idx on public.email_messages (user_id, created_at desc);
create index if not exists email_messages_user_sent_idx on public.email_messages (user_id, sent_at desc) where sent_at is not null;
create index if not exists email_messages_recruiter_idx on public.email_messages (recruiter_id);
create index if not exists email_messages_thread_idx on public.email_messages (user_id, gmail_thread_id) where gmail_thread_id is not null;
create index if not exists email_messages_queue_idx on public.email_messages (send_status, scheduled_for) where send_status = 'queued';

-- ---------------------------------------------------------------------
-- 8. Tracking events
-- ---------------------------------------------------------------------
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.email_messages (id) on delete cascade,
  event_type text not null default 'open' check (event_type in ('open')),
  occurred_at timestamptz not null default now(),
  classification text not null check (classification in ('open_detected', 'proxy', 'suspected_self', 'suspected_automated')),
  ua_family text not null default 'unknown',
  counted boolean not null default false,
  legacy boolean not null default false
);
create index if not exists email_events_message_idx on public.email_events (message_id, occurred_at desc);
create index if not exists email_events_user_idx on public.email_events (user_id, occurred_at desc);

insert into public.email_events (user_id, message_id, occurred_at, classification, ua_family, counted, legacy)
select m.user_id, m.id, m.first_open_at, 'open_detected', 'legacy', true, true
from public.email_messages m
where m.legacy and m.first_open_at is not null and m.user_id is not null
  and exists (select 1 from auth.users u where u.id = m.user_id)
  and not exists (select 1 from public.email_events e where e.message_id = m.id and e.legacy);

-- ---------------------------------------------------------------------
-- 9. Gmail threads and the messages seen in them during sync
-- ---------------------------------------------------------------------
create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  gmail_thread_id text not null,
  recruiter_id uuid references public.recruiters (id) on delete set null,
  first_message_id uuid references public.email_messages (id) on delete set null,
  last_activity_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_threads_user_thread_key unique (user_id, gmail_thread_id)
);

insert into public.email_threads (user_id, gmail_thread_id, recruiter_id, first_message_id, last_activity_at)
select distinct on (m.user_id, m.gmail_thread_id)
  m.user_id, m.gmail_thread_id, m.recruiter_id, m.id, m.sent_at
from public.email_messages m
where m.gmail_thread_id is not null and m.user_id is not null and m.send_status = 'sent'
  and exists (select 1 from auth.users u where u.id = m.user_id)
order by m.user_id, m.gmail_thread_id, m.sent_at asc nulls last
on conflict (user_id, gmail_thread_id) do nothing;

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  gmail_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_email text not null,
  from_name text,
  subject text,
  received_at timestamptz not null,
  classification text not null
    check (classification in ('reply', 'possible_reply', 'auto_reply', 'bounce', 'own_message', 'other_sender')),
  matched_message_id uuid references public.email_messages (id) on delete set null,
  needs_review boolean not null default false,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint thread_messages_user_gmail_key unique (user_id, gmail_message_id)
);
create index if not exists thread_messages_review_idx on public.thread_messages (user_id) where needs_review;

-- ---------------------------------------------------------------------
-- 10. Follow-up reminders
-- ---------------------------------------------------------------------
create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recruiter_id uuid not null references public.recruiters (id) on delete cascade,
  original_message_id uuid not null references public.email_messages (id) on delete cascade,
  previous_message_id uuid not null references public.email_messages (id) on delete cascade,
  step smallint not null check (step between 1 and 3),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'dismissed', 'cancelled')),
  auto_send boolean not null default false,
  cancel_reason text,
  completed_message_id uuid references public.email_messages (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_ups_original_step_key unique (original_message_id, step)
);
create index if not exists follow_ups_user_status_due_idx on public.follow_ups (user_id, status, due_at);
create index if not exists follow_ups_recruiter_idx on public.follow_ups (recruiter_id) where status = 'pending';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'email_messages_follow_up_fk') then
    alter table public.email_messages add constraint email_messages_follow_up_fk
      foreign key (follow_up_id) references public.follow_ups (id) on delete set null;
  end if;
end
$$;
-- A reminder can produce at most one live/sent follow-up message.
create unique index if not exists email_messages_one_message_per_follow_up
  on public.email_messages (follow_up_id)
  where follow_up_id is not null and send_status in ('queued', 'sending', 'sent', 'unknown');

-- v1 followed up automatically after 5 days (max 2). Preserve the intent as
-- *reminders* for recent v1 conversations: one pending reminder per contacted
-- recruiter whose latest send was within the last 90 days.
with latest as (
  select distinct on (m.recruiter_id)
    m.recruiter_id, m.user_id, m.id as previous_id, m.sent_at
  from public.email_messages m
  where m.legacy and m.send_status = 'sent' and m.recruiter_id is not null and m.sent_at is not null
  order by m.recruiter_id, m.sent_at desc
),
first_sent as (
  select distinct on (m.recruiter_id) m.recruiter_id, m.id as original_id
  from public.email_messages m
  where m.legacy and m.send_status = 'sent' and m.recruiter_id is not null
  order by m.recruiter_id, m.sent_at asc nulls last
)
insert into public.follow_ups (user_id, recruiter_id, original_message_id, previous_message_id, step, due_at)
select l.user_id, l.recruiter_id, f.original_id, l.previous_id, coalesce(r.followup_count, 0) + 1, l.sent_at + interval '7 days'
from latest l
join first_sent f on f.recruiter_id = l.recruiter_id
join public.recruiters r on r.id = l.recruiter_id
where coalesce(r.followup_count, 0) < 2
  and r.outreach_status = 'contacted'
  and l.sent_at > now() - interval '90 days'
  and l.user_id is not null
  and exists (select 1 from auth.users u where u.id = l.user_id)
  and not exists (select 1 from public.follow_ups fu where fu.recruiter_id = l.recruiter_id)
on conflict (original_message_id, step) do nothing;

-- ---------------------------------------------------------------------
-- 11. Activity log
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  summary text not null,
  recruiter_id uuid references public.recruiters (id) on delete set null,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  message_id uuid references public.email_messages (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists activity_log_user_time_idx on public.activity_log (user_id, occurred_at desc);

do $$
begin
  if not exists (select 1 from public.activity_log where metadata ->> 'source' = 'v1_migration') then
    insert into public.activity_log (user_id, type, summary, recruiter_id, metadata, occurred_at)
    select r.user_id, 'recruiter_added',
      'Added ' || coalesce(nullif(r.full_name, ''), r.email) || coalesce(' (' || nullif(r.company, '') || ')', ''),
      r.id, '{"source": "v1_migration"}'::jsonb, r.created_at
    from public.recruiters r
    where r.merged_into_id is null and exists (select 1 from auth.users u where u.id = r.user_id);

    insert into public.activity_log (user_id, type, summary, recruiter_id, message_id, metadata, occurred_at)
    select m.user_id,
      case m.send_status when 'sent' then 'email_sent' when 'failed' then 'email_failed' else 'email_send_unknown' end,
      case m.send_status when 'sent' then 'Sent' when 'failed' then 'Failed to send' else 'Send outcome unknown for' end
        || ' "' || left(m.subject, 120) || '" to ' || m.recipient_email,
      m.recruiter_id, m.id, '{"source": "v1_migration"}'::jsonb, coalesce(m.sent_at, m.failed_at, m.created_at)
    from public.email_messages m
    where m.legacy and m.user_id is not null and exists (select 1 from auth.users u where u.id = m.user_id);

    insert into public.activity_log (user_id, type, summary, recruiter_id, message_id, metadata, occurred_at)
    select m.user_id, 'open_detected', 'Open detected for "' || left(m.subject, 120) || '"',
      m.recruiter_id, m.id, '{"source": "v1_migration"}'::jsonb, m.first_open_at
    from public.email_messages m
    where m.legacy and m.first_open_at is not null and m.user_id is not null and exists (select 1 from auth.users u where u.id = m.user_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 12. OAuth connections (encrypted tokens) and single-use OAuth states
-- ---------------------------------------------------------------------
create table if not exists public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'google_gmail' check (provider in ('google_gmail')),
  account_email text not null,
  scopes text[] not null default '{}',
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'revoked')),
  last_error text,
  history_id text,
  last_sync_at timestamptz,
  sync_error text,
  imported_from_v1 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_connections_user_provider_key unique (user_id, provider)
);

create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_verifier text not null,
  return_to text not null default 'dashboard',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- v1 plaintext tokens stay in user_smtp_settings only until the API encrypts
-- them into oauth_connections on first boot (needs TOKEN_ENCRYPTION_KEY),
-- after which the plaintext columns are cleared.
alter table public.user_smtp_settings add column if not exists migrated_at timestamptz;

-- ---------------------------------------------------------------------
-- 13. Templates (v1 table kept as-is, plus timestamps)
-- ---------------------------------------------------------------------
alter table public.email_templates add column if not exists created_at timestamptz not null default now();
alter table public.email_templates add column if not exists updated_at timestamptz not null default now();
-- 2.0 saves templates with ON CONFLICT (user_id, type). If a v1 database lacks that
-- unique key, keep the most recently updated template of each type and add it.
do $$
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.email_templates'::regclass and i.indisunique and i.indpred is null
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(i.indkey) k join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k
      ) = array['type', 'user_id']
  ) then
    delete from public.email_templates t
    using public.email_templates newer
    where newer.user_id = t.user_id and newer.type = t.type and newer.id <> t.id
      and (coalesce(newer.updated_at, newer.created_at, 'epoch') > coalesce(t.updated_at, t.created_at, 'epoch')
           or (coalesce(newer.updated_at, newer.created_at, 'epoch') = coalesce(t.updated_at, t.created_at, 'epoch') and newer.id > t.id));
    create unique index email_templates_user_type_key on public.email_templates (user_id, type);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 14. updated_at triggers
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_settings', 'resumes', 'companies', 'recruiters', 'opportunities',
    'campaigns', 'email_messages', 'email_threads', 'follow_ups', 'oauth_connections', 'email_templates'
  ]
  loop
    execute format('drop trigger if exists autoreach_touch_updated_at on public.%I', t);
    execute format(
      'create trigger autoreach_touch_updated_at before update on public.%I for each row execute function public.autoreach_touch_updated_at()',
      t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 15. Row Level Security and privileges
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  public_role text;
begin
  foreach t in array array[
    'profiles', 'user_settings', 'resumes', 'companies', 'recruiters', 'opportunities',
    'recruiter_opportunities', 'campaigns', 'email_messages', 'email_events', 'email_threads',
    'thread_messages', 'follow_ups', 'activity_log', 'oauth_connections', 'oauth_states',
    'email_templates', 'user_smtp_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    -- Supabase exposes `public` through PostgREST to these roles; AutoReach
    -- tables are reachable only through the API.
    foreach public_role in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = public_role) then
        execute format('revoke all on public.%I from %I', t, public_role);
      end if;
    end loop;
    execute format('grant select, insert, update, delete on public.%I to autoreach_app', t);
    execute format('drop policy if exists autoreach_owner on public.%I', t);
    execute format(
      'create policy autoreach_owner on public.%I for all to autoreach_app using (user_id = public.app_current_user_id()) with check (user_id = public.app_current_user_id())',
      t
    );
  end loop;
end
$$;

-- The older v1 public.users table (profile and résumé link) is no longer used. It is
-- kept for reference but closed to Supabase's public API roles, like every other table.
do $$
declare
  public_role text;
begin
  if to_regclass('public.users') is not null then
    foreach public_role in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = public_role) then
        execute format('revoke all on public.users from %I', public_role);
      end if;
    end loop;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 16. Storage: résumés must not be publicly readable
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('resumes', 'resumes', false)
      on conflict (id) do update set public = false
    $sql$;
  end if;
end
$$;
