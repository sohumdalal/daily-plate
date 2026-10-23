/**
 * The Wrap tab — the whole client. No framework, no build step.
 *
 * State is two values: which period you're looking at, and which key. Both
 * live in the URL hash so a day is linkable and the back button works.
 */

const $ = (id) => document.getElementById(id);

const CATEGORY_LABEL = {
  career: 'Career',
  craft: 'Craft',
  impact: 'Impact',
  personal: 'Personal',
  intrinsic: 'Why',
};

const HORIZON_LABEL = {
  quarter: 'this quarter',
  year: 'this year',
  long: 'long term',
};

const el = {
  shell: $('shell'),
  goalsView: $('goals-view'),
  feedbackView: $('feedback-view'),
  feedbackTab: $('feedback-tab'),
  slackList: $('slack-list'),
  slackCount: $('slack-count'),
  slackEmpty: $('slack-empty'),
  goalsTab: $('goals-tab'),
  brand: $('brand'),
  brandmenu: $('brandmenu'),
  goalForm: $('goal-form'),
  goalAdd: $('goal-form').querySelector('button[type="submit"]'),
  goalTitle: $('goal-title'),
  goalCategory: $('goal-category'),
  goalHorizon: $('goal-horizon'),
  goalMeasure: $('goal-measure'),
  goalWhy: $('goal-why'),
  goalList: $('goal-list'),
  goalsEmpty: $('goals-empty'),
  goalsLoading: $('goals-loading'),
  slackLoading: $('slack-loading'),
  skeleton: $('skeleton'),
  progress: $('progress'),
  periods: $('periods'),
  todayJump: $('today-jump'),
  datefield: $('datefield'),
  datefieldLabel: $('datefield-label'),
  calendar: $('calendar'),
  calMonth: $('cal-month'),
  calDow: $('cal-dow'),
  calGrid: $('cal-grid'),
  calPrev: $('cal-prev'),
  calNext: $('cal-next'),
  calToday: $('cal-today'),
  prev: $('prev'),
  next: $('next'),
  dateLabel: $('date-label'),
  todayBadge: $('today-badge'),
  tabs: $('tabs'),
  tabSummary: $('tab-summary'),
  tabReflect: $('tab-reflect'),
  empty: $('empty'),
  specs: $('specs'),
  specsRule: $('specs-rule'),
  did: $('did'),
  didSection: $('did-section'),
  learned: $('learned'),
  learnedSection: $('learned-section'),
  disagree: $('disagree'),
  dispute: $('dispute'),
  disputeNote: $('dispute-note'),
  disputeSend: $('dispute-send'),
  disputeCancel: $('dispute-cancel'),
  corrections: $('corrections'),
  correctionsList: $('corrections-list'),
  grew: $('grew'),
  grewSection: $('grew-section'),
  grewLabel: $('grew-label'),
  covered: $('covered'),
  coveredSection: $('covered-section'),
  sources: $('sources'),
  sourcesCount: $('sources-count'),
  sourcesSearch: $('sources-search'),
  sourcesKinds: $('sources-kinds'),
  sourcesEmpty: $('sources-empty'),
  tabSources: $('tab-sources'),
  provenance: $('provenance'),
  reflection: $('reflection'),
  thread: $('thread'),
  chatThinking: $('chat-thinking'),
  reflectIntro: $('reflect-intro'),
  reflectSend: $('reflect-send'),
  reflectHint: $('reflect-hint'),
  three: $('three'),
  threeStatus: $('three-status'),
  threeSave: $('three-save'),
  chatDraft: $('chat-draft'),
  takeGood: $('take-good'),
  takeBad: $('take-bad'),
  takeImprove: $('take-improve'),
  energy: $('energy'),
  wrap: $('wrap'),
  charts: $('charts'),
  viewError: $('view-error'),
  viewErrorTitle: $('view-error-title'),
  viewErrorReason: $('view-error-reason'),
  viewRetry: $('view-retry'),
  viewToday: $('view-today'),
  collect: $('collect'),
  readAt: $('read-at'),
  note: $('note'),
};

/** From shell.js, so both tabs say it the same way. */
const { ago } = window.DailyPlate;

const TABS = ['summary', 'reflect', 'sources'];

let state = {
  /** 'wrap' shows a period; 'goals' shows the goals page. */
  mode: 'wrap',
  /** True while the agent is composing a reply, which the chat shows itself. */
  reflecting: false,
  period: 'day',
  /** Which half of a period is on screen. */
  tab: 'summary',
  key: null,
  today: null,
  view: null,
  busy: false,
};

// ── Period key arithmetic (mirrors agent/time.ts, for navigation only) ─────

const pad = (n) => String(n).padStart(2, '0');

