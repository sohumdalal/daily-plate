/**
 * The Board tab, from GET /api/board: how the board is moving, then every
 * issue on it, with what the judge made of each.
 *
 * The charts are Mova mono charts (../charts) and the controls are Mova's
 * FilterTagPill, CategorySelect and search-expand (../ui), as everywhere
 * else. Filtering, sorting and search run here, on what one read returned,
 * so they answer as fast as the keys are pressed.
 */

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Sparkles } from 'lucide-react';
import MonoRoundedBarChart from '../charts/mono-rounded-bar.js';
import MonoRoundedAreaChart from '../charts/mono-rounded-area.js';
import MonoRoundedDonutChart from '../charts/mono-rounded-donut.js';
import MonoRoundedKpiCardChart from '../charts/mono-rounded-kpi.js';
import { FilterTagPill } from '../ui/filter-tag-pill.jsx';
import { CategorySelect } from '../ui/category-select.jsx';
import { SearchExpand } from '../ui/search-expand.jsx';
import { TabIndicator } from '../ui/tab-indicator.jsx';
import { useTheme } from '../use-theme.js';

/** Rows a list shows before its Show more, as on the Plate tab. */
const LIST_LIMIT = 10;
const DAY = 864e5;
/** How often the board is read again while a judge run goes. */
const JUDGE_POLL_MS = 4000;

const short = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

const delta = (now, was) => (was ? `${now >= was ? '+' : '−'}${Math.abs(now - was)} vs last week` : 'no week before');

/** Age groups for a list sorted by when issues were opened. */
const BUCKETS = [
  [7, 'This week'],
  [31, 'This month'],
  [92, 'One to three months'],
  [365, 'Three months to a year'],
  [Infinity, 'Over a year'],
];
const bucketOf = (iso) => BUCKETS.find(([max]) => daysSince(iso) < max)[1];

