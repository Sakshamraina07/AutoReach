import { canonicalTimezone } from '@autoreach/shared';

/** All timestamps are stored in UTC and shown in the user's timezone from Settings. */
let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function setTimezone(tz: string | null | undefined) {
  if (tz) timezone = tz;
}
export function getTimezone(): string {
  return timezone;
}
/** The browser's zone under its current IANA name (Chrome still reports e.g. "Asia/Calcutta"). */
export function browserTimezone(): string {
  return canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: iso.length === 10 ? 'UTC' : timezone }).format(d);
}

export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const sameYear = new Date().getFullYear() === d.getFullYear();
  return fmtDate(iso, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [365 * 86_400_000, 'year'],
    [30 * 86_400_000, 'month'],
    [7 * 86_400_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [ms, unit] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return 'just now';
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
