import { clsx } from 'clsx';
import { Check, FileText, LogOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cleanProfile, ExtractFromResumeDialog, ProfileEditor, profileToForm, type ProfileForm } from '../components/ProfileEditor';
import { Badge, Button, ErrorState, Field, Spinner, Toggle, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { browserTimezone, fmtBytes } from '../lib/format';
import { useInvalidate, useMe, useResumes } from '../lib/queries';
import { ResumeUpload, startGmailConnect, TimezoneSelect } from './Settings';

const STEPS = [
  { id: 'resume', title: 'Your résumé', intro: 'Upload the PDF you want attached to your emails. AutoReach can also read it to fill in your profile; you confirm every field.' },
  { id: 'about', title: 'About you', intro: 'Recruiters see your name and contact details in every email.' },
  { id: 'goals', title: 'What you want', intro: 'Target roles help AutoReach pick the right projects and skills to mention.' },
  { id: 'background', title: 'Skills and projects', intro: 'Drafts only mention skills, projects and achievements listed here. Add the ones you can talk about confidently.' },
  { id: 'voice', title: 'Links and tone', intro: 'Links go in your signature. Tone sets how drafts sound; you can change it per email.' },
  { id: 'gmail', title: 'Connect Gmail', intro: 'Emails are sent from your own Gmail account and appear in your Sent folder.' },
  { id: 'prefs', title: 'Preferences', intro: 'You can change all of these later in Settings.' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const STORAGE_KEY = 'autoreach.onboardingStep';

function readStoredStep(): number {
  try {
    const n = Number(sessionStorage.getItem(STORAGE_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

/** PATCH body: a blank name would fail validation, so leave it out until it's filled. */
function patchBody(form: ProfileForm): Partial<ProfileForm> {
  const clean = cleanProfile(form);
  if (!clean.full_name.trim()) {
    const { full_name: _omit, ...rest } = clean;
    return rest;
  }
  return clean;
}

export default function Onboarding() {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { signOut } = useAuth();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [step, setStep] = useState(() => (params.get('gmail') === 'connected' ? STEPS.findIndex((s) => s.id === 'gmail') : readStoredStep()));
  const [edited, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const handled = useRef(false);

  const saved = useMemo(() => (me.data ? profileToForm(me.data.profile, me.data.user.email) : null), [me.data]);
  const form = edited ?? saved;

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(step));
    } catch {
      /* storage unavailable */
    }
  }, [step]);

  useEffect(() => {
    if (handled.current || params.get('gmail') !== 'connected') return;
    handled.current = true;
    toast.success('Gmail connected');
    void invalidate();
    setParams({}, { replace: true });
  }, [params, setParams, toast, invalidate]);

  if (me.isError) return <div className="p-8"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  if (!me.data || !form) return <div className="p-8"><Spinner /></div>;
  const current: StepId = STEPS[step]!.id;
  const profileStep = current === 'about' || current === 'goals' || current === 'background' || current === 'voice';

  async function next() {
    if (!form) return;
    setError(null);
    if (current === 'about' && !form.full_name.trim()) {
      setError(new Error('Add your name so recruiters know who is writing.'));
      return;
    }
    if (profileStep) {
      setSaving(true);
      try {
        await api('/api/profile', { method: 'PATCH', body: patchBody(form) });
      } catch (e) {
        setError(e);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
            <path d="M5 9.5h22v13H5z" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="m5.5 10 10.5 7.5L26.5 10" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
            <circle cx="26" cy="22" r="4" fill="rgb(var(--replied))" />
          </svg>
          <span className="font-semibold">Set up AutoReach</span>
        </div>
        <Button variant="ghost" size="sm" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <ol className="flex gap-3 overflow-x-auto text-sm md:flex-col md:gap-1" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                aria-current={i === step ? 'step' : undefined}
                className={clsx('flex items-center gap-2 whitespace-nowrap rounded px-1.5 py-1 text-left', i === step ? 'text-ink' : i < step ? 'text-muted hover:text-ink' : 'text-faint')}
              >
                <span
                  className={clsx(
                    'num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-2xs',
                    i < step ? 'border-replied bg-replied/15 text-replied' : i === step ? 'border-accent text-accent' : 'border-line',
                  )}
                  aria-hidden
                >
                  {i < step ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>

        <main className="min-w-0">
          <h1 className="text-2xl">{STEPS[step]!.title}</h1>
          <p className="mb-6 mt-1 max-w-prose text-sm text-muted">{STEPS[step]!.intro}</p>

          {current === 'resume' && <ResumeStep form={form} setForm={setForm} />}
          {current === 'about' && <ProfileEditor value={form} onChange={setForm} sections={['basics', 'education']} />}
          {current === 'goals' && <ProfileEditor value={form} onChange={setForm} sections={['goals']} />}
          {current === 'background' && <BackgroundStep form={form} setForm={setForm} />}
          {current === 'voice' && <ProfileEditor value={form} onChange={setForm} sections={['links', 'voice']} />}
          {current === 'gmail' && <GmailStep />}
          {current === 'prefs' && (
            <PrefsStep
              onFinish={async () => {
                await api('/api/profile/complete-onboarding', { method: 'POST' });
                try {
                  sessionStorage.removeItem(STORAGE_KEY);
                } catch {
                  /* ignore */
                }
                await invalidate();
                navigate('/', { replace: true });
              }}
              onEditName={() => setStep(STEPS.findIndex((s) => s.id === 'about'))}
              hasName={!!form.full_name.trim()}
            />
          )}

          {error ? (
            <div className="mt-6">
              <ErrorState error={error} />
            </div>
          ) : null}

          {current !== 'prefs' && (
            <div className="mt-8 flex items-center gap-2 border-t border-line pt-4">
              {step > 0 && (
                <Button variant="ghost" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              )}
              <Button variant="primary" loading={saving} onClick={next}>
                {current === 'resume' || current === 'gmail' ? 'Continue' : 'Save and continue'}
              </Button>
              {(current === 'resume' || current === 'gmail') && <span className="text-xs text-faint">You can do this later in Settings.</span>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ResumeStep({ form, setForm }: { form: ProfileForm; setForm: (f: ProfileForm) => void }) {
  const resumes = useResumes();
  const [extracting, setExtracting] = useState<string | true | false>(false);
  const [applied, setApplied] = useState(false);
  return (
    <div className="space-y-6">
      {resumes.data && resumes.data.length > 0 && (
        <div className="panel">
          <ul className="divide-y divide-line/60">
            {resumes.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <FileText className="h-4 w-4 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="text-xs text-muted">{fmtBytes(r.size_bytes)}</span>
                {r.is_default && <Badge tone="accent">default</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ResumeUpload compact onUploaded={(r) => r.has_text && setExtracting(r.id)} />
      <div className="rounded border border-line p-4 text-sm">
        <p className="mb-2">Fill your profile from a résumé</p>
        <p className="mb-3 text-xs text-muted">Reads an uploaded PDF or text you paste. You'll see every suggestion and choose which to keep.</p>
        <Button size="sm" onClick={() => setExtracting(true)}>
          Read my résumé
        </Button>
        {applied && <p className="mt-2 text-xs text-replied">Suggestions added. You'll review them in the next steps before anything is saved.</p>}
      </div>
      {extracting && (
        <ExtractFromResumeDialog
          current={form}
          initialResumeId={typeof extracting === 'string' ? extracting : undefined}
          onApply={(f) => {
            setForm(f);
            setApplied(true);
          }}
          onClose={() => setExtracting(false)}
        />
      )}
    </div>
  );
}

function BackgroundStep({ form, setForm }: { form: ProfileForm; setForm: (f: ProfileForm) => void }) {
  return <ProfileEditor value={form} onChange={setForm} sections={['skills', 'projects', 'experience']} />;
}

function GmailStep() {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const g = me.data?.gmail;
  if (!g) return <Spinner />;
  if (!g.configured)
    return <p className="rounded border border-line bg-raised p-3 text-sm text-muted">Gmail sending isn't configured on this server yet. You can still set up recruiters, opportunities and drafts; the administrator needs to add Google OAuth credentials before emails can be sent.</p>;
  if (g.connected && g.status === 'active')
    return (
      <p className="flex items-center gap-2 text-sm">
        <Check className="h-4 w-4 text-replied" /> Connected as <span className="text-ink">{g.account_email}</span>
      </p>
    );
  return (
    <div className="space-y-4 text-sm">
      <ul className="space-y-1.5 text-muted">
        <li>Google will ask you to allow two things: sending email, and reading message headers (sender, subject, date) so AutoReach can tell when someone replies.</li>
        <li>AutoReach never reads the content of your emails and never sends anything you haven't approved.</li>
        <li>You can disconnect at any time; that also revokes access at Google.</li>
      </ul>
      <Button
        variant="primary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await startGmailConnect('onboarding');
          } catch (e) {
            toast.error(e);
            setBusy(false);
          }
        }}
      >
        {g.status === 'needs_reauth' || g.status === 'legacy_import_pending' ? 'Reconnect Gmail' : 'Connect Gmail'}
      </Button>
    </div>
  );
}

function PrefsStep({ onFinish, onEditName, hasName }: { onFinish: () => Promise<void>; onEditName: () => void; hasName: boolean }) {
  const me = useMe();
  const s = me.data!.settings;
  const [timezone, setTimezone] = useState(() => (s.timezone === 'UTC' ? browserTimezone() : s.timezone));
  const [tracking, setTracking] = useState(s.tracking_enabled);
  const [limit, setLimit] = useState(s.daily_send_limit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const trackingAvailable = me.data!.tracking.configured;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/settings', { method: 'PATCH', body: { timezone, tracking_enabled: trackingAvailable ? tracking : false, daily_send_limit: limit } });
      await onFinish();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Your time zone" htmlFor="ob-tz" hint="Used for business days, the daily limit and scheduled sends.">
        <TimezoneSelect id="ob-tz" value={timezone} onChange={setTimezone} />
      </Field>
      <Field label="Daily sending limit" htmlFor="ob-limit" hint="A modest limit keeps outreach personal. Between 10 and 25 is typical for a job search.">
        <div className="flex items-center gap-2">
          <input id="ob-limit" type="number" min={1} max={200} className="field w-24" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          <span className="text-sm text-muted">emails per day</span>
        </div>
      </Field>
      <div className="rounded border border-line px-4 py-2">
        <Toggle
          label="Detect opens (optional)"
          disabled={!trackingAvailable}
          description={
            trackingAvailable
              ? 'Adds an invisible image to each email. When the recipient’s mail app loads images, you see “open detected”. It’s approximate: some apps block images, and others load them without anyone reading. Recipients aren’t told about it. Off by default.'
              : 'Not available on this server.'
          }
          checked={tracking && trackingAvailable}
          onChange={setTracking}
        />
      </div>
      {!hasName && (
        <p className="text-sm text-warn">
          Add your name before finishing.{' '}
          <button type="button" className="font-medium text-accent hover:underline" onClick={onEditName}>
            Go to About you
          </button>
        </p>
      )}
      {error ? <ErrorState error={error} /> : null}
      <div className="flex gap-2 border-t border-line pt-4">
        <Button variant="primary" loading={busy} disabled={!hasName || !Number.isInteger(limit) || limit < 1 || limit > 200} onClick={finish}>
          Finish setup
        </Button>
      </div>
    </div>
  );
}
