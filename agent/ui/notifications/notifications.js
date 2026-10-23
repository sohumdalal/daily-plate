/*
 * The Notifications tab: every time someone @-mentioned you on GitHub or in
 * Slack, newest first, grouped by day.
 *
 * Opening a notification's link marks it read. Unread is the default view,
 * and the choice is remembered in this browser. The list re-reads every
 * minute while the tab is visible, and at once when it comes back.
 */
const $ = (id) => document.getElementById(id);

const SHOW_KEY = 'daily-plate:notifications-show';
const POLL_MS = 60_000;

/** The last answer from /api/notifications. */
let data = null;
let first = true;
let busy = false;
/**
 * Bumped by every change made on this page. A read that started before one
 * is older than what is on screen, so its result is dropped, not rendered.
 */
let edits = 0;

let show = 'unread';
try {
  if (localStorage.getItem(SHOW_KEY) === 'all') show = 'all';
} catch {
  // Blocked storage: Unread, for this page only.
}

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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** How each kind reads after the author's name. */
const VERBS = {
  comment: 'mentioned you in a comment',
  review: 'mentioned you in a review',
  line: 'mentioned you on a line',
  opened: 'mentioned you when opening',
  mention: 'mentioned you',
};

/**
 * Slack's markup, readable: `<@U…>` is a person, `<#C…|name>` a channel,
 * `<url|text>` a link. Only your own id is known by name here.
 */
function slackText(text) {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, name) => (name ? `@${name}` : '@someone'))
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1');
}

