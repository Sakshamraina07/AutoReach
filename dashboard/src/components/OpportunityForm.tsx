import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, extractSkills, OPPORTUNITY_STATUS_LABELS, OPPORTUNITY_STATUSES, type Opportunity } from '@autoreach/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { useInvalidate } from '../lib/queries';
import { Button, Dialog, ErrorState, Field, TagInput, useToast } from './ui';

export interface OpportunityFormValues {
  company: string;
  title: string;
  description: string;
  job_url: string;
  location: string;
  employment_type: string;
  required_skills: string[];
  experience_requirements: string;
  deadline: string;
  status: string;
  notes: string;
  company_notes: string;
}

export const emptyOpportunity: OpportunityFormValues = {
  company: '',
  title: '',
  description: '',
  job_url: '',
  location: '',
  employment_type: 'internship',
  required_skills: [],
  experience_requirements: '',
  deadline: '',
  status: 'saved',
  notes: '',
  company_notes: '',
};

export function fromOpportunity(o: Opportunity): OpportunityFormValues {
  return {
    company: o.company,
    title: o.title,
    description: o.description ?? '',
    job_url: o.job_url ?? '',
    location: o.location ?? '',
    employment_type: o.employment_type,
    required_skills: o.required_skills,
    experience_requirements: o.experience_requirements ?? '',
    deadline: o.deadline ?? '',
    status: o.status,
    notes: o.notes ?? '',
    company_notes: o.company_notes ?? '',
  };
}

export function opportunityPayload(v: OpportunityFormValues) {
  return {
    company: v.company,
    title: v.title,
    description: v.description || null,
    job_url: v.job_url || null,
    location: v.location || null,
    employment_type: v.employment_type,
    required_skills: v.required_skills,
    experience_requirements: v.experience_requirements || null,
    deadline: v.deadline || null,
    status: v.status,
    notes: v.notes || null,
    company_notes: v.company_notes || null,
  };
}

export function OpportunityFields({ value, onChange }: { value: OpportunityFormValues; onChange: (v: OpportunityFormValues) => void }) {
  const set = <K extends keyof OpportunityFormValues>(k: K, v: OpportunityFormValues[K]) => onChange({ ...value, [k]: v });
  const detected = extractSkills(value.description).filter((s) => !value.required_skills.includes(s));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Job title" htmlFor="o-title">
        <input id="o-title" required className="field" value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="Frontend Developer Intern" />
      </Field>
      <Field label="Company" htmlFor="o-company">
        <input id="o-company" required className="field" value={value.company} onChange={(e) => set('company', e.target.value)} />
      </Field>
      <Field label="Job description" htmlFor="o-desc" className="sm:col-span-2" hint="Paste the posting. It's used for role matching and to tailor drafts; it is never published.">
        <textarea id="o-desc" rows={6} className="field" value={value.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="Skills listed in the posting" htmlFor="o-skills" className="sm:col-span-2">
        <TagInput id="o-skills" value={value.required_skills} onChange={(t) => set('required_skills', t)} placeholder="React, TypeScript" />
        {detected.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
            Found in the description:
            {detected.map((s) => (
              <button key={s} type="button" className="rounded border border-line px-1.5 text-xs text-ink hover:border-accent" onClick={() => set('required_skills', [...value.required_skills, s])}>
                + {s}
              </button>
            ))}
          </div>
        )}
      </Field>
      <Field label="Job URL" htmlFor="o-url">
        <input id="o-url" className="field" value={value.job_url} onChange={(e) => set('job_url', e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Location" htmlFor="o-loc">
        <input id="o-loc" className="field" value={value.location} onChange={(e) => set('location', e.target.value)} placeholder="Pune / Remote" />
      </Field>
      <Field label="Employment type" htmlFor="o-type">
        <select id="o-type" className="field" value={value.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EMPLOYMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status" htmlFor="o-status">
        <select id="o-status" className="field" value={value.status} onChange={(e) => set('status', e.target.value)}>
          {OPPORTUNITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {OPPORTUNITY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Experience required" htmlFor="o-exp">
        <input id="o-exp" className="field" value={value.experience_requirements} onChange={(e) => set('experience_requirements', e.target.value)} placeholder="0–1 years" />
      </Field>
      <Field label="Application deadline" htmlFor="o-deadline">
        <input id="o-deadline" type="date" className="field" value={value.deadline} onChange={(e) => set('deadline', e.target.value)} />
      </Field>
      <Field label="What you know about the company" htmlFor="o-cnotes" className="sm:col-span-2" hint="Only facts you've checked. Drafts may mention this, nothing else about the company.">
        <textarea id="o-cnotes" rows={2} className="field" value={value.company_notes} onChange={(e) => set('company_notes', e.target.value)} />
      </Field>
      <Field label="Private notes" htmlFor="o-notes" className="sm:col-span-2">
        <textarea id="o-notes" rows={2} className="field" value={value.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </div>
  );
}

export function OpportunityDialog({ onClose, existing, onSaved }: { onClose: () => void; existing?: Opportunity; onSaved?: (o: Opportunity) => void }) {
  const [value, setValue] = useState<OpportunityFormValues>(existing ? fromOpportunity(existing) : emptyOpportunity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const invalidate = useInvalidate();
  const toast = useToast();
  return (
    <Dialog
      title={existing ? 'Edit opportunity' : 'Save an opportunity'}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="opp-form" loading={busy}>
            {existing ? 'Save changes' : 'Save opportunity'}
          </Button>
        </>
      }
    >
      <form
        id="opp-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const o = existing
              ? await api<Opportunity>(`/api/opportunities/${existing.id}`, { method: 'PATCH', body: opportunityPayload(value) })
              : await api<Opportunity>('/api/opportunities', { method: 'POST', body: opportunityPayload(value) });
            await invalidate();
            toast.success(existing ? 'Opportunity updated' : 'Opportunity saved');
            onSaved?.(o);
            onClose();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <OpportunityFields value={value} onChange={setValue} />
      </form>
      {error ? (
        <div className="mt-3">
          <ErrorState error={error} />
        </div>
      ) : null}
    </Dialog>
  );
}
