import type { Opportunity, Paginated, RecruiterSummary } from '@autoreach/shared';
import { ArrowLeft, Check } from 'lucide-react';
import { useState } from 'react';
import { api, ExtensionApiError } from '../lib/client';
import { dashboardLink } from '../lib/config';
import { useLoad } from '../lib/hooks';
import { Button, ErrorNote, Field } from '../ui/components';
import { openComposer } from './compose';

export function AddRecruiterView({ onDone }: { onDone: () => void }) {
  const opps = useLoad(() => api<Paginated<Opportunity>>('/api/opportunities?active=true&page_size=100'));
  const [v, setV] = useState({ full_name: '', email: '', company: '', title: '', target_role: '', opportunity_id: '', unverified: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState<RecruiterSummary | null>(null);
  const [saved, setSaved] = useState<RecruiterSummary | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setDuplicate(null);
    try {
      const r = await api<RecruiterSummary>('/api/recruiters', {
        method: 'POST',
        body: {
          email: v.email.trim(),
          full_name: v.full_name.trim() || null,
          company: v.company.trim() || null,
          title: v.title.trim() || null,
          target_role: v.target_role.trim() || null,
          opportunity_id: v.opportunity_id || null,
          email_verification: v.unverified ? 'unverified_guess' : 'provided',
        },
      });
      setSaved(r);
    } catch (e) {
      if (e instanceof ExtensionApiError && e.code === 'DUPLICATE_RECRUITER') setDuplicate((e.details as { existing?: RecruiterSummary } | undefined)?.existing ?? null);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="space-y-3 p-4">
        <p className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-replied" /> Added {saved.full_name ?? saved.email}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => openComposer({ recruiterId: saved.id, opportunityId: v.opportunity_id || undefined })}>
            Write email
          </Button>
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
        <h1 className="text-sm font-semibold">Add recruiter</h1>
      </header>
      <form
        className="space-y-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {duplicate && (
          <div role="alert" className="rounded border border-warn/40 bg-warn/10 p-2.5 text-xs">
            {duplicate.email} is already saved{duplicate.full_name ? ` as ${duplicate.full_name}` : ''}
            {duplicate.messages_sent ? `, and you've emailed them ${duplicate.messages_sent === 1 ? 'once' : `${duplicate.messages_sent} times`}` : ''}.{' '}
            <a href={dashboardLink(`/recruiters?open=${duplicate.id}`)} target="_blank" rel="noreferrer">
              Open in dashboard
            </a>
          </div>
        )}
        <Field label="Work email" htmlFor="ar-email">
          <input id="ar-email" type="email" required className="field" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5" checked={v.unverified} onChange={(e) => setV({ ...v, unverified: e.target.checked })} />
          This address is a guess I haven't confirmed (AutoReach will ask you to check it before sending)
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" htmlFor="ar-name">
            <input id="ar-name" className="field" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
          </Field>
          <Field label="Company" htmlFor="ar-company">
            <input id="ar-company" className="field" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Their title" htmlFor="ar-title">
            <input id="ar-title" className="field" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          </Field>
          <Field label="Role you're asking about" htmlFor="ar-role">
            <input id="ar-role" className="field" value={v.target_role} onChange={(e) => setV({ ...v, target_role: e.target.value })} />
          </Field>
        </div>
        <Field label="Link to an opportunity" htmlFor="ar-opp">
          <select id="ar-opp" className="field" value={v.opportunity_id} onChange={(e) => setV({ ...v, opportunity_id: e.target.value })}>
            <option value="">None</option>
            {opps.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} at {o.company}
              </option>
            ))}
          </select>
        </Field>
        {error ? <ErrorNote error={error} /> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy}>
            Save recruiter
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
