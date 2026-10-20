/**
 * Civil-date math in a fixed IANA timezone.
 *
 * Claude transcripts and the GitHub API both speak UTC instants, but a "day" is
 * a local thing — work done at 9pm in New York belongs to that day, not to
 * tomorrow. Everything here converts between a civil date (`2026-09-21`) and
 * the UTC window that date actually spans, honouring DST.
 */

export type Period = 'day' | 'week' | 'month' | 'year';

export const PERIODS: readonly Period[] = ['day', 'week', 'month', 'year'];

export function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value);
}

/** `2026-09-21` */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): boolean {
  return DAY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = offsetFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
    offsetFormatters.set(tz, fmt);
  }
  return fmt;
}

/** Minutes east of UTC for `tz` at the instant `at`. `-240` for EDT. */
function offsetMinutesAt(tz: string, at: Date): number {
  const name = offsetFormatter(tz)
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  // "GMT-04:00", "GMT+5:30", or bare "GMT" at exactly UTC.
  const m = name?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** `±HH:MM` for `tz` on `day` — the suffix GitHub's search qualifiers want. */
export function offsetSuffix(day: string, tz: string): string {
  const mins = offsetMinutesAt(tz, dayStart(day, tz));
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The UTC instant at which `day` begins in `tz`. */
export function dayStart(day: string, tz: string): Date {
  const naive = Date.parse(`${day}T00:00:00Z`);
  // The offset depends on the instant we're resolving, and the instant depends
  // on the offset. One correction pass settles it — including the DST-shift
  // days, where the first guess can land an hour off.
  const first = naive - offsetMinutesAt(tz, new Date(naive)) * 60_000;
  const second = naive - offsetMinutesAt(tz, new Date(first)) * 60_000;
  return new Date(second);
}

/** Half-open `[start, end)` UTC window spanned by the civil dates `from..to`. */
export function bounds(from: string, to: string, tz: string): { start: Date; end: Date } {
  return { start: dayStart(from, tz), end: dayStart(addDays(to, 1), tz) };
}

/** The civil date it is right now in `tz`. */
export function today(tz: string): string {
  return dayOf(new Date(), tz);
}

/** The civil date the instant `at` falls on in `tz`. */
export function dayOf(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  // en-CA formats as YYYY-MM-DD, which is what we want verbatim.
  return parts;
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Every civil date from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ── Period keys ────────────────────────────────────────────────────────────
// day   2026-09-21
// week  2026-W38   (ISO 8601 week, Monday-based)
// month 2026-09
// year  2026

/** The ISO week key containing `day`. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  // Shift to the Thursday of this ISO week; the year of that Thursday is the
  // ISO week-numbering year.
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDow + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${pad(week)}`;
}

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export function yearKey(day: string): string {
  return day.slice(0, 4);
}

export function keyFor(period: Period, day: string): string {
  switch (period) {
    case 'day':
      return day;
    case 'week':
      return weekKey(day);
    case 'month':
      return monthKey(day);
    case 'year':
      return yearKey(day);
  }
}

/** The inclusive civil-date span a period key covers. */
export function spanOf(period: Period, key: string): { from: string; to: string } {
  switch (period) {
    case 'day':
      return { from: key, to: key };
    case 'week': {
      const m = key.match(/^(\d{4})-W(\d{2})$/);
      if (!m) throw new Error(`not an ISO week key: ${key}`);
      const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
      const dow = (jan4.getUTCDay() + 6) % 7;
      const week1Monday = new Date(jan4);
      week1Monday.setUTCDate(jan4.getUTCDate() - dow);
      const monday = new Date(week1Monday);
      monday.setUTCDate(week1Monday.getUTCDate() + (Number(m[2]) - 1) * 7);
      const from = monday.toISOString().slice(0, 10);
      return { from, to: addDays(from, 6) };
    }
    case 'month': {
      const m = key.match(/^(\d{4})-(\d{2})$/);
      if (!m) throw new Error(`not a month key: ${key}`);
      const from = `${key}-01`;
      const next = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
      return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
    }
    case 'year': {
      if (!/^\d{4}$/.test(key)) throw new Error(`not a year key: ${key}`);
      return { from: `${key}-01-01`, to: `${key}-12-31` };
    }
  }
}

/** Valid key shape for a period — guards the route params. */
export function isKeyFor(period: Period, key: string): boolean {
  switch (period) {
    case 'day':
      return isDay(key);
    case 'week':
      return /^\d{4}-W\d{2}$/.test(key);
    case 'month':
      return /^\d{4}-\d{2}$/.test(key);
    case 'year':
      return /^\d{4}$/.test(key);
  }
}

/** Human label for a period key, e.g. `Mon 21 Sep 2026`, `15–21 Sep 2026`. */
export function labelFor(period: Period, key: string): string {
  const { from, to } = spanOf(period, key);
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const f = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(at(d));
  switch (period) {
    case 'day':
      return f(from, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    case 'week':
      return `${f(from, { day: 'numeric', month: 'short' })} – ${f(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    case 'month':
      return f(from, { month: 'long', year: 'numeric' });
    case 'year':
      return key;
  }
}
