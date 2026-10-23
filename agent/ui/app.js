/**
 * Daily Plate — the whole client. No framework, no build step.
 *
 * Motion is FLIP: before a render, every element carrying `data-flip` has its
 * position recorded by key; after, each one is animated from where it was to
 * where it is. Rows are rebuilt on every render, so the key, not the element,
 * is what carries identity across one, and a row that changes lists simply
 * glides from one to the other.
 */

const $ = (id) => document.getElementById(id);

/** Board columns, most urgent first. Anything else sorts after these. */
const COLUMN_ORDER = ['In progress', 'In review', 'Ready', 'On hold', 'Backlog'];

const SOURCE_LABEL = { mention: 'Mention', reaction: 'Reacted', task: 'Task' };

/** Sources read from GitHub. */
const GITHUB_SOURCES = new Set(['board', 'pr', 'issue']);

/** Sources read from Slack. A task is neither: you typed it in. */
const SLACK_SOURCES = new Set(['mention', 'reaction']);
/** What a row's X or a section's Clear all can delete for good. */
const DELETABLE = new Set(['task', ...SLACK_SOURCES]);

const TASKS_SECTION = 'Tasks';

/** PRs and issues off the boards have no column, so their state orders them. */
const STATE_ORDER = ['changes', 'approved', 'in_review', 'draft', 'branch', 'in_progress', 'open'];

/** A card's lifecycle, as the pill shows it. Icons are Lucide's. */
const STATE = {
  open: { label: 'Open', icon: 'circle-dot', hint: 'Not started' },
  in_progress: { label: 'In progress', icon: 'circle-dashed', hint: 'In progress, no branch or PR yet' },
  branch: { label: 'Branch', icon: 'git-branch', hint: 'A branch exists, no PR yet' },
  draft: { label: 'Draft PR', icon: 'git-pull-request-draft', hint: 'A draft PR is open' },
  in_review: { label: 'In PR', icon: 'git-pull-request', hint: 'A PR is open, waiting on review' },
  changes: { label: 'Changes requested', icon: 'circle-alert', hint: 'Review asked for changes' },
  approved: { label: 'Approved', icon: 'badge-check', hint: 'The PR is approved and can merge' },
  merged: { label: 'Merged', icon: 'git-merge', hint: 'The PR merged' },
  closed: { label: 'Closed', icon: 'circle-check-big', hint: 'Closed' },
  not_planned: { label: 'Not planned', icon: 'circle-slash', hint: 'Closed as not planned' },
};

/**
 * On a PR's own row, "In PR" says nothing; the review it waits on does. Only
 * the PR section is filtered by state, so its chips read the same.
 */
const PR_STATE = {
  ...STATE,
  in_review: { label: 'Awaiting review', icon: 'git-pull-request', hint: 'Open, no review decision yet' },
};

/** How a PR or branch was tied to a card, for its tooltip. */
const VIA = {
  linked: 'Linked to this issue',
  'branch-name': 'Its branch name carries this issue’s number',
  mentioned: 'Mentions this issue',
};

/** Longest branch name shown before it is cut; the tooltip has all of it. */
const MAX_BRANCH = 34;

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const MOVE_MS = 620;
/** How long a tick and its strike-through play before the row moves. */
const MARK_MS = 360;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const FILTER_KEY = 'daily-plate:filters';

/** The section whose rows the Repo and State filters narrow. */
const PR_SECTION = 'Pull requests';

/** The section that holds every row, open and cleared, under its own section's title. */
const ALL_SECTION = 'All';

/**
 * The filter rows, in the order they are drawn. Section is always on, one at a
 * time; Repo and State show only under Pull requests.
 */
const FILTER_DIMS = [
  { key: 'section', label: 'Section' },
  { key: 'repo', label: 'Repo', under: PR_SECTION },
  { key: 'state', label: 'State', under: PR_SECTION },
];

let data = null;
let busy = false;
/** One section, and at most one repo and state, as { section, repo, state }. Remembered per browser. */
let filters = readFilters();
/** Set when a section switch brings in its Repo and State rows, so they rise in once. */
let revealRows = false;
/** Set while a completion plays, so a poll cannot re-render under it. */
let animating = 0;
let first = true;
/** Each card's state at the last render, so a change can announce itself. */
const lastStates = new Map();
/** Rows whose notes are open, and what is typed in each one's note box. Both outlive a render. */
const openNotes = new Set();
const noteDrafts = new Map();

/** From shell.js, so both tabs say it the same way. */
const { ago } = window.DailyPlate;

function rank(status) {
  const i = COLUMN_ORDER.indexOf(status);
  return i === -1 ? COLUMN_ORDER.length : i;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, reduced ? 0 : ms));
}

