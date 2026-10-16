import {
  AI_REFINE_ACTION_LABELS,
  attachmentDisplayName,
  gmailSendBlocker,
  OUTREACH_GOAL_LABELS,
  OUTREACH_GOALS,
  TONE_LABELS,
  TONES,
  type AiRefineAction,
  type DraftResult,
  type MeResponse,
  type MessageDetail,
  type Opportunity,
  type OutreachGoal,
  type Paginated,
  type QualityFinding,
  type RecruiterDetail,
  type RecruiterLookupResult,
  type RecruiterSummary,
  type Resume,
  type Tone,
} from '@autoreach/shared';
import { clsx } from 'clsx';
import { Check, ClipboardCopy, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { activeTab, useLoad } from '../lib/hooks';
import { api, ExtensionApiError, idempotencyKey, send } from '../lib/client';
import { dashboardLink } from '../lib/config';
import type { ComposePrefill } from '../lib/protocol';
import { Button, ErrorNote, Field, Spinner } from '../ui/components';

interface SendResponse {
  outcome: 'sent' | 'failed' | 'unknown' | 'queued';
  message: MessageDetail;
  error?: { code: string; message: string };
}

const CONFIRMABLE = ['DUPLICATE_OUTREACH', 'UNVERIFIED_EMAIL', 'QUALITY_CHECK_FAILED', 'RECRUITER_REPLIED'] as const;
type Confirmable = (typeof CONFIRMABLE)[number];
const CONFIRM_FIELD: Record<Confirmable, string> = {
  DUPLICATE_OUTREACH: 'confirm_duplicate',
  UNVERIFIED_EMAIL: 'confirm_unverified_email',
  QUALITY_CHECK_FAILED: 'confirm_quality_override',
  RECRUITER_REPLIED: 'confirm_after_reply',
};

export function Composer({ prefill }: { prefill: ComposePrefill }) {
  const me = useLoad(() => api<MeResponse>('/api/me'));
  const resumes = useLoad(() => api<Resume[]>('/api/resumes'));
  const opps = useLoad(() => api<Paginated<Opportunity>>('/api/opportunities?active=true&page_size=100'));

  const [recruiter, setRecruiter] = useState<RecruiterDetail | null>(null);
  const [unknownEmail, setUnknownEmail] = useState<string | null>(null);
  const [opportunityId, setOpportunityId] = useState(prefill.opportunityId ?? '');
  const [manualRole, setManualRole] = useState('');
  const [resumeChoice, setResumeChoice] = useState<string | null | undefined>(undefined);
  const [tone, setTone] = useState<Tone | ''>('');
  const [goal, setGoal] = useState<OutreachGoal>('interview_consideration');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [kind, setKind] = useState<'initial' | 'follow_up'>('initial');
  const [gen, setGen] = useState<DraftResult | null>(null);
  const [rawFindings, setFindings] = useState<QualityFinding[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [initializing, setInitializing] = useState(!!(prefill.draftId || prefill.followUpId || prefill.recruiterId || prefill.recruiterEmail));
  const [reviewing, setReviewing] = useState(false);
  const [done, setDone] = useState<SendResponse | null>(null);
  const started = useRef(false);

  const resumeId = resumeChoice === undefined ? (me.data?.settings.default_resume_id ?? null) : resumeChoice;
  const findings = recruiter && (subject || body) ? rawFindings : null;

  /** Load the recipient; for a new email, preselect the posting they're linked to when there's exactly one. */
  async function loadRecruiter(id: string, pickOpportunity = false) {
    const r = await api<RecruiterDetail>(`/api/recruiters/${id}`);
    setRecruiter(r);
    if (pickOpportunity && r.opportunities.length === 1) setOpportunityId((cur) => cur || r.opportunities[0]!.id);
  }

  function applyMessage(m: MessageDetail) {
    setDraftId(m.id);
    setSubject(m.subject);
    setBody(m.body_text);
    setKind(m.kind);
    setOpportunityId(m.opportunity_id ?? '');
    setManualRole(m.manual_role ?? '');
    setResumeChoice(m.resume_id);
  }

  // Start from the prefill once (guarded against React strict-mode double effects).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (prefill.followUpId) {
          const r = await api<{ message: MessageDetail; draft: DraftResult | null }>(`/api/followups/${prefill.followUpId}/draft`, { method: 'POST', body: {} });
          applyMessage(r.message);
          if (r.draft) setGen(r.draft);
          if (r.message.recruiter_id) await loadRecruiter(r.message.recruiter_id);
        } else if (prefill.draftId) {
          const m = await api<MessageDetail>(`/api/messages/${prefill.draftId}`);
          if (['draft', 'failed'].includes(m.send_status)) applyMessage(m);
          else setError(new Error('That email was already sent or queued. Open it in the dashboard to see its status.'));
          if (m.recruiter_id) await loadRecruiter(m.recruiter_id);
        } else if (prefill.recruiterId) {
          await loadRecruiter(prefill.recruiterId, true);
        } else if (prefill.recruiterEmail) {
          const [hit] = await api<RecruiterLookupResult[]>('/api/recruiters/lookup', { method: 'POST', body: { emails: [prefill.recruiterEmail] } });
          if (hit?.recruiter) await loadRecruiter(hit.recruiter.id, true);
          else setUnknownEmail(prefill.recruiterEmail);
        }
      } catch (e) {
        setError(e);
      } finally {
        setInitializing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per composer (keyed by prefill)
  }, []);

  // Live quality check.
  useEffect(() => {
    if (!recruiter || (!subject && !body)) return;
    const t = setTimeout(() => {
      api<{ findings: QualityFinding[] }>('/api/messages/quality-check', {
        method: 'POST',
        body: { recruiter_id: recruiter.id, opportunity_id: opportunityId || null, resume_id: resumeId, kind, subject, body_text: body },
      }).then(
        (r) => setFindings(r.findings),
        () => undefined, // advisory; the server checks again on send
      );
    }, 700);
    return () => clearTimeout(t);
  }, [recruiter, opportunityId, resumeId, kind, subject, body]);

  const priorSent = (recruiter?.messages ?? []).filter((m) => m.send_status === 'sent' && m.id !== draftId);
  const context = () => ({
    recruiter_id: recruiter!.id,
    opportunity_id: opportunityId || null,
    manual_role: opportunityId ? null : manualRole || null,
    resume_id: resumeId,
    tone: tone || undefined,
    goal,
    kind,
    follow_up_of_message_id: kind === 'follow_up' ? (priorSent[0]?.id ?? null) : null,
  });

  async function generate(action?: AiRefineAction | 'template') {
    if (!recruiter) return;
    setBusy(action ?? 'generate');
    setError(null);
    try {
      const res =
        action && action !== 'template'
          ? await api<DraftResult>('/api/ai/refine', { method: 'POST', body: { ...context(), action, subject, body_text: body } })
          : await api<DraftResult>('/api/ai/draft', { method: 'POST', body: { ...context(), use_template: action === 'template' || !me.data?.ai.configured } });
      setSubject(res.subject);
      setBody(res.body_text);
      setGen(res);
      setFindings(res.quality);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft(): Promise<string | null> {
    if (!recruiter) return null;
    const payload = { subject, body_text: body, resume_id: resumeId, opportunity_id: opportunityId || null, manual_role: opportunityId ? null : manualRole || null };
    if (draftId) {
      await api(`/api/messages/${draftId}`, { method: 'PATCH', body: payload });
      return draftId;
    }
    const m = await api<MessageDetail>('/api/messages', {
      method: 'POST',
      body: {
        ...payload,
        recruiter_id: recruiter.id,
        follow_up_of_message_id: kind === 'follow_up' ? (priorSent[0]?.id ?? null) : null,
        ai_generated: gen?.source === 'ai',
        generation_meta: gen ? { source: gen.source, provider: gen.provider, model: gen.model, facts_used: gen.facts_used, via: 'extension' } : { via: 'extension' },
      },
    });
    setDraftId(m.id);
    return m.id;
  }

  if (done) return <Done result={done} onAgain={() => window.location.reload()} />;
  if (initializing || !me.data) return <div className="p-4"><Spinner /></div>;

  const blocker = gmailSendBlocker(me.data.gmail);
  const canReview = !!recruiter && !!subject.trim() && !!body.trim();
  const selectedResume = resumes.data?.find((r) => r.id === resumeId) ?? null;
  const recruiterOpps = new Set(recruiter?.opportunities.map((o) => o.id) ?? []);
  const oppList = [...(opps.data?.items ?? [])].sort((a, b) => Number(recruiterOpps.has(b.id)) - Number(recruiterOpps.has(a.id)));

  if (reviewing && recruiter) {
    return (
      <Review
        recruiter={recruiter}
        subject={subject}
        body={body}
        attachment={selectedResume ? attachmentDisplayName(selectedResume.file_name, me.data.settings.attachment_filename) : null}
        fromAccount={me.data.gmail.account_email}
        blocker={blocker}
        findings={findings ?? []}
        saveDraft={saveDraft}
        onBack={() => setReviewing(false)}
        onDone={setDone}
      />
    );
  }

  return (
    <div className="space-y-4 p-3">
      {error ? <ErrorNote error={error} /> : null}

      <section className="space-y-2">
        <span className="label">To</span>
        {recruiter ? (
          <div className="flex items-start gap-2 rounded border border-line bg-surface p-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{recruiter.full_name ?? recruiter.email}</div>
              <div className="truncate text-2xs text-muted">
                {recruiter.email}
                {recruiter.company ? `, ${recruiter.company}` : ''}
              </div>
              {recruiter.email_verification === 'unverified_guess' && <div className="text-2xs text-warn">Unconfirmed address. You'll be asked to check it before sending.</div>}
              {recruiter.do_not_contact && <div className="text-2xs text-danger">Marked do-not-contact.</div>}
              {kind === 'initial' && priorSent.length > 0 && (
                <div className="text-2xs text-warn">
                  You've emailed them {priorSent.length === 1 ? 'once' : `${priorSent.length} times`} already.{' '}
                  <button type="button" className="font-medium text-accent hover:underline" onClick={() => setKind('follow_up')}>
                    Write a follow-up instead
                  </button>
                </div>
              )}
            </div>
            {!draftId && (
              <button type="button" aria-label="Choose someone else" onClick={() => setRecruiter(null)} className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : unknownEmail ? (
          <QuickAdd email={unknownEmail} onAdded={(r) => void loadRecruiter(r.id).then(() => setUnknownEmail(null))} onCancel={() => setUnknownEmail(null)} />
        ) : (
          <RecruiterPicker onPick={(r) => void loadRecruiter(r.id, true).catch(setError)} />
        )}
      </section>

      {recruiter && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Role" htmlFor="c-opp" className="col-span-2">
              <select id="c-opp" className="field" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} disabled={kind === 'follow_up' && !!draftId}>
                <option value="">No saved posting</option>
                {oppList.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title} at {o.company}
                    {recruiterOpps.has(o.id) ? ' (linked)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            {!opportunityId && (
              <Field label="Role (if no posting)" htmlFor="c-role" className="col-span-2">
                <input id="c-role" className="field" value={manualRole} onChange={(e) => setManualRole(e.target.value)} placeholder={recruiter.target_role ?? 'Software Engineer Intern'} />
              </Field>
            )}
            <Field label="Résumé" htmlFor="c-resume" className="col-span-2">
              <select id="c-resume" className="field" value={resumeId ?? ''} onChange={(e) => setResumeChoice(e.target.value || null)}>
                <option value="">No attachment</option>
                {resumes.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                    {r.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tone" htmlFor="c-tone">
              <select id="c-tone" className="field" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                <option value="">Profile default</option>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {TONE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            {kind === 'initial' && (
              <Field label="Asking for" htmlFor="c-goal">
                <select id="c-goal" className="field" value={goal} onChange={(e) => setGoal(e.target.value as OutreachGoal)}>
                  {OUTREACH_GOALS.map((g) => (
                    <option key={g} value={g}>
                      {OUTREACH_GOAL_LABELS[g]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button variant="primary" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={busy === 'generate'} disabled={!!busy} onClick={() => void generate()}>
              {me.data.ai.configured ? (body ? 'Regenerate' : 'Generate draft') : 'Draft from template'}
            </Button>
            {me.data.ai.configured && (
              <Button size="sm" variant="ghost" loading={busy === 'template'} disabled={!!busy} onClick={() => void generate('template')}>
                Use my template
              </Button>
            )}
            {me.data.ai.configured &&
              body &&
              (['concise', 'personalize', 'emphasize_projects'] as const).map((a) => (
                <Button key={a} size="sm" loading={busy === a} disabled={!!busy} onClick={() => void generate(a)}>
                  {AI_REFINE_ACTION_LABELS[a]}
                </Button>
              ))}
          </div>
          {gen && (
            <p className="text-2xs text-faint">
              {gen.source === 'ai' ? `Written by ${gen.provider ?? 'AI'} from your profile facts.` : 'Built from your template and profile.'} Edit anything before sending.
              {gen.notes.length ? ` ${gen.notes.join(' ')}` : ''}
            </p>
          )}

          <Field label="Subject" htmlFor="c-subject">
            <input id="c-subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={kind === 'follow_up'} />
          </Field>
          <Field label="Email" htmlFor="c-body" hint={`${body.trim() ? body.trim().split(/\s+/).length : 0} words`}>
            <textarea id="c-body" rows={14} className="field leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Generate a draft or write your own." />
          </Field>

          {findings && findings.length > 0 && (
            <section aria-label="Quality check" className="space-y-1 rounded border border-line bg-surface p-2">
              {findings.map((f, i) => (
                <p key={`${f.code}-${i}`} className={clsx('text-2xs', f.severity === 'error' ? 'text-danger' : f.severity === 'warning' ? 'text-warn' : 'text-muted')}>
                  {f.message}
                </p>
              ))}
            </section>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Button variant="primary" disabled={!canReview} onClick={() => setReviewing(true)}>
              Review and send
            </Button>
            <Button
              loading={busy === 'save'}
              disabled={!recruiter || !!busy}
              onClick={async () => {
                setBusy('save');
                setError(null);
                try {
                  await saveDraft();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {draftId ? 'Save changes' : 'Save draft'}
            </Button>
          </div>
          <InsertIntoGmail subject={subject} body={body} disabled={!body.trim()} />
        </>
      )}
    </div>
  );
}

function RecruiterPicker({ onPick }: { onPick: (r: RecruiterSummary) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useLoad(() => api<Paginated<RecruiterSummary>>(`/api/recruiters?page_size=8&sort=${debounced ? 'name' : 'created_desc'}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`), [debounced]);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-faint" aria-hidden />
        <input aria-label="Find a recruiter" className="field pl-8" placeholder="Name, email or company" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.reload()} />
      ) : !list.data ? (
        <Spinner />
      ) : list.data.items.length === 0 ? (
        <p className="text-xs text-muted">
          No match. Add people from the popup or the{' '}
          <a href={dashboardLink('/recruiters')} target="_blank" rel="noreferrer">
            dashboard
          </a>
          .
        </p>
      ) : (
        <ul className="divide-y divide-line/60 rounded border border-line">
          {list.data.items.map((r) => (
            <li key={r.id}>
              <button type="button" disabled={r.do_not_contact} onClick={() => onPick(r)} className="w-full px-2.5 py-1.5 text-left hover:bg-raised disabled:opacity-50">
                <span className="block truncate text-sm">{r.full_name ?? r.email}</span>
                <span className="block truncate text-2xs text-muted">
                  {r.company ?? r.email}
                  {r.do_not_contact ? ' (do not contact)' : r.messages_sent ? `, emailed ${r.messages_sent}×` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuickAdd({ email, onAdded, onCancel }: { email: string; onAdded: (r: RecruiterSummary) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="space-y-2 rounded border border-line bg-surface p-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onAdded(await api<RecruiterSummary>('/api/recruiters', { method: 'POST', body: { email, full_name: name.trim() || null, company: company.trim() || null, source: 'manual' } }));
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs">
        <span className="text-ink">{email}</span> isn't in AutoReach yet. Add them to write and track your outreach.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name" htmlFor="qa-name">
          <input id="qa-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Company" htmlFor="qa-company">
          <input id="qa-company" className="field" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
      </div>
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy}>
          Add recruiter
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Choose someone else
        </Button>
      </div>
    </form>
  );
}

function InsertIntoGmail({ subject, body, disabled }: { subject: string; body: string; disabled: boolean }) {
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer select-none">Send from Gmail yourself instead</summary>
      <div className="mt-2 space-y-2">
        <p>
          Puts this text into the Gmail compose window open in the current tab. Emails you send that way aren't recorded by AutoReach, so there's no send status, open signal, reply detection or follow-up reminder for them.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled}
            onClick={async () => {
              const tab = await activeTab();
              if (tab?.id === undefined) return setState({ ok: false, message: 'No active tab.' });
              const res = await send<{ ok: boolean; error?: { message: string } }>({ type: 'gmail:insert', tabId: tab.id, subject, body });
              setState(res.ok ? { ok: true, message: 'Inserted into Gmail. Review it there before sending.' } : { ok: false, message: res.error?.message ?? 'Could not insert.' });
            }}
          >
            Insert into Gmail
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ClipboardCopy className="h-3.5 w-3.5" />}
            disabled={disabled}
            onClick={() =>
              navigator.clipboard.writeText(`${subject}\n\n${body}`).then(
                () => setState({ ok: true, message: 'Copied subject and email.' }),
                () => setState({ ok: false, message: 'Copy failed.' }),
              )
            }
          >
            Copy
          </Button>
        </div>
        {state && <p className={state.ok ? 'text-replied' : 'text-danger'}>{state.message}</p>}
      </div>
    </details>
  );
}

function Review(props: {
  recruiter: RecruiterDetail;
  subject: string;
  body: string;
  attachment: string | null;
  fromAccount: string | null;
  blocker: ReturnType<typeof gmailSendBlocker>;
  findings: QualityFinding[];
  saveDraft: () => Promise<string | null>;
  onBack: () => void;
  onDone: (r: SendResponse) => void;
}) {
  const [queue, setQueue] = useState(false);
  const [needs, setNeeds] = useState<Set<Confirmable>>(() => new Set(props.recruiter.email_verification === 'unverified_guess' ? ['UNVERIFIED_EMAIL'] : []));
  const [confirmed, setConfirmed] = useState<Set<Confirmable>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const keyRef = useRef(idempotencyKey());
  const blockingFindings = props.findings.filter((f) => f.severity === 'error');
  // Errors from the live check need the same explicit override the server asks for.
  const allNeeds = new Set<Confirmable>([...needs, ...(blockingFindings.length ? (['QUALITY_CHECK_FAILED'] as const) : [])]);

  async function sendNow() {
    setBusy(true);
    setError(null);
    try {
      const id = await props.saveDraft();
      if (!id) throw new Error('Could not save the draft before sending.');
      const body: Record<string, unknown> = { queue };
      for (const c of confirmed) body[CONFIRM_FIELD[c]] = true;
      const res = await api<SendResponse>(`/api/messages/${id}/send`, { method: 'POST', body, idempotencyKey: keyRef.current });
      props.onDone(res);
    } catch (e) {
      if (e instanceof ExtensionApiError && (CONFIRMABLE as readonly string[]).includes(e.code)) {
        setNeeds((n) => new Set([...n, e.code as Confirmable]));
        keyRef.current = idempotencyKey(); // rejected before sending; the next attempt is new
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const LABEL: Record<Confirmable, string> = {
    UNVERIFIED_EMAIL: `I've checked that ${props.recruiter.email} is the right address.`,
    DUPLICATE_OUTREACH: 'I know I already emailed this person and want to send another first email (for a different role).',
    RECRUITER_REPLIED: 'They already replied; I still want to send this.',
    QUALITY_CHECK_FAILED: 'Send anyway. I reviewed the problems above.',
  };
  const missing = [...allNeeds].filter((n) => !confirmed.has(n));

  return (
    <div className="space-y-3 p-3">
      <h2 className="text-sm font-semibold">Review before sending</h2>
      {props.blocker && <p className="rounded border border-warn/40 bg-warn/10 p-2.5 text-xs">{props.blocker.message} {props.blocker.action && <a href={dashboardLink('/settings?section=gmail')} target="_blank" rel="noreferrer">Open Gmail settings</a>}</p>}
      <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted">From</dt>
        <dd>{props.fromAccount ?? <span className="text-warn">Gmail not connected</span>}</dd>
        <dt className="text-muted">To</dt>
        <dd className="break-all">{props.recruiter.full_name ? `${props.recruiter.full_name} <${props.recruiter.email}>` : props.recruiter.email}</dd>
        <dt className="text-muted">Subject</dt>
        <dd>{props.subject}</dd>
        <dt className="text-muted">Attached</dt>
        <dd>{props.attachment ?? 'Nothing'}</dd>
      </dl>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-surface p-2.5 font-sans text-xs text-muted">{props.body}</pre>
      {blockingFindings.length > 0 && (
        <div className="space-y-1">
          {blockingFindings.map((f, i) => (
            <p key={i} className="text-xs text-danger">
              {f.message}
            </p>
          ))}
        </div>
      )}
      {allNeeds.size > 0 && (
        <div className="space-y-1.5 rounded border border-warn/40 bg-warn/5 p-2.5">
          {[...allNeeds].map((n) => (
            <label key={n} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed.has(n)}
                onChange={(e) =>
                  setConfirmed((c) => {
                    const next = new Set(c);
                    if (e.target.checked) next.add(n);
                    else next.delete(n);
                    return next;
                  })
                }
              />
              {LABEL[n]}
            </label>
          ))}
        </div>
      )}
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" className="mt-0.5" checked={queue} onChange={(e) => setQueue(e.target.checked)} />
        Let the queue send it (spaced out, respects your daily limit) instead of sending right now
      </label>
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex gap-2">
        <Button variant="primary" loading={busy} disabled={!!props.blocker || missing.length > 0} onClick={() => void sendNow()}>
          {queue ? 'Approve and queue' : 'Send email'}
        </Button>
        <Button variant="ghost" onClick={props.onBack}>
          Keep editing
        </Button>
      </div>
    </div>
  );
}

function Done({ result, onAgain }: { result: SendResponse; onAgain: () => void }) {
  const ok = result.outcome === 'sent' || result.outcome === 'queued';
  return (
    <div className="space-y-3 p-4">
      <p className={clsx('flex items-center gap-2 text-sm', ok ? 'text-replied' : result.outcome === 'unknown' ? 'text-warn' : 'text-danger')}>
        {ok && <Check className="h-4 w-4" />}
        {result.outcome === 'sent'
          ? `Sent to ${result.message.recipient_email}. Gmail accepted it.`
          : result.outcome === 'queued'
            ? 'Approved. The queue will send it.'
            : result.outcome === 'unknown'
              ? "Gmail didn't confirm whether this was sent. Check your Gmail Sent folder, then mark the result in the dashboard. It won't be sent again automatically."
              : `Not sent: ${result.error?.message ?? 'unknown error'}`}
      </p>
      {result.error?.code && <p className="text-2xs text-faint">Code {result.error.code}</p>}
      <div className="flex gap-2">
        <Button onClick={() => void chrome.tabs.create({ url: dashboardLink(`/outreach/${result.message.id}`) })}>Open in dashboard</Button>
        <Button variant="ghost" onClick={onAgain}>
          Write another
        </Button>
      </div>
    </div>
  );
}
