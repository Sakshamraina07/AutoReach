import { RECRUITER_SOURCE_LABELS, RECRUITER_SOURCES, type RecruiterSummary } from '@autoreach/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useInvalidate, useOpportunities } from '../lib/queries';
import { Button, Dialog, ErrorState, Field, TagInput, useToast } from './ui';

export interface RecruiterFormValues {
  full_name: string;
  email: string;
  company: string;
  title: string;
  linkedin_url: string;
  company_website: string;
  target_role: string;
  source: string;
  tags: string[];
  notes: string;
  unverified: boolean;
  opportunity_id: string;
}

export const emptyRecruiter: RecruiterFormValues = {
  full_name: '',
  email: '',
  company: '',
  title: '',
  linkedin_url: '',
  company_website: '',
  target_role: '',
  source: 'manual',
  tags: [],
  notes: '',
  unverified: false,
  opportunity_id: '',
};

export function toPayload(v: RecruiterFormValues, includeOpportunity = true) {
  return {
    full_name: v.full_name || null,
    email: v.email,
    company: v.company || null,
    title: v.title || null,
    linkedin_url: v.linkedin_url || null,
    company_website: v.company_website || null,
    target_role: v.target_role || null,
    source: v.source,
    tags: v.tags,
    notes: v.notes || null,
    email_verification: v.unverified ? 'unverified_guess' : 'provided',
    ...(includeOpportunity && v.opportunity_id ? { opportunity_id: v.opportunity_id } : {}),
  };
}

export function RecruiterFields({ value, onChange, showOpportunity = true }: { value: RecruiterFormValues; onChange: (v: RecruiterFormValues) => void; showOpportunity?: boolean }) {
  const opps = useOpportunities({ active: 'true', page_size: 200 });
  const set = <K extends keyof RecruiterFormValues>(k: K, v: RecruiterFormValues[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor="r-name">
        <input id="r-name" className="field" value={value.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Meera Iyer" />
      </Field>
      <Field label="Work email" htmlFor="r-email">
        <input id="r-email" type="email" required className="field" value={value.email} onChange={(e) => set('email', e.target.value)} placeholder="meera@company.com" />
      </Field>
      <Field label="Company" htmlFor="r-company">
        <input id="r-company" className="field" value={value.company} onChange={(e) => set('company', e.target.value)} />
      </Field>
      <Field label="Their title" htmlFor="r-title">
        <input id="r-title" className="field" value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="University Recruiter" />
      </Field>
      <Field label="LinkedIn profile URL" htmlFor="r-li">
        <input id="r-li" className="field" value={value.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://www.linkedin.com/in/…" />
      </Field>
      <Field label="Company website" htmlFor="r-web">
        <input id="r-web" className="field" value={value.company_website} onChange={(e) => set('company_website', e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Role you're reaching out about" htmlFor="r-role" hint="Used when no job posting is linked.">
        <input id="r-role" className="field" value={value.target_role} onChange={(e) => set('target_role', e.target.value)} placeholder="Software Engineering Intern" />
      </Field>
      <Field label="Where you found them" htmlFor="r-src">
        <select id="r-src" className="field" value={value.source} onChange={(e) => set('source', e.target.value)}>
          {RECRUITER_SOURCES.filter((s) => s !== 'legacy').map((s) => (
            <option key={s} value={s}>
              {RECRUITER_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      {showOpportunity && (
        <Field label="Link to an opportunity" htmlFor="r-opp" className="sm:col-span-2">
          <select id="r-opp" className="field" value={value.opportunity_id} onChange={(e) => set('opportunity_id', e.target.value)}>
            <option value="">None</option>
            {opps.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} — {o.company}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Tags" htmlFor="r-tags" className="sm:col-span-2" hint="Press Enter or comma to add.">
        <TagInput id="r-tags" value={value.tags} onChange={(t) => set('tags', t)} placeholder="frontend, campus" />
      </Field>
      <Field label="Notes" htmlFor="r-notes" className="sm:col-span-2">
        <textarea id="r-notes" rows={3} className="field" value={value.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="mt-1" checked={value.unverified} onChange={(e) => set('unverified', e.target.checked)} />
        <span>
          This address is a guess I haven't confirmed
          <span className="block text-xs text-muted">AutoReach will ask you to confirm it before any email is sent.</span>
        </span>
      </label>
    </div>
  );
}

export function AddRecruiterDialog({ onClose, initial, onCreated }: { onClose: () => void; initial?: Partial<RecruiterFormValues>; onCreated?: (r: RecruiterSummary) => void }) {
  const [value, setValue] = useState<RecruiterFormValues>({ ...emptyRecruiter, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState<RecruiterSummary | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (duplicate || error) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [duplicate, error]);
  const invalidate = useInvalidate();
  const toast = useToast();
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDuplicate(null);
    try {
      const r = await api<RecruiterSummary>('/api/recruiters', { method: 'POST', body: toPayload(value) });
      await invalidate();
      toast.success(`Added ${r.full_name ?? r.email}`);
      onCreated?.(r);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_RECRUITER') setDuplicate((err.details as { existing: RecruiterSummary }).existing);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Add recruiter"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-recruiter" loading={busy}>
            Save recruiter
          </Button>
        </>
      }
    >
      {/* Problems go above the form and are scrolled into view. */}
      <div ref={alertRef} />
      {duplicate && (
        <div role="alert" className="mb-4 rounded border border-warn/40 bg-warn/10 p-3 text-sm">
          <p>
            {duplicate.email} is already saved{duplicate.full_name ? ` as ${duplicate.full_name}` : ''}
            {duplicate.messages_sent ? ` and you've emailed them ${duplicate.messages_sent} time${duplicate.messages_sent > 1 ? 's' : ''}` : ''}.
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => {
              onClose();
              navigate(`/recruiters?open=${duplicate.id}`);
            }}
          >
            Open existing recruiter
          </Button>
        </div>
      )}
      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}
      <form id="add-recruiter" onSubmit={submit}>
        <RecruiterFields value={value} onChange={setValue} />
      </form>
    </Dialog>
  );
}
