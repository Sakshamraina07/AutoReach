import type { ActivityType, KpiValue } from '@autoreach/shared';
import { clsx } from 'clsx';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SentRepliesChart } from '../components/charts';
import { GettingStarted } from '../components/GettingStarted';
import { StatusTrack, TrackLegend } from '../components/StatusTrack';
import { Button, EmptyState, ErrorState, PageHeader, SectionTitle, Spinner } from '../components/ui';
import { fmtPct, fmtShortDate, plural, relative } from '../lib/format';
import { useActivity, useFollowUps, useMe, useMessages, useOpportunities, useOverview, useRecommendations, useReviewQueue, useTimeseries } from '../lib/queries';

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

function Delta({ kpi, range }: { kpi: KpiValue; range: string }) {
  if (kpi.previous === null) return null;
  const diff = kpi.value - kpi.previous;
  return (
    <span className={clsx('num text-2xs', diff > 0 ? 'text-replied' : diff < 0 ? 'text-danger' : 'text-faint')}>
      {diff > 0 ? '+' : ''}
      {diff} vs previous {range.replace('d', ' days')}
    </span>
  );
}

export default function Overview() {
  const [range, setRange] = useState('30d');
  const overview = useOverview(range);
  const series = useTimeseries(range);
  const recent = useMessages({ page_size: 8 });
  const due = useFollowUps('due');
  const recs = useRecommendations();
  const activity = useActivity({ page_size: 12 });
  const review = useReviewQueue();
  const me = useMe();
  // One sent email anywhere in history ends the getting-started checklist.
  const sent = useMessages({ send_status: 'sent', page_size: 1 });
  const jobs = useOpportunities({ page_size: 1 });
  const navigate = useNavigate();

  const trackingOn = me.data?.tracking.configured ?? true;
  const showChecklist = !!me.data && !!sent.data && !!jobs.data && sent.data.total === 0;

  const k = overview.data?.kpis;
  const cells = k
    ? [
        { label: 'Recruiters', value: k.total_recruiters.value, delta: k.total_recruiters, to: '/recruiters', note: 'in your CRM' },
        { label: 'Emails attempted', value: k.emails_attempted.value, delta: k.emails_attempted, to: '/outreach', note: 'sent, failed or unknown' },
        { label: 'Sent successfully', value: k.emails_sent.value, delta: k.emails_sent, to: '/outreach?send_status=sent', note: 'accepted by Gmail' },
        { label: 'Replies', value: k.replies.value, delta: k.replies, to: '/outreach?reply_status=replied', note: 'detected in your threads' },
        { label: 'Follow-ups due', value: k.followups_due.value, delta: k.followups_due, to: '/followups', note: 'today or overdue', warn: k.followups_due.value > 0 },
        { label: 'Active jobs', value: k.active_opportunities.value, delta: k.active_opportunities, to: '/opportunities', note: 'not closed' },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          trackingOn
            ? 'Everything below comes from your own records. Opens are approximate; replies come from your Gmail threads.'
            : 'Everything below comes from your own records. Replies come from your Gmail threads.'
        }
        actions={
          <div role="group" aria-label="Period" className="flex rounded border border-line p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => setRange(r.value)}
                className={clsx('rounded px-2.5 py-1 text-xs', range === r.value ? 'bg-raised text-ink' : 'text-muted hover:text-ink')}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {showChecklist && me.data && jobs.data && <GettingStarted me={me.data} hasJob={jobs.data.total > 0} />}

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !k ? (
        <Spinner />
      ) : (
        <section aria-label="Key numbers" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
          {cells.map((c) => (
            <Link key={c.label} to={c.to} className="group block bg-surface px-4 py-3 no-underline hover:bg-raised hover:no-underline">
              <div className="text-xs text-muted">{c.label}</div>
              <div className={clsx('num mt-1 text-3xl font-semibold', c.warn ? 'text-warn' : 'text-ink')}>{c.value}</div>
              <div className="mt-0.5 flex flex-col">
                <span className="text-2xs text-faint">{c.note}</span>
                <Delta kpi={c.delta} range={range} />
              </div>
            </Link>
          ))}
        </section>
      )}
      {k && (
        <p className="mt-2 text-xs text-muted">
          Response rate{' '}
          <span className="num font-medium text-ink">{fmtPct(k.response_rate.value)}</span> across {plural(k.response_rate.sample, 'first email')} in this period
          {k.response_rate.sample > 0 && k.response_rate.sample < 10 ? ' — small sample, treat as directional' : ''}.
          {trackingOn && (
            <>
              {' '}
              Opens detected: <span className="num text-ink">{k.opens_detected.value}</span> (approximate).
            </>
          )}
        </p>
      )}

      {review.data && review.data.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/5 px-4 py-2.5 text-sm">
          <span className="font-medium">{plural(review.data.length, 'message')} in your threads need a decision.</span>
          <span className="text-muted">Someone other than the recruiter wrote back — is it a reply?</span>
          <Link to="/followups?tab=review" className="ml-auto font-medium">
            Review now
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel min-w-0" aria-labelledby="recent-h">
          <SectionTitle actions={<Link to="/outreach" className="text-xs">All outreach</Link>}>
            <span id="recent-h">Recent outreach</span>
          </SectionTitle>
          {recent.isError ? (
            <div className="p-4">
              <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
            </div>
          ) : !recent.data ? (
            <div className="px-4">
              <Spinner />
            </div>
          ) : recent.data.items.length === 0 ? (
            <EmptyState
              title="No outreach yet"
              action={
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" onClick={() => navigate('/jobs/new')}>
                    New job
                  </Button>
                  <Link to="/outreach/new" className="text-xs text-muted hover:text-ink">
                    Write a single email
                  </Link>
                </div>
              }
            >
              Paste a job posting or open one from career-ops, add the people to write to, and AutoReach drafts one email per person for you to review and send from your Gmail.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Recruiter</th>
                    <th>Role and subject</th>
                    <th>Sent</th>
                    <th>Status</th>
                    <th className="hidden sm:table-cell">Next follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.items.map((m) => (
                    <tr key={m.id} className="cursor-pointer" onClick={() => navigate(`/outreach/${m.id}`)}>
                      <td className="max-w-[180px]">
                        <div className="truncate text-ink">{m.recruiter_name ?? m.recipient_email}</div>
                        <div className="truncate text-2xs text-faint">{m.company ?? '—'}</div>
                      </td>
                      <td className="max-w-[260px]">
                        <div className="truncate text-muted">{m.role_label ?? '—'}</div>
                        <Link to={`/outreach/${m.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-2xs text-faint hover:text-ink">
                          {m.subject || '(no subject)'}
                        </Link>
                      </td>
                      <td className="num whitespace-nowrap text-muted">{m.sent_at ? fmtShortDate(m.sent_at) : m.send_status === 'draft' ? 'Draft' : '—'}</td>
                      <td className="whitespace-nowrap">
                        <StatusTrack m={m} />
                      </td>
                      <td className="num hidden whitespace-nowrap text-muted sm:table-cell">{m.next_follow_up_at ? fmtShortDate(m.next_follow_up_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2">
                <TrackLegend />
              </div>
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <section className="panel" aria-labelledby="due-h">
            <SectionTitle actions={<Link to="/followups" className="text-xs">All follow-ups</Link>}>
              <span id="due-h">Follow-ups due</span>
            </SectionTitle>
            {!due.data ? (
              <div className="px-4">
                <Spinner />
              </div>
            ) : due.data.items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Nothing due. Reminders appear here a few business days after each email.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {due.data.items.slice(0, 6).map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{f.recruiter_name ?? f.recruiter_email}</div>
                      <div className="truncate text-2xs text-faint">
                        {f.company ? `${f.company}, ` : ''}last emailed {fmtShortDate(f.previous_sent_at)}
                        {f.business_days_since_contact !== null ? ` (${plural(f.business_days_since_contact, 'business day')} ago)` : ''}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => navigate(`/followups?focus=${f.id}`)}>
                      Follow up
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="next-h">
            <SectionTitle actions={<Link to="/opportunities" className="text-xs">Jobs</Link>}>
              <span id="next-h">Where to focus next</span>
            </SectionTitle>
            {!recs.data ? (
              <div className="px-4">
                <Spinner />
              </div>
            ) : recs.data.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                Save job postings in <Link to="/opportunities">Jobs</Link> to get suggestions based on your skills, deadlines and progress.
              </p>
            ) : (
              <ul className="divide-y divide-line/60">
                {recs.data.slice(0, 4).map((r) => (
                  <li key={r.opportunity_id} className="px-4 py-2.5">
                    <Link to={`/opportunities/${r.opportunity_id}`} className="block text-sm text-ink">
                      {r.title} <span className="text-muted">at {r.company}</span>
                    </Link>
                    <p className="mt-0.5 text-xs text-accent">{r.next_action}</p>
                    {r.reasons[0] && <p className="text-2xs text-faint">{r.reasons.slice(0, 2).join('; ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel min-w-0" aria-labelledby="perf-h">
          <SectionTitle actions={<Link to="/analytics" className="text-xs">Analytics</Link>}>
            <span id="perf-h">Emails sent and replies per day</span>
          </SectionTitle>
          <div className="px-2 py-3">{series.data ? <SentRepliesChart data={series.data} /> : <Spinner />}</div>
        </section>
        <section className="panel" aria-labelledby="act-h">
          <SectionTitle>
            <span id="act-h">Recent activity</span>
          </SectionTitle>
          {!activity.data ? (
            <div className="px-4">
              <Spinner />
            </div>
          ) : activity.data.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Activity appears as you add recruiters, send emails and receive replies.</p>
          ) : (
            <ol className="max-h-[300px] divide-y divide-line/50 overflow-y-auto">
              {activity.data.items.map((a) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-2">
                  <span className={clsx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', ACTIVITY_DOT[a.type] ?? 'bg-faint')} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug text-ink">{a.summary}</p>
                    <p className="text-2xs text-faint" title={a.occurred_at}>
                      {relative(a.occurred_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

const ACTIVITY_DOT: Partial<Record<ActivityType, string>> = {
  email_sent: 'bg-sent',
  reply_received: 'bg-replied',
  open_detected: 'bg-opened',
  email_failed: 'bg-danger',
  bounce_detected: 'bg-danger',
  delivery_delayed: 'bg-warn',
  email_send_unknown: 'bg-warn',
  reply_needs_review: 'bg-warn',
  followup_scheduled: 'bg-accent',
  recruiter_added: 'bg-muted',
  opportunity_status_changed: 'bg-accent',
};
