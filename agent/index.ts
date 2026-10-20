import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config, isDev } from './config.ts';
import { describeTarget, ping } from './db/client.ts';
import { runMigrations } from './db/migrations.ts';
import { routes } from './routes.ts';
import { startSlackIngestion } from './slack.ts';
import { startBoardSync } from './sync.ts';
import { wrapRoutes } from './wrap/routes.ts';

const app = new Hono();

app.onError((err, c) => {
  console.error('[error]', err);
  return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500);
});

app.route('/', routes);
app.route('/api/wrap', wrapRoutes);

// Static pages: Plate at /, Wrap at /wrap/ and Settings at /settings/, sharing
// theme.css and shell.js. No build step, no bundler, no framework.
app.get('/wrap', (c) => c.redirect('/wrap/'));
app.get('/settings', (c) => c.redirect('/settings/'));
app.use('/*', serveStatic({ root: './agent/ui' }));
app.get('/', serveStatic({ root: './agent/ui', path: 'index.html' }));
app.get('/wrap/', serveStatic({ root: './agent/ui', path: 'wrap/index.html' }));
app.get('/settings/', serveStatic({ root: './agent/ui', path: 'settings/index.html' }));

// Bind the HTTP server FIRST so the platform's port-80 ingress comes up
// immediately. Database problems must never block binding or crash the
// process — otherwise the pod crash-loops and the URL never resolves.
// A manual sync runs several GitHub queries in one request, and writing a wrap
// is one or two model calls that can pass a minute on a dense day. Bun's 10s
// default idle timeout drops either connection mid-request.
Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 180 });

console.log(
  `Daily Plate on :${config.port} — ${config.timezone}` +
    ` — db ${describeTarget()}${isDev ? ' (dev)' : ''}`,
);

// The Postgres knowledge container often isn't accepting connections at the
// instant the agent boots, so retry until reachable, then migrate. Failures
// are logged, never fatal.
void (async () => {
  const maxDelayMs = 30_000;
  let delayMs = 1_000;
  for (let attempt = 1; ; attempt++) {
    if (await ping()) {
      try {
        await runMigrations();
        console.log('[db] connected — migrations applied');
        // Both write to `items`, so they wait for the schema.
        startBoardSync();
        void startSlackIngestion();
      } catch (err) {
        console.error('[boot] database initialization failed after connect:', err);
      }
      return;
    }
    console.warn(`[db] postgres unreachable (attempt ${attempt}) — retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
})();
