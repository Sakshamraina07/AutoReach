import { JOB_TYPES, TONE_LABELS, TONES, type JobType, type Profile, type ProfileUpdate, type Tone } from '@autoreach/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { useResumes } from '../lib/queries';
import { Badge, Button, Dialog, ErrorState, Field, Spinner, TagInput } from './ui';

export type ProfileForm = ProfileUpdate;

const JOB_TYPE_LABEL: Record<JobType, string> = { internship: 'Internship', full_time: 'Full-time', graduate_program: 'Graduate program', contract: 'Contract' };

export function profileToForm(p: Profile | null | undefined, fallbackEmail?: string | null): ProfileForm {
  return {
    full_name: p?.full_name ?? '',
    primary_email: p?.primary_email ?? fallbackEmail ?? null,
    phone: p?.phone ?? null,
    degree: p?.degree ?? null,
    specialization: p?.specialization ?? null,
    university: p?.university ?? null,
    graduation_month: p?.graduation_month ?? null,
    graduation_year: p?.graduation_year ?? null,
    current_location: p?.current_location ?? null,
    preferred_locations: p?.preferred_locations ?? [],
    job_types: p?.job_types ?? [],
    target_roles: p?.target_roles ?? [],
    skills: p?.skills ?? [],
    projects: p?.projects ?? [],
    experience: p?.experience ?? [],
    links: p?.links ?? { github: null, linkedin: null, portfolio: null, other: [] },
    preferred_tone: p?.preferred_tone ?? 'professional',
    writing_style: p?.writing_style ?? null,
    signature: p?.signature ?? null,
  };
}

/** Strip empty strings to null so the API's URL/email validation accepts optional fields. */
export function cleanProfile(f: ProfileForm): ProfileForm {
  const n = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    ...f,
    primary_email: n(f.primary_email),
    phone: n(f.phone),
    degree: n(f.degree),
    specialization: n(f.specialization),
    university: n(f.university),
    current_location: n(f.current_location),
    writing_style: n(f.writing_style),
    signature: n(f.signature),
    links: { github: n(f.links.github), linkedin: n(f.links.linkedin), portfolio: n(f.links.portfolio), other: f.links.other },
    projects: f.projects.filter((p) => p.name.trim()).map((p) => ({ ...p, url: n(p.url) })),
    experience: f.experience.filter((e) => e.organization.trim() && e.title.trim()).map((e) => ({ ...e, start: n(e.start), end: e.current ? null : n(e.end) })),
  };
}

const newId = () => Math.random().toString(36).slice(2, 10);

type Section = 'basics' | 'education' | 'goals' | 'skills' | 'projects' | 'experience' | 'links' | 'voice';

