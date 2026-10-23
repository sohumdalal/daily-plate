/**
 * A link to one Slack message. Slack's own permalinks name the workspace's
 * domain, which the sidecar never sends, so this uses the form without it:
 * slack.com/archives works out the workspace for whoever is signed in. A
 * reply in a thread opens in that thread.
 */
export function slackLink(channelId: string, messageTs: string, threadTs = ''): string {
  if (!channelId || !messageTs) return '';
  const link = `https://slack.com/archives/${channelId}/p${messageTs.replace('.', '')}`;
  return threadTs && threadTs !== messageTs ? `${link}?thread_ts=${threadTs}&cid=${channelId}` : link;
}

/** The link for a row stored by `channel:ts`, when it was stored without one. */
export function slackLinkOf(externalId: string): string {
  const [channelId = '', messageTs = ''] = externalId.split(':');
  return slackLink(channelId, messageTs);
}
