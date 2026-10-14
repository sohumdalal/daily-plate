/**
 * The whole API.
 *
 *   GET   /healthz
 *   GET   /api/plate        today's plate, what was cleared before it, readiness,
 *                           and the last board sync
 *   POST  /api/sync         re-read GitHub now
 *   POST  /api/items        { title: string } — put a task of your own on the plate
 *   PATCH /api/items/:id    { done: boolean } — clear an item, or put it back
 *   POST  /api/items/:id/notes      { text: string } — add a note to an item
 *   DELETE /api/items/:id/notes/:n  remove that note
 */

import { Hono } from 'hono';
import { config, readiness } from './config.ts';
import * as store from './store.ts';
import { slackConnected } from './slack.ts';
import { assignee, lastSync, syncBoards } from './sync.ts';
import { dayOf } from './time.ts';

export const routes = new Hono();

routes.get('/healthz', (c) => c.json({ ok: true }));

async function plateBody() {
  const today = dayOf(new Date(), config.timezone);
  return {
    today,
    state: { ...readiness(), slackConnected: slackConnected() },
    sync: lastSync(),
    assignee: assignee(),
    items: await store.plate(today, config.timezone),
    history: await store.history(today, config.timezone),
  };
}

routes.get('/api/plate', async (c) => c.json(await plateBody()));

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
  return item ? c.json(item) : c.json({ error: 'not found' }, 404);
});

routes.post('/api/items/:id/notes', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!Number.isInteger(id) || !text || text.length > MAX_TEXT) {
    return c.json({ error: `expected { text: string }, 1 to ${MAX_TEXT} characters` }, 400);
  }
  const item = await store.addNote(id, text);
  return item ? c.json(item, 201) : c.json({ error: 'not found' }, 404);
});

routes.delete('/api/items/:id/notes/:note', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'not found' }, 404);
  const item = await store.deleteNote(id, c.req.param('note'));
  return item ? c.json(item) : c.json({ error: 'not found' }, 404);
});