const SORTS = [
  { value: 'newest', label: 'Newest first', by: (a, b) => b.createdAt.localeCompare(a.createdAt), grouped: true },
  { value: 'oldest', label: 'Oldest first', by: (a, b) => a.createdAt.localeCompare(b.createdAt), grouped: true },
  { value: 'updated', label: 'Recently updated', by: (a, b) => b.updatedAt.localeCompare(a.updatedAt) },
  { value: 'quiet', label: 'Longest untouched', by: (a, b) => a.updatedAt.localeCompare(b.updatedAt) },
  { value: 'comments', label: 'Most discussed', by: (a, b) => b.comments - a.comments },
  { value: 'closed', label: 'Recently closed', by: (a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') },
  {
    value: 'size',
    label: 'Smallest first',
    by: (a, b) => sizeRank(a) - sizeRank(b) || a.createdAt.localeCompare(b.createdAt),
  },
];
const SIZE_ORDER = ['S', 'M', 'L', 'XL'];
const sizeRank = (i) => {
  const n = SIZE_ORDER.indexOf(i.judgment?.size ?? '');
  return n === -1 ? SIZE_ORDER.length : n;
};

const UNASSIGNED = '__none';

/** Every word of the search appears somewhere in the issue, in any order. */
function matcher(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (i) => {
    i._text ??= [
      i.title,
      `${i.repo}#${i.number}`,
      `#${i.number}`,
      i.column,
      ...i.labels,
      ...i.assignees.map((a) => a.login),
      i.author?.login ?? '',
      i.judgment?.thought ?? '',
      ...(i.judgment?.badges ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((w) => i._text.includes(w));
  };
}

/** The board's two views. Each has its own link: /board/ and /board/#issues. */
const VIEWS = [
  { value: 'overview', label: 'Overview' },
  { value: 'issues', label: 'All issues' },
];
const viewOf = () => (location.hash === '#issues' ? 'issues' : 'overview');

/** The Wrap tab's tabs, with Mova's underline sliding to the one chosen. */
function Tabs({ view, onView, counts }) {
  const [bar, setBar] = useState(null);
  return (
    <div className="tabs mova-tabs" role="tablist" ref={setBar}>
      {VIEWS.map((v) => (
        <button
          key={v.value}
          type="button"
          role="tab"
          aria-selected={view === v.value}
          aria-current={view === v.value}
          onClick={() => onView(v.value)}
        >
          {v.label}
          {counts[v.value] != null && <span className="tab-count">{counts[v.value]}</span>}
        </button>
      ))}
      {bar && <TabIndicator container={bar} />}
    </div>
  );
}

export function Board({ api }) {
  const [view, setView] = useState(viewOf);
  useEffect(() => {
    const follow = () => setView(viewOf());
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, []);
  const choose = (next) => {
    setView(next);
    history.replaceState(null, '', next === 'issues' ? '#issues' : location.pathname);
    scrollTo({ top: 0 });
  };
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = async (how = 'get') => {
    setBusy(how === 'get' ? '' : how);
    try {
      setData(await api(how));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };
  useEffect(() => {
    load();
  }, []);

  // While a judge run goes, the board is read again every few seconds, so
  // badges and thoughts appear as each batch is saved.
  useEffect(() => {
    if (!data?.judging) return;
    const t = setTimeout(() => api('get').then(setData, (err) => setError(err.message)), JUDGE_POLL_MS);
    return () => clearTimeout(t);
  }, [data]);

  const judge = async () => {
    try {
      await api('judge');
      setData({ ...data, judging: true });
    } catch (err) {
      setError(err.message);
    }
  };

  if (!data) {
    return error ? (
      <div className="state-error" role="alert">
        <p className="empty-title">The board did not load.</p>
        <p className="empty-caption">{error}</p>
        <div className="actions">
          <button className="btn" type="button" onClick={() => load()}>
            Try again
          </button>
        </div>
      </div>
    ) : (
      <div className="board-loading">
        <Loader2 className="w-5 h-5 animate-spin dp-muted" /> Reading the board…
      </div>
    );
  }

  const unjudged = data.issues.filter((i) => i.state === 'open' && !i.judgment).length;
  return (
    <div className="mova board">
      <Tabs view={view} onView={choose} counts={{ issues: data.issues.length }} />
      <header className="board-head">
        <div className="when">
          <span className="label">{data.metrics.open} open issues</span>
          <button className="line-button" type="button" onClick={() => load('refresh')} disabled={Boolean(busy)}>
            {busy === 'refresh' ? 'Reading…' : 'Refresh'}
          </button>
          <span className="label read-at">Read {short(data.at)}</span>
        </div>
        {data.llm && (
          <button className="line-button" type="button" onClick={judge} disabled={Boolean(busy) || data.judging}>
            {data.judging ? `Judging… ${unjudged} to go` : unjudged ? `Judge ${unjudged} new` : 'Judge changes'}
          </button>
        )}
      </header>
      {error && <p className="note warn">{error}</p>}
      {view === 'overview' && <Metrics m={data.metrics} />}
      {view === 'issues' && <Issues issues={data.issues} badges={data.badges} llm={data.llm} api={api} onJudged={(id, j) =>
        setData((d) => ({ ...d, issues: d.issues.map((i) => (i.id === id ? { ...i, judgment: j, _text: undefined } : i)) }))
      } />}
    </div>
  );
}

// ── Metrics ────────────────────────────────────────────────────────────────

function Metrics({ m }) {
  const theme = useTheme();
  const weeks = m.weeks;
  const last = weeks[weeks.length - 1];
  const first = weeks[0];
  const grew = last.open - first.open;
  const before = weeks[weeks.length - 2];
  const week = before ? last.open - before.open : 0;
  /** `+12%`, or '' with nothing to grow from. */
  const pct = (now, was) => (was ? `${now >= was ? '+' : '−'}${Math.round((Math.abs(now - was) / was) * 100)}%` : '');
  const columns = m.byColumn.slice(0, 6);
  const colTotal = columns.reduce((n, c) => n + c.count, 0) || 1;
  const people = m.byAssignee.slice(0, 8);

  return (
    <section className="board-metrics">
      {/* The Plate tab's spec cells (app.css), with the same hairlines. */}
      <div className="specs">
        {[
          [m.openPrs, 'Open PRs'],
          [m.stale, 'Open over 30 days'],
          [m.unassigned, 'Unassigned'],
          [m.oldestOpenDays === null ? '—' : `${m.oldestOpenDays} d`, 'Oldest open'],
        ].map(([value, label]) => (
          <div key={label} className="spec-cell">
            <span className="spec-value">{value}</span>
            <span className="label">{label}</span>
          </div>
        ))}
      </div>
      <div className="kpis">
        <MonoRoundedKpiCardChart
          theme={theme}
          compact
          title="Closed"
          info="Issues closed since Monday, with the 12 weeks before under it. Against last week, so a slow Monday reads as a slow start, not a slow week."
          badge="This week"
          value={m.thisWeek.closed}
          unit={delta(m.thisWeek.closed, m.lastWeek.closed)}
          data={weeks.map((w) => ({ v: w.closed }))}
          footL={`${weeks.length} weeks`}
          footR={`${m.lastWeek.closed} last week`}
        />
        <MonoRoundedKpiCardChart
          theme={theme}
          compact
          title="Opened"
          info="Issues opened since Monday, with the 12 weeks before under it. New work arriving, whoever opened it."
          badge="This week"
          value={m.thisWeek.opened}
          unit={delta(m.thisWeek.opened, m.lastWeek.opened)}
          data={weeks.map((w) => ({ v: w.opened }))}
          footL={`${weeks.length} weeks`}
          footR={`${m.lastWeek.opened} last week`}
        />
        <MonoRoundedKpiCardChart
          theme={theme}
          compact
          title="Close rate"
          info="Issues closed for each one opened, over the last four weeks. Above 1×, the board is shrinking; below, more arrives than leaves."
          badge="4 weeks"
          value={m.closeRate === null ? '—' : `${m.closeRate}×`}
          unit={m.closeRate === null ? 'nothing opened' : m.closeRate >= 1 ? 'shrinking' : 'growing'}
          data={weeks.map((w) => ({ v: w.opened ? w.closed / w.opened : 0 }))}
          footL="Closed per opened"
          footR={m.closeRate >= 1 ? 'Keeping up' : 'Falling behind'}
        />
        <MonoRoundedKpiCardChart
          theme={theme}
          compact
          title="Time to close"
          info="Days from opened to closed, for issues closed in the last 90 days. The median is the typical issue; a mean far above it means a few old ones were closed at last."
          badge="90 days"
          value={m.closeDays.median === null ? '—' : `${m.closeDays.median} d`}
          unit="median"
          data={weeks.map((w) => ({ v: w.medianDays ?? 0 }))}
          footL={m.closeDays.mean === null ? '' : `Mean ${m.closeDays.mean} d`}
          footR={`${m.closeDays.count} closed`}
        />
      </div>

      <div className="grid2">
        <MonoRoundedBarChart
          theme={theme}
          title="Opened and closed"
          info="Each week from Monday: issues closed (dark) beside issues opened (light). Where light stands above dark, the board grew that week. This week is red."
          badge="By week"
          value={weeks.reduce((n, w) => n + w.closed, 0)}
          unit={`closed in ${weeks.length} weeks`}
          data={weeks.map((w) => ({ label: short(w.monday), primary: w.closed, secondary: w.opened }))}
          names={['Closed', 'Opened']}
          highlight={weeks.length - 1}
          footL={`From ${short(first.monday)}`}
          footR="Red is this week"
        />
        <MonoRoundedAreaChart
          theme={theme}
          title="Board growth"
          info="How many issues were open at the end of each week. The change and its percent are this week's, against the end of last week."
          badge="Open issues"
          value={last.open}
          unit={before ? `${week >= 0 ? '+' : '−'}${Math.abs(week)}${before.open ? ` (${pct(last.open, before.open)})` : ''} this week` : ''}
          data={weeks.map((w) => ({ time: short(w.monday), volume: w.open }))}
          footL="Open at each week's end"
          footR={`${grew >= 0 ? '+' : '−'}${Math.abs(grew)} in ${weeks.length} weeks`}
        />
        {columns.length > 0 && (
          <MonoRoundedDonutChart
            theme={theme}
            title="Open by column"
          info="Where the open issues sit on the board now, as a share of all of them. A large Backlog with little In progress is work waiting to start."
            badge="Now"
            value={m.open}
            unit="open"
            data={columns.map((c) => ({ name: c.name, value: Math.round((c.count / colTotal) * 100) }))}
            center="of open"
          />
        )}
        {people.length > 0 && (
          <MonoRoundedBarChart
            theme={theme}
            title="By person"
          info="Open issues assigned to each person (dark), beside what they closed in the last four weeks (light). An issue with two assignees counts for both. Unassigned issues are not shown."
            badge="Now"
            value={m.unassigned}
            unit="unassigned"
            data={people.map((p) => ({ label: p.login, primary: p.open, secondary: p.closedRecently }))}
            names={['Open', 'Closed in 4 weeks']}
            highlight={-1}
            footL={`${m.byAssignee.length} people`}
            footR="Top 8 by open"
          />
        )}
      </div>

    </section>
  );
}

// ── Issues ─────────────────────────────────────────────────────────────────

function Issues({ issues, badges, llm, api, onJudged }) {
  const [state, setState] = useState('open');
  const [person, setPerson] = useState(null);
  const [column, setColumn] = useState(null);
  const [badge, setBadge] = useState(null);
  const [sort, setSort] = useState('newest');
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(false);
  // The list redraws a beat behind the keys, so typing never waits on it.
  const deferred = useDeferredValue(query);

  const counts = {
    open: issues.filter((i) => i.state === 'open').length,
    closed: issues.filter((i) => i.state === 'closed').length,
  };
  const inState = issues.filter((i) => state === 'all' || i.state === state);

  const options = useMemo(() => {
    const people = new Map();
    let none = 0;
    for (const i of inState) {
      if (!i.assignees.length) none++;
      for (const a of i.assignees) people.set(a.login, (people.get(a.login) ?? 0) + 1);
    }
    const cols = new Map();
    for (const i of inState) cols.set(i.column || 'No column', (cols.get(i.column || 'No column') ?? 0) + 1);
    const marks = new Map();
    for (const i of inState) {
      for (const b of i.judgment?.badges ?? []) marks.set(b, (marks.get(b) ?? 0) + 1);
      if (i.judgment && i.judgment.closable !== 'no') marks.set('could-close', (marks.get('could-close') ?? 0) + 1);
    }
    return {
      person: [
        { value: null, label: 'All', count: null },
        ...[...people].sort((a, b) => b[1] - a[1]).map(([login, count]) => ({ value: login, label: login, count })),
        ...(none ? [{ value: UNASSIGNED, label: 'Unassigned', count: none }] : []),
      ],
      column: [
        { value: null, label: 'All', count: null },
        ...[...cols].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ value: name, label: name, count })),
      ],
      badge: [
        { value: null, label: 'All', count: null },
        ...Object.keys(badges)
          .filter((b) => marks.has(b))
          .map((b) => ({ value: b, label: b, count: marks.get(b) })),
      ],
    };
  }, [inState, badges]);

  const order = SORTS.find((s) => s.value === sort);
  const match = matcher(deferred);
  const shown = inState
    .filter((i) => !person || (person === UNASSIGNED ? !i.assignees.length : i.assignees.some((a) => a.login === person)))
    .filter((i) => !column || (i.column || 'No column') === column)
    .filter((i) => !badge || i.judgment?.badges.includes(badge) || (badge === 'could-close' && i.judgment?.closable !== 'no' && i.judgment))
    .filter(match)
    .sort(order.by);
  const drawn = more ? shown : shown.slice(0, LIST_LIMIT);

  // Sorted by when they were opened, the list falls into age groups.
  const groups = [];
  for (const i of drawn) {
    const name = order.grouped ? bucketOf(i.createdAt) : '';
    if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, items: [] });
    groups[groups.length - 1].items.push(i);
  }

  const reset = (set) => (v) => {
    set(v);
    setMore(false);
  };

  return (
    <section className="board-issues">
      <div className="board-tools">
        <FilterTagPill
          tags={[
            { value: 'open', label: 'Open', count: counts.open },
            { value: 'closed', label: 'Closed', count: counts.closed },
            { value: 'all', label: 'All', count: issues.length },
          ]}
          selected={state}
          onSelect={reset(setState)}
        />
        <SearchExpand value={query} placeholder="Search issues" onChange={reset(setQuery)} />
      </div>
      <div className="board-tools">
        <CategorySelect label="Person" options={options.person} selected={person} onSelect={reset(setPerson)} />
        <CategorySelect label="Column" options={options.column} selected={column} onSelect={reset(setColumn)} />
        {llm && <CategorySelect label="Badge" options={options.badge} selected={badge} onSelect={reset(setBadge)} />}
        <CategorySelect
          label="Sort"
          options={SORTS.map((s) => ({ value: s.value, label: s.label, count: null }))}
          selected={sort}
          onSelect={(v) => setSort(v ?? 'newest')}
        />
        <span className="label board-shown">
          {shown.length} of {inState.length} shown
        </span>
      </div>

      {!shown.length && (
        <div className="empty-state">
          <p className="empty-title">No issue matches.</p>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.name || 'all'} className="issue-group">
          {g.name && <h3 className="label issue-bucket">{g.name}</h3>}
          <ul className="items">
            {g.items.map((i) => (
              <IssueRow key={i.id} issue={i} badges={badges} llm={llm} api={api} onJudged={onJudged} />
            ))}
          </ul>
        </div>
      ))}
      {shown.length > LIST_LIMIT && (
        <button className="line-button show-more" type="button" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? 'Show less' : `Show ${shown.length - LIST_LIMIT} more`}
        </button>
      )}
    </section>
  );
}

