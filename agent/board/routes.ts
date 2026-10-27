/**
 * The Board tab's API, under /api/board.
 *
 *   GET   /                every issue on the boards, each with its judgment, and the metrics
 *   POST  /refresh         read the boards again now
 *   POST  /judge           start judging the issues that are new or changed; 202 at once
 *   POST  /think/:id       the deeper thought on one closed issue, by node id
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { boardIssues } from './issues.ts';
import { BADGES, judgeBoard, judging, judgments, thinkDeeper } from './judge.ts';
import { boardMetrics } from './metrics.ts';

export const boardRoutes = new Hono();

async function body({ fresh = false } = {}) {
  const [{ at, issues }, judged] = await Promise.all([boardIssues({ fresh }), judgments()]);
  return {
    at: new Date(at).toISOString(),
    boards: config.github.projects.map((p) => `${p.owner}/${p.number}`),
    llm: Boolean(config.llm.gateway.url || config.llm.anthropicKey),
    judging: judging(),
    badges: BADGES,
    metrics: boardMetrics(issues),
    issues: issues.map(({ body: _body, ...issue }) => {
      const j = judged.get(issue.id);
      return { ...issue, judgment: j ? { ...j, digest: undefined } : null };
    }),
  };
}

const failed = (err: unknown) => (err instanceof Error ? err.message : String(err));

boardRoutes.get('/', async (c) => {
  try {
    return c.json(await body());
  } catch (err) {
    return c.json({ error: failed(err) }, 502);
  }
});

boardRoutes.post('/refresh', async (c) => {
  try {
    return c.json(await body({ fresh: true }));
  } catch (err) {
    return c.json({ error: failed(err) }, 502);
  }
});

// A run over a large board outlasts one request, so it starts here and the
// screen asks GET / again until `judging` is false.
boardRoutes.post('/judge', (c) => {
  void judgeBoard().catch((err) => console.warn('[board] judge run failed:', err));
  return c.json({ judging: true }, 202);
});

boardRoutes.post('/think/:id', async (c) => {
  try {
    return c.json(await thinkDeeper(c.req.param('id')));
  } catch (err) {
    return c.json({ error: failed(err) }, 502);
  }
});
