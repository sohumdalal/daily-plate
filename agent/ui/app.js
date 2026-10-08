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

const SOURCE_LABEL = { mention: 'Mention', reaction: 'Reacted' };

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const MOVE_MS = 620;
/** How long a tick and its strike-through play before the row moves. */
const MARK_MS = 360;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const VIEW_KEY = 'daily-plate:view';

let data = null;
let busy = false;
/** 'split' (a section per source) or 'all' (one list). Remembered per browser. */
let view = readView();
/** Set while a completion plays, so a poll cannot re-render under it. */
let animating = 0;
let first = true;

function rank(status) {
  const i = COLUMN_ORDER.indexOf(status);
  return i === -1 ? COLUMN_ORDER.length : i;
}

function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
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

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'all' ? 'all' : 'split';
  } catch {
    return 'split';
  }
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

/**
 * One row. `key` is its FLIP identity: a card on both boards is shown under
 * each, and the second copy needs a key of its own. `withSource` leads the
 * meta line with where it came from, for the view that mixes sources.
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
  check.addEventListener('click', () => toggle(item.id));

  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'meta';
  if (withSource) {
    const from = span('from', item.source === 'board' ? item.boards.join(' + ') : 'Slack');
    from.prepend(icon(item.source === 'board' ? 'github' : 'slack'));
    meta.append(from);
  }
  if (item.source === 'board') {
    meta.append(span('status', item.status || 'No status'), span('where', item.context));
    if (!withSource && item.boards.length > 1) meta.append(span('', 'Both boards'));
  } else {
    meta.append(span('status', SOURCE_LABEL[item.source]), span('where', item.context || 'Slack'));
    if (item.author) meta.append(span('', item.author));
    meta.append(span('', ago(item.addedAt)));
  }

  const title = document.createElement(item.url ? 'a' : 'span');
  title.className = 'title';
  title.textContent = item.title;
  if (item.url) {
    title.href = item.url;
    title.target = '_blank';
    title.rel = 'noopener';
  }

  body.append(meta, title);
  li.append(check, body);
  return li;
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
function section({ key, iconName, name, href, sub, warn: isWarn, count, items, empty, rowOpts }) {
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
    stat.append(countNode(key, count), span('label', 'open'));
    head.append(stat);
  }

  const list = document.createElement('ul');
  list.className = 'items';
  list.id = `list-${key}`;
  list.append(...items.map((item) => row(item, rowOpts?.(item))));

  group.append(head, list);
  if (!items.length && empty) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.dataset.flip = `e-${key}`;
    p.innerHTML = empty;
    group.append(p);
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

function splitSections(board, slack) {
  const sync = data.sync;
  const failed = Boolean(sync && !sync.ok);
  const drawn = new Set();
  const sections = boardList(board).map((b) => {
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
      empty: 'Nothing of yours is open on this board.',
      // A card on two boards appears under both; the first copy drawn keeps
      // the plain key, so it is the one that travels when the view changes.
      rowOpts: (item) => {
        if (!drawn.has(item.id)) {
          drawn.add(item.id);
          return undefined;
        }
        return { key: `item-${item.id}@${b.title}` };
      },
    });
  });

  const live = data.state.slackConnected;
  sections.push(
    section({
      key: 'slack',
      iconName: 'slack',
      name: 'Slack',
      sub: sub(
        !live
          ? 'Not connected · connects when deployed with messaging'
          : data.state.slackMentions
            ? 'Live · reactions and mentions'
            : 'Live · reactions · set SLACK_USER_ID for mentions',
        { live },
      ),
      count: slack.length,
      items: slack,
      empty: 'Nothing from Slack. React <span class="kbd">:knife_fork_plate:</span> to a message to put it here.',
    }),
  );
  return sections;
}

function allSection(board, slack) {
  // What is moving first, then fresh asks, then the queue.
  const active = board.filter((c) => rank(c.status) <= 1);
  const queued = board.filter((c) => rank(c.status) > 1);
  const items = [...active, ...slack, ...queued];
  return section({
    key: 'all',
    name: 'Everything',
    sub: sub('Boards and Slack, most urgent first'),
    count: items.length,
    items,
    empty: 'Your plate is clear.',
    rowOpts: () => ({ withSource: true }),
  });
}

function render() {
  const before = snapshot();

  const open = data.items.filter((i) => !i.doneAt);
  const board = open.filter((i) => i.source === 'board').sort(byColumn);
  const slack = open.filter((i) => i.source !== 'board').sort(byNewest);
  // Most recently cleared first, so a row you just ticked lands on top.
  const done = data.items
    .filter((i) => i.doneAt)
    .sort((a, b) => b.doneAt.localeCompare(a.doneAt));

  $('date').textContent = new Date(`${data.today}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  setCount($('n-open'), open.length);
  setCount($('n-board'), board.length);
  setCount($('n-slack'), slack.length);
  setCount($('n-done'), done.length);

  const sections = view === 'all' ? [allSection(board, slack)] : splitSections(board, slack);
  if (done.length) {
    sections.push(
      section({
        key: 'done',
        name: 'Cleared today',
        items: done,
        // Cleared rows mix sources in either view, so each says where it is from.
        rowOpts: () => ({ withSource: true }),
      }),
    );
  }
  $('lists').replaceChildren(...sections);

  renderChrome();
  play(before);

  if (first) document.body.classList.add('ready');
  first = false;
}

/** The toggle, the read time, and a failed read's reason. */
function renderChrome() {
  $('views').dataset.view = view;
  for (const button of $('views').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }

  const sync = data.sync;
  $('read-at').textContent = sync ? `Read ${ago(sync.at)}` : '';

  const note = $('provenance');
  note.hidden = !(sync && !sync.ok);
  if (sync && !sync.ok) note.textContent = `Could not read the boards: ${sync.error}`;
}

function warn(message) {
  const note = $('provenance');
  note.hidden = false;
  note.textContent = message;
}

function setView(next) {
  if (next === view || animating) return;
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private window or blocked storage: the choice lasts this visit only.
  }
  if (data) render();
}

// ── Actions ──────────────────────────────────────────────────────────────

async function request(path, init) {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function load() {
  if (animating) return;
  try {
    data = await request('/api/plate');
    render();
  } catch (err) {
    warn(`Could not load the plate: ${err.message}`);
  }
}

async function sync() {
  if (busy) return;
  busy = true;
  $('sync').disabled = true;
  $('sync').textContent = 'Reading…';
  $('progress').classList.add('on');
  try {
    data = await request('/api/sync', { method: 'POST' });
    render();
  } catch (err) {
    warn(`Could not refresh: ${err.message}`);
  } finally {
    busy = false;
    $('sync').disabled = false;
    $('sync').textContent = 'Refresh';
    $('progress').classList.remove('on');
  }
}

/**
 * Clear an item, or put it back. The mark plays in place first — the box
 * fills, the tick draws, a line runs through the title — and only then does
 * the row travel to its new list. The request runs alongside, and a failure
 * sends the row back where it came from.
 */
async function toggle(id) {
  const item = data.items.find((i) => i.id === id);
  if (!item) return;
  const done = !item.doneAt;
  const previous = item.doneAt;

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

$('sync').addEventListener('click', sync);
for (const button of $('views').querySelectorAll('button')) {
  button.addEventListener('click', () => setView(button.dataset.view));
}
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'r') sync();
  if (key === 'v') setView(view === 'split' ? 'all' : 'split');
});
// Set before the first plate arrives, so the thumb starts where it belongs.
$('views').dataset.view = view;

load();
// Slack items arrive on their own; pick them up without a reload.
setInterval(load, 60_000);
