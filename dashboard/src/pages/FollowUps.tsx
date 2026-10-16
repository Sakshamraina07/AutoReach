import type { FollowUp } from '@autoreach/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, plural, relative } from '../lib/format';
import { useFollowUps, useInvalidate, useMe, useMessage, useReviewQueue } from '../lib/queries';

type View = 'due' | 'upcoming' | 'closed' | 'review';

export default function FollowUps() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('tab') as View | null) ?? 'due';
  const due = useFollowUps('due');
  const upcoming = useFollowUps('upcoming');
  const closed = useFollowUps('closed');
  const review = useReviewQueue();
  const me = useMe();
  const data = view === 'due' ? due : view === 'upcoming' ? upcoming : closed;

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description={`Reminders are created ${plural(me.data?.settings.followup_delay_business_days ?? 5, 'business day')} after each email and cancelled automatically when a reply arrives. Nothing is sent without your approval${me.data?.settings.followup_autosend_enabled ? ' unless you enabled auto-send in Settings' : ''}.`}
      />
      <div className="panel">
        <div className="px-3 pt-2">
          <Tabs
            label="Follow-up view"
            value={view}
            onChange={(v) => setParams(v === 'due' ? {} : { tab: v }, { replace: true })}
            items={[
              { value: 'due', label: `Due now${due.data ? ` (${due.data.total})` : ''}` },
              { value: 'upcoming', label: `Upcoming${upcoming.data ? ` (${upcoming.data.total})` : ''}` },
              { value: 'review', label: `Needs review${review.data?.length ? ` (${review.data.length})` : ''}` },
              { value: 'closed', label: 'Done or cancelled' },
            ]}
          />
        </div>
        {view === 'review' ? (
          <ReviewQueue />
        ) : data.isError ? (
          <div className="p-4">
            <ErrorState error={data.error} onRetry={() => data.refetch()} />
          </div>
        ) : !data.data ? (
          <div className="px-4">
            <Spinner />
          </div>
        ) : data.data.items.length === 0 ? (
          <EmptyState title={view === 'due' ? 'No follow-ups due' : view === 'upcoming' ? 'No upcoming follow-ups' : 'Nothing closed yet'}>
            {view === 'due' && 'When a reminder comes due it shows up here with the email you sent before.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line/60">
            {data.data.items.map((f) => (
              <FollowUpRow key={f.id} f={f} focused={params.get('focus') === f.id} autosendEnabled={!!me.data?.settings.followup_autosend_enabled} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function FollowUpRow({ f, focused, autosendEnabled }: { f: FollowUp; focused: boolean; autosendEnabled: boolean }) {
  const [open, setOpen] = useState(focused);
  const [rescheduling, setRescheduling] = useState(false);
  const previous = useMessage(open ? f.previous_message_id : null);
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const toast = useToast();
  const overdue = f.status === 'pending' && new Date(f.due_at) < new Date();

  async function update(body: object, msg: string) {
    try {
      await api(`/api/followups/${f.id}`, { method: 'PATCH', body });
      await invalidate();
      toast.success(msg);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <li className={focused ? 'bg-accent/5' : ''}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" aria-expanded={open} aria-label={open ? 'Hide previous email' : 'Show previous email'} onClick={() => setOpen(!open)} className="rounded p-0.5 text-muted hover:bg-raised">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/recruiters?open=${f.recruiter_id}`} className="truncate text-sm font-medium text-ink">
              {f.recruiter_name ?? f.recruiter_email}
            </Link>
            {f.company && <span className="text-xs text-muted">{f.company}</span>}
            <Badge>follow-up {f.step}</Badge>
            {f.status !== 'pending' && <Badge tone={f.status === 'cancelled' ? 'warning' : 'neutral'}>{f.cancel_reason ? f.cancel_reason.replace(/_/g, ' ') : f.status}</Badge>}
            {f.auto_send && f.status === 'pending' && <Badge tone="info">auto-send on</Badge>}
          </div>
          <p className="truncate text-xs text-muted">
            After “{f.previous_subject}”, emailed {fmtDate(f.previous_sent_at)}
            {f.business_days_since_contact !== null ? ` (${plural(f.business_days_since_contact, 'business day')} ago)` : ''}.
          </p>
        </div>
        <div className="text-right text-xs">
          <div className={overdue ? 'text-warn' : 'text-muted'}>{f.status === 'pending' ? `Due ${relative(f.due_at)}` : fmtDate(f.due_at)}</div>
        </div>
        {f.status === 'pending' && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => navigate(f.draft_message_id ? `/outreach/new?draft=${f.draft_message_id}` : `/outreach/new?followup=${f.id}`)}>
              {f.draft_message_id ? 'Open draft' : 'Draft follow-up'}
            </Button>
            <Button size="sm" onClick={() => setRescheduling(true)}>
              Reschedule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => update({ status: 'completed' }, 'Marked as done')} title="You followed up some other way">
              Mark done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => update({ status: 'dismissed' }, 'Reminder dismissed')}>
              Dismiss
            </Button>
            {f.auto_send ? (
              <Button size="sm" variant="ghost" onClick={() => update({ auto_send: false }, 'This follow-up will wait for you')}>
                Don't auto-send
              </Button>
            ) : (
              autosendEnabled && (
                <Button size="sm" variant="ghost" onClick={() => update({ auto_send: true }, 'This follow-up may be sent automatically from your template')}>
                  Allow auto-send
                </Button>
              )
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="mx-4 mb-3 ml-11 rounded border border-line bg-bg p-3 text-sm">
          {!previous.data ? (
            <Spinner label="Loading previous email" />
          ) : (
            <>
              <p className="mb-1 text-xs text-muted">
                Previous email, sent {fmtDateTime(previous.data.sent_at)}:
              </p>
              <p className="whitespace-pre-wrap leading-relaxed text-muted">{previous.data.body_text || '(AutoReach v1 did not store the body of this email.)'}</p>
            </>
          )}
        </div>
      )}
      {rescheduling && <RescheduleDialog f={f} onClose={() => setRescheduling(false)} onSave={(iso) => update({ due_at: iso }, 'Reminder rescheduled')} />}
    </li>
  );
}

function RescheduleDialog({ f, onClose, onSave }: { f: FollowUp; onClose: () => void; onSave: (iso: string) => Promise<void> }) {
  const [value, setValue] = useState(() => {
    const d = new Date(Math.max(Date.now(), new Date(f.due_at).getTime()) + 2 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Reschedule reminder"
      onClose={onClose}
      width="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onSave(new Date(`${value}T10:00:00`).toISOString());
              setBusy(false);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <label className="label" htmlFor="resched">
        Remind me on
      </label>
      <input id="resched" type="date" className="field" value={value} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
}

function ReviewQueue() {
  const q = useReviewQueue();
  const invalidate = useInvalidate();
  const toast = useToast();
  if (q.isError) return <div className="p-4"><ErrorState error={q.error} /></div>;
  if (!q.data) return <div className="px-4"><Spinner /></div>;
  if (!q.data.length)
    return (
      <EmptyState title="Nothing to review">
        When someone other than the recruiter writes in one of your threads (a colleague, a forwarded reply), it waits here until you decide whether it counts as a reply.
      </EmptyState>
    );
  return (
    <ul className="divide-y divide-line/60">
      {q.data.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">
              {item.from_name ? `${item.from_name} <${item.from_email}>` : item.from_email}
            </p>
            <p className="truncate text-xs text-muted">
              Wrote in your thread “{item.original_subject ?? item.subject}” to {item.recruiter_name ?? item.recipient_email}, {fmtDateTime(item.received_at)}
            </p>
          </div>
          <a href={`https://mail.google.com/mail/u/0/#all/${item.gmail_thread_id}`} target="_blank" rel="noreferrer" className="text-xs">
            Open in Gmail
          </a>
          {(['is_reply', 'not_reply'] as const).map((decision) => (
            <Button
              key={decision}
              size="sm"
              variant={decision === 'is_reply' ? 'primary' : 'secondary'}
              onClick={async () => {
                try {
                  await api(`/api/review-queue/${item.id}`, { method: 'POST', body: { decision } });
                  await invalidate();
                  toast.success(decision === 'is_reply' ? 'Counted as a reply; follow-ups cancelled' : 'Not counted as a reply');
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              {decision === 'is_reply' ? "It's a reply" : 'Not a reply'}
            </Button>
          ))}
        </li>
      ))}
    </ul>
  );
}
