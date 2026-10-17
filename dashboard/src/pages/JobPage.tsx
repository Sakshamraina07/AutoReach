import {
  EMPLOYMENT_TYPE_LABELS,
  FIT_VERDICT_LABELS,
  type FitVerdict,
  type JobAnalysis,
  type JobAnalysisResult,
  type JobFit,
  type JobPasteResult,
  type JobView,
  type PreparedEmail,
  type RecruiterSummary,
} from '@autoreach/shared';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, Check, Circle, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { JobEmailCard } from '../components/JobEmailCard';
import { Button, Dialog, EmptyState, ErrorState, Field, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate, plural } from '../lib/format';
import { keys, useInvalidate, useJob, useMe, useSuggestedRecruiters } from '../lib/queries';

const VERDICT_CLASS: Record<FitVerdict, string> = {
  strong: 'text-replied',
  good: 'text-replied',
  stretch: 'text-opened',
  long_shot: 'text-warn',
};

/** A fresh page per job, so nothing carries over when going back and forth between two jobs. */
export default function JobPageRoute() {
  const { id = '' } = useParams();
  return <JobPage key={id} id={id} />;
}

function JobPage({ id }: { id: string }) {
  const job = useJob(id);
  const me = useMe();
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);

  // Emails are written one at a time, in the order people were added, so the AI
  // provider's rate limit isn't hit and each email can open differently from the last.
  const [working, setWorking] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Record<string, PreparedEmail>>({});
  const [failed, setFailed] = useState<Record<string, unknown>>({});
  // People whose email this page already asked for; they aren't written again automatically.
  const [attempted, setAttempted] = useState<ReadonlySet<string>>(() => new Set());

  const prepare = useCallback(
    async (recruiterId: string, opts: { regenerate?: boolean; use_template?: boolean } = {}) => {
      setAttempted((a) => new Set(a).add(recruiterId));
      setWorking(recruiterId);
      setFailed(({ [recruiterId]: _drop, ...rest }) => rest);
      // Forget the last version this page wrote: if this attempt fails, the card shows what the server has.
      setPrepared(({ [recruiterId]: _old, ...rest }) => rest);
      try {
        const res = await api<PreparedEmail>(`/api/jobs/${id}/recruiters/${recruiterId}/email`, { method: 'POST', body: { regenerate: !!opts.regenerate, use_template: !!opts.use_template } });
        setPrepared((p) => ({ ...p, [recruiterId]: res }));
        await qc.invalidateQueries({ queryKey: keys.job(id) });
      } catch (e) {
        setFailed((f) => ({ ...f, [recruiterId]: e }));
      } finally {
        setWorking(null);
      }
    },
    [id, qc],
  );

  const view = job.data;
  const next = view?.recruiters.find((r) => !view.emails[r.id] && !r.do_not_contact && r.outreach_status !== 'do_not_contact' && !attempted.has(r.id));
  useEffect(() => {
    if (!working && next && view?.analysis) void prepare(next.id);
  }, [working, next, view?.analysis, prepare]);

  if (job.isError) return <ErrorState error={job.error} onRetry={() => job.refetch()} />;
  if (!view) return <Spinner label="Loading the job" />;
  const o = view.opportunity;

  return (
    <>
      <Link to="/opportunities" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Jobs
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl">{o.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {o.company}
            {o.location ? `, ${o.location}` : ''}
            {o.employment_type !== 'unknown' ? `. ${EMPLOYMENT_TYPE_LABELS[o.employment_type]}` : ''}
            {o.deadline ? `. Apply by ${fmtDate(o.deadline)}` : ''}
            {typeof o.career_ops_score === 'number' ? `. career-ops score ${o.career_ops_score.toFixed(1)}/5` : ''}
            {o.job_url && (
              <>
                {'. '}
                <a href={o.job_url} target="_blank" rel="noreferrer">
                  Open posting
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing(true)}>Edit company or role</Button>
          <Link to={`/opportunities/${o.id}`} className="inline-flex h-8 items-center rounded border border-line px-3 text-sm text-muted hover:text-ink">
            Status and notes
          </Link>
        </div>
      </div>

      {!view.analysis ? (
        <ReadSavedJob view={view} onDone={() => invalidate()} />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          <JobReading analysis={view.analysis} fit={view.fit} aiModel={me.data?.ai.model ?? null} />
          <section aria-labelledby="people-heading" className="min-w-0 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="people-heading" className="text-lg">
                People to email
              </h2>
              {view.recruiters.length > 0 && <span className="num text-sm text-muted">{plural(view.recruiters.length, 'person', 'people')}</span>}
            </div>
            <AddPeople jobId={id} company={o.company} empty={view.recruiters.length === 0} />
            {view.recruiters.map((r) => (
              <JobEmailCard
                key={r.id}
                recruiter={r}
                summary={view.emails[r.id] ?? null}
                prepared={prepared[r.id] ?? null}
                working={working === r.id}
                queued={!view.emails[r.id] && !!working && working !== r.id && !attempted.has(r.id)}
                error={failed[r.id] ?? null}
                onWrite={(opts) => void prepare(r.id, opts)}
                busyElsewhere={!!working && working !== r.id}
              />
            ))}
          </section>
        </div>
      )}

      {editing && <EditJobDialog view={view} onClose={() => setEditing(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The reading of the job description                                  */
/* ------------------------------------------------------------------ */

function SkillRow({ skill, have }: { skill: string; have: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {have ? <Check className="h-3.5 w-3.5 shrink-0 text-replied" aria-label="On your profile" /> : <Circle className="h-3 w-3 shrink-0 text-faint" aria-label="Not on your profile" />}
      <span className={have ? 'text-ink' : 'text-muted'}>{skill}</span>
    </li>
  );
}

export function JobReading({ analysis: a, fit, aiModel }: { analysis: JobAnalysis; fit: JobFit | null; aiModel: string | null }) {
  const matchedMust = new Set(fit?.matched_must ?? []);
  const matchedNice = new Set(fit?.matched_nice ?? []);
  return (
    <aside className="panel divide-y divide-line xl:sticky xl:top-4">
      {fit && (
        <div className="space-y-2 p-4">
          <p className={clsx('text-xl font-semibold', VERDICT_CLASS[fit.verdict])}>{FIT_VERDICT_LABELS[fit.verdict]}</p>
          <p className="text-sm text-muted">{fit.summary}</p>
          {fit.warnings.length > 0 && (
            <ul className="space-y-1 text-sm text-warn">
              {fit.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {a.priorities.length > 0 && (
        <div className="space-y-3 p-4">
          <h3 className="text-sm">What the team cares about</h3>
          {a.priorities.map((p) => (
            <figure key={p.point} className="space-y-1">
              <figcaption className="text-sm text-ink">{p.point}</figcaption>
              <blockquote className="border-l-2 border-line pl-3 text-sm italic text-muted">{p.evidence}</blockquote>
            </figure>
          ))}
        </div>
      )}

      {fit && fit.projects.length > 0 && (
        <div className="space-y-2 p-4">
          <h3 className="text-sm">Projects the emails lead with</h3>
          <ul className="space-y-1 text-sm">
            {fit.projects.map((p) => (
              <li key={p.name}>
                <span className="text-ink">{p.name}</span> <span className="text-muted">shows {p.matched.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.must_have.length > 0 && (
        <div className="space-y-2 p-4">
          <h3 className="text-sm">Must-have skills</h3>
          <ul className="space-y-1">
            {a.must_have.map((s) => (
              <SkillRow key={s} skill={s} have={matchedMust.has(s)} />
            ))}
          </ul>
          {fit && fit.missing_must.length > 0 && (
            <p className="text-xs text-faint">
              Emails never claim a skill you haven't listed. If you do have one, <Link to="/settings?section=profile">add it to your profile</Link>.
            </p>
          )}
        </div>
      )}

      {a.nice_to_have.length > 0 && (
        <div className="space-y-2 p-4">
          <h3 className="text-sm">Nice to have</h3>
          <ul className="space-y-1">
            {a.nice_to_have.map((s) => (
              <SkillRow key={s} skill={s} have={matchedNice.has(s)} />
            ))}
          </ul>
        </div>
      )}

      {(a.experience.text || a.responsibilities.length > 0) && (
        <div className="space-y-2 p-4 text-sm">
          {a.experience.text && (
            <p>
              <span className="text-muted">Experience: </span>
              {a.experience.text}
              {a.experience.fresher_friendly ? <span className="text-replied"> Open to freshers.</span> : null}
            </p>
          )}
          {a.responsibilities.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted hover:text-ink">What you'd do ({a.responsibilities.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {a.responsibilities.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="space-y-1 p-4 text-xs text-faint">
        <p>{a.source === 'ai' ? `Read by ${a.model ?? aiModel ?? 'AI'}. Every skill and quote above was checked against the text you pasted.` : 'Plain keyword reading of the text you pasted.'}</p>
        {a.notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Adding people                                                       */
/* ------------------------------------------------------------------ */

function AddPeople({ jobId, company, empty }: { jobId: string; company: string; empty: boolean }) {
  const qc = useQueryClient();
  const suggested = useSuggestedRecruiters(jobId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<JobPasteResult | null>(null);

  async function add(body: { text?: string; recruiter_ids?: string[] }, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const r = await api<JobPasteResult>(`/api/jobs/${jobId}/recruiters`, { method: 'POST', body });
      if (body.text) {
        setResult(r);
        if (r.added + r.already_saved > 0) setText('');
      }
      qc.setQueryData(keys.job(jobId), (({ added: _a, already_saved: _s, skipped: _k, ...view }) => view)(r) as JobView);
      await qc.invalidateQueries({ queryKey: keys.suggested(jobId) });
      await qc.invalidateQueries({ queryKey: ['recruiters'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const others = suggested.data ?? [];
  return (
    <div className="panel space-y-3 p-4">
      <Field
        label={empty ? `Who should get an email at ${company}?` : 'Add more people'}
        htmlFor="people-paste"
        hint="One person per line, like “Priya Nair <priya@company.com>” or “Name, Title, email”. A CSV with an email column works too. Only add addresses you found or were given."
      >
        <textarea id="people-paste" rows={empty ? 4 : 2} className="field font-[inherit]" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Priya Nair, Campus Recruiter, priya.nair@company.com\nOmar Haddad <omar@company.com>'} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={empty ? 'primary' : 'secondary'} icon={<UserPlus className="h-4 w-4" />} loading={busy === 'paste'} disabled={!text.trim() || !!busy} onClick={() => add({ text }, 'paste')}>
          Add and write emails
        </Button>
        {result && (
          <p className="text-xs text-muted" role="status">
            {[
              result.added ? `Added ${plural(result.added, 'person', 'people')}.` : null,
              result.already_saved ? `${plural(result.already_saved, 'person was', 'people were')} already saved and ${result.already_saved === 1 ? 'is' : 'are'} now on this job.` : null,
              result.skipped.length ? `Skipped ${plural(result.skipped.length, 'line')} without an email address: ${result.skipped.slice(0, 3).map((s) => `“${s.slice(0, 40)}”`).join(', ')}${result.skipped.length > 3 ? '…' : ''}` : null,
              !result.added && !result.already_saved && !result.skipped.length ? 'No email addresses found.' : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}
      </div>
      {others.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-muted">Saved contacts at {company}</p>
          <ul className="flex flex-wrap gap-2">
            {others.map((r: RecruiterSummary) => (
              <li key={r.id}>
                <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} loading={busy === r.id} disabled={!!busy || r.do_not_contact} onClick={() => add({ recruiter_ids: [r.id] }, r.id)} title={r.email}>
                  {r.full_name ?? r.email}
                  {r.title ? <span className="font-normal text-muted">, {r.title}</span> : null}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error ? <ErrorState error={error} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Jobs saved before they were read (e.g. from the extension)          */
/* ------------------------------------------------------------------ */

function ReadSavedJob({ view, onDone }: { view: JobView; onDone: () => void }) {
  const o = view.opportunity;
  const [text, setText] = useState(o.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<JobAnalysisResult>('/api/jobs/analyze', { method: 'POST', body: { text } });
      await api('/api/jobs', {
        method: 'POST',
        body: { text, url: o.job_url, opportunity_id: o.id, analysis: { ...r.analysis, company: o.company, title: o.title, location: o.location ?? r.analysis.location } },
      });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <EmptyState title="This job hasn't been read yet">
        {o.description ? 'AutoReach has the description you saved. Read it to see your fit and write emails.' : 'Paste the job description to see your fit and write emails.'}
      </EmptyState>
      <Field label="Job description" htmlFor="saved-jd">
        <textarea id="saved-jd" rows={12} className="field leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {error ? <ErrorState error={error} /> : null}
      <Button variant="primary" loading={busy} disabled={text.trim().length < 80} onClick={read}>
        Read job description
      </Button>
    </div>
  );
}

function EditJobDialog({ view, onClose }: { view: JobView; onClose: () => void }) {
  const o = view.opportunity;
  const invalidate = useInvalidate();
  const toast = useToast();
  const [company, setCompany] = useState(o.company);
  const [title, setTitle] = useState(o.title);
  const [location, setLocation] = useState(o.location ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/opportunities/${o.id}`, { method: 'PATCH', body: { company: company.trim(), title: title.trim(), location: location.trim() || null } });
      await invalidate();
      toast.success('Job updated. Drafts written before this keep their wording; use “Write again” to refresh one.');
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Edit company or role"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!company.trim() || !title.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Company" htmlFor="edit-company">
          <input id="edit-company" className="field" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="edit-title">
          <input id="edit-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Location" htmlFor="edit-location">
          <input id="edit-location" className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        {error ? <ErrorState error={error} /> : null}
      </div>
    </Dialog>
  );
}
