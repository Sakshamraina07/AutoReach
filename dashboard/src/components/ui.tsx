import { clsx } from 'clsx';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../lib/api';

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent/90 border border-accent',
  secondary: 'bg-raised text-ink border border-line hover:border-faint',
  ghost: 'text-muted hover:text-ink hover:bg-raised border border-transparent',
  danger: 'bg-danger/10 text-danger border border-danger/40 hover:bg-danger/20',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
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
});

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'sent';
const TONES: Record<Tone, string> = {
  neutral: 'text-muted border-line',
  info: 'text-accent border-accent/40',
  sent: 'text-sent border-sent/40',
  success: 'text-replied border-replied/40',
  warning: 'text-warn border-warn/40',
  danger: 'text-danger border-danger/40',
  accent: 'text-opened border-opened/40',
};

export function Badge({ tone = 'neutral', children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={clsx('inline-flex h-5 items-center whitespace-nowrap rounded border px-1.5 text-2xs font-medium', TONES[tone], className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback states                                                     */
/* ------------------------------------------------------------------ */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <p className="text-ink">{message}</p>
        {requestId && <p className="mt-0.5 text-2xs text-faint">Reference {requestId}</p>}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-8">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export function Field({ label, hint, error, children, htmlFor, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {description && <div className="mt-0.5 max-w-prose text-xs text-muted">{description}</div>}
      </div>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50',
          checked ? 'border-accent bg-accent' : 'border-line bg-raised',
        )}
      >
        <span className={clsx('absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full transition-transform', checked ? 'translate-x-[18px] bg-accent-ink' : 'translate-x-0.5 bg-faint')} />
      </button>
    </div>
  );
}

export function TagInput({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <div className="field flex min-h-[34px] flex-wrap items-center gap-1 py-1">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-raised px-1.5 py-0.5 text-xs text-ink">
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="text-faint hover:text-ink" onClick={() => onChange(value.filter((x) => x !== t))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={commit}
        className="min-w-[8ch] flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog & drawer                                                     */
/* ------------------------------------------------------------------ */

/**
 * Open dialogs and drawers. Escape closes only the top one: the most deeply nested (a
 * dialog opened from inside a drawer), then the most recently opened. Nesting depth comes
 * from context because effects of overlays mounted together run inner-first.
 */
const OverlayDepth = createContext(0);
const openOverlays: { id: symbol; depth: number; seq: number }[] = [];
let overlaySeq = 0;

function topOverlay(): symbol | undefined {
  let top: (typeof openOverlays)[number] | undefined;
  for (const o of openOverlays) if (!top || o.depth > top.depth || (o.depth === top.depth && o.seq > top.seq)) top = o;
  return top?.id;
}

function useEscape(onClose: () => void, depth: number) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const entry = { id: Symbol('overlay'), depth, seq: ++overlaySeq };
    openOverlays.push(entry);
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || topOverlay() !== entry.id) return;
      e.stopPropagation();
      latest.current();
    };
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      const i = openOverlays.indexOf(entry);
      if (i >= 0) openOverlays.splice(i, 1);
    };
  }, [depth]);
}

function useFocusOnOpen() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    (first ?? ref.current)?.focus();
    return () => previous?.focus?.();
  }, []);
  return ref;
}

export function Dialog({ title, onClose, children, footer, width = 'max-w-lg' }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  const depth = useContext(OverlayDepth) + 1;
  useEscape(onClose, depth);
  const ref = useFocusOnOpen();
  return createPortal(
    <OverlayDepth.Provider value={depth}>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={clsx('w-full rounded-lg border border-line bg-surface shadow-2xl outline-none', width)}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-lg">{title}</h2>
            <button data-close type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </div>
      </div>
    </OverlayDepth.Provider>,
    document.body,
  );
}

export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const depth = useContext(OverlayDepth) + 1;
  useEscape(onClose, depth);
  const ref = useFocusOnOpen();
  return createPortal(
    <OverlayDepth.Provider value={depth}>
      <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className="flex h-full w-full max-w-2xl flex-col border-l border-line bg-surface outline-none">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
            <div className="min-w-0 flex-1">{title}</div>
            <div className="flex items-center gap-2">
              {actions}
              <button data-close type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </div>
    </OverlayDepth.Provider>,
    document.body,
  );
}

export function Confirm({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setErr(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted">{body}</div>
      {err ? (
        <div className="mt-3">
          <ErrorState error={err} />
        </div>
      ) : null}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs, pagination                                                    */
/* ------------------------------------------------------------------ */

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
            value === it.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="px-3 py-2 text-xs text-faint">{total === 1 ? '1 result' : `${total} results`}</p>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
      <span className="num">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

interface ToastItem {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}
const ToastContext = createContext<(tone: ToastItem['tone'], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto rounded-md border bg-surface px-3 py-2 text-sm shadow-lg',
              t.tone === 'success' && 'border-replied/50',
              t.tone === 'error' && 'border-danger/60',
              t.tone === 'info' && 'border-line',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (m: string) => push('success', m),
    error: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)),
    info: (m: string) => push('info', m),
  };
}

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
      <h2 className="text-sm font-semibold">{children}</h2>
      {actions}
    </div>
  );
}