function span(className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

// ── Motion ───────────────────────────────────────────────────────────────

/** Where every keyed element is now, and which list it is in. */
function snapshot() {
  const out = new Map();
  for (const node of document.querySelectorAll('[data-flip]')) {
    if (node.closest('[hidden]')) continue;
    out.set(node.dataset.flip, {
      rect: node.getBoundingClientRect(),
      list: node.parentElement?.id ?? '',
      node,
    });
  }
  return out;
}

/** Animate every keyed element from where `before` saw it to where it is. */
function play(before) {
  if (reduced) return;
  const seen = new Set();
  let entering = 0;

  for (const node of document.querySelectorAll('[data-flip]')) {
    if (node.closest('[hidden]')) continue;
    const key = node.dataset.flip;
    seen.add(key);
    const was = before.get(key);
    const now = node.getBoundingClientRect();

    if (!was) {
      // On the first render everything rises in turn; after that, a new
      // arrival fades in and holds a highlight long enough to be noticed.
      node.animate(
        [
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 520, easing: EASE, delay: first ? 160 + entering++ * 45 : 0, fill: 'backwards' },
      );
      if (!first && node.classList.contains('item')) node.classList.add('arrived');
      continue;
    }

    const dx = was.rect.left - now.left;
    const dy = was.rect.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    const changedList = was.list !== (node.parentElement?.id ?? '');
    if (changedList) {
      // The row that is travelling rides above the rows making room for it.
      node.classList.add('flying');
      node
        .animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1.015)`, offset: 0.5 },
            { transform: 'none' },
          ],
          { duration: MOVE_MS + 80, easing: EASE },
        )
        .finished.then(() => node.classList.remove('flying'), () => {});
    } else {
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: MOVE_MS,
        easing: EASE,
      });
    }
  }

  // Whatever left the page fades out where it stood, as a ghost.
  for (const [key, was] of before) {
    if (seen.has(key)) continue;
    const ghost = was.node.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${was.rect.left}px`,
      top: `${was.rect.top}px`,
      width: `${was.rect.width}px`,
      margin: '0',
      pointerEvents: 'none',
    });
    ghost.classList.add('ghost');
    document.body.append(ghost);
    ghost
      .animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(-16px)' }], {
        duration: 360,
        easing: EASE,
      })
      .finished.then(() => ghost.remove(), () => ghost.remove());
  }
}

/**
 * A count changes by rolling: the old figure floats out and the new one in,
 * upward when it grew and downward when it shrank.
 */
