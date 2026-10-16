import { EMPLOYMENT_TYPE_LABELS, OPPORTUNITY_STATUS_LABELS, OPPORTUNITY_STATUSES, ROLE_CATEGORY_LABELS, type OpportunityStatus } from '@autoreach/shared';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OpportunityDialog } from '../components/OpportunityForm';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Pagination, Spinner, Tabs, useToast, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { fmtShortDate } from '../lib/format';
import { useInvalidate, useOpportunities } from '../lib/queries';

export const OPP_TONE: Record<OpportunityStatus, Tone> = {
  saved: 'neutral',
  researching: 'neutral',
  ready: 'info',
  contacted: 'sent',
  applied: 'sent',
  interviewing: 'success',
  offer: 'success',
  rejected: 'danger',
  closed: 'neutral',
};

export default function Opportunities() {
  const [view, setView] = useState<'active' | 'closed' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const list = useOpportunities({ q: search, active: view === 'all' ? undefined : view === 'active' ? 'true' : 'false', page, page_size: 25 });
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const toast = useToast();

  async function setStatus(id: string, status: string) {
    try {
      await api(`/api/opportunities/${id}`, { method: 'PATCH', body: { status } });
      await invalidate();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="Job postings and companies you're targeting. Link recruiters to them so every email knows which role it's about."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            Save opportunity
          </Button>
        }
      />
      <div className="panel">
        <div className="flex flex-wrap items-end justify-between gap-3 px-3 pt-2">
          <Tabs
            label="Opportunity view"
            value={view}
            onChange={(v) => {
              setView(v);
              setPage(1);
            }}
            items={[
              { value: 'active', label: 'Active' },
              { value: 'closed', label: 'Offer, rejected or closed' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="relative mb-2 w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-faint" aria-hidden />
            <input aria-label="Search opportunities" className="field pl-8" placeholder="Search title, company, location" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
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
          <EmptyState title={search ? 'No opportunities match your search' : 'No opportunities here yet'} action={!search && <Button variant="primary" onClick={() => setAdding(true)}>Save opportunity</Button>}>
            {!search && 'Paste a job description and AutoReach extracts the skills it asks for, compares them with your profile and tailors your drafts to it.'}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Type</th>
                    <th className="hidden md:table-cell">Recruiters</th>
                    <th className="hidden lg:table-cell">Sent / replies</th>
                    <th className="hidden lg:table-cell">Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((o) => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/opportunities/${o.id}`)}>
                      <td className="max-w-[320px]">
                        <div className="truncate text-ink">{o.title}</div>
                        <div className="truncate text-2xs text-faint">
                          {o.company}
                          {o.location ? `, ${o.location}` : ''} ({ROLE_CATEGORY_LABELS[o.role_category]})
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select aria-label={`Status of ${o.title}`} className="field h-7 w-auto py-0 text-xs" value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}>
                          {OPPORTUNITY_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {OPPORTUNITY_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="hidden text-muted md:table-cell">{EMPLOYMENT_TYPE_LABELS[o.employment_type]}</td>
                      <td className="num hidden md:table-cell">{o.recruiter_count ? o.recruiter_count : <Badge tone="warning">none yet</Badge>}</td>
                      <td className="num hidden text-muted lg:table-cell">
                        {o.messages_sent} / <span className={o.replies ? 'text-replied' : ''}>{o.replies}</span>
                      </td>
                      <td className="num hidden whitespace-nowrap text-muted lg:table-cell">{fmtShortDate(o.deadline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </div>
      {adding && <OpportunityDialog onClose={() => setAdding(false)} onSaved={(o) => navigate(`/opportunities/${o.id}`)} />}
    </>
  );
}
