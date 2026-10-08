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

let data = null;
let busy = false;
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
    if (seen.has(key) || !was.node.classList.contains('item')) continue;
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

const CHECK_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10.5l3 3 6-6.5" /></svg>';

function row(item) {
  const li = document.createElement('li');
  li.className = item.doneAt ? 'item done' : 'item';
  li.dataset.flip = `item-${item.id}`;

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.innerHTML = CHECK_SVG;
  check.setAttribute('aria-pressed', String(Boolean(item.doneAt)));
  check.title = item.doneAt ? 'Put it back on the plate' : 'Clear it';
  check.addEventListener('click', () => toggle(item.id, li));

  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'meta';
  if (item.source === 'board') {
    meta.append(span('status', item.status || 'No status'), span('where', item.context));
    if (item.boards.length > 1) meta.append(span('', 'Both boards'));
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

function render() {
  const before = snapshot();

  const open = data.items.filter((i) => !i.doneAt);
  const board = open
    .filter((i) => i.source === 'board')
    .sort((a, b) => rank(a.status) - rank(b.status));
  const slack = open.filter((i) => i.source !== 'board');
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

  $('board-list').replaceChildren(...board.map(row));
  $('board-empty').hidden = board.length > 0;
  $('slack-list').replaceChildren(...slack.map(row));
  $('slack-empty').hidden = slack.length > 0;
  $('done-list').replaceChildren(...done.map(row));
  $('done-group').hidden = done.length === 0;

  renderNote();
  play(before);

  if (first) document.body.classList.add('ready');
  first = false;
}

function renderNote() {
  const note = $('provenance');
  const sync = data.sync;
  note.className = sync && !sync.ok ? 'note warn' : 'note';
  if (!data.state.github) {
    note.textContent = 'GitHub is not configured, so the boards cannot be read.';
  } else if (!sync) {
    note.textContent = 'Reading the boards…';
  } else if (!sync.ok) {
    note.textContent = `Could not read the boards: ${sync.error}`;
  } else {
    note.textContent =
      `Boards ${data.state.projects.join(', ')} read ${ago(sync.at)}.` +
      (data.state.slackMentions ? '' : ' Slack mentions are off until SLACK_USER_ID is set.');
  }
}

function warn(message) {
  $('provenance').className = 'note warn';
  $('provenance').textContent = message;
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
async function toggle(id, li) {
  const item = data.items.find((i) => i.id === id);
  if (!item) return;
  const done = !item.doneAt;
  const previous = item.doneAt;

  animating++;
  li.classList.toggle('done', done);
  if (done) li.classList.add('popping');

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
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) sync();
});

load();
// Slack items arrive on their own; pick them up without a reload.
setInterval(load, 60_000);
