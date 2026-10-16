import {
  AI_REFINE_ACTION_LABELS,
  attachmentDisplayName,
  OUTREACH_GOAL_LABELS,
  OUTREACH_GOALS,
  TONE_LABELS,
  TONES,
  type AiRefineAction,
  type DraftResult,
  type MessageDetail,
  type OutreachGoal,
  type QualityFinding,
  type RecruiterSummary,
  type Tone,
} from '@autoreach/shared';
import { ArrowLeft, FileText, Paperclip, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AddRecruiterDialog } from '../components/RecruiterForm';
import { QualityPanel } from '../components/QualityPanel';
import { Badge, Button, Dialog, ErrorState, Field, Spinner, Toggle, useToast } from '../components/ui';
import { api, ApiError, idempotencyKey } from '../lib/api';
import { gmailProblem } from '../lib/gmail';
import { fmtBytes, fmtDate } from '../lib/format';
import { useInvalidate, useMe, useOpportunities, useOpportunity, useRecruiter, useRecruiters, useResumes } from '../lib/queries';

interface SendResponse {
  outcome: 'sent' | 'failed' | 'unknown' | 'queued';
  message: MessageDetail;
  error?: { code: string; message: string };
}

const REFINES: AiRefineAction[] = ['concise', 'personalize', 'emphasize_projects', 'regenerate'];

