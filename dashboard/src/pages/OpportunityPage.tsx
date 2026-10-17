import { EMPLOYMENT_TYPE_LABELS, OPPORTUNITY_STATUS_LABELS, OPPORTUNITY_STATUSES, OUTREACH_STATUS_LABELS, ROLE_CATEGORY_LABELS } from '@autoreach/shared';
import { ArrowLeft, Mail, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { OpportunityDialog } from '../components/OpportunityForm';
import { AddRecruiterDialog } from '../components/RecruiterForm';
import { StatusTrack } from '../components/StatusTrack';
import { Badge, Button, Confirm, Dialog, ErrorState, SectionTitle, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useInvalidate, useOpportunity, useRecruiters } from '../lib/queries';
import { STATUS_TONE } from './Recruiters';

export default function OpportunityPage() {
  const { id = '' } = useParams();
  const q = useOpportunity(id);
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const toast = useToast();
  const o = q.data;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!o) return <Spinner />;

  async function unlink(recruiterId: string) {
    try {
      await api(`/api/recruiters/${recruiterId}/opportunities/${id}`, { method: 'DELETE' });
      await invalidate();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <Link to={`/jobs/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Emails for this job
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl">{o.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {o.company}
            {o.location ? `, ${o.location}` : ''}. {EMPLOYMENT_TYPE_LABELS[o.employment_type]}, {ROLE_CATEGORY_LABELS[o.role_category].toLowerCase()} role.
            {o.job_url && (
              <>
                {' '}
                <a href={o.job_url} target="_blank" rel="noreferrer">
                  Open posting
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Status"
            className="field h-8 w-auto"
            value={o.status}
            onChange={async (e) => {
              try {
                await api(`/api/opportunities/${id}`, { method: 'PATCH', body: { status: e.target.value } });
                await invalidate();
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            {OPPORTUNITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {OPPORTUNITY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <Button onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <section className="panel">
            <SectionTitle
              actions={
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setLinking(true)}>
                    Link existing
                  </Button>
                  <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
                    New recruiter
                  </Button>
                </div>
              }
            >
              Recruiters for this role
            </SectionTitle>
            {o.recruiters.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No contact yet. Add the recruiter or hiring manager you plan to email about this role.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {o.recruiters.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link to={`/recruiters?open=${r.id}`} className="block truncate text-sm text-ink">
                        {r.full_name ?? r.email}
                      </Link>
                      <p className="truncate text-2xs text-faint">
                        {r.title ? `${r.title}, ` : ''}
                        {r.email}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[r.outreach_status]}>{OUTREACH_STATUS_LABELS[r.outreach_status]}</Badge>
                    <Button size="sm" variant="primary" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => navigate(`/outreach/new?recruiter=${r.id}&opportunity=${o.id}`)}>
                      Write email
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => unlink(r.id)}>
                      Unlink
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <SectionTitle>Emails about this role</SectionTitle>
            {o.messages.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Nothing sent yet.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {o.messages.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link to={`/outreach/${m.id}`} className="block truncate text-sm text-ink">
                        {m.subject || '(no subject)'}
                      </Link>
                      <p className="text-2xs text-faint">
                        To {m.recruiter_name ?? m.recipient_email}
                        {m.sent_at ? `, ${fmtDate(m.sent_at)}` : ''}
                      </p>
                    </div>
                    <StatusTrack m={m} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <SectionTitle>Job description</SectionTitle>
            {o.description ? <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-muted">{o.description}</p> : <p className="px-4 py-6 text-sm text-muted">No description saved. Paste it in Edit for better matching and drafts.</p>}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="panel">
            <SectionTitle>How your profile matches</SectionTitle>
            <div className="space-y-3 px-4 py-3 text-sm">
              {o.skill_match.considered === 0 ? (
                <p className="text-muted">The posting has no recognisable skills yet. Add the description or skills to compare.</p>
              ) : (
                <>
                  <p>
                    Your profile lists <span className="num font-semibold">{o.skill_match.matched.length}</span> of the <span className="num">{o.skill_match.considered}</span> skills mentioned.
                  </p>
                  <div>
                    <p className="mb-1 text-xs text-muted">You have</p>
                    <div className="flex flex-wrap gap-1">{o.skill_match.matched.length ? o.skill_match.matched.map((s) => <Badge key={s} tone="success">{s}</Badge>) : <span className="text-xs text-faint">none</span>}</div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted">Not in your profile</p>
                    <div className="flex flex-wrap gap-1">{o.skill_match.missing.length ? o.skill_match.missing.map((s) => <Badge key={s}>{s}</Badge>) : <span className="text-xs text-faint">none</span>}</div>
                  </div>
                  <p className="text-2xs text-faint">Compares only what is written in your profile and the posting. It is not a prediction of your chances, and drafts never claim the missing skills.</p>
                </>
              )}
            </div>
          </section>
          <section className="panel">
            <SectionTitle>Details</SectionTitle>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 px-4 py-3 text-sm">
              <dt className="text-muted">Experience</dt>
              <dd>{o.experience_requirements ?? '—'}</dd>
              <dt className="text-muted">Saved</dt>
              <dd>{fmtDate(o.discovered_at)}</dd>
              <dt className="text-muted">Deadline</dt>
              <dd>{fmtDate(o.deadline)}</dd>
              <dt className="text-muted">Company facts</dt>
              <dd className="whitespace-pre-wrap text-muted">{o.company_notes ?? '—'}</dd>
              <dt className="text-muted">Notes</dt>
              <dd className="whitespace-pre-wrap text-muted">{o.notes ?? '—'}</dd>
            </dl>
          </section>
        </aside>
      </div>

      {editing && <OpportunityDialog existing={o} onClose={() => setEditing(false)} />}
      {adding && <AddRecruiterDialog onClose={() => setAdding(false)} initial={{ company: o.company, opportunity_id: o.id, target_role: o.title }} />}
      {linking && <LinkRecruitersDialog opportunityId={o.id} linked={o.recruiters.map((r) => r.id)} onClose={() => setLinking(false)} />}
      {deleting && (
        <Confirm
          title="Delete job?"
          danger
          confirmLabel="Delete job"
          body={<p>The job and its recruiter links are removed. Recruiters and sent emails stay.</p>}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api(`/api/opportunities/${id}`, { method: 'DELETE' });
            await invalidate();
            navigate('/opportunities');
          }}
        />
      )}
    </>
  );
}

function LinkRecruitersDialog({ opportunityId, linked, onClose }: { opportunityId: string; linked: string[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useRecruiters({ q, page_size: 50, sort: 'name' });
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();
  const toast = useToast();
  return (
    <Dialog
      title="Link recruiters"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!chosen.length}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/opportunities/${opportunityId}/recruiters`, { method: 'POST', body: { recruiter_ids: chosen } });
                await invalidate();
                onClose();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Link {chosen.length || ''}
          </Button>
        </>
      }
    >
      <input aria-label="Search recruiters" className="field mb-3" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.data ? (
        <Spinner />
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {list.data.items
            .filter((r) => !linked.includes(r.id))
            .map((r) => (
              <li key={r.id}>
                <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-raised">
                  <input type="checkbox" checked={chosen.includes(r.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))} />
                  <span className="min-w-0 flex-1 truncate">
                    {r.full_name ?? r.email} <span className="text-muted">{r.company}</span>
                  </span>
                </label>
              </li>
            ))}
        </ul>
      )}
    </Dialog>
  );
}
