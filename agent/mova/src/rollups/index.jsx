/**
 * A week, month or year's charts, from GET /api/wrap/stats/:period/:key.
 *
 * Every chart is a Mova mono chart (../charts), re-skinned with the theme.
 * Rosso Corsa marks one thing per chart: the peak day, this week, or today.
 * Days are YYYY-MM-DD strings handled in UTC, so no timezone moves one.
 */

import { useTheme } from '../use-theme.js';
import MonoRoundedBarChart from '../charts/mono-rounded-bar.js';
import MonoRoundedHeatmapChart from '../charts/mono-rounded-heatmap.js';
import MonoRoundedSparklineChart from '../charts/mono-rounded-sparkline.js';
import MonoRoundedKpiCardChart from '../charts/mono-rounded-kpi.js';
import MonoActivityHeatmap from '../charts/mono-activity-green.js';
import MonoRoundedAreaChart from '../charts/mono-rounded-area.js';
import MonoRoundedDonutChart from '../charts/mono-rounded-donut.js';
import MonoRoundedStackedBarChart from '../charts/mono-rounded-stacked-bar.js';

const D = (k) => new Date(`${k}T00:00:00Z`);
const K = (dt) => dt.toISOString().slice(0, 10);
const add = (k, n) => {
  const t = D(k);
  t.setUTCDate(t.getUTCDate() + n);
  return K(t);
};
// en-GB, like the rest of the Wrap tab: "12 Oct", "Thu 15 Oct".
const fmt = (k, o) => D(k).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
const short = (k) => fmt(k, { month: 'short', day: 'numeric' });
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const hours = (mins) => Math.round(mins / 6) / 10;
const change = (now, prev) =>
  prev ? `${now >= prev ? '+' : '−'}${Math.round((Math.abs(now - prev) / prev) * 100)}%` : '';
const trim = (t, n) => (t.length > n ? `${t.slice(0, n).replace(/\s\S*$/, '')}…` : t);

/** A week's notes in the ledger before the rest are a link to that week. */
const LEDGER_ITEMS = 3;

/** The ISO week key, e.g. 2026-W42, of the week starting on a Monday. */
function isoWeek(monday) {
  const thursday = D(add(monday, 3));
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const n = Math.floor((thursday - jan1) / 864e5 / 7) + 1;
  return `${thursday.getUTCFullYear()}-W${String(n).padStart(2, '0')}`;
}

const EMPTY = { minutes: 0, prompts: 0, sessions: 0, starts: [], github: null, grew: [], empty: true };

/** True when the period itself, not just the weeks around it, has any work in it. */
export function hasActivity(stats) {
  return stats.days.some((d) => d.day >= stats.span.from && d.day <= stats.span.to && d.minutes > 0);
}

export function Rollup({ stats }) {
  const theme = useTheme();
  const byDay = Object.fromEntries(stats.days.map((d) => [d.day, d]));
  const at = (k) => byDay[k] ?? { ...EMPTY, day: k };
  const week = (monday) => Array.from({ length: 7 }, (_, i) => at(add(monday, i)));
  const View = { week: Week, month: Month, year: Year }[stats.period];
  return (
    <div className="mova mova-rollup">
      <View stats={stats} at={at} week={week} theme={theme} />
    </div>
  );
}

// ── Week ────────────────────────────────────────────────────────────────────

