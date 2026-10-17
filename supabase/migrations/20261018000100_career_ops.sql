-- Jobs brought in from a local career-ops folder: which evaluation report they came
-- from (so the same report isn't imported twice) and career-ops' 0–5 score.
alter table public.opportunities add column if not exists career_ops_report integer;
alter table public.opportunities add column if not exists career_ops_score numeric(3, 1);
create unique index if not exists opportunities_career_ops_report_key
  on public.opportunities (user_id, career_ops_report) where career_ops_report is not null;
