import type { QualityFinding } from '@autoreach/shared';
import { clsx } from 'clsx';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

const ORDER = { error: 0, warning: 1, info: 2 } as const;

export function QualityPanel({ findings, loading }: { findings: QualityFinding[] | null; loading?: boolean }) {
  if (!findings) return <p className="text-xs text-faint">{loading ? 'Checking…' : 'Write or generate a draft to run the quality check.'}</p>;
  if (findings.length === 0)
    return (
      <p className="flex items-center gap-1.5 text-sm text-replied">
        <CheckCircle2 className="h-4 w-4" /> No problems found.
      </p>
    );
  return (
    <ul className="space-y-1.5" aria-live="polite">
      {[...findings]
        .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
        .map((f) => (
          <li key={f.code + f.message} className={clsx('flex gap-2 text-sm', f.severity === 'error' ? 'text-danger' : f.severity === 'warning' ? 'text-warn' : 'text-muted')}>
            {f.severity === 'error' ? (
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-label="Must fix" />
            ) : f.severity === 'warning' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-label="Warning" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-label="Note" />
            )}
            <span className="text-ink/90">{f.message}</span>
          </li>
        ))}
    </ul>
  );
}
