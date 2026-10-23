/**
 * People in Slack by name, never by their U… id, wherever the screen shows
 * them. Slack items store the sender's raw id (as `<@U…|Name>` when the
 * adapter named them), which stays the one reliable key, and are named here
 * on the way out.
 *
 * Names come from three places, best first: Slack itself through
 * SLACK_PROFILE_TOKEN, which also gives each person's picture; the name the
 * adapter gave the author of a message you reacted to; and yours from GitHub.
 * Without the token there are no pictures, and someone never named is shown
 * without a name.
 */

import { config } from './config.ts';
import { profileOf } from './sync.ts';
import { team } from './users.ts';
import { slackAuthorNames } from './wrap/store.ts';

const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;
const MENTION = /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g;
/** An author stored as `<@U…|Name>`, or a bare U… id. */
const AUTHOR = /^(?:<@([UW][A-Z0-9]+)(?:\|([^>]+))?>|([UW][A-Z0-9]{6,}))$/;

type Profile = { name: string; avatar: string };

/** users.info answers, hits and misses both, for the life of the process. */
const profiles = new Map<string, Profile | null>();
const pending = new Map<string, Promise<void>>();

/** Most time a page load waits on Slack before it shows what it has. */
const LOOKUP_WAIT_MS = 2500;

function lookUp(id: string): Promise<void> {
  let call = pending.get(id);
  if (!call) {
    call = fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${config.slack.botToken}` },
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => res.json() as Promise<SlackUser>)
      .then((body) => {
        const u = body.ok ? body.user : undefined;
        const name = u ? u.real_name || u.profile?.real_name || u.profile?.display_name || u.name || '' : '';
        profiles.set(id, u ? { name, avatar: u.profile?.image_72 || u.profile?.image_48 || '' } : null);
        if (!body.ok) console.warn(`[people] users.info ${id}: ${body.error}`);
      })
      // A network failure is not an answer: the next page load asks again.
      .catch((err) => console.warn(`[people] users.info ${id} failed:`, err))
      .finally(() => pending.delete(id));
    pending.set(id, call);
  }
  return call;
}

type SlackUser = {
  ok: boolean;
  error?: string;
  user?: {
    name?: string;
    real_name?: string;
    profile?: { real_name?: string; display_name?: string; image_48?: string; image_72?: string };
  };
};

/** Every Slack id a piece of text or a stored author names. */
export function idsIn(...texts: string[]): string[] {
  const ids = new Set<string>();
  for (const text of texts) {
    for (const [, id] of text.matchAll(MENTION)) ids.add(id!);
    const author = text.match(AUTHOR);
    if (author) ids.add((author[1] || author[3])!);
  }
  return [...ids];
}

/**
 * Names by id. With SLACK_PROFILE_TOKEN, `ids` are looked up in Slack first, each
 * once; a slow Slack never holds a page load past LOOKUP_WAIT_MS.
 */
export async function slackPeople(ids: string[] = []): Promise<Map<string, string>> {
  if (config.slack.botToken) {
    const asks = ids.filter((id) => !profiles.has(id)).map(lookUp);
    if (asks.length) {
      await Promise.race([Promise.all(asks), new Promise((ok) => setTimeout(ok, LOOKUP_WAIT_MS))]);
    }
  }
  const names = await slackAuthorNames();
  // Each member by their GitHub name, where Slack has not named them.
  for (const member of team()) {
    const first = profileOf(member.login)?.name.split(' ')[0];
    if (member.slackId && first && !names.has(member.slackId)) names.set(member.slackId, first);
  }
  for (const [id, profile] of profiles) if (profile?.name) names.set(id, profile.name);
  return names;
}

/** `<@U0BF…> can you look` → `@Sohum can you look`, or `@someone` for a person never named. */
export function withNames(text: string, people: Map<string, string>): string {
  return text.replace(MENTION, (_, id: string, label?: string) => `@${people.get(id) || label || 'someone'}`);
}

/** The `@Name`s withNames writes into `text`, so the screen can set them apart. */
export function mentionsIn(text: string, people: Map<string, string>): string[] {
  return [...new Set([...text.matchAll(MENTION)].map(([, id, label]) => `@${people.get(id!) || label || 'someone'}`))];
}

/** An author as stored: a name passes through, an id becomes the name, or nothing. */
export function personName(author: string, people: Map<string, string>): string {
  const match = author.match(AUTHOR);
  if (!match) return author;
  return people.get((match[1] || match[3])!) || match[2] || '';
}

/** The author's Slack picture, once SLACK_PROFILE_TOKEN has looked them up, or ''. */
export function personAvatar(author: string): string {
  const match = author.match(AUTHOR);
  return match ? (profiles.get((match[1] || match[3])!)?.avatar ?? '') : '';
}