/** `Today`, `Yesterday`, then `Monday 19 October`. */
function dayLabel(day) {
  const today = new Date();
  const key = (d) => d.toLocaleDateString('en-CA');
  if (day === key(today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day === key(yesterday)) return 'Yesterday';
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function row(n) {
  const li = el('li', `notice${n.readAt ? '' : ' unread'}`);
  li.dataset.id = n.id;

  const dot = el('span', 'dot');
  dot.setAttribute('aria-hidden', 'true');

  const main = el('div', 'notice-main');
  const meta = el('div', 'notice-meta');
  meta.append(el('span', `icon icon-${n.source}`));
  if (n.context) meta.append(el('span', 'notice-context', n.context));
  const time = el('time', 'notice-time', clock(n.at));
  time.dateTime = n.at;
  time.title = new Date(n.at).toLocaleString('en-GB');
  meta.append(time);

  const link = el('a', 'notice-link');
  link.href = n.url || '#';
  link.target = '_blank';
  link.rel = 'noopener';
  const who = el('span', 'notice-who');
  // A Slack person has a picture only once SLACK_PROFILE_TOKEN has looked them up.
  const picture =
    n.source === 'github' && n.author ? `https://github.com/${encodeURIComponent(n.author)}.png?size=40` : n.authorAvatar;
  if (picture) {
    const avatar = el('img', 'notice-avatar');
    avatar.alt = '';
    avatar.src = picture;
    avatar.onerror = () => avatar.remove();
    who.append(avatar);
  }
  who.append(el('strong', '', n.author || 'Someone'), ` ${VERBS[n.kind] || VERBS.mention}`);
  link.append(who);
  if (n.source === 'github') link.append(el('span', 'notice-title', n.title));
  link.addEventListener('click', () => {
    if (!n.readAt) setRead(n, true);
  });

  main.append(meta, link);
  if (n.body) main.append(el('p', 'notice-body', n.source === 'slack' ? slackText(n.body) : n.body));

  const toggle = el('button', 'line-button sm notice-toggle', n.readAt ? 'Unread' : 'Read');
  toggle.type = 'button';
  toggle.setAttribute(
    'aria-label',
    `Mark ${n.author || 'this'} ${n.readAt ? 'unread' : 'read'}: ${n.title || n.context}`,
  );
  toggle.addEventListener('click', () => setRead(n, !n.readAt));

  li.append(dot, main, toggle);
  return li;
}

function provenance() {
  const lines = [];
  const { state, sync } = data;
  if (!state.github) lines.push('GitHub is not set up, so GitHub mentions are not read.');
  else if (sync && !sync.ok) lines.push(`The last GitHub read failed: ${sync.error}`);
  if (!state.slackMentions) lines.push('SLACK_USER_ID is not set, so Slack mentions are not kept.');
  else if (!state.slackConnected) lines.push('Slack is not connected, so new Slack mentions do not arrive.');
  $('provenance').textContent = lines.join(' ');
  $('provenance').hidden = !lines.length;
}

function render() {
  const unread = data.items.filter((n) => !n.readAt).length;
  window.DailyPlate.setUnread(unread);
  document.title = unread ? `(${unread}) Notifications — Daily Plate` : 'Notifications — Daily Plate';
  $('unread-label').textContent = unread ? `${unread} unread` : 'All read';
  $('read-at').textContent = data.sync ? `Read ${window.DailyPlate.ago(data.sync.at)}` : '';
  $('read-all').disabled = !unread;
  $('show-unread').setAttribute('aria-pressed', String(show === 'unread'));
  $('show-all').setAttribute('aria-pressed', String(show === 'all'));
  provenance();

  const shown = show === 'unread' ? data.items.filter((n) => !n.readAt) : data.items;
  const lists = $('lists');
  lists.replaceChildren();
  if (!shown.length) {
    const empty = el('div', 'empty-state');
    empty.append(
      el('p', 'empty-title', show === 'unread' && data.items.length ? 'You are all caught up.' : 'No one has mentioned you yet.'),
      el(
        'p',
        'empty-caption',
        'A mention of @you on GitHub or in a Slack channel the app watches shows here.',
      ),
    );
    lists.append(empty);
    return;
  }

  let list = null;
  let day = '';
  for (const n of shown) {
    const d = new Date(n.at).toLocaleDateString('en-CA');
    if (d !== day) {
      day = d;
      const section = el('section', 'day');
      const heading = el('h2', 'label day-label', dayLabel(d));
      list = el('ul', 'notices');
      section.append(heading, list);
      lists.append(section);
    }
    list.append(row(n));
  }
}

function warn(text) {
  $('provenance').textContent = text;
  $('provenance').hidden = false;
}

function loadFailed(err) {
  $('load-error-reason').textContent = `Reason: ${err.message}.`;
  document.body.classList.add('failed');
  $('load-error').hidden = false;
}

async function load() {
  if (busy) return;
  const at = edits;
  try {
    const fresh = await request('/api/notifications');
    if (at !== edits) return;
    data = fresh;
    first = false;
    document.body.classList.remove('failed');
    $('load-error').hidden = true;
    document.body.classList.add('ready');
    render();
  } catch (err) {
    if (first) return loadFailed(err);
    warn(`Could not load notifications: ${err.message}`);
  }
}

async function setRead(n, read) {
  edits++;
  const was = n.readAt;
  n.readAt = read ? new Date().toISOString() : null;
  render();
  try {
    const saved = await request(`/api/notifications/${n.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read }),
    });
    n.readAt = saved.readAt;
  } catch (err) {
    n.readAt = was;
    warn(`Could not mark it ${read ? 'read' : 'unread'}: ${err.message}`);
  }
  render();
}

/** Runs one action that answers with the whole list, with the button showing it is busy. */
async function run(button, path, failure) {
  if (busy || !data) return;
  busy = true;
  edits++;
  button.disabled = true;
  try {
    data = await request(path, { method: 'POST' });
    render();
  } catch (err) {
    warn(`${failure}: ${err.message}`);
  } finally {
    busy = false;
    button.disabled = false;
    if (data) render();
  }
}

const sync = () => run($('sync'), '/api/notifications/sync', 'Could not read GitHub');
const readAll = () => run($('read-all'), '/api/notifications/read', 'Could not mark them read');

function setShow(value) {
  show = value;
  try {
    localStorage.setItem(SHOW_KEY, value);
  } catch {
    // Blocked storage: the choice lasts this page only.
  }
  if (data) render();
}

$('sync').addEventListener('click', sync);
$('read-all').addEventListener('click', readAll);
$('show-unread').addEventListener('click', () => setShow('unread'));
$('show-all').addEventListener('click', () => setShow('all'));
$('load-retry').addEventListener('click', load);

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.target.closest('input, textarea')) return;
  // Not while a button or link has the focus, where a letter is easy to hit by accident.
  if (e.target.closest('button, a')) return;
  const key = e.key.toLowerCase();
  if (key === 'r') sync();
  if (key === 'u') setShow(show === 'unread' ? 'all' : 'unread');
  if (key === 'a' && e.shiftKey) readAll();
});

setInterval(() => {
  if (!document.hidden) load();
}, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

load();
