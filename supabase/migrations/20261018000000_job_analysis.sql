-- The structured reading of a pasted job description that the candidate confirmed
-- (skills, experience, what the team cares about with quotes from the JD).
alter table public.opportunities add column if not exists analysis jsonb;
