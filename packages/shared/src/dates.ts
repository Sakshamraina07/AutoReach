import { DateTime } from 'luxon';

/** True if the string is a valid IANA timezone name. */
export function isValidTimezone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}

/**
 * Add `days` business days (Mon–Fri) to `from`, evaluated in `timezone`,
 * and return the result at `hour:00` local time as a UTC ISO string.
 * Weekends are skipped; public holidays are not modelled.
 */
export function addBusinessDays(from: Date | string, days: number, timezone: string, hour = 10): string {
  let dt = (typeof from === 'string' ? DateTime.fromISO(from, { zone: 'utc' }) : DateTime.fromJSDate(from)).setZone(
    isValidTimezone(timezone) ? timezone : 'UTC',
  );
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    dt = dt.plus({ days: 1 });
    if (dt.weekday <= 5) remaining--;
  }
  // If we landed on a weekend (days = 0 on a Saturday), roll forward to Monday.
  while (dt.weekday > 5) dt = dt.plus({ days: 1 });
  return dt.set({ hour, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()!;
}

/** Whole business days elapsed between two instants (in the user's timezone). */
export function businessDaysBetween(from: Date | string, to: Date | string, timezone: string): number {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
  let a = (typeof from === 'string' ? DateTime.fromISO(from) : DateTime.fromJSDate(from)).setZone(zone).startOf('day');
  const b = (typeof to === 'string' ? DateTime.fromISO(to) : DateTime.fromJSDate(to)).setZone(zone).startOf('day');
  let count = 0;
  while (a < b) {
    a = a.plus({ days: 1 });
    if (a.weekday <= 5) count++;
  }
  return count;
}

/** Calendar days between two instants, floored. */
export function daysBetween(from: Date | string, to: Date | string = new Date()): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** Start of the current local day for `timezone`, as a UTC ISO string. */
export function startOfLocalDay(timezone: string, at: Date = new Date()): string {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
  return DateTime.fromJSDate(at).setZone(zone).startOf('day').toUTC().toISO()!;
}