function Week({ stats, week, theme }) {
  const monday = stats.span.from;
  const six = Array.from({ length: 6 }, (_, i) => add(monday, (i - 5) * 7));
  const days = week(monday);
  const prev = week(add(monday, -7));
  const mins = sum(days, (d) => d.minutes);
  const prevMins = sum(prev, (d) => d.minutes);
  const peak = days.reduce((a, d, i) => (d.minutes > days[a].minutes ? i : a), 0);
  const worked = days.filter((d) => d.minutes).length;

  // Six weeks of session starts in 2-hour blocks, so the pattern is a habit
  // rather than one week's accident.
  const BLOCKS = [8, 10, 12, 14, 16, 18, 20];
  const raw = DOW.map(() => BLOCKS.map(() => 0));
  let sessions = 0;
  six.forEach((m) =>
    week(m).forEach((d, r) =>
      d.starts.forEach(([h, mm]) => {
        sessions++;
        raw[r][Math.max(0, Math.min(6, Math.floor((h - 8) / 2)))] += mm;
      }),
    ),
  );
  const hmax = Math.max(1, ...raw.flat());
  const heat = DOW.map((day, r) => ({
    day,
    raw: raw[r],
    hours: raw[r].map((v) => (v ? Math.max(12, Math.round((v / hmax) * 100)) : 4)),
  }));
  const blockName = (h) => (h > 12 ? `${h - 12} pm` : h === 12 ? '12 pm' : `${h} am`);

  // Measures every day records. Pull requests are on the month, because a day
  // GitHub was not read for would read here as a bad week.
  const spark = [
    ['Active hours', (d) => d.minutes / 60, (v) => `${Math.round(v)} h`],
    ['Prompts', (d) => d.prompts, (v) => String(Math.round(v))],
    ['Sessions', (d) => d.sessions, (v) => String(Math.round(v))],
    ['Days worked', (d) => (d.minutes ? 1 : 0), (v) => `${v} of 7`],
  ].map(([name, f, show]) => {
    const ys = six.map((m) => sum(week(m), f));
    const now = ys[5];
    const was = ys[4];
    return {
      name,
      val: show(now),
      up: now > was,
      delta: was ? `${change(now, was)} vs ${show(was)}` : '',
      data: ys.map((y, i) => ({ x: i, y })),
    };
  });
  const ups = spark.filter((r) => r.up).length;

  const parts = [
    ['Morning', 0, 12],
    ['Midday', 12, 15],
    ['Afternoon', 15, 18],
    ['Evening', 18, 24],
  ].map(([name, a, b]) => ({
    name,
    v: sum(days.flatMap((d) => d.starts), ([h, m]) => (h >= a && h < b ? m : 0)),
  }));
  const ptotal = sum(parts, (p) => p.v);

  return (
    <div className="grid2">
      <MonoRoundedBarChart
        theme={theme}
        title="Active hours"
        badge="Day by day"
        value={`${hours(mins)} h`}
        unit={prevMins ? `${change(mins, prevMins)} vs last week` : ''}
        data={days.map((d, i) => ({ label: DOW[i], primary: hours(d.minutes), secondary: hours(prev[i].minutes) }))}
        names={['This week', 'Last week']}
        highlight={mins ? peak : -1}
        footL={mins ? `Peak: ${DOW[peak]} ${D(days[peak].day).getUTCDate()}, ${hours(days[peak].minutes)} h` : 'No work yet'}
        footR={`${worked} working ${worked === 1 ? 'day' : 'days'}`}
      />
      <MonoRoundedHeatmapChart
        theme={theme}
        title="When you work"
        badge="6 weeks"
        value={sessions}
        unit="sessions"
        data={heat}
        tip={(row, c) => `${row.day} ${blockName(BLOCKS[c])}: ${Math.round(row.raw[c])} min`}
        footL="2-hour blocks from 8 am"
        footR="Stronger is more minutes"
      />
      <MonoRoundedSparklineChart
        theme={theme}
        title="Against the weeks before"
        badge="6 weeks"
        value={`${ups} of ${spark.length}`}
        unit="up on last week"
        data={spark}
        footL={`${short(six[0])} to ${short(add(monday, 6))}`}
        footR="Red dot is this week"
      />
      {ptotal > 0 && (
        <MonoRoundedDonutChart
          theme={theme}
          title="Part of day"
          badge="Week"
          value={`${hours(ptotal)} h`}
          unit="in sessions"
          data={parts.map((p) => ({ name: p.name, value: Math.round((p.v / ptotal) * 100) }))}
          center="of the week"
        />
      )}
      <section className="dp-card textcard wide">
        <span className="label">The week's sharpest calls</span>
        <ul className="list">
          {days.map((d, i) => (
            <li key={d.day}>
              <a className="when" href={`#day/${d.day}`}>
                {DOW[i]} {D(d.day).getUTCDate()}
              </a>
              {d.learned ? (
                <span className="what">{trim(d.learned, 260)}</span>
              ) : (
                <span className="what quiet">{d.minutes ? 'Nothing learned was written.' : 'A quiet day.'}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── Month ───────────────────────────────────────────────────────────────────

function Month({ stats, week, theme }) {
  const month = stats.key;
  const inMonth = (k) => k.startsWith(month);
  const mdays = stats.days.filter((d) => inMonth(d.day));
  const worked = mdays.filter((d) => d.minutes);
  const mins = sum(mdays, (d) => d.minutes);
  const max = Math.max(1, ...mdays.map((d) => d.minutes));
  const mondays = [];
  for (let m = stats.range.from; m <= stats.range.to; m = add(m, 7)) mondays.push(m);

  const grid = mondays.map((m) => {
    const ds = week(m);
    return {
      day: short(m),
      ds,
      hours: ds.map((d) =>
        !inMonth(d.day) ? 0 : d.minutes ? Math.max(12, Math.round((d.minutes / max) * 100)) : 4,
      ),
    };
  });
  const busiest = worked.reduce((a, d) => (d.minutes > a.minutes ? d : a), worked[0]);

  // A week where GitHub was not read for some day of it carries a star, so a
  // short bar is not mistaken for a slow week.
  const prs = mondays.map((m) => {
    const all = week(m).filter((d) => inMonth(d.day) && !d.empty);
    const read = all.filter((d) => d.github);
    const g = (f) => sum(read, (d) => f(d.github));
    return {
      label: short(m) + (read.length < all.length ? '*' : ''),
      layer1: g((x) => x.merged),
      layer2: g((x) => x.opened),
      layer3: g((x) => x.reviewed),
      add: g((x) => x.additions),
      del: g((x) => x.deletions),
      gap: read.length < all.length,
    };
  });
  const merged = sum(prs, (p) => p.layer1);
  const added = sum(prs, (p) => p.add);
  const gaps = prs.some((p) => p.gap);
  const ledger = mondays
    .map((m) => ({ m, items: week(m).filter((d) => inMonth(d.day)).flatMap((d) => d.grew.map((g) => [d.day, g])) }))
    .filter((w) => w.items.length);
  const name = fmt(`${month}-01`, { month: 'long' });

  return (
    <div className="grid2">
      <MonoRoundedKpiCardChart
        theme={theme}
        title="Active hours"
        badge={name}
        value={`${hours(mins)} h`}
        unit={`${worked.length} days worked`}
        data={mdays.map((d) => ({ v: d.minutes }))}
        footL={`${short(stats.span.from)} to ${short(stats.span.to)}`}
        footR={busiest ? `Busiest: ${short(busiest.day)}` : ''}
      />
      <MonoRoundedHeatmapChart
        theme={theme}
        title={name}
        badge="Calendar"
        value={worked.length}
        unit="days"
        data={grid}
        tip={(row, c) => {
          const d = row.ds[c];
          return inMonth(d.day) ? `${short(d.day)}: ${d.minutes} min${d.headline ? ` · ${d.headline}` : ''}` : `Outside ${name}`;
        }}
        footL="Rows are weeks from Monday"
        footR="Stronger is more minutes"
      />
      <MonoRoundedStackedBarChart
        theme={theme}
        title="Pull requests"
        badge="By week"
        value={merged}
        unit="merged"
        data={prs}
        names={['Merged', 'Opened', 'Reviewed']}
        footL={gaps ? '* GitHub not read for some days' : 'Every day read'}
        footR="Merged at the base"
      />
      <MonoRoundedBarChart
        theme={theme}
        title="Lines changed"
        badge="By week"
        value={added >= 1000 ? `+${(added / 1000).toFixed(1)}k` : `+${added}`}
        unit="lines added"
        data={prs.map((p) => ({ label: p.label, primary: p.add, secondary: p.del }))}
        names={['Added', 'Removed']}
        highlight={-1}
        footL={`${short(stats.span.from)} to ${short(stats.span.to)}`}
        footR="Where GitHub was read"
      />
      {ledger.length > 0 && (
        <section className="dp-card textcard wide">
          <span className="label">Growth ledger</span>
          <h3>Every "Where to improve" of {name}, by week</h3>
          <div className="ledger">
            {ledger.map((w) => (
              <section key={w.m}>
                <span className="label">Week of {short(w.m)}</span>
                <ul>
                  {w.items.slice(0, LEDGER_ITEMS).map(([day, g], i) => (
                    <li key={day + i} title={short(day)}>
                      {trim(g, 150)}
                    </li>
                  ))}
                  {w.items.length > LEDGER_ITEMS && (
                    <li className="quiet">
                      <a href={`#week/${isoWeek(w.m)}`}>{w.items.length - LEDGER_ITEMS} more that week</a>
                    </li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Year ────────────────────────────────────────────────────────────────────

function Year({ stats, at, week, theme }) {
  const year = stats.key;
  const start = stats.range.from;
  const cols = Math.round((D(stats.range.to) - D(start)) / (7 * 864e5)) + 1;
  const ydays = stats.days.filter((d) => d.day.startsWith(year));
  const max = Math.max(1, ...ydays.map((d) => d.minutes));
  const first = ydays.find((d) => d.minutes);

  const contrib = Array.from({ length: cols * 7 }, (_, i) => {
    const k = add(start, i);
    const m = at(k).minutes;
    return {
      date: short(k),
      count: m,
      level: m ? Math.min(4, 1 + Math.floor((m / max) * 3.999)) : 0,
      today: k === stats.today,
      out: k > stats.today || !k.startsWith(year),
    };
  });
  // One label slot per week column, filled where a month starts.
  const monthCols = Array.from({ length: cols }, (_, w) => {
    const k = Array.from({ length: 7 }, (_, r) => add(start, w * 7 + r)).find(
      (x) => x.endsWith('-01') && x.startsWith(year),
    );
    return k ? fmt(k, { month: 'short' }) : '';
  });

  // Weekly rhythm from the first recorded week to the last full one; the
  // week in progress would always read as a drop.
  const last = stats.today <= stats.span.to ? add(stats.today, -1) : stats.span.to;
  const weeks = [];
  if (first) {
    const from = add(first.day, -((D(first.day).getUTCDay() + 6) % 7));
    for (let m = from; add(m, 6) <= last; m = add(m, 7)) weeks.push(m);
  }
  let run = 0;
  const cum = weeks.map((m) => ({ v: (run += sum(week(m), (d) => d.github?.merged ?? 0)) }));
  const lastWeek = weeks[weeks.length - 1];

  const wrapped = Object.fromEntries(stats.months.map((m) => [m.key, m.headline]));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    .map((mo) => {
      const ds = ydays.filter((d) => d.day.startsWith(mo) && d.minutes);
      const top = ds.reduce((a, d) => (d.minutes > a.minutes ? d : a), ds[0]);
      return { mo, ds, mins: sum(ds, (d) => d.minutes), top, headline: wrapped[mo] ?? null };
    })
    .filter((m) => m.ds.length)
    .reverse();

  return (
    <div className="grid2">
      <div className="wide">
        <MonoActivityHeatmap
          theme={theme}
          title="The year in squares"
          badge={year}
          value={`${hours(sum(ydays, (d) => d.minutes))} h`}
          unit="active"
          data={contrib}
          months={monthCols}
          noun={['min', 'min']}
          hint="Hover a day for its minutes. Red is today."
          footL={first ? `The record starts ${short(first.day)}` : 'Nothing recorded yet'}
          footR={`Jan to Dec ${year}`}
        />
      </div>
      {weeks.length > 1 && (
        <MonoRoundedAreaChart
          theme={theme}
          title="Rhythm"
          badge="Weekly hours"
          value={`${hours(sum(week(lastWeek), (d) => d.minutes))} h`}
          unit="in the last full week"
          data={weeks.map((m) => ({ time: short(m), volume: hours(sum(week(m), (d) => d.minutes)) }))}
          names={['Active hours']}
          footL={`${short(weeks[0])} to ${short(add(lastWeek, 6))}`}
          footR="One point per week"
        />
      )}
      {weeks.length > 1 && (
        <MonoRoundedKpiCardChart
          theme={theme}
          title="PRs merged"
          badge="Running total"
          value={run}
          unit="where GitHub was read"
          data={cum}
          footL="Flat weeks may be unread"
          footR={`Since ${short(weeks[0])}`}
        />
      )}
      <section className="dp-card textcard wide">
        <span className="label">Months as chapters</span>
        <ul className="list">
          {months.map((m) => (
            <li key={m.mo}>
              <a className="when" href={`#month/${m.mo}`}>
                {fmt(`${m.mo}-01`, { month: 'short' })}
              </a>
              <span className="what">
                {m.headline ?? m.top.headline ?? `${m.ds.length} days of work`}
                <br />
                <span className="quiet">
                  {m.ds.length} days · {hours(m.mins)} h · busiest {short(m.top.day)}
                  {m.headline ? '' : ' · not wrapped, so this is its busiest day'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