function shiftDay(key, delta) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function mondayOfWeekKey(key) {
  const [year, week] = key.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  monday.setUTCDate(monday.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

function weekKeyOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${isoYear}-W${pad(week)}`;
}

function shiftKey(period, key, delta) {
  if (period === 'day') return shiftDay(key, delta);
  if (period === 'week') return weekKeyOf(shiftDay(mondayOfWeekKey(key), delta * 7));
  if (period === 'month') {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  return String(Number(key) + delta);
}

/** The key for the period that contains today — where each period starts. */
function keyForToday(period, today) {
  if (period === 'day') return today;
  if (period === 'week') return weekKeyOf(today);
  if (period === 'month') return today.slice(0, 7);
  return today.slice(0, 4);
}

/** The key for the period containing `day`, for switching period in place. */
function keyContaining(period, key, today) {
  // Derive a representative day from whatever key we're on, then re-bucket it.
  let day = today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) day = key;
  else if (key.includes('-W')) day = mondayOfWeekKey(key);
  else if (/^\d{4}-\d{2}$/.test(key)) day = `${key}-01`;
  else if (/^\d{4}$/.test(key)) day = `${key}-01-01`;
  return keyForToday(period, day);
}

// ── Rendering ──────────────────────────────────────────────────────────────

function list(node, items) {
  node.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function specCell(value, label) {
  const cell = document.createElement('div');
  const v = document.createElement('div');
  v.className = value ? 'spec-value' : 'spec-value dim';
  v.textContent = String(value);
  const l = document.createElement('div');
  l.className = 'label spec-label';
  l.textContent = label;
  cell.append(v, l);
  return cell;
}

function renderSpecs(view) {
  const claude = view.claude;
  const github = view.github;
  if (!claude && !github) {
    el.specs.hidden = true;
    el.specsRule.hidden = true;
    return;
  }
  const c = claude?.totals;
  const g = github?.totals;
  el.specs.replaceChildren(
    specCell(c?.prompts ?? 0, 'Prompts'),
    specCell(g?.commits ?? 0, 'Commits'),
    specCell((g?.opened ?? 0) + (g?.merged ?? 0), 'Pull requests'),
    specCell(c?.activeMinutes ?? 0, 'Minutes active'),
  );
  el.specs.hidden = false;
  el.specsRule.hidden = false;
}

/** A time, with its date when it was not today: "14:02", or "15 Oct, 14:02". */
const clock = (iso) => {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === new Date().toDateString()) return time;
  return `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
};

/** A day key as the tab writes dates everywhere: "Thu 15 Oct". */
const dayLabel = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * Where this screen's contents came from and when. GitHub's commit search is
 * indexed with a lag, so a count can be short simply because the day was read
 * too early; saying when it was read makes that visible instead of puzzling.
 */
function renderProvenance(view) {
  const parts = [];
  if (view.collectedAt) parts.push(`Sources read ${clock(view.collectedAt)}`);
  if (view.wrap) {
    parts.push(
      `wrapped ${clock(view.wrap.generatedAt)}` +
        (view.wrap.model ? ` by ${view.wrap.model}` : ''),
    );
  }
  el.provenance.hidden = parts.length === 0;
  el.provenance.textContent = parts.join(' · ');
}

function renderWrap(view) {
  const wrap = view.wrap;
  const hasWrap = Boolean(wrap && wrap.did.length);

  // The headline is still generated — it labels this key in a rollup's list of
  // days — but it is not rendered here, where it only restated the bullets.
  el.empty.hidden = hasWrap;
  // A day with no wrap is an empty page; a week, month or year still has its
  // charts above, so it says so in a line rather than a headline.
  el.empty.className = view.period === 'day' ? 'empty-state empty-title' : 'note';
  el.empty.textContent =
    view.period === 'day'
      ? 'Nothing wrapped yet.'
      : `Not wrapped yet. Wrap the ${view.period} to write what it adds up to.`;

  for (const [section, node, items] of [
    [el.didSection, el.did, wrap?.did ?? []],
    [el.grewSection, el.grew, wrap?.grew ?? []],
  ]) {
    section.hidden = items.length === 0;
    if (items.length) list(node, items);
  }

  // The agent's take is a paragraph. The section stays open whenever there are
  // corrections to show, even on a period it has nothing to say about.
  const take = wrap?.learned ?? '';
  const notes = view.feedback ?? [];
  el.learned.textContent = take;
  el.learned.hidden = !take;
  el.learnedSection.hidden = !take && notes.length === 0;
  el.disagree.hidden = !take;

  el.corrections.hidden = notes.length === 0;
  if (notes.length) list(el.correctionsList, notes.map((n) => n.note));
}

function renderCovered(view) {
  const days = view.coveredDays;
  // A week's charts list its days with their calls, and a year's its months,
  // so the list of days would say it twice. A month keeps it.
  const charted = window.Mova && (view.period === 'week' || view.period === 'year');
  if (!days || (charted && days.length)) {
    el.coveredSection.hidden = true;
    return;
  }
  el.coveredSection.hidden = false;
  if (!days.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('p');
    title.className = 'empty-title';
    title.textContent = 'No days wrapped in this period yet.';
    empty.append(title);
    el.covered.replaceChildren(empty);
    return;
  }
  el.covered.replaceChildren(
    ...days.map((d) => {
      const a = document.createElement('a');
      a.href = `#day/${d.key}`;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = dayLabel(d.key);
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = d.headline;
      a.append(when, what);
      return a;
    }),
  );
}

/**
 * Every row is a real URL that came from the collected data, so these are safe
 * to link. textContent throughout — a PR title is somebody else's text.
 */
/** Search text and kind, applied to the day's sources without refetching. */
const sourceFilter = { text: '', kind: 'all' };

function matchesFilter(source) {
  if (sourceFilter.kind !== 'all' && source.kind !== sourceFilter.kind) return false;
  const text = sourceFilter.text.trim().toLowerCase();
  if (!text) return true;
  return `${source.ref} ${source.label} ${source.author ?? ''}`
    .toLowerCase()
    .includes(text);
}

function renderSources(view) {
  const all = view.sources ?? [];
  const sources = all.filter(matchesFilter);

  el.sourcesCount.textContent =
    sources.length === all.length
      ? `${all.length}`
      : `${sources.length} of ${all.length}`;
  el.sourcesEmpty.hidden = sources.length > 0 || all.length === 0;

  // Only offer a kind that the period actually contains.
  const present = new Set(all.map((s) => s.kind));
  for (const button of el.sourcesKinds.querySelectorAll('button')) {
    const kind = button.dataset.kind;
    button.hidden = kind !== 'all' && !present.has(kind);
    button.setAttribute('aria-pressed', String(kind === sourceFilter.kind));
  }

  el.sources.replaceChildren(
    ...sources.map((s) => {
      const a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.dataset.kind = s.kind;

      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = s.kind;

      const ref = document.createElement('span');
      ref.className = 'ref';
      ref.textContent = s.ref;

      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = s.author ? `${s.label} · ${s.author}` : s.label;
      what.title = what.textContent;

      a.append(kind, ref, what);
      return a;
    }),
  );
}

/** Keep the newest message in view without yanking the whole page. */
function scrollChatToEnd() {
  requestAnimationFrame(() => {
    el.thread.scrollTop = el.thread.scrollHeight;
  });
}

/** The line above an empty conversation; `working` gives it Mova's shimmer. */
let introShown = '';
function intro(text, working) {
  if (introShown === text) return;
  introShown = text;
  window.Mova?.release(el.reflectIntro);
  if (working && window.Mova) window.Mova.shimmer(el.reflectIntro, text);
  else el.reflectIntro.textContent = text;
}

function renderThread(view) {
  const turns = view.turns ?? [];
  el.thread.replaceChildren(
    ...turns.map((t) => {
      const row = document.createElement('div');
      row.className = 'msg';
      row.dataset.role = t.role;

      // Only the agent is labelled; your own messages are obviously yours.
      if (t.role === 'agent') {
        const role = document.createElement('span');
        role.className = 'msg-role';
        role.textContent = 'Daily Plate';
        row.append(role);
      }

      const text = document.createElement('p');
      text.className = 'msg-text';
      text.textContent = t.text;
      row.append(text);
      return row;
    }),
  );

  const waiting = state.reflecting;
  el.chatThinking.hidden = !waiting;
  el.reflectIntro.hidden = turns.length > 0 || waiting;
  // The conversation opens from the wrap, so without one there is nothing to
  // wait for: say what would start it instead of shimmering forever.
  if (!view.wrap) intro(`Nothing to reflect on yet. Wrap the ${view.period} first, and the conversation starts from it.`, false);
  else intro(view.period === 'day' ? 'Reading your day and your recent ones…' : 'Reading your days…', true);
  el.reflectHint.hidden = turns.length === 0;
  // Nothing to answer until it has asked.
  el.reflection.disabled = turns.length === 0 || waiting;
  el.reflectSend.disabled = turns.length === 0 || waiting;
  scrollChatToEnd();
}

/**
 * The three, always editable. They sit on the summary tab and are the point of
 * the whole record, so they are shown whether or not the chat has drafted
 * anything: you can write them yourself without talking to anyone.
 */
function renderTakeaways(view) {
  const t = view.reflection?.takeaways ?? { good: '', bad: '', improve: '' };
  const any = Boolean(t.good || t.bad || t.improve);
  // Shown once there is a draft or something you already saved, so the chat
  // starts as a conversation rather than a form with three empty boxes.
  el.three.hidden = !any;
  el.threeStatus.textContent = view.reflection?.updatedAt
    ? `Saved ${clock(view.reflection.updatedAt)}`
    : '';
  for (const [field, node] of [
    ['good', el.takeGood],
    ['bad', el.takeBad],
    ['improve', el.takeImprove],
  ]) {
    // Never overwrite what is being typed.
    if (document.activeElement !== node) node.value = t[field] ?? '';
  }
  for (const button of el.energy.querySelectorAll('button')) {
    button.setAttribute(
      'aria-pressed',
      String(Number(button.dataset.energy) === view.reflection?.energy),
    );
  }
}

function renderReflection(view) {
  renderThread(view);
  renderTakeaways(view);
  el.chatDraft.disabled = (view.turns ?? []).length === 0 || state.reflecting;
}

function render() {
  const view = state.view;
  if (!view) return;

  // The picker names the period it is on, not only the period's first day.
  const from = new Date(`${view.span.from}T12:00:00Z`);
  const opts = {
    day: { day: 'numeric', month: 'short', year: 'numeric' },
    week: { day: 'numeric', month: 'short' },
    month: { month: 'short', year: 'numeric' },
    year: { year: 'numeric' },
  }[view.period];
  el.datefieldLabel.textContent =
    (view.period === 'week' ? 'Week of ' : '') +
    from.toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

  el.dateLabel.textContent = view.label;
  document.title = `${view.label} — Wrap — Daily Plate`;
  el.todayBadge.hidden = view.key !== keyForToday(state.period, state.today);
  // No future — a day that hasn't happened has nothing to wrap.
  el.next.disabled = view.key >= keyForToday(state.period, state.today);

  // Writing again replaces what is there, so the button says so.
  buttonState(el.wrap, 'idle', {
    label: `${view.wrap ? 'Rewrap' : 'Wrap'} the ${state.period}`,
  });
  // Forward-looking, so it names the period that comes next, not this one.
  el.grewLabel.textContent =
    state.period === 'day'
      ? 'Where to improve tomorrow'
      : `Where to improve next ${state.period}`;
  el.collect.hidden = state.period !== 'day';
  el.readAt.textContent =
    state.period === 'day' && view.collectedAt ? `Read ${ago(view.collectedAt)}` : '';

  applyTab();
  maybeOpenReflection(view);
  renderSpecs(view);
  renderWrap(view);
  renderCovered(view);
  renderCharts(view);
  renderSources(view);
  renderReflection(view);
  renderProvenance(view);
}

/**
 * A rollup's charts. Their numbers are a second request, so the written wrap
 * never waits on them, and without the Mova bundle the section stays hidden.
 */
async function renderCharts(view) {
  const mova = window.Mova;
  if (!mova || view.period === 'day') {
    el.charts.hidden = true;
    mova?.rollup(el.charts, null);
    return;
  }
  el.charts.hidden = false;
  mova.skeleton(el.charts, 'charts', view.period);
  try {
    const stats = await api(`/api/stats/${view.period}/${view.key}`);
    if (state.view?.period === view.period && state.view?.key === view.key) {
      await mova.rollup(el.charts, stats);
    }
  } catch {
    el.charts.hidden = true;
  }
}

function goalRow(goal) {
  const row = document.createElement('div');
  row.className = 'goal';
  row.dataset.category = goal.category;
  row.dataset.status = goal.status;

  const meta = document.createElement('div');
  meta.className = 'goal-meta';
  meta.textContent = CATEGORY_LABEL[goal.category] ?? goal.category;

  const body = document.createElement('div');
  const title = document.createElement('span');
  title.className = 'goal-title';
  title.textContent = goal.title;
  body.append(title);

  const sub = document.createElement('span');
  sub.className = 'goal-sub';
  sub.textContent = [HORIZON_LABEL[goal.horizon] ?? goal.horizon, goal.measure]
    .filter(Boolean)
    .join(' · ');
  body.append(sub);

  if (goal.why) {
    const why = document.createElement('span');
    why.className = 'goal-why';
    why.textContent = goal.why;
    body.append(why);
  }

  const actions = document.createElement('div');
  actions.className = 'goal-actions';

  const status = document.createElement('select');
  status.setAttribute('aria-label', 'Status');
  for (const value of ['active', 'paused', 'achieved', 'dropped']) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === goal.status;
    status.append(option);
  }
  status.addEventListener('change', () => patchGoal(goal.id, { status: status.value }));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.addEventListener('click', async () => {
    // Deleting changes what every future wrap is judged against, so confirm.
    if (!confirm(`Delete "${goal.title}"? Future wraps stop measuring against it.`)) return;
    await api(`/api/goals/${goal.id}`, { method: 'DELETE' }).catch((err) =>
      note(err.message, true),
    );
    loadGoals();
  });

  actions.append(status, remove);
  row.append(meta, body, actions);
  return row;
}

