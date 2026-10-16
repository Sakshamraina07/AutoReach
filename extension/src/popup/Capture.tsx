import { EMPLOYMENT_TYPES, type Opportunity, type RecruiterSummary } from '@autoreach/shared';
import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CapturedPage } from '../lib/capture';
import { api, ExtensionApiError, send } from '../lib/client';
import { dashboardLink } from '../lib/config';
import { activeTab } from '../lib/hooks';
import type { ApiErrorShape } from '../lib/protocol';
import { Button, ErrorNote, Field, Spinner } from '../ui/components';
import { openComposer } from './compose';

const TYPE_LABEL: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
  internship: 'Internship',
  full_time: 'Full-time',
  graduate_program: 'Graduate program',
  contract: 'Contract',
  part_time: 'Part-time',
  unknown: 'Not stated',
};

/** "Save this page": the user reviews every field before anything is stored. */
export function CaptureView({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState<CapturedPage | null>(null);
  const [captureError, setCaptureError] = useState<unknown>(null);
  const [form, setForm] = useState({ title: '', company: '', location: '', employment_type: 'unknown' as CapturedPage['job']['employment_type'], deadline: '', job_url: '', description: '' });
  const [rec, setRec] = useState({ add: false, name: '', email: '', title: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<{ opportunity: Opportunity; recruiter: RecruiterSummary | null; note: string | null } | null>(null);

  useEffect(() => {
    void (async () => {
      const tab = await activeTab();
      if (tab?.id === undefined) {
        setCaptureError(new Error('No active tab.'));
        return;
      }
      const res = await send<{ ok: true; page: CapturedPage } | { ok: false; error: ApiErrorShape }>({ type: 'capture:page', tabId: tab.id });
      if (!res.ok) {
        setCaptureError(new ExtensionApiError(res.error));
        setForm((f) => ({ ...f, job_url: tab.url ?? '' }));
        return;
      }
      const p = res.page;
      setPage(p);
      setForm({
        title: p.job.title ?? '',
        company: p.job.company ?? '',
        location: p.job.location ?? '',
        employment_type: p.job.employment_type,
        deadline: p.job.deadline ?? '',
        job_url: p.job.url,
        description: p.job.description ?? '',
      });
      if (p.emailsInSelection[0]) setRec((r) => ({ ...r, add: true, email: p.emailsInSelection[0]! }));
    })();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const opportunity = await api<Opportunity>('/api/opportunities', {
        method: 'POST',
        body: {
          company: form.company.trim(),
          title: form.title.trim(),
          location: form.location.trim() || null,
          employment_type: form.employment_type,
          deadline: form.deadline || null,
          job_url: form.job_url.trim() || null,
          description: form.description.trim() || null,
          ...(page?.structured && page.job.skills.length ? { required_skills: page.job.skills } : {}),
          ...(page?.job.experience ? { experience_requirements: page.job.experience } : {}),
          source: 'browser_capture',
          source_url: page?.url ?? (form.job_url.trim() || null),
        },
      });
      let recruiter: RecruiterSummary | null = null;
      let note: string | null = null;
      if (rec.add && rec.email.trim()) {
        try {
          recruiter = await api<RecruiterSummary>('/api/recruiters', {
            method: 'POST',
            body: {
              email: rec.email.trim(),
              full_name: rec.name.trim() || null,
              title: rec.title.trim() || null,
              company: form.company.trim(),
              source: 'browser_capture',
              source_url: page?.url ?? null,
              opportunity_id: opportunity.id,
            },
          });
        } catch (e) {
          if (e instanceof ExtensionApiError && e.code === 'DUPLICATE_RECRUITER') {
            const existing = (e.details as { existing?: RecruiterSummary } | undefined)?.existing ?? null;
            if (existing) {
              await api(`/api/recruiters/${existing.id}/opportunities`, { method: 'POST', body: { opportunity_id: opportunity.id } });
              recruiter = existing;
              note = `${existing.email} was already saved, so it was linked to this opportunity instead of added again.`;
            }
          } else {
            note = `The opportunity was saved, but the recruiter wasn't: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      }
      setSaved({ opportunity, recruiter, note });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="space-y-3 p-4">
        <p className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-replied" /> Saved {saved.opportunity.title} at {saved.opportunity.company}.
        </p>
        {saved.note && <p className="text-xs text-warn">{saved.note}</p>}
        <div className="flex flex-wrap gap-2">
          {saved.recruiter && (
            <Button variant="primary" onClick={() => openComposer({ recruiterId: saved.recruiter!.id, opportunityId: saved.opportunity.id })}>
              Write to {saved.recruiter.full_name?.split(' ')[0] ?? saved.recruiter.email}
            </Button>
          )}
          <Button onClick={() => void chrome.tabs.create({ url: dashboardLink(`/opportunities/${saved.opportunity.id}`) })}>Open in dashboard</Button>
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" aria-label="Back" onClick={onDone} className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold">Save this page as an opportunity</h1>
      </header>
      <div className="space-y-3 p-3">
        {!page && !captureError && <Spinner label="Reading the page" />}
        {captureError ? <ErrorNote error={captureError} /> : null}
        {page && (
          <p className="text-2xs text-faint">
            {page.structured
              ? 'Filled from the job details this site publishes. Check every field before saving.'
              : "This page doesn't publish structured job details, so only the title and any text you selected were used. Fill in the rest."}
          </p>
        )}
        {(page || !!captureError) && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="Role title" htmlFor="cap-title">
              <input id="cap-title" required className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Company" htmlFor="cap-company">
              <input id="cap-company" required className="field" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Location" htmlFor="cap-loc">
                <input id="cap-loc" className="field" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </Field>
              <Field label="Type" htmlFor="cap-type">
                <select id="cap-type" className="field" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value as typeof form.employment_type })}>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Apply by" htmlFor="cap-deadline">
                <input id="cap-deadline" type="date" className="field" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
              </Field>
              <Field label="Job link" htmlFor="cap-url">
                <input id="cap-url" className="field" value={form.job_url} onChange={(e) => setForm({ ...form, job_url: e.target.value })} />
              </Field>
            </div>
            <Field label="Description" htmlFor="cap-desc" hint="Used to match your skills and to write role-specific emails.">
              <textarea id="cap-desc" rows={4} className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>

            <div className="rounded border border-line p-2.5">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" checked={rec.add} onChange={(e) => setRec({ ...rec, add: e.target.checked })} /> Also save a recruiter for this role
              </label>
              {rec.add && (
                <div className="mt-2 space-y-2">
                  <Field
                    label="Their email"
                    htmlFor="cap-rec-email"
                    hint={page?.emailsInSelection.length ? 'Found in the text you selected on the page.' : 'Only add an address you found published or were given. AutoReach never guesses addresses.'}
                  >
                    <input id="cap-rec-email" type="email" required className="field" value={rec.email} onChange={(e) => setRec({ ...rec, email: e.target.value })} list="cap-emails" />
                    <datalist id="cap-emails">
                      {page?.emailsInSelection.map((e) => (
                        <option key={e} value={e} />
                      ))}
                    </datalist>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Name" htmlFor="cap-rec-name">
                      <input id="cap-rec-name" className="field" value={rec.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} />
                    </Field>
                    <Field label="Their title" htmlFor="cap-rec-title">
                      <input id="cap-rec-title" className="field" value={rec.title} onChange={(e) => setRec({ ...rec, title: e.target.value })} />
                    </Field>
                  </div>
                </div>
              )}
            </div>
            {error ? <ErrorNote error={error} /> : null}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={busy}>
                Save opportunity
              </Button>
              <Button variant="ghost" onClick={onDone}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
