import { OPEN_TRACKING_CAVEAT, REPLY_STATUSES, type ReplyStatus } from '@autoreach/shared';
import { ArrowLeft, ExternalLink, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StatusBadge, StatusTrack } from '../components/StatusTrack';
import { Badge, Button, Confirm, ErrorState, SectionTitle, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtBytes, fmtDateTime } from '../lib/format';
import { useInvalidate, useMessage } from '../lib/queries';

const CLASSIFICATION_LABEL: Record<string, string> = {
  open_detected: 'Open detected',
  proxy: 'Loaded through a mail image proxy',
  suspected_self: 'Probably you (right after sending or while viewing it)',
  suspected_automated: 'Probably a security scanner',
};

const INBOUND_LABEL: Record<string, string> = {
  reply: 'Reply from the recruiter',
  possible_reply: 'From someone else at their company',
  auto_reply: 'Automatic reply',
  bounce: 'Delivery failure',
  own_message: 'Sent by you from Gmail',
  other_sender: 'From another sender',
};

const REPLY_LABEL: Record<ReplyStatus, string> = {
  none: 'No reply',
  replied: 'Replied',
  auto_reply: 'Automatic reply only',
  bounced: 'Bounced',
  needs_review: 'Needs review',
};

export default function MessagePage() {
  const { id = '' } = useParams();
  const q = useMessage(id);
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [resolving, setResolving] = useState<'sent' | 'failed' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const m = q.data;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!m) return <Spinner />;

  const counted = m.events.filter((e) => e.counted).length;

  async function setReply(status: ReplyStatus) {
    try {
      await api(`/api/messages/${id}/reply-status`, { method: 'PATCH', body: { reply_status: status } });
      await invalidate();
      toast.success(status === 'replied' ? 'Marked as replied. Pending follow-ups were cancelled.' : 'Reply status updated');
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <Link to="/outreach" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Outreach
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl">{m.subject || '(no subject)'}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusTrack m={m} />
            {m.kind === 'follow_up' && <Badge>follow-up</Badge>}
            {m.ai_generated && <Badge>AI-assisted</Badge>}
            {m.legacy && <Badge title="Sent with AutoReach v1; the body was not stored then.">v1 email</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {['draft', 'failed'].includes(m.send_status) && (
            <Button variant="primary" onClick={() => navigate(`/outreach/new?draft=${m.id}`)}>
              {m.send_status === 'failed' ? 'Edit and retry' : 'Continue editing'}
            </Button>
          )}
          {m.send_status === 'queued' && <Button onClick={() => setCancelling(true)}>Cancel sending</Button>}
          {m.send_status === 'unknown' && (
            <>
              <Button onClick={() => setResolving('sent')}>It was sent</Button>
              <Button onClick={() => setResolving('failed')}>It was not sent</Button>
            </>
          )}
          {m.send_status === 'sent' && m.recruiter_id && m.reply_status !== 'replied' && (
            <Button onClick={() => navigate(`/outreach/new?recruiter=${m.recruiter_id}${m.opportunity_id ? `&opportunity=${m.opportunity_id}` : ''}`)}>Write another email</Button>
          )}
          {m.gmail_url && (
            <a href={m.gmail_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded border border-line bg-raised px-3 text-sm text-ink hover:no-underline">
              <ExternalLink className="h-4 w-4" /> Open in Gmail
            </a>
          )}
        </div>
      </div>

      {m.error_message && (
        <div className={`mb-4 rounded border p-3 text-sm ${m.send_status === 'unknown' ? 'border-warn/40 bg-warn/5' : 'border-danger/40 bg-danger/5'}`}>
          <p>{m.error_message}</p>
          {m.error_code && <p className="mt-1 text-2xs text-faint">Code {m.error_code}</p>}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel min-w-0">
          <SectionTitle>Message</SectionTitle>
          <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 border-b border-line px-4 py-3 text-sm">
            <dt className="text-muted">To</dt>
            <dd className="break-all">
              {m.recruiter_id ? <Link to={`/recruiters?open=${m.recruiter_id}`}>{m.recruiter_name ?? m.recipient_email}</Link> : m.recruiter_name ?? m.recipient_email}{' '}
              <span className="text-muted">&lt;{m.recipient_email}&gt;</span>
            </dd>
            <dt className="text-muted">Role</dt>
            <dd>{m.opportunity_id ? <Link to={`/opportunities/${m.opportunity_id}`}>{m.role_label}</Link> : m.role_label ?? '—'}</dd>
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusBadge m={m} />
            </dd>
            <dt className="text-muted">Sent</dt>
            <dd>{m.sent_at ? fmtDateTime(m.sent_at) : m.scheduled_for ? `Scheduled for ${fmtDateTime(m.scheduled_for)}` : '—'}</dd>
            {m.attachment && (
              <>
                <dt className="text-muted">Attached</dt>
                <dd className="flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5 text-muted" /> {m.attachment.file_name} ({fmtBytes(m.attachment.size_bytes)})
                </dd>
              </>
            )}
          </dl>
          {m.body_text ? (
            <p className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed">{m.body_text}</p>
          ) : (
            <p className="px-4 py-4 text-sm text-muted">{m.legacy ? 'AutoReach v1 did not store email bodies.' : 'Empty message.'}</p>
          )}
        </section>

        <aside className="space-y-6">
          <section className="panel">
            <SectionTitle>Replies</SectionTitle>
            <div className="space-y-3 px-4 py-3 text-sm">
              {m.send_status !== 'sent' ? (
                <p className="text-muted">Reply detection starts after the email is sent.</p>
              ) : (
                <>
                  <p>
                    {m.reply_status === 'replied' ? (
                      <span className="text-replied">Replied {m.replied_at ? fmtDateTime(m.replied_at) : ''}</span>
                    ) : (
                      REPLY_LABEL[m.reply_status]
                    )}
                  </p>
                  {m.thread.length > 0 && (
                    <ul className="space-y-1.5">
                      {m.thread.map((t) => (
                        <li key={t.id} className="text-xs">
                          <span className="text-ink">{INBOUND_LABEL[t.classification] ?? t.classification}</span>
                          <span className="text-muted">, {t.from_email}, {fmtDateTime(t.occurred_at)}</span>
                          {t.needs_review && <Badge tone="warning" className="ml-1">review</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="block">
                    <span className="label">Correct the reply status</span>
                    <select aria-label="Reply status" className="field" value={m.reply_status} onChange={(e) => setReply(e.target.value as ReplyStatus)}>
                      {REPLY_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {REPLY_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <SectionTitle>Open tracking</SectionTitle>
            <div className="space-y-2 px-4 py-3 text-sm">
              {!m.tracking_enabled ? (
                <p className="text-muted">Tracking was off for this email.</p>
              ) : m.events.length === 0 ? (
                <p className="text-muted">No open detected. That doesn't mean it wasn't read — many mail apps block images.</p>
              ) : (
                <>
                  <p>
                    {counted} counted open signal{counted === 1 ? '' : 's'}
                    {m.first_open_at ? `, first ${fmtDateTime(m.first_open_at)}` : ''}.
                  </p>
                  <ul className="space-y-1 text-xs">
                    {m.events.map((e) => (
                      <li key={e.id} className={e.counted ? 'text-ink' : 'text-faint'}>
                        {fmtDateTime(e.occurred_at)}: {CLASSIFICATION_LABEL[e.classification] ?? e.classification}
                        {!e.counted && ' (not counted)'}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="text-2xs text-faint">{OPEN_TRACKING_CAVEAT}</p>
            </div>
          </section>
        </aside>
      </div>

      {resolving && (
        <Confirm
          title={resolving === 'sent' ? 'Mark as sent?' : 'Mark as not sent?'}
          confirmLabel={resolving === 'sent' ? 'Yes, it was sent' : 'Yes, it was not sent'}
          body={
            <p>
              Check your Gmail Sent folder for “{m.subject}” to {m.recipient_email}.{' '}
              {resolving === 'sent' ? 'A follow-up reminder will be scheduled.' : 'You can then edit and send it again.'}
            </p>
          }
          onClose={() => setResolving(null)}
          onConfirm={async () => {
            await api(`/api/messages/${id}/resolve`, { method: 'POST', body: { outcome: resolving } });
            await invalidate();
          }}
        />
      )}
      {cancelling && (
        <Confirm
          title="Cancel this queued email?"
          confirmLabel="Move back to drafts"
          body={<p>It won't be sent. You can edit it and send later.</p>}
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            await api(`/api/messages/${id}/cancel`, { method: 'POST' });
            await invalidate();
          }}
        />
      )}
    </>
  );
}
