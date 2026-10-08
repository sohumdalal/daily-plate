/**
 * Daily Plate — the whole client. No framework, no build step.
 */

const $ = (id) => document.getElementById(id);

/** Board columns, most urgent first. Anything else sorts after these. */
const COLUMN_ORDER = ['In progress', 'In review', 'Ready', 'On hold', 'Backlog'];

const SOURCE_LABEL = { mention: 'Mention', reaction: 'Reacted' };

let busy = false;

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

function span(className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function row(item) {
  const li = document.createElement('li');
  li.className = item.doneAt ? 'item done' : 'item';

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.setAttribute('aria-pressed', String(Boolean(item.doneAt)));
  check.title = item.doneAt ? 'Put it back on the plate' : 'Clear it';
  check.addEventListener('click', () => toggle(item));

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

function fill(list, items) {
  list.replaceChildren(...items.map(row));
}

function render(data) {
  const open = data.items.filter((i) => !i.doneAt);
  const board = open
    .filter((i) => i.source === 'board')
    .sort((a, b) => rank(a.status) - rank(b.status));
  const slack = open.filter((i) => i.source !== 'board');
  const done = data.items.filter((i) => i.doneAt);

  $('date').textContent = new Date(`${data.today}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  $('n-open').textContent = open.length;
  $('n-board').textContent = board.length;
  $('n-slack').textContent = slack.length;
  $('n-done').textContent = done.length;

  fill($('board-list'), board);
  $('board-empty').hidden = board.length > 0;
  fill($('slack-list'), slack);
  $('slack-empty').hidden = slack.length > 0;
  fill($('done-list'), done);
  $('done-group').hidden = done.length === 0;

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

async function request(path, init) {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function load() {
  try {
    render(await request('/api/plate'));
  } catch (err) {
    $('provenance').className = 'note warn';
    $('provenance').textContent = `Could not load the plate: ${err.message}`;
  }
}

async function sync() {
  if (busy) return;
  busy = true;
  $('sync').disabled = true;
  $('sync').textContent = 'Reading…';
  try {
    render(await request('/api/sync', { method: 'POST' }));
  } catch (err) {
    $('provenance').className = 'note warn';
    $('provenance').textContent = `Could not refresh: ${err.message}`;
  } finally {
    busy = false;
    $('sync').disabled = false;
    $('sync').textContent = 'Refresh';
  }
}

async function toggle(item) {
  try {
    await request(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: !item.doneAt }),
    });
    await load();
  } catch (err) {
    $('provenance').className = 'note warn';
    $('provenance').textContent = `Could not update that item: ${err.message}`;
  }
}

$('sync').addEventListener('click', sync);
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) sync();
});

load();
// Slack items arrive on their own; pick them up without a reload.
setInterval(load, 60_000);