/**
 * Slack's markup as it reads in Slack: <@U123> is a mention, <#C1|name> a
 * channel, <url|label> a link's label. Names the message does not carry stay
 * generic rather than showing ids.
 */
function slackText(text) {
  return text
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name) => `@${name ?? 'someone'}`)
    .replace(/<#[A-Z0-9]+(?:\|([^>]*))?>/g, (_, name) => `#${name || 'channel'}`)
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1');
}

async function loadSlackFeedback() {
  // The shape only while there is nothing to show; a refresh keeps the list.
  const blank = el.slackList.childElementCount === 0;
  el.slackLoading.hidden = !blank;
  progress(true);
  try {
    const { feedback } = await api('/api/feedback/slack');
    el.slackCount.textContent = feedback.length ? `${feedback.length}` : '';
    el.slackEmpty.hidden = feedback.length > 0;
    el.slackList.replaceChildren(
      ...feedback.map((f) => {
        const item = document.createElement('div');
        item.className = 'feedback-item';

        const meta = document.createElement('div');
        meta.className = 'feedback-meta';
        const where = document.createElement('span');
        where.className = 'where';
        // An id is meaningless to read; a channel the agent cannot name is just Slack.
        where.textContent = f.channelName ? `#${f.channelName}` : 'Slack';
        const when = document.createElement('a');
        when.href = `#day/${f.day}`;
        when.textContent = dayLabel(f.day);
        meta.append(where, when);
        const who = f.authorName || f.authorId;
        if (who) {
          const author = document.createElement('span');
          author.className = 'who';
          author.textContent = who;
          meta.append(author);
        }
        if (f.permalink) {
          const link = document.createElement('a');
          link.href = f.permalink;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Open in Slack';
          meta.append(link);
        }

        const text = document.createElement('p');
        text.className = 'feedback-text';
        text.textContent = slackText(f.text);

        item.append(meta, text);
        return item;
      }),
    );
  } catch (err) {
    note(err.message, true);
  } finally {
    el.slackLoading.hidden = true;
    progress(false);
  }
}

