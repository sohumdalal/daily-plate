/**
 * The whole API.
 *
 *   GET   /healthz
 *   GET   /api/plate        today's plate, readiness, and the last board sync
 *   POST  /api/sync         re-read the boards now
 *   PATCH /api/items/:id    { done: boolean } — clear an item, or put it back
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
  };
}

routes.get('/api/plate', async (c) => c.json(await plateBody()));

routes.post('/api/sync', async (c) => {
  await syncBoards();
  return c.json(await plateBody());
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