function setCount(node, value) {
  const text = String(value);
  if (node.dataset.value === text) return;
  const prev = node.dataset.value;
  node.dataset.value = text;

  const next = span('digit', text);
  const old = node.querySelector('.digit');
  if (reduced || prev === undefined || !old) {
    node.replaceChildren(next);
    if (!reduced) {
      const i = Number(node.dataset.i ?? 0);
      next.animate(
        [
          { opacity: 0, transform: 'translateY(60%)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 640, easing: EASE, delay: 80 + i * 70, fill: 'backwards' },
      );
    }
    return;
  }

  const up = Number(text) > Number(prev);
  old.classList.add('leaving');
  node.append(next);
  old
    .animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `translateY(${up ? -70 : 70}%)` },
      ],
      { duration: 420, easing: EASE, fill: 'forwards' },
    )
    .finished.then(() => old.remove(), () => old.remove());
  next.animate(
    [
      { opacity: 0, transform: `translateY(${up ? 70 : -70}%)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 520, easing: EASE, delay: 60, fill: 'backwards' },
  );
}

// ── Rendering ────────────────────────────────────────────────────────────

function readFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

/** What a row is, along each filter dimension. A card on two boards is in two sections. */
function facets(item) {
  const fromGitHub = GITHUB_SOURCES.has(item.source);
  return {
    repo: fromGitHub && item.context.includes('#') ? [item.context.split('#')[0]] : [],
    section: [ALL_SECTION, ...(SECTION_OF[item.source]?.(item) ?? ['Slack'])],
    state: item.state ? [item.state] : [],
  };
}

const SECTION_OF = {
  board: (item) => item.boards,
  pr: () => ['Pull requests'],
  issue: () => ['Issues'],
  task: () => [TASKS_SECTION],
};

/** The filter rows that apply to the section that is on. */
function liveDims() {
  return FILTER_DIMS.filter(({ under }) => !under || under === filters.section);
}

/** Whether a row passes every filter that is on, leaving out `skip`. */
function passes(item, skip) {
  const of = facets(item);
  return liveDims().every(({ key }) => key === skip || !filters[key] || of[key].includes(filters[key]));
}

/** Whether a filter narrows the section that is on. */
function filtering() {
  return liveDims().some(({ key }) => key !== 'section' && filters[key]);
}

/** The section to show: the one last picked, or the first with rows in it. All is only ever picked. */
function pickSection(open) {
  const order = FILTER_ORDER.section();
  if (order.includes(filters.section)) return filters.section;
  const present = new Set(open.flatMap((i) => facets(i).section));
  return order.find((name) => name !== ALL_SECTION && present.has(name)) ?? order[1];
}

function setFilter(key, value) {
  if (animating) return;
  if (key === 'section') {
    // One section is always on, and its narrowing starts over.
    if (filters.section === value) return;
    filters = { section: value };
    revealRows = FILTER_DIMS.some(({ under }) => under === value);
  } else {
    filters = { ...filters, [key]: filters[key] === value ? null : value };
  }
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch {
    // Private window or blocked storage: the filter lasts this visit only.
  }
  if (data) render();
}

/**
 * The chip rows. Each chip counts what it would leave on screen with the
 * other filters as they are, so a dead end shows before it is clicked.
 */
function renderFilters(open) {
  const rows = liveDims().map(({ key, label }) => {
    const values = new Map();
    for (const item of open) {
      for (const value of facets(item)[key]) values.set(value, 0);
    }
    for (const item of open) {
      // A section counts all its rows: picking one starts its narrowing over.
      if (key !== 'section' && !passes(item, key)) continue;
      for (const value of facets(item)[key]) values.set(value, values.get(value) + 1);
    }
    // A stale filter (its last row cleared) still shows, so it can be turned off.
    if (filters[key] && !values.has(filters[key])) values.set(filters[key], 0);
    if (!values.size) return null;

    const order = FILTER_ORDER[key]?.() ?? null;
    const sorted = [...values].sort(([a, n], [b, m]) =>
      order ? orderOf(order, a) - orderOf(order, b) : m - n || a.localeCompare(b),
    );

    const row = document.createElement('div');
    row.className = revealRows && key !== 'section' ? 'filter-row filter-row-enter' : 'filter-row';
    row.append(span('label filter-label', label));
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const [value, count] of sorted) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      const on = filters[key] === value;
      chip.setAttribute('aria-pressed', String(on));
      chip.disabled = !on && count === 0;
      chip.append(span('', key === 'state' ? (PR_STATE[value]?.label ?? value) : value), span('chip-count', String(count)));
      chip.addEventListener('click', () => setFilter(key, value));
      chips.append(chip);
    }
    row.append(chips);
    return row;
  }).filter(Boolean);

  if (filtering()) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'filter-clear';
    clear.textContent = 'Clear filters';
    clear.title = 'Clear filters (Esc)';
    clear.addEventListener('click', clearFilters);
    rows.push(clear);
  }
  $('filters').replaceChildren(...rows);
  revealRows = false;
}

function clearFilters() {
  if (animating) return;
  filters = { section: filters.section };
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch {
    // Private window or blocked storage: the section lasts this visit only.
  }
  if (data) render();
}

/** Sections in plate order, states in lifecycle order; repos by count. */
const FILTER_ORDER = {
  section: () => [ALL_SECTION, ...boardList([]).map((b) => b.title), PR_SECTION, 'Issues', TASKS_SECTION, 'Slack'],
  state: () => Object.keys(STATE),
};

function orderOf(order, value) {
  const i = order.indexOf(value);
  return i === -1 ? order.length : i;
}

/**
 * Lucide's github and slack marks, vendored from lucide-static 1.0.0 into
 * /icons — the last release that still carries brand icons. Drawn as a CSS
 * mask so they take the ink colour like any other text.
 */
function icon(name) {
  return span(`icon icon-${name}`, '');
}

const CHECK_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10.5l3 3 6-6.5" /></svg>';
const CROSS_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>';

/**
 * One row. `key` is its FLIP identity: a card on both boards is shown under
 * each, and the second copy needs a key of its own. `withSource` leads the
 * meta line with where it came from, for the lists that mix sources.
 */
function row(item, { key = `item-${item.id}`, withSource = false } = {}) {
  const li = document.createElement('li');
  li.className = item.doneAt ? 'item done' : 'item';
  li.dataset.flip = key;
  li.dataset.id = String(item.id);

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.innerHTML = CHECK_SVG;
  check.setAttribute('aria-pressed', String(Boolean(item.doneAt)));
  check.title = item.doneAt ? 'Put it back on the plate' : 'Clear it';
  check.setAttribute('aria-label', `${item.doneAt ? 'Put back' : 'Clear'}: ${item.title}`);
  check.addEventListener('click', () => toggle(item.id));

  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const fromGitHub = GITHUB_SOURCES.has(item.source);
  // A board card or PR says where it is from by its repo, number and colour.
  // A task's meta line already says Task.
  if (withSource && !['board', 'pr', 'task'].includes(item.source)) {
    const from = span('from', FROM[item.source]?.(item) ?? 'Slack');
    from.prepend(icon(fromGitHub ? 'github' : 'slack'));
    meta.append(from);
  }
  if (fromGitHub) {
    meta.append(span(`where where-${item.source}`, item.context));
    // The PR a card's state comes from is named in the pill, so the two read
    // as one: In PR #3216. A mention sets no state and keeps its own link.
    const work = item.work;
    const pr = work?.kind === 'pr' && work.via !== 'self' && work.via !== 'mentioned' ? work : null;
    if (item.state) meta.append(statePill(item, pr));
    if (work?.stack) meta.append(stackPill(work.stack, work.number));
    // The pill says where a card is; the column only adds to it while the
    // card has not started, as Backlog against Ready. Off the boards there
    // is no column to add.
    if (item.source === 'board' && (!item.state || item.state === 'open')) {
      meta.append(span('status', item.status || 'No status'));
    }
    if (work && work.via !== 'self' && !pr) meta.append(workLink(work));
    if (!withSource && item.boards.length > 1) meta.append(span('', 'Both boards'));
  } else {
    meta.append(span('status', SOURCE_LABEL[item.source]));
    if (item.source !== 'task') meta.append(span('where', item.context || 'Slack'));
    if (item.author) {
      const who = span('author', item.author);
      // A picture only once SLACK_BOT_TOKEN has looked them up.
      if (item.authorAvatar) {
        const img = document.createElement('img');
        img.className = 'author-avatar';
        img.src = item.authorAvatar;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => img.remove();
        who.prepend(img);
      }
      meta.append(who);
    }
    meta.append(span('', ago(item.addedAt)));
  }

  const title = item.url ? document.createElement('a') : linked('title', item.title);
  if (item.url) {
    title.className = 'title';
    title.append(...withMentions(item.title, item.mentions));
    title.href = item.url;
    title.target = '_blank';
    title.rel = 'noopener';
  }

  body.append(meta, title);
  if (item.work?.kind === 'pr' && item.work.comments?.length) body.append(commentChip(item.work.comments));
  // A task or Slack message can also go for good. Anything synced would only come back.
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(notesToggle(item));
  if (DELETABLE.has(item.source)) {
    const cross = document.createElement('button');
    cross.className = 'cross';
    cross.type = 'button';
    cross.innerHTML = CROSS_SVG;
    cross.title = 'Delete it';
    cross.setAttribute('aria-label', `Delete: ${item.title}`);
    cross.addEventListener('click', () => removeItems([item.id]));
    actions.append(cross);
  }
  li.append(check, body, actions);
  if (openNotes.has(item.id)) li.append(notesPanel(item));
  return li;
}

/** A Slack title, its @-mentions set in italics so they read as mentions. */
function withMentions(text, mentions) {
  if (!mentions?.length) return [text];
  const escaped = mentions.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.split(new RegExp(`(${escaped.join('|')})`)).map((part) =>
    mentions.includes(part) ? span('mention', part) : part,
  );
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>';

/** Opens a row's notes. The bubble counts them, and is gone while there are none. */
function notesToggle(item) {
  const n = item.notes?.length ?? 0;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'notes-toggle';
  button.setAttribute('aria-expanded', String(openNotes.has(item.id)));
  button.setAttribute(
    'aria-label',
    `${n ? `${n} ${n === 1 ? 'note' : 'notes'}` : 'Add a note'}: ${item.title}`,
  );
  button.title = openNotes.has(item.id) ? 'Hide notes' : n ? 'Show notes' : 'Add a note';
  if (n) button.append(span('note-count', String(n)));
  button.insertAdjacentHTML('beforeend', CHEVRON_SVG);
  button.addEventListener('click', () => {
    if (!openNotes.delete(item.id)) openNotes.add(item.id);
    render();
    if (openNotes.has(item.id)) document.querySelector(`.note-input[data-id="${item.id}"]`)?.focus();
  });
  return button;
}

/** A row's notes, oldest first, and a box to add one. Enter adds; Shift+Enter breaks the line. */
function notesPanel(item) {
  const panel = document.createElement('div');
  panel.className = 'notes';

  const list = document.createElement('ul');
  list.className = 'note-list';
  for (const note of item.notes ?? []) {
    const li = document.createElement('li');
    li.className = 'note-row';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'note-remove';
    remove.textContent = '×';
    remove.title = 'Delete this note';
    remove.setAttribute('aria-label', 'Delete this note');
    remove.addEventListener('click', () => removeNote(item, note.id));
    li.append(linked('note-text', note.text), span('label note-at', ago(note.at)), remove);
    list.append(li);
  }

  const input = document.createElement('textarea');
  input.className = 'note-input';
  input.dataset.id = String(item.id);
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = item.notes?.length ? 'Add another note' : 'Add a note';
  input.value = noteDrafts.get(item.id) ?? '';
  input.addEventListener('input', () => {
    noteDrafts.set(item.id, input.value);
    fit(input);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addNote(item, input.value);
    }
    if (e.key === 'Escape') input.blur();
  });
  requestAnimationFrame(() => fit(input));

  panel.append(list, input);
  return panel;
}

/** A URL in a note, less the punctuation that ends its sentence. */
const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'}]/g;
/** Link previews by URL: a card once read, a promise while reading. Outlives a render. */
const unfurls = new Map();

/** Text, a note or a task, with its links live. */
function linked(className, text) {
  const node = span(className, '');
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    node.append(text.slice(at, m.index), noteLink(m[0]));
    at = m.index + m[0].length;
  }
  node.append(text.slice(at));
  return node;
}

/** A link that reads as its host and path, then as its page's icon and title once the server has read them. */
function noteLink(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = url;
  a.textContent = shortUrl(url);
  const fill = (u) => {
    if (!u?.title) return;
    a.className = 'unfurl';
    a.replaceChildren(span('unfurl-title', u.title));
    if (u.icon) {
      const img = document.createElement('img');
      img.src = u.icon;
      img.alt = '';
      img.onerror = () => img.remove();
      a.prepend(img);
    }
  };
  const known = unfurls.get(url);
  if (known && !(known instanceof Promise)) fill(known);
  else {
    if (!known) {
      unfurls.set(
        url,
        request(`/api/unfurl?url=${encodeURIComponent(url)}`)
          .catch(() => ({ url }))
          .then((u) => (unfurls.set(url, u), u)),
      );
    }
    unfurls.get(url).then(fill);
  }
  return a;
}

/** A URL as its host and path, with no query, cut to a readable length. */
function shortUrl(href) {
  const u = new URL(href);
  const text = (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, '');
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** A note box grows with what is typed in it. */
function fit(input) {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

/** The state pill. With `pr`, it names that PR and links to it. */
function statePill(item, pr = null) {
  const states = item.source === 'pr' ? PR_STATE : STATE;
  const meta = states[item.state] ?? STATE.open;
  const pill = document.createElement(pr ? 'a' : 'span');
  pill.className = `state state-${item.state}`;
  pill.append(icon(meta.icon), span('', pr ? `${meta.label} #${pr.number}` : meta.label));
  pill.title = meta.hint;
  if (pr) {
    pill.href = pr.url;
    pill.target = '_blank';
    pill.rel = 'noopener';
    pill.title = `${meta.hint}\n${pr.title} (${pr.repo}#${pr.number})\n${VIA[pr.via] ?? ''}`;
  }

  // A state that moved since the last render says so, once.
  const was = lastStates.get(item.id);
  if (was !== undefined && was !== item.state) pill.classList.add('changed');
  lastStates.set(item.id, item.state);
  return pill;
}

/**
 * Where a PR sits in a stack of PRs: 2 of 5 is on top of one, under three.
 * On hover, the whole stack from the bottom, this PR marked.
 */
function stackPill({ position, total, prs }, current) {
  const pill = span('state stack', '');
  pill.tabIndex = 0;
  pill.setAttribute('aria-label', `Stacked PR, ${position} of ${total}`);
  const tip = span('tip', '');
  tip.setAttribute('role', 'tooltip');
  for (const pr of prs ?? []) {
    const line = document.createElement('a');
    line.className = pr.number === current ? 'tip-line current' : 'tip-line';
    line.href = pr.url;
    line.target = '_blank';
    line.rel = 'noopener';
    line.append(span('tip-count', `#${pr.number}`), span('tip-login', pr.title));
    tip.append(line);
  }
  pill.append(icon('layers'), span('', `${position} of ${total}`));
  if (prs?.length) pill.append(tip);
  return pill;
}

/** A GitHub user's avatar, from the address GitHub serves it at for any login. */
function avatar(login, className) {
  const img = document.createElement('img');
  img.className = className;
  img.src = `https://github.com/${encodeURIComponent(login)}.png?size=40`;
  img.alt = '';
  img.loading = 'lazy';
  return img;
}

/** How many comments a PR has, and on hover, who left them. */
function commentChip(comments) {
  const total = comments.reduce((sum, c) => sum + c.count, 0);
  const chip = span('comments', '');
  chip.tabIndex = 0;
  chip.setAttribute('aria-label', `${total} ${total === 1 ? 'comment' : 'comments'}`);
  // Drawn by the page, not `title`: the browser's tooltip waits, and some never show it.
  const tip = span('tip', '');
  tip.setAttribute('role', 'tooltip');
  for (const c of comments) {
    const line = document.createElement('a');
    line.className = 'tip-line';
    line.href = `https://github.com/${encodeURIComponent(c.login)}`;
    line.target = '_blank';
    line.rel = 'noopener';
    line.append(avatar(c.login, 'tip-avatar'), span('tip-login', c.login), span('tip-count', String(c.count)));
    tip.append(line);
  }
  chip.append(icon('message-square'), span('', String(total)), tip);
  return chip;
}

/** The PR or branch tackling a card, as a link. */
function workLink(work) {
  const link = document.createElement('a');
  link.className = `work work-${work.via}`;
  link.href = work.url;
  link.target = '_blank';
  link.rel = 'noopener';

  const isPr = work.kind === 'pr';
  const name = isPr
    ? `${work.via === 'mentioned' ? 'Mentioned in ' : ''}PR #${work.number}`
    : work.branch.length > MAX_BRANCH
      ? `${work.branch.slice(0, MAX_BRANCH - 1)}…`
      : work.branch;
  link.append(icon(isPr ? 'git-pull-request' : 'git-branch'), span('', name));

  const detail = isPr ? `${work.title} (${work.repo}#${work.number})` : `${work.repo} · ${work.branch}`;
  link.title = `${detail}\n${VIA[work.via] ?? ''}`;
  return link;
}

/** Each header's last count, so a rebuilt header can still roll from it. */
const lastCounts = new Map();

/** A count that rolls from whatever this key showed last time. */
function countNode(key, value) {
  const node = span('group-count', '');
  const prev = lastCounts.get(key);
  if (prev !== undefined) {
    node.dataset.value = String(prev);
    node.append(span('digit', String(prev)));
  }
  lastCounts.set(key, value);
  setCount(node, value);
  return node;
}

/**
 * A section: a header naming the source, its rows, and a line for when it has
 * none. The header is where a source says what it is and how it is doing —
 * the board and its link, or whether Slack is connected.
 */
/**
 * The shared empty state (theme.css): a muted title, and a caption under it.
 * `caption` may hold markup, such as a <span class="kbd">.
 */
function emptyState(flipKey, { title, caption }) {
  const box = document.createElement('div');
  box.className = 'empty-state';
  box.dataset.flip = flipKey;
  const heading = document.createElement('p');
  heading.className = 'empty-title';
  heading.textContent = title;
  box.append(heading);
  if (caption) {
    const note = document.createElement('p');
    note.className = 'empty-caption';
    note.innerHTML = caption;
    box.append(note);
  }
  return box;
}

/** Clear all. The first press asks again, so one stray click deletes nothing. */
function clearAll(items) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'clear-all';
  button.textContent = 'Clear all';
  button.title = 'Delete every row here for good. Ticked rows stay in Cleared today.';
  let armed = null;
  button.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      removeItems(items.map((i) => i.id));
      return;
    }
    button.textContent = `Delete ${items.length}?`;
    button.classList.add('armed');
    armed = setTimeout(() => {
      armed = null;
      button.textContent = 'Clear all';
      button.classList.remove('armed');
    }, 3000);
  });
  return button;
}