async function loadGoals() {
  // Bars only while there is nothing to show; a refresh keeps the current list.
  const blank = el.goalList.childElementCount === 0;
  el.goalsLoading.hidden = !blank;
  el.goalsEmpty.hidden = true;
  progress(true);
  try {
    const { goals } = await api('/api/goals');
    el.goalList.replaceChildren(...goals.map(goalRow));
    el.goalsEmpty.hidden = goals.length > 0;
  } catch (err) {
    note(err.message, true);
  } finally {
    el.goalsLoading.hidden = true;
    progress(false);
  }
}

async function patchGoal(id, patch) {
  try {
    await api(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    loadGoals();
  } catch (err) {
    note(err.message, true);
  }
}

/** `working` says it with Mova's shimmer, for something still in progress. */
function note(message, warn = false, working = false) {
  window.Mova?.release(el.note);
  el.note.hidden = !message;
  el.note.className = warn ? 'note warn' : 'note';
  if (working && message && window.Mova) window.Mova.shimmer(el.note, message);
  else el.note.textContent = message ?? '';
}

/**
 * Mova draws a button's working, done and failed states when its bundle has
 * loaded. Without it the button keeps a plain label, as it always did.
 */
function buttonState(node, state, labels = {}) {
  if (window.Mova) window.Mova.button(node, { state, ...labels });
  else if (labels.label) node.textContent = labels.label;
}

function busy(on) {
  state.busy = on;
  el.wrap.disabled = on;
  el.collect.disabled = on;
}

/** Mova's progress line along the nav, while anything is read. */
function progress(on) {
  window.Mova?.progress(el.progress, on);
}

// ── Server ─────────────────────────────────────────────────────────────────

/** Every call is to the Wrap tab's API, mounted under /api/wrap. */
async function api(path, options) {
  const res = await fetch(path.replace(/^\/api\//, '/api/wrap/'), {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

/** Counts loads, so only the newest one's answer is shown when paging quickly. */
let loads = 0;

async function load() {
  const seq = ++loads;
  // A different period or key empties to its skeleton; the same one, read
  // again, keeps what is on screen.
  const fresh = state.view?.period !== state.period || state.view?.key !== state.key;
  if (fresh) {
    window.Mova?.skeleton(el.skeleton, state.period === 'day' ? 'day' : 'rollup', state.period);
    el.shell.classList.add('is-loading');
  }
  busy(true);
  progress(true);
  try {
    const view = await api(`/api/view/${state.period}/${state.key}`);
    if (seq !== loads) return;
    state.view = view;
    el.shell.classList.remove('failed');
    el.viewError.hidden = true;
    render();
    restorePlace();
    if (focusReflectionOnLoad) {
      focusReflectionOnLoad = false;
      setTab('reflect');
      applyTab();
      focusReflection();
    }
  } catch (err) {
    if (seq === loads) viewFailed(err);
  } finally {
    progress(false);
    if (seq === loads) {
      el.shell.classList.remove('is-loading');
      busy(false);
    }
  }
}

/** The view did not load: say why, and offer it again or today instead. */
function viewFailed(err) {
  state.view = null;
  el.shell.classList.add('failed');
  el.viewErrorTitle.textContent = `This ${state.period} did not load.`;
  el.viewErrorReason.textContent = sentence(err.message);
  el.viewError.hidden = false;
  note(null);
}

/** An error message as a sentence: capital first, full stop last. */
function sentence(text) {
  const t = text || 'Unknown error';
  return `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
}

/** `button`, when given, is the one that started this, and shows its progress. */
async function run(path, pending, body, button) {
  if (state.busy) return;
  busy(true);
  progress(true);
  note(pending, false, true);
  if (button) buttonState(button.node, 'loading', { pending: button.pending });
  let outcome = 'success';
  const at = `${state.period}/${state.key}`;
  try {
    const view = await api(path, {
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Moved on while it worked: the answer is for a page no longer shown.
    if (at !== `${state.period}/${state.key}`) {
      note(`${view.label ?? at} is wrapped.`);
      return;
    }
    state.view = view;
    render();
    if (view.empty)
      note(
        state.period === 'day'
          ? 'Nothing recorded for this day — nothing to wrap.'
          : `No days wrapped in this ${state.period} yet — wrap some days first.`,
      );
    else if (view.errors?.length) {
      note(view.errors.join(' · '), true);
      outcome = 'error';
    } else note(null);
  } catch (err) {
    note(err.message, true);
    outcome = 'error';
  } finally {
    busy(false);
    progress(false);
    if (button) buttonState(button.node, outcome, { done: button.done });
  }
}

const wrapNow = () =>
  run(
    `/api/view/${state.period}/${state.key}/wrap`,
    state.period === 'day' ? 'Reading the day, then writing it…' : 'Reading the days…',
    undefined,
    { node: el.wrap, pending: 'Writing', done: 'Wrapped' },
  );

const collectNow = () =>
  run(
    `/api/view/${state.period}/${state.key}/collect`,
    'Re-reading Claude and GitHub…',
    undefined,
    { node: el.collect, pending: 'Reading', done: 'Read' },
  );

/** Patch fields on the reflection without touching the rest. True if it saved. */
async function patchReflection(patch) {
  try {
    const { reflection } = await api(`/api/reflection/${state.period}/${state.key}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    if (state.view) state.view.reflection = reflection;
    renderReflection(state.view);
    return true;
  } catch (err) {
    note(err.message, true);
    return false;
  }
}

async function saveThree() {
  el.threeStatus.textContent = 'Saving…';
  buttonState(el.threeSave, 'loading', { pending: 'Saving' });
  const saved = await patchReflection({
    good: el.takeGood.value.trim(),
    bad: el.takeBad.value.trim(),
    improve: el.takeImprove.value.trim(),
  });
  buttonState(el.threeSave, saved ? 'success' : 'error', { done: 'Saved' });
}

/**
 * Keys this session has already tried to open, so a failed open is not retried
 * on every render and a revisit does not spend another call.
 */
const opened = new Set();

/**
 * Open the conversation when you arrive with nothing in it. Gated on the
 * period having a wrap: with nothing to read, the agent has nothing to ask
 * about, and paging through empty days should not each cost a call.
 */
function maybeOpenReflection(view) {
  if (state.tab !== 'reflect') return;
  if (state.reflecting) return;
  if ((view.turns ?? []).length > 0) return;
  if (!view.wrap) return;
  const id = `${view.period}/${view.key}`;
  if (opened.has(id)) return;
  opened.add(id);
  sendReflection();
}

/**
 * Send a turn, or open the conversation when the box is empty.
 *
 * The page is not dimmed for this: the chat shows its own thinking state, and
 * blanking the rest of the screen while a reply composes reads as a failure.
 * Your message is shown immediately rather than waiting for the round trip.
 */
async function sendReflection() {
  if (state.reflecting) return;
  const message = el.reflection.value.trim();

  state.reflecting = true;
  if (message && state.view) {
    state.view.turns = [
      ...(state.view.turns ?? []),
      { id: `pending-${Date.now()}`, role: 'person', text: message, createdAt: '' },
    ];
    el.reflection.value = '';
  }
  if (state.view) renderThread(state.view);

  try {
    const res = await api(`/api/reflect/${state.period}/${state.key}`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    if (state.view) {
      state.view.turns = res.turns;
      state.view.reflection = res.reflection;
    }
    note(null);
  } catch (err) {
    // Put the unsent message back so it is not lost to a failed request.
    if (message) el.reflection.value = message;
    if (state.view) {
      state.view.turns = (state.view.turns ?? []).filter(
        (t) => !String(t.id).startsWith('pending-'),
      );
    }
    note(err.message, true);
  } finally {
    state.reflecting = false;
    if (state.view) renderReflection(state.view);
    el.reflection.focus();
  }
}

// ── Resuming after a reload ────────────────────────────────────────────────

/**
 * A reload restores the period from the hash, but not the scroll position or
 * an unsent answer, so it lands you at the top of a page you were part way
 * down. Both are per-key and per-tab, which is what sessionStorage is for.
 * Every access is guarded: a private window or blocked site data throws here
 * rather than returning empty.
 */
const resumeKey = () => `dw:resume:${state.mode}:${state.period}:${state.key}`;

function rememberPlace() {
  if (!state.key) return;
  try {
    sessionStorage.setItem(
      resumeKey(),
      JSON.stringify({ scroll: window.scrollY, draft: el.reflection.value }),
    );
  } catch {
    // No session storage. Losing the position is not worth failing over.
  }
}

function restorePlace() {
  let saved = null;
  try {
    const raw = sessionStorage.getItem(resumeKey());
    if (raw) saved = JSON.parse(raw);
  } catch {
    saved = null;
  }
  if (!saved) return;

  if (typeof saved.draft === 'string' && saved.draft && !el.reflection.value) {
    el.reflection.value = saved.draft;
  }
  if (typeof saved.scroll === 'number' && saved.scroll > 0) {
    // After render, so the page is tall enough to scroll to.
    requestAnimationFrame(() => window.scrollTo(0, saved.scroll));
  }
}

// Fires on reload, tab close, and navigation away.
window.addEventListener('pagehide', rememberPlace);
window.addEventListener('beforeunload', rememberPlace);

// ── Routing ────────────────────────────────────────────────────────────────

function go(period, key, replace = false) {
  rememberPlace();
  sourceFilter.text = '';
  sourceFilter.kind = 'all';
  el.sourcesSearch.value = '';
  state.mode = 'wrap';
  // Moving to another period keeps whichever half you were reading.
  const suffix = state.tab === 'summary' ? '' : `/${state.tab}`;
  const hash = `#${period}/${key}${suffix}`;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) applyHash();
}

/**
 * Show one half of a period. Switching is not navigation, so it replaces the
 * history entry rather than adding one, while still living in the URL.
 */
function setTab(tab) {
  if (!TABS.includes(tab) || tab === state.tab) return;
  state.tab = tab;
  const suffix = tab === 'summary' ? '' : `/${tab}`;
  history.replaceState(null, '', `#${state.period}/${state.key}${suffix}`);
  applyTab();
  if (state.view) maybeOpenReflection(state.view);
}

function applyTab() {
  el.tabSummary.hidden = state.tab !== 'summary';
  el.tabReflect.hidden = state.tab !== 'reflect';
  el.tabSources.hidden = state.tab !== 'sources';
  // Chat mode pins the page to the viewport so only the log scrolls.
  el.shell.classList.toggle('is-chat', state.tab === 'reflect');
  for (const button of el.tabs.querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.dataset.tab === state.tab));
  }
}

/** Swap which of the two shells is on screen, and mark the nav. */
function applyMode() {
  const goals = state.mode === 'goals';
  const feedback = state.mode === 'feedback';
  const wrap = !goals && !feedback;
  el.goalsView.hidden = !goals;
  el.feedbackView.hidden = !feedback;
  el.shell.hidden = !wrap;
  if (goals) document.title = 'Goals — Daily Plate';
  if (feedback) document.title = 'Feedback — Daily Plate';
  // The one status line goes with the page on screen, so a failure on Goals
  // or Feedback is seen there rather than inside a hidden page.
  const page = goals ? el.goalsView : feedback ? el.feedbackView : el.shell;
  page.insertBefore(el.note, page.querySelector(':scope > .keys'));
  el.goalsTab.setAttribute('aria-current', String(goals));
  el.feedbackTab.setAttribute('aria-current', String(feedback));
  el.datefield.closest('.datefield-wrap').hidden = !wrap;
  closeCalendar();
  openBrandMenu(false);
  for (const button of el.periods.querySelectorAll('button[data-period]')) {
    button.setAttribute(
      'aria-current',
      String(wrap && button.dataset.period === state.period),
    );
  }
}

function applyHash() {
  const raw = location.hash.replace(/^#/, '');

  if (raw === 'goals') {
    state.mode = 'goals';
    applyMode();
    note(null);
    loadGoals();
    return;
  }

  if (raw === 'feedback') {
    state.mode = 'feedback';
    applyMode();
    note(null);
    loadSlackFeedback();
    return;
  }

  const [period, key, tab] = raw.split('/');
  const valid = ['day', 'week', 'month', 'year'].includes(period) && key;
  state.mode = 'wrap';
  state.period = valid ? period : 'day';
  state.key = valid ? key : keyForToday(state.period, state.today);
  state.tab = TABS.includes(tab) ? tab : 'summary';
  applyMode();
  load().catch((err) => note(err.message, true));
}

// ── Events ─────────────────────────────────────────────────────────────────

el.periods.addEventListener('click', (e) => {
  const period = e.target.dataset?.period;
  if (period) go(period, keyContaining(period, state.key, state.today));
});

el.goalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = el.goalTitle.value.trim();
  if (!title) return;
  buttonState(el.goalAdd, 'loading', { pending: 'Adding' });
  try {
    await api('/api/goals', {
      method: 'POST',
      body: JSON.stringify({
        title,
        category: el.goalCategory.value,
        horizon: el.goalHorizon.value,
        measure: el.goalMeasure.value.trim(),
        why: el.goalWhy.value.trim(),
      }),
    });
    el.goalForm.reset();
    el.goalHorizon.value = 'year';
    el.goalTitle.focus();
    loadGoals();
    buttonState(el.goalAdd, 'success', { done: 'Added' });
  } catch (err) {
    note(err.message, true);
    buttonState(el.goalAdd, 'error');
  }
});

