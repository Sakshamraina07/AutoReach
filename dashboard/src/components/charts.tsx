import type { TimeseriesPoint } from '@autoreach/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate } from '../lib/format';
import { tokenColor, useThemeVersion } from '../lib/theme';

export function SentRepliesChart({ data, height = 220 }: { data: TimeseriesPoint[]; height?: number }) {
  useThemeVersion();
  const total = data.reduce((s, p) => s + p.sent + p.replies, 0);
  if (!total) return <p className="px-4 py-10 text-center text-sm text-muted">No emails sent in this period yet.</p>;
  const grid = tokenColor('line');
  const faint = tokenColor('faint');
  return (
    <div style={{ height }} role="img" aria-label={`Emails sent and replies per day. ${data.reduce((s, p) => s + p.sent, 0)} sent and ${data.reduce((s, p) => s + p.replies, 0)} replies in total.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={1}>
          <CartesianGrid stroke={grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => fmtDate(d, { day: 'numeric', month: 'short' })}
            tick={{ fill: faint, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: grid }}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={{ fill: faint, fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: tokenColor('raised', 0.6) }}
            contentStyle={{ background: tokenColor('surface'), border: `1px solid ${grid}`, borderRadius: 6, fontSize: 12, color: tokenColor('ink') }}
            labelFormatter={(d) => fmtDate(String(d))}
          />
          <Bar dataKey="sent" name="Sent" fill={tokenColor('sent')} radius={[2, 2, 0, 0]} maxBarSize={18} />
          <Bar dataKey="replies" name="Replies" fill={tokenColor('replied')} radius={[2, 2, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