function section({ key, iconName, name, href, sub, warn: isWarn, count, items, empty, rowOpts, clearable }) {
  const group = document.createElement('section');
  group.className = 'group';

  const head = document.createElement('header');
  head.className = isWarn ? 'group-head warn' : 'group-head';
  head.dataset.flip = `h-${key}`;
  if (iconName) head.append(icon(iconName));

  const titles = span('group-titles', '');
  const nameNode = document.createElement(href ? 'a' : 'h2');
  nameNode.className = 'group-name';
  nameNode.textContent = name;
  if (href) {
    nameNode.href = href;
    nameNode.target = '_blank';
    nameNode.rel = 'noopener';
    nameNode.append(span('go', '↗'));
  }
  titles.append(nameNode);
  if (sub) titles.append(sub);
  head.append(titles);

  if (count !== undefined) {
    const stat = span('group-stat', '');
    if (clearable && items.length) stat.append(clearAll(items));
    stat.append(countNode(key, count), span('label', 'open'));
    head.append(stat);
  }

  const list = document.createElement('ul');
  list.className = 'items';
  list.id = `list-${key}`;
  list.append(...items.map((item) => row(item, rowOpts?.(item))));

  group.append(head, list);
  if (!items.length && empty) {
    // Under a filter, an empty list says so rather than claiming a clear plate.
    group.append(emptyState(`e-${key}`, filtering() ? { title: 'Nothing here matches the filters.' } : empty));
  }
  return group;
}

