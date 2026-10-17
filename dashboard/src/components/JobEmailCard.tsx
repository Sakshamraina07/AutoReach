import { attachmentDisplayName, type MessageDetail, type MessageSummary, type PreparedEmail, type QualityFinding, type RecruiterSummary } from '@autoreach/shared';
import { Check, Loader2, Paperclip, RefreshCw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, idempotencyKey } from '../lib/api';
import { fmtDate, fmtDateTime, fmtResumeSize } from '../lib/format';
import { gmailProblem } from '../lib/gmail';
import { useInvalidate, useMe, useMessage, useResumes } from '../lib/queries';
import { QualityPanel } from './QualityPanel';
import { Badge, Button, ErrorState, useToast } from './ui';

/** Send refusals the person can confirm and retry from the card itself. */
const CONFIRMABLE = {
  DUPLICATE_OUTREACH: { field: 'confirm_duplicate', label: 'I know I already emailed this person and want to send this as a new first email.' },
  UNVERIFIED_EMAIL: { field: 'confirm_unverified_email', label: 'I checked that this address is right.' },
  RECRUITER_REPLIED: { field: 'confirm_after_reply', label: 'They replied already; I still want to send this email.' },
  QUALITY_CHECK_FAILED: { field: 'confirm_quality_override', label: 'Send anyway. I read the problems above.' },
} as const;
type ConfirmCode = keyof typeof CONFIRMABLE;

interface SendResponse {
  outcome: 'sent' | 'failed' | 'unknown' | 'queued';
  message: MessageDetail;
  error?: { code: string; message: string };
}

export interface JobEmailCardProps {
  recruiter: RecruiterSummary;
  /** The latest email to this person about the job, if any. */
  summary: MessageSummary | null;
  /** Returned by the page's last "write" call for this person. */
  prepared: PreparedEmail | null;
  working: boolean;
  /** Waiting for an earlier person's email to finish. */
  queued: boolean;
  busyElsewhere: boolean;
  error: unknown;
  onWrite: (opts: { regenerate?: boolean; use_template?: boolean }) => void;
}

