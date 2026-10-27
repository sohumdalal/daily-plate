/**
 * The Board tab's numbers, from the issues alone: when each was opened and
 * closed is enough to say how the board has grown, week by week, without
 * keeping a snapshot of it. Weeks run Monday to Sunday, in UTC.
 */

import type { BoardIssue } from './issues.ts';

/** Weeks of history the charts show. */
const WEEKS = 12;
const DAY_MS = 864e5;
/** An open issue untouched for this long is stale. */
const STALE_DAYS = 30;
/** Close times are of issues closed within this many days. */
const CLOSE_WINDOW_DAYS = 90;

export type Week = { monday: string; opened: number; closed: number; open: number; medianDays: number | null };

export type BoardMetrics = {
  open: number;
  closed: number;
  thisWeek: { opened: number; closed: number };
  lastWeek: { opened: number; closed: number };
  /** Closed per opened over the last four weeks: above 1, the board is shrinking. */
  closeRate: number | null;
  /** Days from opened to closed, over the last CLOSE_WINDOW_DAYS. */
  closeDays: { mean: number | null; median: number | null; count: number };
  weeks: Week[];
  byColumn: { name: string; count: number }[];
  byAssignee: { login: string; avatar: string; open: number; closedRecently: number }[];
  unassigned: number;
  stale: number;
  oldestOpenDays: number | null;
  /** Open issues whose PR has merged: likely done, and worth closing. */
  mergedButOpen: number;
};

const ms = (iso: string) => new Date(iso).getTime();

function mondayOf(t: number): number {
  const d = new Date(t);
  const back = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const daysOpen = (i: BoardIssue) => (ms(i.closedAt!) - ms(i.createdAt)) / DAY_MS;

export function boardMetrics(issues: BoardIssue[], now = Date.now()): BoardMetrics {
  const open = issues.filter((i) => i.state === 'open');
  const closed = issues.filter((i) => i.state === 'closed' && i.closedAt);
  const thisMonday = mondayOf(now);

  const weeks: Week[] = Array.from({ length: WEEKS }, (_, n) => {
    const from = thisMonday - (WEEKS - 1 - n) * 7 * DAY_MS;
    const to = from + 7 * DAY_MS;
    const closedIn = closed.filter((i) => ms(i.closedAt!) >= from && ms(i.closedAt!) < to);
    return {
      monday: new Date(from).toISOString().slice(0, 10),
      opened: issues.filter((i) => ms(i.createdAt) >= from && ms(i.createdAt) < to).length,
      closed: closedIn.length,
      // Open at the week's end: opened by then, and not yet closed.
      open: issues.filter((i) => ms(i.createdAt) < to && (!i.closedAt || ms(i.closedAt) >= to)).length,
      medianDays: round1(median(closedIn.map(daysOpen))),
    };
  });
  const last4 = weeks.slice(-4);
  const opened4 = last4.reduce((n, w) => n + w.opened, 0);
  const closed4 = last4.reduce((n, w) => n + w.closed, 0);

  const recent = closed.filter((i) => now - ms(i.closedAt!) < CLOSE_WINDOW_DAYS * DAY_MS);
  const spans = recent.map(daysOpen);

  const columns = new Map<string, number>();
  for (const i of open) columns.set(i.column || 'No column', (columns.get(i.column || 'No column') ?? 0) + 1);

  const people = new Map<string, BoardMetrics['byAssignee'][number]>();
  const who = (p: { login: string; avatar: string }) => {
    let row = people.get(p.login);
    if (!row) people.set(p.login, (row = { login: p.login, avatar: p.avatar, open: 0, closedRecently: 0 }));
    return row;
  };
  for (const i of open) for (const p of i.assignees) who(p).open++;
  for (const i of closed.filter((i) => now - ms(i.closedAt!) < 28 * DAY_MS)) for (const p of i.assignees) who(p).closedRecently++;

  const ages = open.map((i) => (now - ms(i.createdAt)) / DAY_MS);
  const current = weeks[WEEKS - 1]!;
  const previous = weeks[WEEKS - 2]!;
  return {
    open: open.length,
    closed: closed.length,
    thisWeek: { opened: current.opened, closed: current.closed },
    lastWeek: { opened: previous.opened, closed: previous.closed },
    closeRate: opened4 ? Math.round((closed4 / opened4) * 100) / 100 : null,
    closeDays: {
      mean: round1(spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : null),
      median: round1(median(spans)),
      count: spans.length,
    },
    weeks,
    byColumn: [...columns].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    byAssignee: [...people.values()].sort((a, b) => b.open - a.open || b.closedRecently - a.closedRecently),
    unassigned: open.filter((i) => !i.assignees.length).length,
    stale: open.filter((i) => now - ms(i.updatedAt) > STALE_DAYS * DAY_MS).length,
    oldestOpenDays: ages.length ? Math.floor(Math.max(...ages)) : null,
    mergedButOpen: open.filter((i) => i.prs.some((p) => p.state === 'MERGED')).length,
  };
}