/** Board columns first by urgency; Slack asks newest first. */
function byColumn(a, b) {
  return rank(a.status) - rank(b.status);
}

function byNewest(a, b) {
  return b.addedAt.localeCompare(a.addedAt);
}

function byState(a, b) {
  const at = (i) => (STATE_ORDER.includes(i.state) ? STATE_ORDER.indexOf(i.state) : STATE_ORDER.length);
  return at(a) - at(b) || byNewest(a, b);
}

/** Where a GitHub row is from, for the lists that mix sources. */
const FROM = {
  issue: () => 'Issue',
};

/** The same search on GitHub, for a section header to link to. */
function searchUrl(kind) {
  const login = data.assignee?.login;
  if (!login || !data.state.orgs.length) return '';
  const who = kind === 'pr' ? `author:${login}` : `assignee:${login}`;
  const q = `is:open is:${kind} ${who} ${data.state.orgs.map((o) => `org:${o}`).join(' ')} archived:false`;
  return `https://github.com/${kind === 'pr' ? 'pulls' : 'issues'}?q=${encodeURIComponent(q)}`;
}

/**
 * The boards to section by: as last read, or — before a read has named them —
 * whatever the cards themselves say they are on.
 */
function boardList(cards) {
  if (data.sync?.boards?.length) return data.sync.boards;
  const titles = [...new Set(cards.flatMap((c) => c.boards))];
  if (titles.length) return titles.map((title) => ({ title, url: '', owner: '', number: '' }));
  return data.state.projects.map((ref) => {
    const [owner, number] = ref.split('/');
    return { title: `${owner} / #${number}`, url: '', owner, number };
  });
}