export function ProfileEditor({ value, onChange, sections }: { value: ProfileForm; onChange: (v: ProfileForm) => void; sections?: Section[] }) {
  const show = (s: Section) => !sections || sections.includes(s);
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => onChange({ ...value, [k]: v });
  const text = (k: keyof ProfileForm) => ({ value: (value[k] as string | null) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });

  return (
    <div className="space-y-8">
      {show('basics') && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">About you</legend>
          <Field label="Full name" htmlFor="p-name">
            <input id="p-name" required className="field" {...text('full_name')} />
          </Field>
          <Field label="Email recruiters should use" htmlFor="p-email">
            <input id="p-email" type="email" className="field" {...text('primary_email')} />
          </Field>
          <Field label="Phone (optional)" htmlFor="p-phone">
            <input id="p-phone" className="field" {...text('phone')} />
          </Field>
          <Field label="Current location" htmlFor="p-loc">
            <input id="p-loc" className="field" {...text('current_location')} placeholder="Pune, India" />
          </Field>
        </fieldset>
      )}
      {show('education') && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Education</legend>
          <Field label="Degree" htmlFor="p-degree">
            <input id="p-degree" className="field" {...text('degree')} placeholder="B.Tech Computer Science" />
          </Field>
          <Field label="Specialization" htmlFor="p-spec">
            <input id="p-spec" className="field" {...text('specialization')} placeholder="AI & Data Science" />
          </Field>
          <Field label="College or university" htmlFor="p-uni" className="sm:col-span-2">
            <input id="p-uni" className="field" {...text('university')} />
          </Field>
          <Field label="Graduation month" htmlFor="p-gm">
            <select id="p-gm" className="field" value={value.graduation_month ?? ''} onChange={(e) => set('graduation_month', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Graduation year" htmlFor="p-gy">
            <input id="p-gy" type="number" min={1990} max={2100} className="field" value={value.graduation_year ?? ''} onChange={(e) => set('graduation_year', e.target.value ? Number(e.target.value) : null)} />
          </Field>
        </fieldset>
      )}
      {show('goals') && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">What you're looking for</legend>
          <Field label="Target roles" htmlFor="p-roles" className="sm:col-span-2">
            <TagInput id="p-roles" value={value.target_roles} onChange={(v) => set('target_roles', v)} placeholder="Frontend Developer Intern, Backend Engineer" />
          </Field>
          <div className="sm:col-span-2">
            <span className="label">Job types</span>
            <div className="flex flex-wrap gap-4">
              {JOB_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={value.job_types.includes(t)} onChange={(e) => set('job_types', e.target.checked ? [...value.job_types, t] : value.job_types.filter((x) => x !== t))} />
                  {JOB_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <Field label="Preferred work locations" htmlFor="p-plocs" className="sm:col-span-2">
            <TagInput id="p-plocs" value={value.preferred_locations} onChange={(v) => set('preferred_locations', v)} placeholder="Bengaluru, Remote" />
          </Field>
        </fieldset>
      )}
      {show('skills') && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Technical skills</legend>
          <TagInput id="p-skills" value={value.skills} onChange={(v) => set('skills', v)} placeholder="React, TypeScript, Python" />
          <p className="mt-1 text-xs text-faint">Only list skills you'd be comfortable being asked about. Drafts never claim skills that aren't here or in your projects.</p>
        </fieldset>
      )}
      {show('projects') && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Projects</legend>
          {value.projects.map((p, i) => (
            <div key={p.id} className="space-y-2 rounded border border-line p-3">
              <div className="flex gap-2">
                <input aria-label="Project name" className="field" placeholder="Project name" value={p.name} onChange={(e) => set('projects', value.projects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Button variant="ghost" aria-label="Remove project" onClick={() => set('projects', value.projects.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <textarea aria-label="What it does" rows={2} className="field" placeholder="What it does and your part in it" value={p.description} onChange={(e) => set('projects', value.projects.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <TagInput value={p.technologies} onChange={(v) => set('projects', value.projects.map((x, j) => (j === i ? { ...x, technologies: v } : x)))} placeholder="Technologies used" />
              <textarea
                aria-label="Measurable achievements"
                rows={2}
                className="field"
                placeholder="Measurable achievements, one per line (e.g. Used by 120 students)"
                value={p.achievements.join('\n')}
                onChange={(e) => set('projects', value.projects.map((x, j) => (j === i ? { ...x, achievements: e.target.value.split('\n').map((s) => s.trimStart()).filter((s, k, arr) => s || k === arr.length - 1) } : x)))}
              />
              <input aria-label="Link" className="field" placeholder="https://github.com/…" value={p.url ?? ''} onChange={(e) => set('projects', value.projects.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            </div>
          ))}
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('projects', [...value.projects, { id: newId(), name: '', description: '', technologies: [], achievements: [], url: null }])}>
            Add project
          </Button>
        </fieldset>
      )}
      {show('experience') && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Internships and work experience</legend>
          {value.experience.map((x, i) => {
            const up = (patch: Partial<typeof x>) => set('experience', value.experience.map((e, j) => (j === i ? { ...e, ...patch } : e)));
            return (
              <div key={x.id} className="grid gap-2 rounded border border-line p-3 sm:grid-cols-2">
                <input aria-label="Title" className="field" placeholder="Software Engineering Intern" value={x.title} onChange={(e) => up({ title: e.target.value })} />
                <div className="flex gap-2">
                  <input aria-label="Organization" className="field" placeholder="Organization" value={x.organization} onChange={(e) => up({ organization: e.target.value })} />
                  <Button variant="ghost" aria-label="Remove experience" onClick={() => set('experience', value.experience.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <input aria-label="Start (YYYY-MM)" type="month" className="field" value={x.start ?? ''} onChange={(e) => up({ start: e.target.value || null })} />
                <div className="flex items-center gap-2">
                  <input aria-label="End (YYYY-MM)" type="month" className="field" disabled={x.current} value={x.end ?? ''} onChange={(e) => up({ end: e.target.value || null })} />
                  <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                    <input type="checkbox" checked={x.current} onChange={(e) => up({ current: e.target.checked })} /> Current
                  </label>
                </div>
                <textarea aria-label="Description" rows={2} className="field sm:col-span-2" placeholder="What you worked on" value={x.description} onChange={(e) => up({ description: e.target.value })} />
                <textarea
                  aria-label="Achievements"
                  rows={2}
                  className="field sm:col-span-2"
                  placeholder="Achievements, one per line"
                  value={x.achievements.join('\n')}
                  onChange={(e) => up({ achievements: e.target.value.split('\n').filter((s, k, arr) => s.trim() || k === arr.length - 1) })}
                />
                <div className="sm:col-span-2">
                  <TagInput value={x.technologies} onChange={(v) => up({ technologies: v })} placeholder="Technologies used" />
                </div>
              </div>
            );
          })}
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('experience', [...value.experience, { id: newId(), organization: '', title: '', start: null, end: null, current: false, description: '', achievements: [], technologies: [] }])}>
            Add experience
          </Button>
        </fieldset>
      )}
      {show('links') && (
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold">Links</legend>
          {(['github', 'linkedin', 'portfolio'] as const).map((k) => (
            <Field key={k} label={k === 'github' ? 'GitHub' : k === 'linkedin' ? 'LinkedIn' : 'Portfolio'} htmlFor={`p-${k}`}>
              <input id={`p-${k}`} className="field" placeholder="https://…" value={value.links[k] ?? ''} onChange={(e) => set('links', { ...value.links, [k]: e.target.value })} />
            </Field>
          ))}
        </fieldset>
      )}
      {show('voice') && (
        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-semibold">How your emails should sound</legend>
          <Field label="Default tone" htmlFor="p-tone">
            <select id="p-tone" className="field max-w-xs" value={value.preferred_tone} onChange={(e) => set('preferred_tone', e.target.value as Tone)}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {TONE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Writing-style notes" htmlFor="p-style" hint="E.g. “Short sentences. No exclamation marks. Mention I'm open to relocating.”">
            <textarea id="p-style" rows={2} className="field" {...text('writing_style')} />
          </Field>
          <Field label="Signature" htmlFor="p-sig" hint="Leave empty to use your name, phone and links.">
            <textarea id="p-sig" rows={3} className="field" {...text('signature')} />
          </Field>
        </fieldset>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Résumé → profile suggestions (confirmation required)                */
/* ------------------------------------------------------------------ */

interface Extraction {
  source: 'ai' | 'heuristic';
  suggested: Partial<ProfileForm>;
  warnings: string[];
}

const FIELD_LABELS: Partial<Record<keyof ProfileForm, string>> = {
  full_name: 'Name',
  primary_email: 'Email',
  phone: 'Phone',
  degree: 'Degree',
  specialization: 'Specialization',
  university: 'College',
  graduation_month: 'Graduation month',
  graduation_year: 'Graduation year',
  current_location: 'Location',
  skills: 'Skills',
  projects: 'Projects',
  experience: 'Experience',
  links: 'Links',
};

function describe(k: keyof ProfileForm, v: unknown): string {
  if (k === 'projects') return (v as ProfileForm['projects']).map((p) => p.name).join(', ');
  if (k === 'experience') return (v as ProfileForm['experience']).map((e) => `${e.title} at ${e.organization}`).join('; ');
  if (k === 'links') return Object.entries(v as Record<string, unknown>).filter(([key, val]) => key !== 'other' && val).map(([, val]) => String(val)).join(', ');
  if (Array.isArray(v)) return v.join(', ');
  return String(v ?? '');
}

export function ExtractFromResumeDialog({ current, onApply, onClose, initialResumeId }: { current: ProfileForm; onApply: (v: ProfileForm) => void; onClose: () => void; initialResumeId?: string }) {
  const resumes = useResumes();
  const [resumeId, setResumeId] = useState(initialResumeId ?? '');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Extraction>('/api/profile/extract', { method: 'POST', body: pasted.trim() ? { pasted_text: pasted } : { resume_id: resumeId } });
      setResult(r);
      setChosen(new Set(Object.keys(r.suggested).filter((k) => describe(k as keyof ProfileForm, (r.suggested as Record<string, unknown>)[k]))));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    const next = { ...current } as Record<string, unknown>;
    for (const k of chosen) {
      const v = (result.suggested as Record<string, unknown>)[k];
      if (k === 'skills') next.skills = [...new Set([...(current.skills ?? []), ...(v as string[])])];
      else if (k === 'projects') next.projects = [...current.projects, ...(v as ProfileForm['projects']).filter((p) => !current.projects.some((c) => c.name.toLowerCase() === p.name.toLowerCase()))];
      else if (k === 'experience') next.experience = [...current.experience, ...(v as ProfileForm['experience'])];
      else if (k === 'links') next.links = { ...current.links, ...Object.fromEntries(Object.entries(v as object).filter(([, x]) => x)) };
      else next[k] = v;
    }
    onApply(next as ProfileForm);
    onClose();
  }

  return (
    <Dialog
      title="Fill your profile from a résumé"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Back
            </Button>
            <Button variant="primary" disabled={!chosen.size} onClick={apply}>
              Use selected fields
            </Button>
          </>
        ) : (
          <Button variant="primary" loading={busy} disabled={!resumeId && !pasted.trim()} onClick={run}>
            Read résumé
          </Button>
        )
      }
    >
      {!result ? (
        <div className="space-y-4 text-sm">
          <p className="text-muted">AutoReach reads the text and suggests profile fields. Nothing is saved until you choose which suggestions to use and then save your profile.</p>
          <Field label="Uploaded résumé" htmlFor="x-res">
            {resumes.data ? (
              <select id="x-res" className="field" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                <option value="">Choose…</option>
                {resumes.data.map((r) => (
                  <option key={r.id} value={r.id} disabled={!r.has_text}>
                    {r.label}
                    {!r.has_text ? ' (no readable text)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <Spinner />
            )}
          </Field>
          <Field label="Or paste the text" htmlFor="x-paste">
            <textarea id="x-paste" rows={8} className="field" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {result.warnings.map((w) => (
            <p key={w} className="text-xs text-warn">
              {w}
            </p>
          ))}
          <ul className="space-y-2">
            {Object.entries(result.suggested).map(([k, v]) => {
              const d = describe(k as keyof ProfileForm, v);
              if (!d) return null;
              return (
                <li key={k}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={chosen.has(k)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                    <span>
                      <span className="font-medium">{FIELD_LABELS[k as keyof ProfileForm] ?? k}</span> <Badge>{['skills', 'projects', 'experience'].includes(k) ? 'adds to yours' : 'replaces yours'}</Badge>
                      <span className="block text-xs text-muted">{d}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error ? (
        <div className="mt-3">
          <ErrorState error={error} />
        </div>
      ) : null}
    </Dialog>
  );
}