/** Set while a Today jump is in flight, so load() knows to focus when it lands. */
let focusReflectionOnLoad = false;

function focusReflection() {
  el.reflection.focus();
  el.reflection.setSelectionRange(
    el.reflection.value.length,
    el.reflection.value.length,
  );
  el.reflection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Jump to today and put the cursor in the reflection.
 *
 * The mode is part of "already there": on the goals page the period and key
 * are still today's, so testing those alone skips the navigation and then
 * focuses a textarea inside the hidden shell.
 *
 * Focusing waits for the load rather than a timer, because renderReflection
 * will not overwrite a focused textarea. Winning that race would leave an
 * empty box on a day that has a reflection.
 */
function goToTodaysReflection() {
  const alreadyThere =
    state.mode === 'wrap' && state.period === 'day' && state.key === state.today;
  if (alreadyThere) {
    setTab('reflect');
    focusReflection();
    return;
  }
  focusReflectionOnLoad = true;
  state.tab = 'reflect';
  go('day', state.today);
}

el.todayJump.addEventListener('click', goToTodaysReflection);

// ── Brand menu ─────────────────────────────────────────────────────────────

function openBrandMenu(open) {
  el.brandmenu.hidden = !open;
  el.brand.setAttribute('aria-expanded', String(open));
}

el.brand.addEventListener('click', (e) => {
  e.stopPropagation();
  closeCalendar();
  openBrandMenu(el.brandmenu.hidden);
});

el.brandmenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const view = e.target.dataset?.view;
  if (view) {
    openBrandMenu(false);
    location.hash = `#${view}`;
  }
});

