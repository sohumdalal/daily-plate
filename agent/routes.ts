/**
 * The whole API.
 *
 *   GET   /healthz
 *   GET   /api/plate        today's plate, what was cleared before it, readiness,
 *                           and the last board sync
 *   POST  /api/sync         re-read GitHub now
 *   POST  /api/items        { title: string } — put a task of your own on the plate
 *   PATCH /api/items/:id    { done: boolean } — clear an item, or put it back
 *   DELETE /api/items/:id   delete a task or Slack message for good
 *   POST  /api/items/clear  { ids: number[] } — delete those tasks and Slack messages
 *   POST  /api/items/:id/notes      { text: string } — add a note to an item
 *   DELETE /api/items/:id/notes/:n  remove that note
 *   GET   /api/unfurl?url=          { url, title, site, icon } — a link's preview card
 *   GET   /api/export      every item as stored, for scripts/import-plate.ts
 *   GET   /api/me          { login, name } — whose plate this is, for the account menu
 *   GET   /api/notifications            every mention of you, newest first, and the last GitHub read
 *   GET   /api/notifications/unread     { unread } — for the count on the tab
 *   POST  /api/notifications/sync       re-read GitHub's mentions now
 *   POST  /api/notifications/read       mark every notification read
 *   PATCH /api/notifications/:id        { read: boolean } — mark one read, or unread again
 */

import { Hono } from 'hono';
import ogs from 'open-graph-scraper';
import { config, readiness } from './config.ts';
import * as notifications from './notifications.ts';
import { personName, slackPeople, withNames } from './people.ts';
import * as store from './store.ts';
import { slackConnected } from './slack.ts';
import { assignee, lastSync, syncBoards } from './sync.ts';
import { dayOf } from './time.ts';

export const routes = new Hono();

routes.get('/healthz', (c) => c.json({ ok: true }));

/** A Slack item with its people named rather than shown by id. */
function named(people: Map<string, string>) {
  return (item: store.Item): store.Item =>
    item.source === 'mention' || item.source === 'reaction'
      ? { ...item, title: withNames(item.title, people), author: personName(item.author, people) }
      : item;
}

async function plateBody() {
  const today = dayOf(new Date(), config.timezone);
  const people = await slackPeople();
  return {
    today,
    state: { ...readiness(), slackConnected: slackConnected() },
    sync: lastSync(),
    assignee: assignee(),
    items: (await store.plate(today, config.timezone)).map(named(people)),
    history: (await store.history(today, config.timezone)).map(named(people)),
  };
}

routes.get('/api/plate', async (c) => c.json(await plateBody()));

routes.get('/api/me', (c) => {
  const login = assignee()?.login || config.github.username;
  return c.json({ login, name: assignee()?.name || login });
});

routes.get('/api/export', async (c) => {
  c.header('content-disposition', 'attachment; filename="daily-plate-items.json"');
  return c.json({ exportedAt: new Date().toISOString(), items: await store.exportItems() });
});

routes.post('/api/sync', async (c) => {
  await syncBoards();
  return c.json(await plateBody());
});

/** Longest task title or note kept. */
const MAX_TEXT = 2000;

routes.post('/api/items', async (c) => {
  const body = await c.req.json<{ title?: unknown }>().catch(() => ({}) as { title?: unknown });
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TEXT) {
    return c.json({ error: `expected { title: string }, 1 to ${MAX_TEXT} characters` }, 400);
  }
  return c.json(await store.addTask(title), 201);
});

routes.patch('/api/items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ done?: unknown }>().catch(() => ({}) as { done?: unknown });
  if (!Number.isInteger(id) || typeof body.done !== 'boolean') {
    return c.json({ error: 'expected { done: boolean }' }, 400);
  }
  const item = await store.setDone(id, body.done);
  return item ? c.json(named(await slackPeople())(item)) : c.json({ error: 'not found' }, 404);
});

routes.delete('/api/items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const deleted = Number.isInteger(id) && (await store.deleteItems([id])).length > 0;
  return deleted ? c.json({ id }) : c.json({ error: 'not found' }, 404);
});

/** Most rows one Clear all deletes. */
const MAX_CLEAR = 500;

routes.post('/api/items/clear', async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  const ids = Array.isArray(body.ids) ? body.ids : null;
  if (!ids || ids.length > MAX_CLEAR || !ids.every((id) => Number.isInteger(id))) {
    return c.json({ error: `expected { ids: number[] }, at most ${MAX_CLEAR}` }, 400);
  }
  return c.json({ ids: await store.deleteItems(ids as number[]) });
});

routes.post('/api/items/:id/notes', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!Number.isInteger(id) || !text || text.length > MAX_TEXT) {
    return c.json({ error: `expected { text: string }, 1 to ${MAX_TEXT} characters` }, 400);
  }
  const item = await store.addNote(id, text);
  return item ? c.json(named(await slackPeople())(item), 201) : c.json({ error: 'not found' }, 404);
});

routes.delete('/api/items/:id/notes/:note', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'not found' }, 404);
  const item = await store.deleteNote(id, c.req.param('note'));
  return item ? c.json(named(await slackPeople())(item)) : c.json({ error: 'not found' }, 404);
});

/** Link previews, read once per URL for the life of the process. */
const unfurls = new Map<string, Promise<{ url: string; title?: string; site?: string; icon?: string }>>();

function unfurl(url: string) {
  let card = unfurls.get(url);
  if (!card) {
    card = ogs({ url, timeout: 5 })
      .then(({ result: r }) => ({
        url,
        title: r.ogTitle || r.twitterTitle || undefined,
        site: r.ogSiteName || new URL(url).hostname.replace(/^www\./, ''),
        icon: r.favicon ? new URL(r.favicon, url).href : undefined,
      }))
      .catch(() => ({ url }));
    unfurls.set(url, card);
  }
  return card;
}

routes.get('/api/unfurl', async (c) => {
  const url = c.req.query('url') ?? '';
  if (!/^https?:\/\//.test(url)) return c.json({ error: 'expected ?url=http(s)://…' }, 400);
  return c.json(await unfurl(url));
});

async function notificationsBody() {
  const people = await slackPeople();
  return {
    state: { ...readiness(), slackConnected: slackConnected() },
    sync: notifications.lastMentionSync(),
    items: (await notifications.list()).map((n) =>
      n.source === 'slack' ? { ...n, body: withNames(n.body, people), author: personName(n.author, people) } : n,
    ),
    unread: await notifications.unreadCount(),
  };
}

routes.get('/api/notifications', async (c) => c.json(await notificationsBody()));

routes.get('/api/notifications/unread', async (c) =>
  c.json({ unread: await notifications.unreadCount() }),
);

routes.post('/api/notifications/sync', async (c) => {
  await notifications.syncMentions();
  return c.json(await notificationsBody());
});

routes.post('/api/notifications/read', async (c) => {
  await notifications.readAll();
  return c.json(await notificationsBody());
});

routes.patch('/api/notifications/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ read?: unknown }>().catch(() => ({}) as { read?: unknown });
  if (!Number.isInteger(id) || typeof body.read !== 'boolean') {
    return c.json({ error: 'expected { read: boolean }' }, 400);
  }
  const item = await notifications.setRead(id, body.read);
  return item ? c.json(item) : c.json({ error: 'not found' }, 404);
});