/** `opened today`, `opened 1 day ago`, `closed 3 weeks ago`. */
function since(verb, iso) {
  const d = daysSince(iso);
  if (d < 1) return `${verb} today`;
  const [n, unit] =
    d < 14 ? [d, 'day'] : d < 60 ? [Math.round(d / 7), 'week'] : d < 365 ? [Math.round(d / 30), 'month'] : [Math.round(d / 365), 'year'];
  return `${verb} ${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/**
 * Where an issue is, in the Plate tab's state pill: closed, merged, in a PR,
 * or, before any of that, its board column.
 */
function statePill(i) {
  if (i.state === 'closed') {
    return i.notPlanned
      ? { cls: 'state-not_planned', icon: 'circle-slash', label: 'Not planned' }
      : { cls: 'state-closed', icon: 'circle-check-big', label: 'Closed' };
  }
  const merged = i.prs.find((p) => p.state === 'MERGED');
  if (merged) return { cls: 'state-merged', icon: 'git-merge', label: `Merged #${merged.number}`, href: merged.url };
  const open = i.prs.find((p) => p.state === 'OPEN');
  if (open) return { cls: 'state-in_progress', icon: 'circle-dashed', label: `In PR #${open.number}`, href: open.url };
  return null;
}

function IssueRow({ issue: i, badges, llm, api, onJudged }) {
  const j = i.judgment;
  const [open, setOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState('');
  const pill = statePill(i);
  const lead = i.assignees[0];

  const think = async () => {
    setThinking(true);
    setFailed('');
    try {
      onJudged(i.id, await api('think', i.id));
      setOpen(true);
    } catch (err) {
      setFailed(err.message);
    } finally {
      setThinking(false);
    }
  };

  const Pill = pill?.href ? 'a' : 'span';
  return (
    <li className={`item issue ${i.state === 'closed' ? 'done' : ''}`}>
      <span className={`icon issue-mark icon-${i.state === 'closed' ? 'circle-check-big' : 'circle-dot'}`} aria-hidden="true" />
      <div>
        <div className="meta">
          <a className="where where-board" href={i.url} target="_blank" rel="noopener">
            {i.repo}#{i.number}
          </a>
          {pill && (
            <Pill
              className={`state ${pill.cls}`}
              {...(pill.href ? { href: pill.href, target: '_blank', rel: 'noopener' } : {})}
            >
              <span className={`icon icon-${pill.icon}`} />
              <span>{pill.label}</span>
            </Pill>
          )}
          {i.state === 'open' && <span className="status">{i.column || 'No status'}</span>}
          {j?.size && (
            <span className="status" title="The judge's size: S hours, M days, L a week, XL more">
              Size {j.size}
            </span>
          )}
          {lead && (
            <span className="author" title={i.assignees.map((a) => a.login).join(', ')}>
              <span className="issue-people">
                {i.assignees.map((a) => (
                  <img key={a.login} className="author-avatar" src={`${a.avatar}&s=32`} alt="" loading="lazy" />
                ))}
              </span>
              {lead.login}
              {i.assignees.length > 1 ? ` +${i.assignees.length - 1}` : ''}
            </span>
          )}
          <span title={`Opened ${short(i.createdAt)}, updated ${short(i.updatedAt)}`}>
            {i.state === 'closed' && i.closedAt ? since('closed', i.closedAt) : since('opened', i.createdAt)}
          </span>
        </div>
        <a className="title" href={i.url} target="_blank" rel="noopener">
          {i.title}
        </a>
        {(j?.badges.length > 0 || (j && j.closable !== 'no' && i.state === 'open')) && (
          <div className="issue-badges">
            {j && j.closable !== 'no' && i.state === 'open' && (
              <span className={`badge close-${j.closable}`} title={j.closeReason}>
                {j.closable === 'yes' ? 'Can close' : 'Might close'}
              </span>
            )}
            {j?.badges.map((b) => (
              <span key={b} className={`badge b-${b}`} title={badges[b]}>
                {b}
              </span>
            ))}
          </div>
        )}
        {j?.thought && <p className="issue-thought">{j.thought}</p>}
        {/* The deeper thought is for closed issues: did the code really get what was asked. */}
        {llm && i.state === 'closed' && (
          <div className="issue-actions">
            {j?.deep ? (
              <button className="link-button" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? 'Hide the deeper thought' : 'Deeper thought'}
              </button>
            ) : null}
            <button className="link-button" type="button" onClick={think} disabled={thinking}>
              {thinking ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking the code…
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" /> {j?.deep ? 'Think again' : 'Think deeper'}
                </>
              )}
            </button>
            {failed && <span className="note warn">{failed}</span>}
          </div>
        )}
        <AnimatePresence initial={false}>
          {open && j?.deep && (
            <motion.div
              key="deep"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="deep"
            >
              <Deep deep={j.deep} at={j.deepAt} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}

const VERDICT = { done: 'Looks done', 'partly-done': 'Partly done', 'not-started': 'Not started', unclear: 'Unclear' };

function Deep({ deep, at }) {
  const list = (title, items) =>
    items.length > 0 && (
      <div>
        <h4 className="label">{title}</h4>
        <ul>
          {items.map((t, n) => (
            <li key={n}>{t}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="deep-body">
      <p className="deep-verdict">
        <span className={`badge verdict-${deep.verdict}`}>{VERDICT[deep.verdict]}</span>
        <span className="label">{at ? `Thought ${short(at)}` : ''}</span>
      </p>
      <p>{deep.summary}</p>
      <div className="deep-lists">
        {list('In place', deep.done)}
        {list('Left to do', deep.left)}
        {list('Plan', deep.plan)}
        {list('Risks', deep.risks)}
      </div>
      {deep.evidence.length > 0 && (
        <div>
          <h4 className="label">Evidence</h4>
          <ul className="deep-evidence">
            {deep.evidence.map((e, n) => (
              <li key={n}>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener">
                    {e.label}
                  </a>
                ) : (
                  <span>{e.label}</span>
                )}{' '}
                — {e.why}
              </li>
            ))}
          </ul>
        </div>
      )}
      {deep.searched.length > 0 && <p className="label">Searched the code for: {deep.searched.join(', ')}</p>}
    </div>
  );
}