// ── Calendar ───────────────────────────────────────────────────────────────

/** Which month the open calendar is showing, as `YYYY-MM`. */
let calMonth = null;

const monthOf = (key) => key.slice(0, 7);

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function renderCalendar() {
  const [year, month] = calMonth.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));

  el.calMonth.textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(first);

  // Weeks start Monday, to agree with the ISO week keys used everywhere else.
  if (!el.calDow.childElementCount) {
    el.calDow.replaceChildren(
      ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => {
        const span = document.createElement('span');
        span.textContent = d;
        return span;
      }),
    );
  }

  const leading = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - leading);

  const selected = state.view?.span.from;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const at = new Date(gridStart);
    at.setUTCDate(gridStart.getUTCDate() + i);
    const iso = at.toISOString().slice(0, 10);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cal-day';
    button.textContent = String(at.getUTCDate());
    button.dataset.outside = String(iso.slice(0, 7) !== calMonth);
    button.dataset.today = String(iso === state.today);
    // A day in a period the current view covers reads as selected, so the
    // calendar makes sense on a week or month view too.
    button.setAttribute('aria-label', dayLabel(iso));
    if (iso === state.today) button.setAttribute('aria-current', 'date');
    button.setAttribute(
      'aria-pressed',
      String(
        selected !== undefined &&
          iso >= selected &&
          iso <= (state.view?.span.to ?? selected),
      ),
    );
    // Nothing to wrap in the future.
    button.disabled = iso > state.today;
    if (!button.disabled) {
      button.addEventListener('click', () => {
        closeCalendar();
        go(state.period, keyForToday(state.period, iso));
      });
    }
    cells.push(button);
  }
  el.calGrid.replaceChildren(...cells);

  // Never navigate into a month that has not happened.
  el.calNext.disabled = shiftMonth(calMonth, 1) > monthOf(state.today);
}

