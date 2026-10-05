/** Calendar days (YYYY-MM-DD) in the app's time zone, so "a day" starts at local midnight for everyone. */

const DAY_MS = 86_400_000;

export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh';
}

/** Today's date as YYYY-MM-DD in the app's time zone. */
export function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone() }).format(now);
}

function toUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); 0 when they're the same day. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** `key` plus `n` days, as YYYY-MM-DD. */
export function addDays(key: string, n: number): string {
  const d = new Date(toUtc(key) + n * DAY_MS);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
