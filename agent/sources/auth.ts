/**
 * The token every GitHub call carries.
 *
 * Deployed, Daily Plate signs in as a GitHub App installed on the org, since
 * `astropods` forbids personal access tokens: the App ID and private key sign
 * a JWT, which buys a one-hour installation token. Locally there is no App,
 * and GITHUB_TOKEN (from `gh auth token`, see scripts/env.ts) is used as is.
 */

import { createSign } from 'node:crypto';
import { config, usesApp } from '../config.ts';

/** Fetch a new installation token this long before the old one expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cached: { token: string; expiresAt: number } | null = null;

/**
 * A PEM pasted into a single-line form field arrives with literal `\n`, or
 * with no line breaks at all. Either way, rebuild it.
 */
function normalizePem(raw: string): string {
  const pem = raw.replace(/\\n/g, '\n').trim();
  if (pem.includes('\n')) return pem;
  const match = pem.match(/(-----BEGIN [A-Z ]+-----)(.+)(-----END [A-Z ]+-----)/);
  if (!match) return pem;
  const body = match[2]!.replace(/\s/g, '').match(/.{1,64}/g)?.join('\n') ?? match[2];
  return `${match[1]}\n${body}\n${match[3]}`;
}

function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  // iat is backdated a minute: GitHub rejects a JWT issued "in the future" by clock skew.
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: appId, iat: now - 60, exp: now + 600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(normalizePem(privateKey), 'base64url');
  return `${unsigned}.${signature}`;
}

async function installationToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached.token;
  const { id, privateKey, installationId } = config.github.app;
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${appJwt(id, privateKey)}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub App token exchange failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { token: string; expires_at: string };
  cached = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
  return cached.token;
}

export async function githubToken(): Promise<string> {
  return usesApp() ? installationToken() : config.github.token;
}