function openCalendar() {
  calMonth = monthOf(state.view?.span.from ?? state.today);
  el.calendar.hidden = false;
  el.datefield.setAttribute('aria-expanded', 'true');
  renderCalendar();
  // Focus goes into the dialog, on the day you are on or today.
  const days = [...el.calGrid.querySelectorAll('.cal-day')].filter((b) => !b.disabled);
  (days.find((b) => b.getAttribute('aria-pressed') === 'true') ?? days.at(-1))?.focus();
}

/** Arrow keys move a day or a week through the grid; the page's keys wait. */
el.calendar.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeCalendar();
    el.datefield.focus();
    return;
  }
  if (!step || !e.target.classList.contains('cal-day')) return;
  e.preventDefault();
  e.stopPropagation();
  const days = [...el.calGrid.querySelectorAll('.cal-day')];
  const next = days[days.indexOf(e.target) + step];
  if (next && !next.disabled) next.focus();
});

function closeCalendar() {
  el.calendar.hidden = true;
  el.datefield.setAttribute('aria-expanded', 'false');
}

el.datefield.addEventListener('click', (e) => {
  e.stopPropagation();
  if (el.calendar.hidden) openCalendar();
  else closeCalendar();
});

el.calendar.addEventListener('click', (e) => e.stopPropagation());

el.calPrev.addEventListener('click', () => {
  calMonth = shiftMonth(calMonth, -1);
  renderCalendar();
});

el.calNext.addEventListener('click', () => {
  if (el.calNext.disabled) return;
  calMonth = shiftMonth(calMonth, 1);
  renderCalendar();
});

el.calToday.addEventListener('click', () => {
  closeCalendar();
  go(state.period, keyForToday(state.period, state.today));
});

// Clicking anywhere else dismisses either popup.
document.addEventListener('click', () => {
  if (!el.calendar.hidden) closeCalendar();
  if (!el.brandmenu.hidden) openBrandMenu(false);
});

