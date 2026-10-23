/**
 * A link to one Slack message. Slack's own permalinks name the workspace's
 * domain, which the sidecar never sends. With SLACK_PROFILE_TOKEN,
 * `auth.test` gives it once at boot. Without the token the link is
 * slack.com/archives, which opens in whichever workspace you are signed in
 * to last, so it can land in the wrong one. A reply in a thread opens in
 * that thread.
 */

import { config } from './config.ts';

/** `https://postman.slack.com/`, once auth.test answers. */
let workspace = '';

export async function learnWorkspace(): Promise<void> {
  if (!config.slack.botToken) {
    console.log('[slack] no SLACK_PROFILE_TOKEN, so Slack links cannot name the workspace');
    return;
  }
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.slack.botToken}` },
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { ok: boolean; url?: string; error?: string };
    if (!body.ok || !body.url) throw new Error(body.error ?? 'no url');
    workspace = body.url.endsWith('/') ? body.url : `${body.url}/`;
    console.log(`[slack] links open in ${workspace}`);
  } catch (err) {
    console.warn('[slack] auth.test failed, so Slack links cannot name the workspace:', err);
  }
}

export function slackLink(channelId: string, messageTs: string, threadTs = ''): string {
  if (!channelId || !messageTs) return '';
  const link = `${workspace || 'https://slack.com/'}archives/${channelId}/p${messageTs.replace('.', '')}`;
  return threadTs && threadTs !== messageTs ? `${link}?thread_ts=${threadTs}&cid=${channelId}` : link;
}

/** The link for a row stored by `channel:ts`, when it was stored without one. */
export function slackLinkOf(externalId: string): string {
  const [channelId = '', messageTs = ''] = externalId.split(':');
  return slackLink(channelId, messageTs);
}
