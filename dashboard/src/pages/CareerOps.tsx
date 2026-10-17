import type { CareerOpsJob, CareerOpsOverview, JobView } from '@autoreach/shared';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Spinner, useToast } from '../components/ui';
import { api, ApiError, download } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useInvalidate } from '../lib/queries';

/** Statuses in career-ops' tracker that mean "not going for this one". */
const CLOSED = /^(skip|discarded|rejected|hired|descartado|rechazado)$/i;
const GOOD_SCORE = 4;

const SOURCE: Record<CareerOpsJob['description'], string> = {
  report: 'Description saved in the report',
  saved: 'Description saved by career-ops',
  link: 'Description read from the job board',
  none: 'No description saved',
};

/**
 * Jobs career-ops found and scored on this computer. The good ones become AutoReach jobs
 * in one click: the job page reads the description, shows the fit and writes the emails.
 */
export default function CareerOps() {
  const q = useQuery({ queryKey: ['career-ops'], queryFn: () => api<CareerOpsOverview>('/api/career-ops') });
  const [showAll, setShowAll] = useState(false);

  const jobs = q.data?.jobs ?? [];
  const shown = showAll ? jobs : jobs.filter((j) => (j.score === null || j.score >= GOOD_SCORE) && !(j.status && CLOSED.test(j.status)));
  const ordered = [...shown].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.report_number - a.report_number);
  const hidden = jobs.length - shown.length;

  return (
    <>
      <PageHeader
        title="From career-ops"
        description="Jobs career-ops found and scored on this computer, best first. Write emails turns one into an AutoReach job: AutoReach reads the description again, shows your fit and writes an email for each person you add."
        actions={
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={q.isFetching} onClick={() => q.refetch()}>
            Check for new reports
          </Button>
        }
      />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Spinner label="Reading career-ops reports" />
      ) : (
        <div className="space-y-6">
          <section className="panel">
            {jobs.length === 0 ? (
              <EmptyState title="No career-ops reports yet">
                Run a scan and an evaluation in career-ops. Each evaluation writes a report into its <code>reports</code> folder, and it shows up here.
              </EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {ordered.map((j) => (
                    <JobRow key={j.report_number} job={j} />
                  ))}
                </ul>
                {ordered.length === 0 && <p className="px-4 py-6 text-sm text-muted">No jobs scored {GOOD_SCORE} or higher yet.</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
                  <span className="num">
                    {ordered.length} of {jobs.length} evaluations
                    {!showAll && hidden > 0 ? `; ${hidden} scored below ${GOOD_SCORE.toFixed(1)} or marked skip/rejected are hidden` : ''}
                  </span>
                  {hidden > 0 || showAll ? (
                    <button type="button" className="text-accent" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? `Hide jobs below ${GOOD_SCORE.toFixed(1)}` : 'Show all'}
                    </button>
                  ) : null}
                </div>
              </>
            )}
            {q.data.unreadable.length > 0 && (
              <p className="border-t border-line px-4 py-2.5 text-xs text-warn">
                Couldn't read {q.data.unreadable.length === 1 ? 'this report' : 'these reports'}: {q.data.unreadable.join(', ')}
              </p>
            )}
          </section>

          <CvCard exists={q.data.cv_exists} onWritten={() => q.refetch()} />
        </div>
      )}
    </>
  );
}

function ScoreMark({ score }: { score: number | null }) {
  if (score === null) return <span className="num w-12 shrink-0 text-lg text-faint">–</span>;
  return (
    <span className={clsx('num w-12 shrink-0 text-lg font-semibold', score >= 4.5 ? 'text-replied' : score >= GOOD_SCORE ? 'text-ink' : 'text-muted')} title="career-ops score out of 5">
      {score.toFixed(1)}
    </span>
  );
}

function JobRow({ job: j }: { job: CareerOpsJob }) {
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Set when the import found no usable description: offer pasting it instead.
  const [needsPaste, setNeedsPaste] = useState<string | null>(null);

  async function writeEmails() {
    setBusy(true);
    try {
      const view = await api<JobView>(`/api/career-ops/reports/${j.report_number}/import`, { method: 'POST' });
      await invalidate(['career-ops']);
      navigate(`/jobs/${view.opportunity.id}`);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'CAREER_OPS_NO_DESCRIPTION' || e.code === 'CAREER_OPS_UNREADABLE' || e.code === 'CAREER_OPS_MISSING_NAME')) setNeedsPaste(e.message);
      else toast.error(e);
      setBusy(false);
    }
  }

  const pasteLink = `/jobs/new?${new URLSearchParams({ ...(j.url ? { url: j.url } : {}), ...(j.company ? { company: j.company } : {}), ...(j.role ? { role: j.role } : {}) }).toString()}`;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <ScoreMark score={j.score} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ink">{j.role ?? '(role not named)'}</p>
        <p className="truncate text-xs text-muted">
          {j.company ?? '(company not named)'}
          {j.date ? `, evaluated ${fmtDate(j.date)}` : ''}. {SOURCE[j.description]}.
          {j.url ? (
            <>
              {' '}
              <a href={j.url} target="_blank" rel="noreferrer">
                Posting
              </a>
            </>
          ) : null}
        </p>
        {needsPaste && <p className="mt-1 text-xs text-warn">{needsPaste}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {j.status && <Badge tone={CLOSED.test(j.status) ? 'neutral' : 'info'}>{j.status}</Badge>}
        {j.legitimacy && !/^high/i.test(j.legitimacy) && <Badge tone="warning">{j.legitimacy}</Badge>}
        {j.opportunity_id ? (
          <Link to={`/jobs/${j.opportunity_id}`} className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs text-ink hover:border-faint">
            Open job
          </Link>
        ) : j.description === 'none' || needsPaste ? (
          <Link to={pasteLink} className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs text-ink hover:border-faint">
            Paste description
          </Link>
        ) : (
          <Button size="sm" variant="primary" loading={busy} onClick={writeEmails}>
            Write emails
          </Button>
        )}
      </div>
    </li>
  );
}

function CvCard({ exists, onWritten }: { exists: boolean; onWritten: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel space-y-2 p-4 text-sm">
      <h2 className="flex items-center gap-2 text-sm">
        <FileText className="h-4 w-4 text-muted" aria-hidden /> Your CV for career-ops
      </h2>
      {exists ? (
        <p className="text-muted">career-ops already has a cv.md. AutoReach never replaces it. To compare it with your AutoReach profile, download the profile version.</p>
      ) : (
        <p className="text-muted">career-ops scores jobs against a cv.md file. AutoReach can create it from the profile you already filled in, using only what your profile says.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!exists && (
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ path: string }>('/api/career-ops/cv.md', { method: 'POST' });
                toast.success(`Saved ${r.path}`);
                onWritten();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create cv.md in career-ops
          </Button>
        )}
        <Button icon={<Download className="h-4 w-4" />} onClick={() => download('/api/career-ops/cv.md', 'cv.md').catch((e: unknown) => toast.error(e))}>
          Download cv.md
        </Button>
      </div>
    </section>
  );
}
