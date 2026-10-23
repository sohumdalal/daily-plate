/**
 * People in Slack by name, never by their U… id, wherever the screen shows
 * them. Slack items store the sender's raw id, which stays the one reliable
 * key, and are named here on the way out.
 *
 * The agent holds no Slack token to look anyone up, so the names are the
 * ones the adapter gave each person as the author of a message you reacted
 * to, and yours from GitHub. Someone never named is shown without a name.
 */

import { config } from './config.ts';
import { assignee } from './sync.ts';
import { slackAuthorNames } from './wrap/store.ts';

const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;
const MENTION = /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g;

export async function slackPeople(): Promise<Map<string, string>> {
  const names = await slackAuthorNames();
  const owner = assignee()?.name.split(' ')[0];
  if (config.slack.userId && owner && !names.has(config.slack.userId)) names.set(config.slack.userId, owner);
  return names;
}

/** `<@U0BF…> can you look` → `@Sohum can you look`, or `@someone` for a person never named. */
export function withNames(text: string, people: Map<string, string>): string {
  return text.replace(MENTION, (_, id: string, label?: string) => `@${label || people.get(id) || 'someone'}`);
}

/** The `@Name`s withNames writes into `text`, so the screen can set them apart. */
export function mentionsIn(text: string, people: Map<string, string>): string[] {
  return [...new Set([...text.matchAll(MENTION)].map(([, id, label]) => `@${label || people.get(id!) || 'someone'}`))];
}

/** An author as stored: a name passes through, an id becomes the name, or nothing. */
export function personName(author: string, people: Map<string, string>): string {
  return SLACK_ID.test(author) ? (people.get(author) ?? '') : author;
}
