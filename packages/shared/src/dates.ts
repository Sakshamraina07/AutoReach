import { DateTime } from 'luxon';

/** True if the string is a valid IANA timezone name. */
export function isValidTimezone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}

/**
 * Old ("backward") IANA names mapped to their current names. Browsers and
 * Node (ICU) still report several old names — Chrome in India reports
 * "Asia/Calcutta" — but servers whose tz database omits the backward links
 * (e.g. Debian/Ubuntu without tzdata-legacy) reject them, so they are
 * normalised before being stored or used in SQL.
 */
const TIMEZONE_ALIASES: Readonly<Record<string, string>> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ujung_Pandang': 'Asia/Makassar',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Asia/Macao': 'Asia/Macau',
  'Asia/Chongqing': 'Asia/Shanghai',
  'Asia/Chungking': 'Asia/Shanghai',
  'Asia/Harbin': 'Asia/Shanghai',
  'Asia/Kashgar': 'Asia/Urumqi',
  'Asia/Tel_Aviv': 'Asia/Jerusalem',
  'Asia/Istanbul': 'Europe/Istanbul',
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'Europe/Belfast': 'Europe/London',
  'Europe/Nicosia': 'Asia/Nicosia',
  'Europe/Tiraspol': 'Europe/Chisinau',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Atlantic/Jan_Mayen': 'Europe/Berlin',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Fort_Wayne': 'America/Indiana/Indianapolis',
  'America/Knox_IN': 'America/Indiana/Knox',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Godthab': 'America/Nuuk',
  'America/Coral_Harbour': 'America/Panama',
  'America/Atka': 'America/Adak',
  'America/Ensenada': 'America/Tijuana',
  'America/Montreal': 'America/Toronto',
  'America/Nipigon': 'America/Toronto',
  'America/Thunder_Bay': 'America/Toronto',
  'America/Rainy_River': 'America/Winnipeg',
  'America/Yellowknife': 'America/Edmonton',
  'America/Shiprock': 'America/Denver',
  'America/Porto_Acre': 'America/Rio_Branco',
  'America/Virgin': 'America/Puerto_Rico',
  'Africa/Asmera': 'Africa/Nairobi',
  'Africa/Timbuktu': 'Africa/Abidjan',
  'Australia/ACT': 'Australia/Sydney',
  'Australia/Canberra': 'Australia/Sydney',
  'Australia/NSW': 'Australia/Sydney',
  'Australia/North': 'Australia/Darwin',
  'Australia/Queensland': 'Australia/Brisbane',
  'Australia/South': 'Australia/Adelaide',
  'Australia/Tasmania': 'Australia/Hobart',
  'Australia/Victoria': 'Australia/Melbourne',
  'Australia/West': 'Australia/Perth',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Yap': 'Pacific/Chuuk',
  'Pacific/Samoa': 'Pacific/Pago_Pago',
  'Pacific/Johnston': 'Pacific/Honolulu',
  'US/Alaska': 'America/Anchorage',
  'US/Arizona': 'America/Phoenix',
  'US/Central': 'America/Chicago',
  'US/Eastern': 'America/New_York',
  'US/Hawaii': 'Pacific/Honolulu',
  'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles',
  'Canada/Atlantic': 'America/Halifax',
  'Canada/Central': 'America/Winnipeg',
  'Canada/Eastern': 'America/Toronto',
  'Canada/Mountain': 'America/Edmonton',
  'Canada/Newfoundland': 'America/St_Johns',
  'Canada/Pacific': 'America/Vancouver',
  'Brazil/East': 'America/Sao_Paulo',
  'Mexico/General': 'America/Mexico_City',
  GB: 'Europe/London',
  Japan: 'Asia/Tokyo',
  Singapore: 'Asia/Singapore',
  Hongkong: 'Asia/Hong_Kong',
  PRC: 'Asia/Shanghai',
  ROK: 'Asia/Seoul',
  Israel: 'Asia/Jerusalem',
  Turkey: 'Europe/Istanbul',
  'Etc/UCT': 'Etc/UTC',
  UCT: 'Etc/UTC',
  Universal: 'Etc/UTC',
  Zulu: 'Etc/UTC',
  'Etc/Universal': 'Etc/UTC',
  'Etc/Zulu': 'Etc/UTC',
  'Etc/GMT0': 'Etc/GMT',
  GMT0: 'Etc/GMT',
  Greenwich: 'Etc/GMT',
};

/** Current IANA name for a timezone (maps old aliases like "Asia/Calcutta" to "Asia/Kolkata"). */
export function canonicalTimezone(tz: string): string {
  const trimmed = tz.trim();
  return TIMEZONE_ALIASES[trimmed] ?? trimmed;
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