// ── Disagreeing with the agent's take ──────────────────────────────────────

function showDispute(show) {
  el.dispute.hidden = !show;
  if (show) {
    el.disputeNote.focus();
  } else {
    el.disputeNote.value = '';
  }
}

el.disagree.addEventListener('click', () => showDispute(el.dispute.hidden));
el.disputeCancel.addEventListener('click', () => showDispute(false));

el.disputeSend.addEventListener('click', async () => {
  const note = el.disputeNote.value.trim();
  if (!note) {
    el.disputeNote.focus();
    return;
  }
  showDispute(false);
  await run(
    `/api/view/${state.period}/${state.key}/disagree`,
    'Noted. Rewriting with that in mind, and keeping it for next time…',
    { note },
  );
});

el.sourcesSearch.addEventListener('input', () => {
  sourceFilter.text = el.sourcesSearch.value;
  if (state.view) renderSources(state.view);
});

el.sourcesKinds.addEventListener('click', (e) => {
  const kind = e.target.dataset?.kind;
  if (!kind) return;
  sourceFilter.kind = kind;
  if (state.view) renderSources(state.view);
});

el.tabs.addEventListener('click', (e) => {
  const tab = e.target.dataset?.tab;
  if (tab) setTab(tab);
});

el.prev.addEventListener('click', () => go(state.period, shiftKey(state.period, state.key, -1)));
el.next.addEventListener('click', () => {
  if (!el.next.disabled) go(state.period, shiftKey(state.period, state.key, 1));
});

el.wrap.addEventListener('click', wrapNow);
el.viewRetry.addEventListener('click', () => load());
el.viewToday.addEventListener('click', () => go(state.period, keyForToday(state.period, state.today)));
el.collect.addEventListener('click', collectNow);

el.reflectSend.addEventListener('click', sendReflection);

// Grow with the text, up to the height the stylesheet caps it at.
el.reflection.addEventListener('input', () => {
  el.reflection.style.height = 'auto';
  el.reflection.style.height = `${el.reflection.scrollHeight}px`;
});

el.threeSave.addEventListener('click', saveThree);

// Asking for a draft is a turn like any other, with an explicit instruction.
el.chatDraft.addEventListener('click', () => {
  if (state.reflecting) return;
  el.reflection.value = 'Draft my three from what I have told you.';
  sendReflection();
});

el.energy.addEventListener('click', (e) => {
  const value = e.target.dataset?.energy;
  if (!value) return;
  const already = e.target.getAttribute('aria-pressed') === 'true';
  patchReflection({ energy: already ? null : Number(value) });
});

/** A key pressed inside a field belongs to the field. */
const isTyping = (target) =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable);

document.addEventListener('keydown', (e) => {
  // These pages are forms or lists, so their fields keep their own keys.
  // Outside them the jump to today still works.
  if (state.mode !== 'wrap') {
    if (isTyping(e.target)) return;
    // Back to the period you were on; history.back() could leave the site.
    if (e.key === 'Escape') go(state.period, state.key ?? keyForToday(state.period, state.today));
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      goToTodaysReflection();
    }
    return;
  }
  // Never steal keys from either text box.
  if (e.target === el.reflection) {
    if (e.key === 'Escape') el.reflection.blur();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReflection();
    }
    return;
  }
  if (e.target === el.disputeNote) {
    if (e.key === 'Escape') showDispute(false);
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) el.disputeSend.click();
    return;
  }
  if (e.key === 'Escape' && (!el.calendar.hidden || !el.brandmenu.hidden)) {
    closeCalendar();
    openBrandMenu(false);
    return;
  }
  // Every other field keeps its keys: the search, the three, the goal form.
  if (isTyping(e.target)) return;
  // Writing a wrap is a model call, so it takes a deliberate chord.
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    wrapNow();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  // A focused button or link answers Enter and Space itself; letters still work.
  if (e.target.closest?.('button, a, [role="menuitem"]') && (e.key === 'Enter' || e.key === ' ')) return;

  const periods = { d: 'day', w: 'week', m: 'month', y: 'year' };
  const period = periods[e.key.toLowerCase()];

  if (e.key === 'ArrowLeft') el.prev.click();
  else if (e.key === 'ArrowRight') el.next.click();
  else if (e.key.toLowerCase() === 't') {
    e.preventDefault();
    goToTodaysReflection();
  } else if (e.key.toLowerCase() === 'r') {
    e.preventDefault();
    setTab('reflect');
    el.reflection.focus();
  } else if (period) go(period, keyContaining(period, state.key, state.today));
});

window.addEventListener('hashchange', applyHash);

// ── Boot ───────────────────────────────────────────────────────────────────

// Mova's sliding underline on both tab rows, and its dots while a reply composes.
window.Mova?.tabs(el.periods);
window.Mova?.tabs(el.tabs);
window.Mova?.typing(el.chatThinking.querySelector('.dots'));
// Mova's loading shapes for the goals and the Slack list.
window.Mova?.skeleton(el.goalsLoading, 'goals');
window.Mova?.skeleton(el.slackLoading, 'feedback');


(async () => {
  try {
    const server = await api('/api/state');
    state.today = server.today;
    if (!server.llm) note('No model is set up (the AI gateway, or ANTHROPIC_API_KEY on a laptop) — wraps cannot be written.', true);
    else if (!server.github) note('GitHub is not configured — the day will be Claude only.', true);
  } catch (err) {
    note(`Cannot reach the agent: ${err.message}`, true);
    // The agent's own day is unknown, so this browser's local day stands in.
    const now = new Date();
    state.today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (!location.hash) go('day', state.today, true);
  else applyHash();
})();
