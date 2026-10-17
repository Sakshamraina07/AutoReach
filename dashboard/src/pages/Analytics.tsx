import { clsx } from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SentRepliesChart } from '../components/charts';
import { Badge, ErrorState, PageHeader, SectionTitle, Spinner, Tabs } from '../components/ui';
import { fmtPct, plural } from '../lib/format';
import { useBreakdown, useInsights, useMe, useOverview, useRecommendations, useTimeseries } from '../lib/queries';
import { TRACKING_OFF_NOTE } from '../lib/tracking';

const RANGES = ['7d', '30d', '90d', '365d', 'all'] as const;
const RANGE_LABEL: Record<(typeof RANGES)[number], string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '365d': '12 months', all: 'All time' };

export default function Analytics() {
  const [range, setRange] = useState<(typeof RANGES)[number]>('90d');
  const [by, setBy] = useState<'role_category' | 'company' | 'campaign'>('role_category');
  const overview = useOverview(range);
  const series = useTimeseries(range);
  const breakdown = useBreakdown(by, range);
  const insights = useInsights(range);
  const recs = useRecommendations();
  const me = useMe();
  const trackingOn = me.data?.tracking.configured ?? true;
  const k = overview.data?.kpis;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Response rate counts a first email as answered when the recruiter replied to anything in that conversation. With a personal job search the numbers are small, so most findings are directional."
        actions={
          <select aria-label="Period" className="field w-auto" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABEL[r]}
              </option>
            ))}
          </select>
        }
      />

      {k && (
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-4">
          {[
            { label: 'Sent successfully', value: String(k.emails_sent.value) },
            { label: 'Replies', value: String(k.replies.value) },
            { label: 'Response rate', value: fmtPct(k.response_rate.value), note: `of ${plural(k.response_rate.sample, 'first email')}` },
            trackingOn ? { label: 'Opens detected', value: String(k.opens_detected.value), note: 'approximate' } : { label: 'Opens detected', value: 'Off', note: TRACKING_OFF_NOTE },
          ].map((c) => (
            <div key={c.label} className="bg-surface px-4 py-3">
              <div className="text-xs text-muted">{c.label}</div>
              <div className="num mt-1 text-2xl font-semibold">{c.value}</div>
              {c.note && <div className="text-2xs text-faint">{c.note}</div>}
            </div>
          ))}
        </div>
      )}

      <section className="panel mb-6">
        <SectionTitle>Emails sent and replies per day</SectionTitle>
        <div className="px-2 py-3">{series.isError ? <ErrorState error={series.error} /> : series.data ? <SentRepliesChart data={series.data} height={260} /> : <Spinner />}</div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="panel min-w-0">
          <div className="px-3 pt-2">
            <Tabs
              label="Break down by"
              value={by}
              onChange={setBy}
              items={[
                { value: 'role_category', label: 'Role category' },
                { value: 'company', label: 'Company' },
                { value: 'campaign', label: 'Campaign' },
              ]}
            />
          </div>
          {breakdown.isError ? (
            <div className="p-4">
              <ErrorState error={breakdown.error} />
            </div>
          ) : !breakdown.data ? (
            <div className="px-4">
              <Spinner />
            </div>
          ) : breakdown.data.rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted">No first emails sent in this period.</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>{by === 'role_category' ? 'Role category' : by === 'company' ? 'Company' : 'Campaign'}</th>
                    <th className="text-right">First emails</th>
                    <th className="text-right">Replied</th>
                    <th className="w-[40%]">Response rate</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.data.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num text-right">{r.sent}</td>
                      <td className="num text-right">{r.replies}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-raised" aria-hidden>
                            <div className={clsx('h-1.5 rounded-full', r.small_sample ? 'bg-replied/50' : 'bg-replied')} style={{ width: `${Math.round((r.response_rate ?? 0) * 100)}%` }} />
                          </div>
                          <span className="num w-10 text-right text-xs">{fmtPct(r.response_rate)}</span>
                          {r.small_sample && (
                            <Badge title={`Fewer than ${breakdown.data.small_sample_threshold} emails — directional only`}>small sample</Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2 text-2xs text-faint">Rows with fewer than {breakdown.data.small_sample_threshold} emails are marked as small samples; differences between them may be chance.</p>
            </>
          )}
        </section>

        <div className="space-y-6">
          <section className="panel">
            <SectionTitle>What correlates with replies</SectionTitle>
            {!insights.data ? (
              <div className="px-4">
                <Spinner />
              </div>
            ) : insights.data.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Send a few more emails to compare approaches.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {insights.data.map((i) => (
                  <li key={i.id} className="px-4 py-3">
                    <p className="text-sm font-medium">
                      {i.title} {i.directional && <Badge className="ml-1">directional</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{i.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <SectionTitle>Jobs to work on</SectionTitle>
            {!recs.data ? (
              <div className="px-4">
                <Spinner />
              </div>
            ) : recs.data.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No active jobs.</p>
            ) : (
              <ol className="divide-y divide-line/60">
                {recs.data.map((r) => (
                  <li key={r.opportunity_id} className="px-4 py-2.5">
                    <Link to={`/opportunities/${r.opportunity_id}`} className="text-sm text-ink">
                      {r.title} <span className="text-muted">at {r.company}</span>
                    </Link>
                    <p className="text-xs text-accent">{r.next_action}</p>
                    <p className="text-2xs text-faint">{r.reasons.join('; ')}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
