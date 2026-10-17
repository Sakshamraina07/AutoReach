import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { StatusTrack, TrackLegend } from '../components/StatusTrack';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Pagination, Spinner, Tabs } from '../components/ui';
import { fmtShortDate } from '../lib/format';
import { useMe, useMessages } from '../lib/queries';
import { TRACKING_OFF_NOTE } from '../lib/tracking';

type View = 'all' | 'draft' | 'queued' | 'sent' | 'failed' | 'unknown' | 'replied';

const VIEWS: { value: View; label: string; params: Record<string, string> }[] = [
  { value: 'all', label: 'All', params: {} },
  { value: 'draft', label: 'Drafts', params: { send_status: 'draft' } },
  { value: 'queued', label: 'Queued', params: { send_status: 'queued' } },
  { value: 'sent', label: 'Sent', params: { send_status: 'sent' } },
  { value: 'replied', label: 'Replied', params: { reply_status: 'replied' } },
  { value: 'failed', label: 'Failed', params: { send_status: 'failed' } },
  { value: 'unknown', label: 'Outcome unknown', params: { send_status: 'unknown' } },
];

export default function Outreach() {
  const [params, setParams] = useSearchParams();
  const initial: View = params.get('reply_status') === 'replied' ? 'replied' : ((params.get('send_status') as View | null) ?? 'all');
  const [view, setView] = useState<View>(VIEWS.some((v) => v.value === initial) ? initial : 'all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const v = VIEWS.find((x) => x.value === view)!;
  const list = useMessages({ ...v.params, q, page, page_size: 25 });
  const me = useMe();
  const trackingOn = me.data?.tracking.configured ?? true;

  return (
    <>
      <PageHeader
        title="Outreach"
        description={
          trackingOn
            ? 'Every email you drafted or sent. Sent means Gmail accepted it; opens are approximate; replies come from your Gmail threads.'
            : `Every email you drafted or sent. Sent means Gmail accepted it; replies come from your Gmail threads. ${TRACKING_OFF_NOTE}`
        }
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/outreach/new')}>
            New outreach
          </Button>
        }
      />
      <div className="panel">
        <div className="flex flex-wrap items-end justify-between gap-3 px-3 pt-2">
          <Tabs
            label="Filter outreach"
            value={view}
            onChange={(x) => {
              setView(x);
              setPage(1);
              setParams({}, { replace: true });
            }}
            items={VIEWS.map((x) => ({ value: x.value, label: x.label }))}
          />
          <div className="relative mb-2 w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-faint" aria-hidden />
            <input aria-label="Search outreach" className="field pl-8" placeholder="Subject, recipient or company" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        {list.isError ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !list.data ? (
          <div className="px-4">
            <Spinner />
          </div>
        ) : list.data.items.length === 0 ? (
          <EmptyState title={view === 'all' && !q ? 'No emails yet' : 'Nothing here'} action={view === 'all' && !q ? <Button variant="primary" onClick={() => navigate('/outreach/new')}>Write an email</Button> : undefined} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th className="hidden md:table-cell">Role</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((m) => (
                    <tr
                      key={m.id}
                      className="cursor-pointer"
                      onClick={() => navigate(['draft', 'failed'].includes(m.send_status) ? `/outreach/new?draft=${m.id}` : `/outreach/${m.id}`)}
                    >
                      <td className="max-w-[220px]">
                        <div className="truncate text-ink">{m.recruiter_name ?? m.recipient_email}</div>
                        <div className="truncate text-2xs text-faint">{m.company ?? m.recipient_email}</div>
                      </td>
                      <td className="max-w-[320px]">
                        <Link to={`/outreach/${m.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-muted hover:text-ink">
                          {m.subject || '(no subject)'}
                        </Link>
                        <div className="flex gap-1">
                          {m.kind === 'follow_up' && <Badge>follow-up</Badge>}
                          {m.ai_generated && <Badge>AI-assisted</Badge>}
                          {m.legacy && <Badge>v1</Badge>}
                        </div>
                      </td>
                      <td className="hidden max-w-[180px] truncate text-muted md:table-cell">{m.role_label ?? '—'}</td>
                      <td className="num whitespace-nowrap text-muted">
                        {m.sent_at ? fmtShortDate(m.sent_at) : m.scheduled_for ? `for ${fmtShortDate(m.scheduled_for)}` : fmtShortDate(m.updated_at)}
                      </td>
                      <td className="whitespace-nowrap">
                        <StatusTrack m={m} />
                        {m.error_message && ['failed', 'unknown', 'draft'].includes(m.send_status) && <div className="max-w-[260px] truncate text-2xs text-faint" title={m.error_message}>{m.error_message}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3">
              <TrackLegend />
              <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