export default function Composer() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const me = useMe();
  const resumes = useResumes();
  const opps = useOpportunities({ active: 'true', page_size: 200 });

  const [recruiterId, setRecruiterId] = useState(params.get('recruiter') ?? '');
  const [opportunityId, setOpportunityId] = useState(params.get('opportunity') ?? '');
  const [manualRole, setManualRole] = useState('');
  // undefined = not chosen yet → the default from settings applies.
  const [resumeChoice, setResumeId] = useState<string | null | undefined>(undefined);
  const [tone, setTone] = useState<Tone | ''>('');
  const [goal, setGoal] = useState<OutreachGoal>('interview_consideration');
  const [extra, setExtra] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // null = not chosen yet → the default from settings applies.
  const [trackingChoice, setTracking] = useState<boolean | null>(null);
  const [draftId, setDraftId] = useState<string | null>(params.get('draft'));
  const [kind, setKind] = useState<'initial' | 'follow_up'>('initial');
  const [gen, setGen] = useState<Pick<DraftResult, 'source' | 'provider' | 'model' | 'facts_used' | 'notes'> | null>(null);
  const [rawFindings, setFindings] = useState<QualityFinding[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [addingRecruiter, setAddingRecruiter] = useState(false);
  const [loadedDraft, setLoadedDraft] = useState(() => !params.get('draft') && !params.get('followup'));
  const loadStarted = useRef(false);

  const recruiter = useRecruiter(recruiterId || null);
  const opportunity = useOpportunity(opportunityId || null);
  const recruiterSearch = useRecruiters({ page_size: 200, sort: 'name' });

  // Load an existing draft (edit) or create one from a follow-up reminder.
  useEffect(() => {
    if (loadedDraft || loadStarted.current) return;
    loadStarted.current = true;
    const followUp = params.get('followup');
    const id = params.get('draft');
    (async () => {
      try {
        let m: MessageDetail;
        if (followUp) {
          const r = await api<{ message: MessageDetail; draft: DraftResult | null }>(`/api/followups/${followUp}/draft`, { method: 'POST', body: {} });
          m = r.message;
          if (r.draft) setGen(r.draft);
          const next = new URLSearchParams(params);
          next.delete('followup');
          next.set('draft', m.id);
          setParams(next, { replace: true });
        } else {
          m = await api<MessageDetail>(`/api/messages/${id}`);
        }
        if (!['draft', 'failed'].includes(m.send_status)) {
          navigate(`/outreach/${m.id}`, { replace: true });
          return;
        }
        setDraftId(m.id);
        setRecruiterId(m.recruiter_id ?? '');
        setOpportunityId(m.opportunity_id ?? '');
        setManualRole(m.manual_role ?? '');
        setResumeId(m.resume_id);
        setSubject(m.subject);
        setBody(m.body_text);
        setTracking(m.tracking_enabled);
        setKind(m.kind);
      } catch (e) {
        setError(e);
      } finally {
        setLoadedDraft(true);
      }
    })();
  }, [params, setParams, navigate, loadedDraft]);

  const resumeId = resumeChoice === undefined ? (me.data?.settings.default_resume_id ?? null) : resumeChoice;
  const tracking = trackingChoice ?? (me.data ? me.data.settings.tracking_enabled && me.data.tracking.configured : false);

  const findings = recruiterId && (subject || body) ? rawFindings : null;
  const selectedResume = resumes.data?.find((r) => r.id === resumeId) ?? null;
  const r = recruiter.data;
  const priorSent = (r?.messages ?? []).filter((m) => m.send_status === 'sent' && m.id !== draftId);
  const linkedRecruiterIds = useMemo(() => new Set(opportunity.data?.recruiters.map((x) => x.id) ?? []), [opportunity.data]);

  const contextBody = useCallback(
    () => ({
      recruiter_id: recruiterId,
      opportunity_id: opportunityId || null,
      manual_role: opportunityId ? null : manualRole || null,
      resume_id: resumeId ?? null,
      tone: tone || undefined,
      goal,
      kind,
      extra_instructions: extra || null,
      follow_up_of_message_id: kind === 'follow_up' ? priorSent.at(0)?.id ?? null : null,
    }),
    [recruiterId, opportunityId, manualRole, resumeId, tone, goal, kind, extra, priorSent],
  );

  // Live quality check (debounced).
  useEffect(() => {
    if (!recruiterId || (!subject && !body)) return;
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await api<{ findings: QualityFinding[] }>('/api/messages/quality-check', {
          method: 'POST',
          body: { recruiter_id: recruiterId, opportunity_id: opportunityId || null, resume_id: resumeId ?? null, kind, subject, body_text: body },
        });
        setFindings(res.findings);
      } catch {
        /* the check is advisory; errors surface on send */
      } finally {
        setChecking(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [recruiterId, opportunityId, resumeId, kind, subject, body]);

  async function generate(action?: AiRefineAction | 'template') {
    if (!recruiterId) return toast.info('Choose a recruiter first.');
    setBusy(action ?? 'generate');
    setError(null);
    try {
      const res =
        action && action !== 'template'
          ? await api<DraftResult>('/api/ai/refine', { method: 'POST', body: { ...contextBody(), action, subject, body_text: body } })
          : await api<DraftResult>('/api/ai/draft', { method: 'POST', body: { ...contextBody(), use_template: action === 'template' } });
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

  async function saveDraft(silent = false): Promise<string | null> {
    if (!recruiterId) {
      toast.info('Choose a recruiter first.');
      return null;
    }
    const payload = {
      subject,
      body_text: body,
      resume_id: resumeId ?? null,
      opportunity_id: opportunityId || null,
      manual_role: opportunityId ? null : manualRole || null,
      tracking_enabled: !!tracking,
    };
    try {
      let id = draftId;
      if (id) {
        await api(`/api/messages/${id}`, { method: 'PATCH', body: payload });
      } else {
        const m = await api<MessageDetail>('/api/messages', {
          method: 'POST',
          body: {
            ...payload,
            recruiter_id: recruiterId,
            follow_up_of_message_id: kind === 'follow_up' ? priorSent.at(0)?.id ?? null : null,
            ai_generated: gen?.source === 'ai',
            generation_meta: gen ? { source: gen.source, provider: gen.provider, model: gen.model, facts_used: gen.facts_used } : undefined,
          },
        });
        id = m.id;
        setDraftId(m.id);
        const next = new URLSearchParams(params);
        next.set('draft', m.id);
        setParams(next, { replace: true });
      }
      await invalidate();
      if (!silent) toast.success('Draft saved');
      return id;
    } catch (e) {
      setError(e);
      return null;
    }
  }

  async function previewResume() {
    if (!resumeId) return;
    try {
      const res = await api<Response>(`/api/resumes/${resumeId}/file`, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(e);
    }
  }

  const blocking = findings?.some((f) => f.severity === 'error') ?? false;
  const canSend = !!recruiterId && !!subject.trim() && !!body.trim();

  if (!loadedDraft) return <Spinner label="Loading draft" />;

  return (
    <>
      <Link to="/outreach" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Outreach
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">{kind === 'follow_up' ? 'Follow-up email' : 'New outreach'}</h1>
          <p className="mt-1 text-sm text-muted">Nothing is sent until you review the email and press Send.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void saveDraft()} disabled={!recruiterId}>
            Save draft
          </Button>
          <Button variant="primary" disabled={!canSend} onClick={() => setSendOpen(true)}>
            Review and send
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* ---------------- context column ---------------- */}
        <div className="space-y-4">
          <section className="panel space-y-3 p-4">
            <Field label="Opportunity" htmlFor="c-opp">
              <select id="c-opp" className="field" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} disabled={kind === 'follow_up' && !!draftId}>
                <option value="">No saved posting</option>
                {opps.data?.items.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title} — {o.company}
                  </option>
                ))}
              </select>
            </Field>
            {!opportunityId && (
              <Field label="Role (if no posting)" htmlFor="c-role" hint="Leave empty for a speculative email about internships or entry-level roles.">
                <input id="c-role" className="field" value={manualRole} onChange={(e) => setManualRole(e.target.value)} placeholder="Backend Software Engineer Intern" />
              </Field>
            )}
            <Field label="Recruiter" htmlFor="c-rec">
              <div className="flex gap-2">
                <select id="c-rec" className="field" value={recruiterId} onChange={(e) => setRecruiterId(e.target.value)} disabled={!!draftId}>
                  <option value="">Choose…</option>
                  {[...(recruiterSearch.data?.items ?? [])]
                    .sort((a, b) => Number(linkedRecruiterIds.has(b.id)) - Number(linkedRecruiterIds.has(a.id)))
                    .map((x: RecruiterSummary) => (
                      <option key={x.id} value={x.id} disabled={x.do_not_contact}>
                        {linkedRecruiterIds.has(x.id) ? '★ ' : ''}
                        {x.full_name ?? x.email}
                        {x.company ? ` — ${x.company}` : ''}
                        {x.do_not_contact ? ' (do not contact)' : ''}
                      </option>
                    ))}
                </select>
                {!draftId && (
                  <Button onClick={() => setAddingRecruiter(true)} aria-label="Add a new recruiter">
                    New
                  </Button>
                )}
              </div>
            </Field>
            {r && (
              <div className="rounded border border-line bg-bg p-2.5 text-xs">
                <p className="text-ink">
                  {r.full_name ?? '(name unknown)'} &lt;{r.email}&gt;
                </p>
                <p className="text-muted">{[r.title, r.company].filter(Boolean).join(' at ') || 'No title or company saved'}</p>
                {r.email_verification === 'unverified_guess' && <p className="mt-1 text-warn">This address is an unconfirmed guess. You'll be asked to confirm it before sending.</p>}
                {kind === 'initial' && priorSent.length > 0 && (
                  <p className="mt-1 text-warn">
                    You've already emailed them {priorSent.length} time{priorSent.length > 1 ? 's' : ''} (last {fmtDate(priorSent[0]?.sent_at)}).{' '}
                    <button type="button" className="text-accent hover:underline" onClick={() => { setKind('follow_up'); setSubject(''); setBody(''); }}>
                      Write a follow-up instead
                    </button>
                  </p>
                )}
                {r.outreach_status === 'replied' && <p className="mt-1 text-replied">They replied — consider answering in Gmail instead.</p>}
              </div>
            )}
          </section>

          <section className="panel space-y-3 p-4">
            <Field label="Résumé to attach" htmlFor="c-resume">
              <select id="c-resume" className="field" value={resumeId ?? ''} onChange={(e) => setResumeId(e.target.value || null)}>
                <option value="">No attachment</option>
                {resumes.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                    {x.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            {selectedResume ? (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Paperclip className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1 truncate" title={selectedResume.file_name}>
                  {selectedResume.file_name} ({fmtBytes(selectedResume.size_bytes)})
                </span>
                <button type="button" className="text-accent hover:underline" onClick={previewResume}>
                  Preview
                </button>
              </div>
            ) : me.data?.settings.require_resume_attachment ? (
              <p className="text-xs text-warn">Your settings require a résumé attachment.</p>
            ) : null}
            {resumes.data?.length === 0 && (
              <p className="text-xs text-muted">
                No résumé uploaded. <Link to="/settings?section=resumes">Upload one</Link>.
              </p>
            )}
            <Field label="Tone" htmlFor="c-tone">
              <select id="c-tone" className="field" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                <option value="">Profile default{me.data?.profile ? ` (${TONE_LABELS[me.data.profile.preferred_tone]})` : ''}</option>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {TONE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            {kind === 'initial' && (
              <Field label="What you're asking for" htmlFor="c-goal">
                <select id="c-goal" className="field" value={goal} onChange={(e) => setGoal(e.target.value as OutreachGoal)}>
                  {OUTREACH_GOALS.map((g) => (
                    <option key={g} value={g}>
                      {OUTREACH_GOAL_LABELS[g]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Extra instructions (optional)" htmlFor="c-extra">
              <input id="c-extra" className="field" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Mention I can start in January" />
            </Field>
            <Toggle
              checked={!!tracking}
              onChange={setTracking}
              disabled={!me.data?.tracking.configured}
              label="Open tracking for this email"
              description={me.data?.tracking.configured ? 'Adds an invisible image. Opens are approximate and never trigger follow-ups.' : 'Not available on this server (API_PUBLIC_URL must be https).'}
            />
          </section>
        </div>

        {/* ---------------- editor column ---------------- */}
        <div className="min-w-0 space-y-4">
          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={busy === 'generate'} disabled={!recruiterId || !!busy} onClick={() => generate()}>
                {me.data?.ai.configured ? 'Generate email' : 'Draft from template'}
              </Button>
              {me.data?.ai.configured && (
                <>
                  {REFINES.map((a) => (
                    <Button key={a} size="sm" icon={a === 'regenerate' ? <RefreshCw className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />} loading={busy === a} disabled={!body || !!busy} onClick={() => generate(a)}>
                      {AI_REFINE_ACTION_LABELS[a]}
                    </Button>
                  ))}
                  <Button size="sm" loading={busy === 'change_tone'} disabled={!body || !tone || !!busy} onClick={() => generate('change_tone')} title={tone ? '' : 'Pick a tone on the left first'}>
                    Change tone
                  </Button>
                  <Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} disabled={!recruiterId || !!busy} loading={busy === 'template'} onClick={() => generate('template')}>
                    Use my template
                  </Button>
                </>
              )}
            </div>
            {!me.data?.ai.configured && <p className="mb-3 text-xs text-muted">AI drafting isn't configured on the server, so drafts come from your template and profile. You can edit everything.</p>}
            <div className="space-y-3">
              <Field label="Subject" htmlFor="c-subject" hint={kind === 'follow_up' ? 'Follow-ups keep the original subject so they stay in the same Gmail thread.' : undefined}>
                <input id="c-subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={kind === 'follow_up'} />
              </Field>
              <Field label="Email" htmlFor="c-body">
                <textarea id="c-body" rows={16} className="field font-[inherit] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Generate a draft or write your own." />
              </Field>
              <p className="num text-right text-2xs text-faint">{body.trim() ? body.trim().split(/\s+/).length : 0} words</p>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-4">
              <h2 className="mb-2 text-sm">Quality check</h2>
              <QualityPanel findings={findings} loading={checking} />
            </section>
            <section className="panel p-4">
              <h2 className="mb-2 text-sm">How this draft was made</h2>
              {!gen ? (
                <p className="text-xs text-faint">Generate a draft to see which of your facts it used.</p>
              ) : (
                <div className="space-y-2 text-xs text-muted">
                  <p>
                    {gen.source === 'ai' ? (
                      <>
                        AI draft ({gen.provider}, {gen.model}). Only facts from your profile, résumé, the posting and your notes were provided.
                      </>
                    ) : (
                      'Built from your template and profile without AI.'
                    )}
                  </p>
                  {gen.facts_used.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {gen.facts_used.map((f) => (
                        <Badge key={f}>{f.replace(':', ' ')}</Badge>
                      ))}
                    </div>
                  )}
                  {gen.notes.map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {sendOpen && r && (
        <SendDialog
          recruiter={r}
          subject={subject}
          body={body}
          attachment={selectedResume ? `${attachmentDisplayName(selectedResume.file_name, me.data?.settings.attachment_filename)} (${fmtBytes(selectedResume.size_bytes)})` : null}
          tracking={!!tracking}
          fromAccount={me.data?.gmail.account_email ?? null}
          gmailProblem={gmailProblem(me.data?.gmail)}
          blocking={blocking}
          findings={findings ?? []}
          kind={kind}
          ensureDraft={async () => {
            const id = await saveDraft(true);
            return id ?? draftId;
          }}
          onClose={() => setSendOpen(false)}
          onDone={(res) => {
            void invalidate();
            if (res.outcome === 'sent') toast.success(`Sent to ${r.email}`);
            else if (res.outcome === 'queued') toast.success('Approved and queued');
            navigate(`/outreach/${res.message.id}`);
          }}
        />
      )}
      {addingRecruiter && (
        <AddRecruiterDialog
          onClose={() => setAddingRecruiter(false)}
          initial={{ company: opportunity.data?.company ?? '', opportunity_id: opportunityId, target_role: opportunity.data?.title ?? manualRole }}
          onCreated={(x) => setRecruiterId(x.id)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function SendDialog(props: {
  recruiter: RecruiterSummary;
  subject: string;
  body: string;
  attachment: string | null;
  tracking: boolean;
  fromAccount: string | null;
  gmailProblem: { message: string; action: string | null } | null;
  blocking: boolean;
  findings: QualityFinding[];
  kind: 'initial' | 'follow_up';
  ensureDraft: () => Promise<string | null>;
  onClose: () => void;
  onDone: (r: SendResponse) => void;
}) {
  const [when, setWhen] = useState<'now' | 'queue' | 'schedule'>('now');
  const [at, setAt] = useState('');
  const [confirm, setConfirm] = useState({ confirm_duplicate: false, confirm_unverified_email: false, confirm_quality_override: false, confirm_after_reply: false });
  const [needs, setNeeds] = useState<Set<string>>(new Set(props.recruiter.email_verification === 'unverified_guess' ? ['UNVERIFIED_EMAIL'] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SendResponse | null>(null);
  const keyRef = useRef<string>(idempotencyKey());

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const id = await props.ensureDraft();
      if (!id) throw new Error('Could not save the draft before sending.');
      const res = await api<SendResponse>(`/api/messages/${id}/send`, {
        method: 'POST',
        headers: { 'Idempotency-Key': keyRef.current },
        body: {
          ...confirm,
          queue: when === 'queue',
          send_at: when === 'schedule' && at ? new Date(at).toISOString() : null,
        },
      });
      if (res.outcome === 'failed' || res.outcome === 'unknown') {
        setResult(res);
        keyRef.current = idempotencyKey(); // a retry after a definite failure is a new attempt
      } else props.onDone(res);
    } catch (e) {
      if (e instanceof ApiError && ['DUPLICATE_OUTREACH', 'UNVERIFIED_EMAIL', 'QUALITY_CHECK_FAILED', 'RECRUITER_REPLIED'].includes(e.code)) {
        setNeeds((n) => new Set([...n, e.code]));
        keyRef.current = idempotencyKey();
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Dialog title={result.outcome === 'unknown' ? 'Outcome unknown' : 'Email not sent'} onClose={props.onClose} footer={<Button onClick={() => props.onDone(result)}>Open message</Button>}>
        <div className={result.outcome === 'unknown' ? 'text-warn' : 'text-danger'}>
          <p className="text-sm">{result.error?.message}</p>
          {result.error?.code && <p className="mt-1 text-2xs text-faint">Code {result.error.code}</p>}
        </div>
        {result.error?.code?.startsWith('GMAIL_') && (
          <p className="mt-3 text-sm">
            <Link to="/settings?section=gmail">Check your Gmail connection</Link>
          </p>
        )}
      </Dialog>
    );
  }

  const checkbox = (key: keyof typeof confirm, label: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={confirm[key]} onChange={(e) => setConfirm((c) => ({ ...c, [key]: e.target.checked }))} />
      <span>{label}</span>
    </label>
  );

  return (
    <Dialog
      title="Review and send"
      onClose={props.onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Keep editing
          </Button>
          <Button variant="primary" loading={busy} onClick={send} disabled={(when === 'schedule' && !at) || !!props.gmailProblem}>
            {when === 'now' ? 'Send email' : when === 'queue' ? 'Approve and queue' : 'Schedule email'}
          </Button>
        </>
      }
    >
      {props.gmailProblem && (
        <div role="alert" className="mb-4 rounded border border-warn/40 bg-warn/10 p-3 text-sm">
          <p>{props.gmailProblem.message}</p>
          {props.gmailProblem.action && (
            <Link to="/settings?section=gmail" className="mt-1 inline-block font-medium" onClick={() => void props.ensureDraft()}>
              {props.gmailProblem.action}
            </Link>
          )}
        </div>
      )}
      <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted">From</dt>
        <dd>{props.fromAccount ?? <span className="text-warn">Gmail not connected</span>}</dd>
        <dt className="text-muted">To</dt>
        <dd className="break-all">
          {props.recruiter.full_name ? `${props.recruiter.full_name} <${props.recruiter.email}>` : props.recruiter.email}
        </dd>
        <dt className="text-muted">Subject</dt>
        <dd>{props.subject}</dd>
        <dt className="text-muted">Attachment</dt>
        <dd>{props.attachment ?? 'None'}</dd>
        <dt className="text-muted">Tracking</dt>
        <dd>{props.tracking ? 'Open tracking on' : 'Off'}</dd>
      </dl>
      <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-bg p-3 font-sans text-sm text-muted">{props.body}</pre>

      <fieldset className="mt-4 space-y-1.5">
        <legend className="label">When</legend>
        {(
          [
            ['now', 'Send now'],
            ['queue', 'Approve and let the queue send it (spaced out, respects your daily limit)'],
            ['schedule', 'Schedule for a specific time'],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input type="radio" name="when" checked={when === v} onChange={() => setWhen(v)} />
            {l}
          </label>
        ))}
        {when === 'schedule' && <input type="datetime-local" className="field mt-1 w-auto" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Send at" />}
      </fieldset>

      {(needs.size > 0 || props.blocking) && (
        <div className="mt-4 space-y-2 rounded border border-warn/40 bg-warn/5 p-3">
          {needs.has('UNVERIFIED_EMAIL') && checkbox('confirm_unverified_email', `I've checked that ${props.recruiter.email} is the right address.`)}
          {needs.has('DUPLICATE_OUTREACH') && checkbox('confirm_duplicate', 'I know I already emailed this person and want to send a new first email (for a different role).')}
          {needs.has('RECRUITER_REPLIED') && checkbox('confirm_after_reply', 'They replied already; I still want to send this email.')}
          {(needs.has('QUALITY_CHECK_FAILED') || props.blocking) && (
            <>
              <QualityPanel findings={props.findings.filter((f) => f.severity === 'error')} />
              {checkbox('confirm_quality_override', 'Send anyway — I reviewed these problems.')}
            </>
          )}
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
