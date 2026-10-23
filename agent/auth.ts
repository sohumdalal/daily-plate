/**
 * Signing in with GitHub, after Cruise Line.
 *
 *   GET  /api/auth/github?return_to=   off to GitHub to sign in
 *   GET  /api/auth/callback            back from GitHub: on the team, a session
 *   POST /api/auth/logout              the session cookie, gone
 *
 * The GitHub App that reads the boards is also the OAuth client, so there is
 * nothing new to install: its client id and secret go in the deploy form, and
 * `<app url>/api/auth/callback` in the App's callback URLs. Signing in only
 * says who you are; the App's own token still reads everyone's work.
 *
 * The session is a signed cookie, `dp_session`, good for 7 days. Only people
 * on TEAM get one. Without a client id and secret there is no sign-in, and
 * everyone is the first on the team, as before there was a team.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { config, isDev } from './config.ts';
import { db } from './db/client.ts';
import { asUser, memberByLogin, owner, type Member } from './users.ts';

const COOKIE = 'dp_session';
const SESSION_TTL_S = 7 * 24 * 3600;
const STATE_TTL_S = 10 * 60;

export function signInEnabled(): boolean {
  return Boolean(config.auth.clientId && config.auth.clientSecret);
}

let secret: Promise<string> | null = null;

/** SESSION_SECRET, or one made on first boot and kept in app_config. */
function sessionSecret(): Promise<string> {
  secret ??= (async () => {
    if (config.auth.sessionSecret) return config.auth.sessionSecret;
    const sql = db();
    await sql`
      INSERT INTO app_config (key, value) VALUES ('session_secret', ${randomBytes(32).toString('hex')})
      ON CONFLICT (key) DO NOTHING
    `;
    const [row] = await sql<{ value: string }[]>`SELECT value FROM app_config WHERE key = 'session_secret'`;
    return row!.value;
  })().catch((err) => {
    secret = null;
    throw err;
  });
  return secret;
}

async function sign(payload: Record<string, unknown>, aud: string, ttlS: number): Promise<string> {
  const body = Buffer.from(
    JSON.stringify({ ...payload, aud, exp: Math.floor(Date.now() / 1000) + ttlS }),
  ).toString('base64url');
  const mac = createHmac('sha256', await sessionSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

async function verify<T>(token: string, aud: string): Promise<T | null> {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = createHmac('sha256', await sessionSecret()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (claims.aud !== aud || typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
    return claims as T;
  } catch {
    return null;
  }
}

function appUrl(c: Context): string {
  return config.auth.appUrl || new URL(c.req.url).origin;
}

function cookie(c: Context, value: string, maxAge: number): string {
  const secure = appUrl(c).startsWith('https://') ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(c: Context): string {
  const header = c.req.header('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return '';
}

/** A path on this site only: never `//elsewhere`, `/\elsewhere` or a control character. */
function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return /[\u0000-\u001f]/.test(value) ? '/' : value;
}

function page(c: Context, status: 403 | 400, title: string, text: string) {
  return c.html(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
      `<title>${title} — Daily Plate</title><link rel="stylesheet" href="/theme.css">` +
      `<main style="max-width:32rem;margin:20vh auto;padding:0 16px;font:15px/1.5 system-ui">` +
      `<h1 style="font-size:20px;font-weight:500">${title}</h1><p>${text}</p>` +
      `<p><a href="/api/auth/github">Sign in again</a></p></main>`,
    status,
  );
}

export const authRoutes = new Hono();

authRoutes.get('/github', async (c) => {
  if (!signInEnabled()) return c.redirect('/');
  const state = await sign({ returnTo: safeReturnTo(c.req.query('return_to')) }, 'oauth-state', STATE_TTL_S);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.auth.clientId);
  url.searchParams.set('redirect_uri', `${appUrl(c)}/api/auth/callback`);
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
});

authRoutes.get('/callback', async (c) => {
  const state = await verify<{ returnTo: string }>(c.req.query('state') ?? '', 'oauth-state');
  const code = c.req.query('code');
  if (!state || !code) return page(c, 400, 'Sign-in expired', 'That sign-in link is old or was changed.');

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.auth.clientId,
      client_secret: config.auth.clientSecret,
      code,
      redirect_uri: `${appUrl(c)}/api/auth/callback`,
    }),
  });
  const token = ((await res.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!token) return page(c, 400, 'GitHub said no', 'GitHub did not give back a sign-in. Try again.');

  const user: { login?: string } = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  }).then((r) => (r.ok ? r.json() : {}));
  const member = user.login ? memberByLogin(user.login) : undefined;
  if (!member) {
    console.warn(`[auth] ${user.login ?? 'someone'} signed in but is not on TEAM`);
    return page(c, 403, 'Not on the team', `${user.login ?? 'This account'} is not on this Daily Plate's TEAM. Ask whoever deployed it to add you.`);
  }

  console.log(`[auth] ${member.login} signed in`);
  c.header('set-cookie', cookie(c, await sign({ login: member.login }, 'session', SESSION_TTL_S), SESSION_TTL_S));
  return c.redirect(state.returnTo);
});

authRoutes.post('/logout', (c) => {
  c.header('set-cookie', cookie(c, '', 0));
  return c.json({ ok: true });
});

/** Who is asking: the session's member, DEV_USER locally, or the owner while sign-in is off. */
async function memberOf(c: Context): Promise<Member | undefined> {
  if (isDev && config.auth.devUser) return memberByLogin(config.auth.devUser);
  if (!signInEnabled()) return owner();
  const claims = await verify<{ login: string }>(readCookie(c), 'session');
  // Taken off TEAM since signing in: the cookie no longer counts.
  return claims ? memberByLogin(claims.login) : undefined;
}

/** Paths anyone may load: the health check, signing in, and the icons the sign-in page shows. */
const OPEN = /^\/(healthz$|api\/auth\/|favicon|apple-touch-icon|icon-|theme\.css$)/;

/**
 * Every other request runs as its member, so the stores read and write their
 * rows. A page sends a stranger to sign in; an API call answers 401.
 */
export const requireMember: MiddlewareHandler = async (c, next) => {
  if (OPEN.test(c.req.path)) return next();
  const member = await memberOf(c);
  if (!member) {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'sign in first' }, 401);
    return c.redirect(`/api/auth/github?return_to=${encodeURIComponent(c.req.path)}`);
  }
  return asUser(member, () => next());
};