function sub(text, { live = false } = {}) {
  const node = span('group-sub', text);
  if (live) node.prepend(span('live', ''));
  return node;
}

function splitSections({ board, pulls, issues, tasks, slack }) {
  const sync = data.sync;
  const failed = Boolean(sync && !sync.ok);
  const drawn = new Set();
  const shown = (name) => filters.section === name;
  const sections = boardList(board).filter((b) => shown(b.title)).map((b) => {
    const key = `board-${b.owner}-${b.number}-${b.title}`;
    const items = board.filter((c) => c.boards.includes(b.title));
    let line = b.owner ? `${b.owner} · #${b.number}` : 'GitHub Projects';
    if (!data.state.github) line = 'GitHub is not configured';
    else if (!sync) line = 'Reading…';
    else if (failed) line = 'Could not read';
    return section({
      key,
      iconName: 'github',
      name: b.title,
      href: b.url,
      sub: sub(line),
      warn: failed,
      count: items.length,
      items,
      empty: { title: 'Nothing of yours is open on this board.' },
      // A card on two boards appears under both; the first copy drawn keeps
      // the plain key, so it is the one that travels when the section changes.
      rowOpts: (item) => {
        if (!drawn.has(item.id)) {
          drawn.add(item.id);
          return undefined;
        }
        return { key: `item-${item.id}@${b.title}` };
      },
    });
  });

  // Your PRs and issues across the orgs, headed like a board.
  const orgs = data.state.orgs.join(' · ');
  const repoLine = (text) => {
    if (!data.state.github) return 'GitHub is not configured';
    if (!sync) return 'Reading…';
    if (failed) return 'Could not read';
    return text;
  };
  if (shown(PR_SECTION)) {
    sections.push(
      section({
        key: 'pr',
        iconName: 'github',
        name: 'Pull requests',
        href: searchUrl('pr'),
        sub: sub(repoLine(`${orgs} · opened by you`)),
        warn: failed,
        count: pulls.length,
        items: pulls,
        empty: { title: 'No open PRs of yours.' },
      }),
    );
  }
  if (shown('Issues')) {
    sections.push(
      section({
        key: 'issue',
        iconName: 'github',
        name: 'Issues',
        href: searchUrl('issue'),
        sub: sub(repoLine(`${orgs} · assigned to you, not on a board`)),
        warn: failed,
        count: issues.length,
        items: issues,
        empty: { title: 'Every issue of yours is on a board.' },
      }),
    );
  }

  if (shown(TASKS_SECTION)) {
    sections.push(
      section({
        key: 'task',
        name: TASKS_SECTION,
        sub: sub('Added by you'),
        count: tasks.length,
        items: tasks,
        clearable: true,
        empty: { title: 'No tasks of your own.', caption: 'Type one in the box above, or press N.' },
      }),
    );
  }

  if (!shown('Slack')) return sections;
  const live = data.state.slackConnected;
  sections.push(
    section({
      key: 'slack',
      iconName: 'slack',
      name: 'Slack',
      sub: sub(
        !live
          ? 'Slack is not connected'
          : data.state.slackMentions
            ? 'Live · reactions and mentions'
            : 'Live · reactions',
        { live },
      ),
      count: slack.length,
      items: slack,
      clearable: true,
      empty: {
        title: 'Nothing from Slack.',
        caption: 'React <span class="kbd">:knife_fork_plate:</span> to a message, or mention @Daily Plate, to put it here.',
      },
    }),
  );
  return sections;
}

/**
 * All activity: every row there is, open and cleared, under the title of the
 * section it belongs to. Open rows lead in each, then cleared, newest first.
 * A section with nothing in it ever is left out.
 */
function activitySections(open) {
  const cleared = [...data.items.filter((i) => i.doneAt), ...(data.history ?? [])].sort((a, b) =>
    b.doneAt.localeCompare(a.doneAt),
  );
  const of = (source) => cleared.filter((i) => (source === 'slack' ? SLACK_SOURCES.has(i.source) : i.source === source));
  const drawn = new Set();
  // A card on two boards appears under both; the second copy needs a key of its own.
  const rowOpts = (name) => (item) => {
    if (!drawn.has(item.id)) {
      drawn.add(item.id);
      return undefined;
    }
    return { key: `item-${item.id}@${name}` };
  };
  const part = ({ key, name, href, iconName, openItems, doneItems }) =>
    section({
      key: `all-${key}`,
      iconName,
      name,
      href,
      sub: sub(`${doneItems.length} cleared`),
      count: openItems.length,
      items: [...openItems, ...doneItems],
      rowOpts: rowOpts(name),
    });

  const boards = boardList(open.board).map((b) =>
    part({
      key: `board-${b.owner}-${b.number}-${b.title}`,
      name: b.title,
      href: b.url,
      iconName: 'github',
      openItems: open.board.filter((c) => c.boards.includes(b.title)),
      doneItems: of('board').filter((c) => c.boards.includes(b.title)),
    }),
  );
  const parts = [
    ...boards,
    part({ key: 'pr', name: 'Pull requests', href: searchUrl('pr'), iconName: 'github', openItems: open.pulls, doneItems: of('pr') }),
    part({ key: 'issue', name: 'Issues', href: searchUrl('issue'), iconName: 'github', openItems: open.issues, doneItems: of('issue') }),
    part({ key: 'task', name: TASKS_SECTION, openItems: open.tasks, doneItems: of('task') }),
    part({ key: 'slack', name: 'Slack', iconName: 'slack', openItems: open.slack, doneItems: of('slack') }),
  ].filter((group) => group.querySelector('.item'));

  const head = section({
    key: 'all-activity',
    name: 'All activity',
    sub: sub('Everything open and everything cleared, by section'),
    items: [],
  });
  return [head, ...parts];
}

