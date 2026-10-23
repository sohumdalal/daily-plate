import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { secureHeaders } from 'hono/secure-headers';
import { authRoutes, requireMember, signInEnabled } from './auth.ts';
import { config, isDev } from './config.ts';
import { describeTarget, ping } from './db/client.ts';
import { runMigrations } from './db/migrations.ts';
import { startMentionSync } from './notifications.ts';
import { routes } from './routes.ts';
import { startSlack } from './slack.ts';
import { startBoardSync } from './sync.ts';
import { claimDefaultRows, team } from './users.ts';
import { wrapRoutes } from './wrap/routes.ts';

const app = new Hono();

app.use(compress());
app.use(etag());
app.use(
  secureHeaders({
    // Framing stays allowed: the platform may show the app inside its own UI.
    xFrameOptions: false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Recharts and Motion set inline styles; Inter comes from Google Fonts.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      // Avatars and link previews come from GitHub, Slack and any linked site.
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  }),
);

app.onError((err, c) => {
  console.error('[error]', err);
  return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500);
});

app.route('/api/auth', authRoutes);
app.use(requireMember);
app.route('/', routes);
app.route('/api/wrap', wrapRoutes);

// Static pages: Plate at /, Wrap at /wrap/, Notifications at /notifications/
// and Settings at /settings/, sharing theme.css and shell.js. The one build is
// the Mova bundle (agent/mova).
//
// Mova's chunks are named by content hash, so they are cached for good. Every
// other file keeps its name across deploys, so the browser revalidates it
// against its ETag on each load.
const cacheFor = (path: string) =>
  /\/mova\/dist\/index-[a-z0-9]+\.js$/.test(path)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

app.get('/wrap', (c) => c.redirect('/wrap/'));
app.get('/settings', (c) => c.redirect('/settings/'));
app.get('/notifications', (c) => c.redirect('/notifications/'));
app.use(
  '/*',
  serveStatic({
    root: './agent/ui',
    onFound: (path, c) => {
      c.header('Cache-Control', cacheFor(path));
    },
  }),
);
app.get('/', serveStatic({ root: './agent/ui', path: 'index.html' }));
app.get('/wrap/', serveStatic({ root: './agent/ui', path: 'wrap/index.html' }));
app.get('/settings/', serveStatic({ root: './agent/ui', path: 'settings/index.html' }));
app.get('/notifications/', serveStatic({ root: './agent/ui', path: 'notifications/index.html' }));

// An unknown API path is an error for the caller; an unknown page is a page.
const notFoundPage = Bun.file('./agent/ui/404.html');
app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
  return c.html(await notFoundPage.text(), 404);
});

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
console.log(
  `[team] ${team().map((m) => m.login + (m.slackId ? `:${m.slackId}` : '')).join(', ') || 'nobody (set TEAM)'}` +
    (signInEnabled()
      ? ' — sign in with GitHub'
      : ` — sign-in is off (no GITHUB_APP_CLIENT_ID/SECRET), so everyone is ${team()[0]?.login ?? 'nobody'}`),
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
        await claimDefaultRows();
        console.log('[db] connected — migrations applied');
        // All three write to the database, so they wait for the schema.
        startBoardSync();
        startMentionSync();
        void startSlack();
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