export function JobEmailCard(props: JobEmailCardProps) {
  const { recruiter: r, summary } = props;
  const status = summary?.send_status;
  const editable = status === 'draft' || status === 'failed';

  return (
    <article className="panel" aria-label={`Email to ${r.full_name ?? r.email}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">{r.full_name ?? r.email}</p>
          <p className="truncate text-xs text-muted">
            {r.title ? `${r.title}, ` : ''}
            {r.email}
            {r.email_verification === 'unverified_guess' ? <span className="text-warn"> (unconfirmed guess)</span> : null}
          </p>
        </div>
        <StatusBadge summary={summary} recruiter={r} />
      </header>

      {r.do_not_contact ? (
        <p className="px-4 py-3 text-sm text-muted">Marked do-not-contact. No email will be written.</p>
      ) : summary && !editable ? (
        <SentState summary={summary} />
      ) : props.working ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Writing {r.full_name ? `${r.full_name.split(' ')[0]}'s` : 'the'} email from the job and your profile…
        </p>
      ) : summary ? (
        <DraftEditor
          // A rewrite replaces the editor so its text starts from the new version.
          key={`${summary.id}:${props.prepared?.message.updated_at ?? ''}`}
          summary={summary}
          prepared={props.prepared?.message.id === summary.id ? props.prepared : null}
          recruiter={r}
          busyElsewhere={props.busyElsewhere}
          onRewrite={(useTemplate) => props.onWrite({ regenerate: true, use_template: useTemplate })}
        />
      ) : (
        <div className="space-y-3 px-4 py-3">
          {props.error ? <ErrorState error={props.error} /> : <p className="text-sm text-muted">{props.queued ? 'Waiting for the email above to finish.' : 'No email yet.'}</p>}
          {!props.queued && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={props.busyElsewhere} onClick={() => props.onWrite({})}>
                Write email
              </Button>
              {props.error instanceof ApiError && props.error.code.startsWith('AI_') ? (
                <Button size="sm" disabled={props.busyElsewhere} onClick={() => props.onWrite({ use_template: true })}>
                  Use my template instead
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function StatusBadge({ summary, recruiter }: { summary: MessageSummary | null; recruiter: RecruiterSummary }) {
  if (summary?.reply_status === 'replied' || recruiter.outreach_status === 'replied') return <Badge tone="success">Replied</Badge>;
  switch (summary?.send_status) {
    case 'sent':
      return <Badge tone="sent">Sent</Badge>;
    case 'queued':
      return <Badge tone="info">{summary.scheduled_for ? 'Scheduled' : 'Queued'}</Badge>;
    case 'sending':
      return <Badge tone="info">Sending</Badge>;
    case 'unknown':
      return <Badge tone="warning">Check Gmail</Badge>;
    case 'failed':
      return <Badge tone="danger">Not sent</Badge>;
    case 'draft':
      return <Badge>Ready to send</Badge>;
    default:
      return null;
  }
}

function SentState({ summary }: { summary: MessageSummary }) {
  const s = summary.send_status;
  return (
    <div className="space-y-1 px-4 py-3 text-sm">
      <p className="truncate text-ink" title={summary.subject}>
        {summary.subject}
      </p>
      <p className="text-muted">
        {s === 'sent' ? (
          <>
            <Check className="mr-1 inline h-3.5 w-3.5 text-replied" aria-hidden />
            Sent {fmtDateTime(summary.sent_at)}.
            {summary.next_follow_up_at ? ` Follow-up reminder on ${fmtDate(summary.next_follow_up_at)}.` : ''}
          </>
        ) : s === 'queued' ? (
          summary.scheduled_for ? `Scheduled for ${fmtDateTime(summary.scheduled_for)}.` : 'Approved. The send queue will send it shortly.'
        ) : s === 'sending' ? (
          'Sending now.'
        ) : (
          'The last attempt may or may not have reached Gmail. Check your Sent folder and record what happened.'
        )}{' '}
        <Link to={`/outreach/${summary.id}`}>Open</Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Draft: edit in place, one click to send                             */
/* ------------------------------------------------------------------ */

function DraftEditor({
  summary,
  prepared,
  recruiter,
  busyElsewhere,
  onRewrite,
}: {
  summary: MessageSummary;
  prepared: PreparedEmail | null;
  recruiter: RecruiterSummary;
  busyElsewhere: boolean;
  onRewrite: (useTemplate: boolean) => void;
}) {
  const fetched = useMessage(prepared ? null : summary.id);
  const message = prepared?.message ?? fetched.data ?? null;
  if (fetched.isError) return <div className="p-4"><ErrorState error={fetched.error} onRetry={() => fetched.refetch()} /></div>;
  if (!message) return <p className="px-4 py-4 text-sm text-muted">Loading the draft…</p>;
  return <DraftForm message={message} prepared={prepared} recruiter={recruiter} busyElsewhere={busyElsewhere} onRewrite={onRewrite} />;
}

interface Draft {
  subject: string;
  body: string;
  resumeId: string | null;
}

const sameDraft = (a: Draft, b: Draft) => a.subject === b.subject && a.body === b.body && a.resumeId === b.resumeId;

function DraftForm({
  message,
  prepared,
  recruiter,
  busyElsewhere,
  onRewrite,
}: {
  message: MessageDetail;
  prepared: PreparedEmail | null;
  recruiter: RecruiterSummary;
  busyElsewhere: boolean;
  onRewrite: (useTemplate: boolean) => void;
}) {
  const me = useMe();
  const resumes = useResumes();
  const invalidate = useInvalidate();
  const toast = useToast();
  const initial: Draft = { subject: message.subject, body: message.body_text, resumeId: message.resume_id };
  const [draft, setDraft] = useState<Draft>(initial);
  // What the server has, so only real edits are saved.
  const [saved, setSaved] = useState<Draft>(initial);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [findings, setFindings] = useState<QualityFinding[] | null>(prepared?.quality ?? null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [refused, setRefused] = useState<ConfirmCode[]>([]);
  const [confirmed, setConfirmed] = useState<Partial<Record<ConfirmCode, boolean>>>({});
  const keyRef = useRef(idempotencyKey());
  const dirty = !sameDraft(draft, saved);
  const edit = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  async function persist(d: Draft) {
    await api(`/api/messages/${message.id}`, { method: 'PATCH', body: { subject: d.subject, body_text: d.body, resume_id: d.resumeId } });
    setSaved(d);
  }

  // Edits are saved a moment after typing stops.
  useEffect(() => {
    if (sameDraft(draft, saved)) return;
    const t = setTimeout(() => {
      api(`/api/messages/${message.id}`, { method: 'PATCH', body: { subject: draft.subject, body_text: draft.body, resume_id: draft.resumeId } })
        .then(() => {
          setSaved(draft);
          setSaveError(null);
        })
        .catch((e: unknown) => setSaveError(e));
    }, 900);
    return () => clearTimeout(t);
  }, [draft, saved, message.id]);

  // The quality check runs again after edits (the server runs it once more before sending).
  const checkedFresh = !!prepared && sameDraft(draft, initial);
  useEffect(() => {
    if (checkedFresh) return;
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await api<{ findings: QualityFinding[] }>('/api/messages/quality-check', {
          method: 'POST',
          body: { recruiter_id: recruiter.id, opportunity_id: message.opportunity_id, resume_id: draft.resumeId, kind: 'initial', subject: draft.subject, body_text: draft.body },
        });
        setFindings(res.findings);
      } catch {
        /* advisory only */
      } finally {
        setChecking(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [checkedFresh, draft, recruiter.id, message.opportunity_id]);

  const gmail = gmailProblem(me.data?.gmail);
  const blocking = findings?.some((f) => f.severity === 'error') ?? false;
  // Problems the person must acknowledge before this email can go: shown before the first click when known.
  const needs: ConfirmCode[] = [...refused];
  if (blocking && !needs.includes('QUALITY_CHECK_FAILED')) needs.push('QUALITY_CHECK_FAILED');
  if (recruiter.email_verification === 'unverified_guess' && !needs.includes('UNVERIFIED_EMAIL')) needs.push('UNVERIFIED_EMAIL');
  const unconfirmed = needs.some((c) => !confirmed[c]);
  const empty = !draft.subject.trim() || !draft.body.trim();
  const resume = resumes.data?.find((x) => x.id === draft.resumeId) ?? null;
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0;
  const madeBy = prepared?.draft ? (prepared.draft.source === 'ai' ? `Written by ${prepared.draft.model ?? 'AI'} from your profile and this job.` : 'Built from your template and profile.') : null;

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      if (!sameDraft(draft, saved)) await persist(draft);
      const flags = Object.fromEntries(needs.filter((c) => confirmed[c]).map((c) => [CONFIRMABLE[c].field, true]));
      const res = await api<SendResponse>(`/api/messages/${message.id}/send`, { method: 'POST', headers: { 'Idempotency-Key': keyRef.current }, body: flags });
      if (res.outcome === 'failed' || res.outcome === 'unknown') {
        keyRef.current = idempotencyKey();
        setSendError(new Error(res.error?.message ?? (res.outcome === 'unknown' ? 'Gmail didn’t confirm the send. Check your Sent folder before trying again.' : 'Gmail refused the email.')));
      } else toast.success(res.outcome === 'sent' ? `Sent to ${recruiter.email}` : 'Approved and queued');
      await invalidate();
    } catch (e) {
      if (e instanceof ApiError && e.code in CONFIRMABLE) {
        const code = e.code as ConfirmCode;
        setRefused((n) => (n.includes(code) ? n : [...n, code]));
        const serverFindings = (e.details as { findings?: QualityFinding[] } | undefined)?.findings;
        if (serverFindings) setFindings(serverFindings);
        keyRef.current = idempotencyKey();
      }
      setSendError(e);
    } finally {
      setSending(false);
    }
  }

  const confirmable = sendError instanceof ApiError && sendError.code in CONFIRMABLE;

  return (
    <div className="space-y-3 px-4 py-3">
      <label className="sr-only" htmlFor={`subj-${message.id}`}>
        Subject
      </label>
      <input id={`subj-${message.id}`} className="field font-medium" value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} />
      <label className="sr-only" htmlFor={`body-${message.id}`}>
        Email
      </label>
      <textarea
        id={`body-${message.id}`}
        rows={Math.min(18, Math.max(9, draft.body.split('\n').length + 2))}
        className="field leading-relaxed"
        value={draft.body}
        onChange={(e) => edit({ body: e.target.value })}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="num">{words} words</span>
        <span className="flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          <select aria-label="Résumé to attach" className="h-6 rounded border border-line bg-bg px-1 text-xs text-ink" value={draft.resumeId ?? ''} onChange={(e) => edit({ resumeId: e.target.value || null })}>
            <option value="">No attachment</option>
            {resumes.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {attachmentDisplayName(x.file_name, me.data?.settings.attachment_filename)} ({fmtResumeSize(x)})
              </option>
            ))}
          </select>
          {!resume && me.data?.settings.require_resume_attachment ? <span className="text-warn">Your settings require a résumé.</span> : null}
        </span>
        <span aria-live="polite">{saveError ? <span className="text-danger">Not saved. Check your connection.</span> : dirty ? 'Saving…' : 'Saved'}</span>
      </div>
      {(madeBy || prepared?.draft?.notes.length) && (
        <div className="space-y-0.5 text-xs text-faint">
          {madeBy && <p>{madeBy}</p>}
          {prepared?.draft?.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      {(checking || (findings && findings.length > 0)) && <QualityPanel findings={findings} loading={checking} />}

      {needs.length > 0 && (
        <div className="space-y-2 rounded border border-warn/40 bg-warn/5 p-3">
          {confirmable ? <p className="text-sm text-warn">{(sendError as ApiError).message}</p> : null}
          {needs.map((c) => (
            <label key={c} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={!!confirmed[c]} onChange={(e) => setConfirmed((x) => ({ ...x, [c]: e.target.checked }))} />
              <span>{c === 'UNVERIFIED_EMAIL' ? `I checked that ${recruiter.email} is the right address.` : CONFIRMABLE[c].label}</span>
            </label>
          ))}
        </div>
      )}
      {sendError && !confirmable ? <ErrorState error={sendError} /> : null}

      {gmail ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-raised p-3 text-sm">
          <span className="flex-1">{gmail.message.replace(' Your draft is saved when you leave.', '').replace(' Save it as a draft for now.', '')} This draft is saved.</span>
          {gmail.action && (
            <Link to="/settings?section=gmail" className="font-medium">
              {gmail.action}
            </Link>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={sending} disabled={empty || !!gmail || unconfirmed} onClick={send}>
          Send cold email
        </Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={sending || busyElsewhere} onClick={() => onRewrite(false)}>
          Write again
        </Button>
        <Link to={`/outreach/new?draft=${message.id}`} className="text-sm text-muted">
          Shorten, change tone or schedule
        </Link>
      </div>
    </div>
  );
}