function render() {
  const before = snapshot();
  // A note box being typed in is rebuilt with its row; it keeps the focus.
  const typing = document.activeElement?.classList.contains('note-input') ? document.activeElement.dataset.id : null;

  const open = data.items.filter((i) => !i.doneAt);
  // The counts up top stay whole; the filters only narrow the lists.
  filters.section = pickSection(open);
  const all = {
    board: open.filter((i) => i.source === 'board'),
    pulls: open.filter((i) => i.source === 'pr'),
    issues: open.filter((i) => i.source === 'issue'),
    tasks: open.filter((i) => i.source === 'task'),
    slack: open.filter((i) => SLACK_SOURCES.has(i.source)),
  };
  const shown = (list) => list.filter((i) => passes(i));
  const board = shown(all.board).sort(byColumn);
  const pulls = shown(all.pulls).sort(byState);
  const issues = shown(all.issues).sort(byState);
  const tasks = shown(all.tasks).sort(byNewest);
  const slack = shown(all.slack).sort(byNewest);
  const lists = { board, pulls, issues, tasks, slack };
  // Most recently cleared first, so a row you just ticked lands on top.
  const allDone = data.items.filter((i) => i.doneAt);
  const done = shown(allDone).sort((a, b) => b.doneAt.localeCompare(a.doneAt));

  $('date').textContent = new Date(`${data.today}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  // Pull requests are listed but not counted: the plate is issues, tasks and Slack.
  setCount($('n-open'), all.board.length + all.issues.length + all.tasks.length + all.slack.length);
  document.title = `(all.board.length + all.issues.length + all.tasks.length + all.slack.length) Plate — Daily Plate`;
  setCount($('n-github'), all.board.length + all.issues.length);
  setCount($('n-slack'), all.slack.length);
  setCount($('n-done'), allDone.length);
  renderFilters(open);

  if (filters.section === ALL_SECTION) {
    $('lists').replaceChildren(...activitySections(lists));
    refocus(typing);
    renderChrome();
    play(before);
    if (first) document.body.classList.add('ready');
    first = false;
    return;
  }

  const sections = splitSections(lists);
  if (done.length) {
    sections.push(
      section({
        key: 'done',
        name: 'Cleared today',
        items: done,
        // Cleared rows mix sources, so each says where it is from.
        rowOpts: () => ({ withSource: true }),
      }),
    );
  }
  $('lists').replaceChildren(...sections);
  refocus(typing);

  renderChrome();
  play(before);

  if (first) document.body.classList.add('ready');
  first = false;
}

function refocus(id) {
  const input = id && document.querySelector(`.note-input[data-id="${id}"]`);
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/** The read time, whose plate it is, and a failed read's reason. */
function renderChrome() {
  const me = data.assignee;
  $('assignee').hidden = !me;
  if (me) $('assignee').replaceChildren(avatar(me.login, 'assignee-avatar'), span('', `Assigned to ${me.name}`));

  const sync = data.sync;
  $('read-at').textContent = sync ? `Read ${ago(sync.at)}` : '';

  const note = $('provenance');
  note.hidden = !(sync && !sync.ok);
  if (sync && !sync.ok) note.textContent = `Could not read GitHub: ${sync.error}`;
}

function warn(message) {
  const note = $('provenance');
  note.hidden = false;
  note.textContent = message;
}

// ── Actions ──────────────────────────────────────────────────────────────

/**
 * Every call to the API. A proxy's error page or an empty body is not JSON,
 * so the status is the message when there is no `error` to give.
 */
async function request(path, init) {
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error(navigator.onLine ? 'the agent did not answer' : 'you are offline');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`.trim());
  return body;
}

/**
 * Bumped by every change made on this page. A read that started before one
 * is older than what is on screen, so its result is dropped, not rendered.
 */
let edits = 0;

async function load() {
  if (animating || busy) return;
  const at = edits;
  try {
    const fresh = await request('/api/plate');
    if (at !== edits || animating) return;
    data = fresh;
    render();
  } catch (err) {
    if (first) return loadFailed(err);
    warn(`Could not load the plate: ${err.message}`);
  }
}

/** The first read failed, so there is no plate to show: say so, and offer it again. */
function loadFailed(err) {
  document.body.classList.add('ready', 'failed');
  window.Mova?.release($('plate-skeleton'));
  const why = err.message || 'unknown error';
  $('load-error-reason').textContent = `${why[0].toUpperCase()}${why.slice(1)}${/[.!?]$/.test(why) ? '' : '.'}`;
  $('load-error').hidden = false;
}

$('load-retry').addEventListener('click', () => {
  $('load-error').hidden = true;
  document.body.classList.remove('ready', 'failed');
  window.Mova?.skeleton($('plate-skeleton'), 'plate');
  load();
});

/**
 * Mova draws the button's working, done and failed states when its bundle has
 * loaded (agent/ui/mova). Without it, the label alone says what is happening.
 */
