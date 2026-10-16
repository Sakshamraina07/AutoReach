import { deriveDisplayStatus, type MessageSummary } from '@autoreach/shared';
import { clsx } from 'clsx';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ExtensionApiError } from '../lib/client';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink border border-accent hover:bg-accent/90',
  secondary: 'bg-raised text-ink border border-line hover:border-faint',
  ghost: 'text-muted hover:text-ink hover:bg-raised border border-transparent',
  danger: 'bg-danger/10 text-danger border border-danger/40 hover:bg-danger/20',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-3 text-xs text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const ref = error instanceof ExtensionApiError && error.requestId ? error.requestId : null;
  return (
    <div role="alert" className="flex gap-2 rounded border border-danger/40 bg-danger/5 p-2.5 text-xs">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ink">{message}</p>
        {ref && <p className="mt-0.5 text-2xs text-faint">Reference {ref}</p>}
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-1 font-medium text-accent hover:underline">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-2xs text-faint">{hint}</p>}
    </div>
  );
}

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-muted',
  info: 'text-accent',
  success: 'text-replied',
  warning: 'text-warn',
  danger: 'text-danger',
  accent: 'text-opened',
};

/** Compact version of the dashboard's status track: send, open (approximate), reply. */
export function StatusLabel({ m }: { m: Pick<MessageSummary, 'send_status' | 'reply_status' | 'tracking_enabled' | 'first_open_at' | 'scheduled_for'> }) {
  const s = deriveDisplayStatus(m);
  return (
    <span className={clsx('text-2xs', TONE_TEXT[s.tone])} title={s.hint}>
      {s.label}
    </span>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
      <path d="M5 9.5h22v13H5z" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="m5.5 10 10.5 7.5L26.5 10" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="26" cy="22" r="4" fill="rgb(var(--replied))" />
    </svg>
  );
}
