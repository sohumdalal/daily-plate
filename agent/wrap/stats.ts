/**
 * The numbers behind a week, month or year's charts, one compact row per day.
 *
 * A rollup's charts compare the period with what came before it, so the range
 * read is wider than the period: six weeks for a week, the Monday-aligned
 * weeks around a month, the Monday-aligned weeks of a year. Everything here is
 * derived from stored days and day wraps; nothing is collected.
 */

import { addDays, spanOf, type Period } from '../time.ts';
import type { DayRecord, Wrap } from './types.ts';

export type DayStat = {
  day: string;
  minutes: number;
  prompts: number;
  sessions: number;
  /** Each session's start hour in the configured timezone, and its active minutes. */
  starts: Array<[number, number]>;
  /** Null where GitHub was not read for the day, which is not the same as zero. */
  github: {
    merged: number;
    opened: number;
    reviewed: number;
    commits: number;
    additions: number;
    deletions: number;
  } | null;
  headline: string | null;
  learned: string | null;
  grew: string[];
};

/** Monday on or before a day. */
function mondayOf(day: string): string {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

/** The days a period's charts read. */
export function statsRange(period: Period, key: string): { from: string; to: string } {
  const span = spanOf(period, key);
  if (period === 'week') return { from: addDays(span.from, -35), to: span.to };
  if (period === 'day') return span;
  return { from: mondayOf(span.from), to: addDays(mondayOf(span.to), 6) };
}

function hourIn(iso: string, tz: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: tz,
  }).format(new Date(iso));
  return Number(hour) % 24;
}

export function dayStats(days: DayRecord[], wraps: Wrap[], tz: string): DayStat[] {
  const wrapOf = new Map(wraps.map((w) => [w.key, w]));
  return days.map((d) => {
    const c = d.claude;
    const g = d.github?.totals;
    const w = wrapOf.get(d.day);
    return {
      day: d.day,
      minutes: c?.totals.activeMinutes ?? 0,
      prompts: c?.totals.prompts ?? 0,
      sessions: c?.totals.sessions ?? 0,
      starts: (c?.sessions ?? []).map((s) => [hourIn(s.startedAt, tz), s.activeMinutes]),
      github: g
        ? {
            merged: g.merged,
            opened: g.opened,
            reviewed: g.reviewed,
            commits: g.commits,
            additions: g.additions,
            deletions: g.deletions,
          }
        : null,
      headline: w?.headline ?? null,
      learned: w?.learned || null,
      grew: w?.grew ?? [],
    };
  });
}