function syncState(state) {
  const button = $('sync');
  if (window.Mova) window.Mova.button(button, { state, label: 'Refresh', pending: 'Reading', done: 'Read' });
  else button.textContent = state === 'loading' ? 'Reading…' : 'Refresh';
}

async function sync() {
  if (busy) return;
  busy = true;
  $('sync').disabled = true;
  syncState('loading');
  window.Mova?.progress($('progress'), true);
  let outcome = 'success';
  try {
    data = await request('/api/sync', { method: 'POST' });
    render();
  } catch (err) {
    warn(`Could not refresh: ${err.message}`);
    outcome = 'error';
  } finally {
    busy = false;
    $('sync').disabled = false;
    syncState(outcome);
    window.Mova?.progress($('progress'), false);
  }
}

/**
 * Clear an item, or put it back. The mark plays in place first — the box
 * fills, the tick draws, a line runs through the title — and only then does
 * the row travel to its new list. The request runs alongside, and a failure
 * sends the row back where it came from.
 */
async function toggle(id) {
  let item = data.items.find((i) => i.id === id);
  // A row cleared before today lives in the history; acting on it brings it
  // onto today's plate, cleared or not.
  if (!item) {
    const at = data.history?.findIndex((i) => i.id === id) ?? -1;
    if (at === -1) return;
    [item] = data.history.splice(at, 1);
    data.items.push(item);
  }
  const done = !item.doneAt;
  const previous = item.doneAt;
  edits++;

  animating++;
  // A card on both boards is on screen twice; both copies mark together.
  for (const li of document.querySelectorAll(`.item[data-id="${id}"]`)) {
    li.classList.toggle('done', done);
    if (done) li.classList.add('popping');
  }

  const saved = request(`/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ done }),
  });

  await wait(MARK_MS);
  item.doneAt = done ? new Date().toISOString() : null;
  render();

  try {
    const fresh = await saved;
    Object.assign(item, fresh);
  } catch (err) {
    item.doneAt = previous;
    render();
    warn(`Could not update that item: ${err.message}`);
  } finally {
    await wait(MOVE_MS);
    animating--;
  }
}

/** Put a task of your own on the plate, and show the section it lands in. */
async function addTask(e) {
  e.preventDefault();
  const input = $('add-title');
  const title = input.value.trim();
  if (!title) return;
  input.disabled = true;
  edits++;
  addState('loading');
  let outcome = 'success';
  try {
    const item = await request('/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!data.items.some((i) => i.id === item.id)) data.items.push(item);
    input.value = '';
    if (filters.section !== ALL_SECTION && filters.section !== TASKS_SECTION) setFilter('section', TASKS_SECTION);
    else render();
  } catch (err) {
    warn(`Could not add that task: ${err.message}`);
    outcome = 'error';
  } finally {
    input.disabled = false;
    addState(outcome);
    input.focus();
  }
}

/** The Add button's states, from Mova when its bundle has loaded. */
function addState(state) {
  window.Mova?.button($('add-submit'), { state, label: 'Add', pending: 'Adding', done: 'Added' });
}

/** The item as the server now has it, wherever it is kept on the page. */
function replaceItem(fresh) {
  edits++;
  for (const list of [data.items, data.history ?? []]) {
    const at = list.findIndex((i) => i.id === fresh.id);
    if (at !== -1) list[at] = fresh;
  }
  render();
}

/** Delete tasks and Slack messages for good. A failure puts them back where they were. */
async function removeItems(ids) {
  const gone = new Set(ids);
  const before = [data.items, data.history ?? []].map((list) => [...list]);
  data.items = data.items.filter((i) => !gone.has(i.id));
  if (data.history) data.history = data.history.filter((i) => !gone.has(i.id));
  edits++;
  render();
  try {
    if (ids.length === 1) await request(`/api/items/${ids[0]}`, { method: 'DELETE' });
    else {
      await request('/api/items/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    }
  } catch (err) {
    [data.items] = before;
    if (data.history) data.history = before[1];
    render();
    warn(`Could not delete ${ids.length === 1 ? 'that' : 'those'}: ${err.message}`);
  }
}

async function addNote(item, value) {
  const text = value.trim();
  if (!text) return;
  try {
    const fresh = await request(`/api/items/${item.id}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    noteDrafts.delete(item.id);
    replaceItem(fresh);
  } catch (err) {
    warn(`Could not add that note: ${err.message}`);
  }
}

async function removeNote(item, noteId) {
  try {
    replaceItem(await request(`/api/items/${item.id}/notes/${noteId}`, { method: 'DELETE' }));
  } catch (err) {
    warn(`Could not delete that note: ${err.message}`);
  }
}

$('add').addEventListener('submit', addTask);
$('sync').addEventListener('click', sync);
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  // Typing a task or a note is not a shortcut.
  if (e.target.closest('input, textarea')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const key = e.key.toLowerCase();
  if (key === 'n') {
    e.preventDefault();
    $('add-title').focus();
  }
  // Not while a button or link has the focus, where R is easy to hit by accident.
  if (key === 'r' && !e.target.closest('button, a')) sync();
  // Escape closes an open menu first; only then does it clear the filters.
  if (key === 'escape' && !document.querySelector('.account-menu:not([hidden])')) clearFilters();
});

// Mova's loading shape until the first plate arrives. A module, so it loads
// after this script; the first frame without it is blank, as it always was.
addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('ready')) window.Mova?.skeleton($('plate-skeleton'), 'plate');
});

load();
// Slack items arrive on their own; pick them up without a reload. Not while a
// note is being typed, which a render would interrupt, nor in a hidden tab,
// which reads again as soon as it is shown.
setInterval(() => {
  if (document.hidden || document.activeElement?.classList.contains('note-input')) return;
  load();
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !first) load();
});
