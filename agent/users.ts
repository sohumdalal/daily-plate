/**
 * The team, and whose plate a piece of work is for.
 *
 * TEAM in the deploy form lists everyone who may sign in, each as
 * `github-login:SLACK_ID` (the Slack id is optional). Every row in the
 * database belongs to one of them by lowercase GitHub login. Without TEAM,
 * GITHUB_USERNAME and SLACK_USER_ID make a team of one, as before.
 *
 * Whose rows a query reads is not passed down by hand: a request, a sync
 * pass or a Slack event runs inside asUser(), and the stores ask
 * currentUser(). Asking outside one throws, so no write can land on the
 * wrong plate, or on nobody's.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './db/client.ts';

export type Member = { login: string; slackId: string };

const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;

/** `sohumdalal:U08TSB1BZ5H, jessye:U0…` → members. Order is kept: the first is the owner. */
export function parseTeam(raw: string): Member[] {
  const members: Member[] = [];
  for (const entry of raw.split(/[,\n]/)) {
    const [login = '', slackId = ''] = entry.split(':').map((s) => s.trim());
    if (!login) continue;
    if (slackId && !SLACK_ID.test(slackId)) {
      console.warn(`[team] ${login}: "${slackId}" is not a Slack member id (U…); ignoring it`);
    }
    const member = { login: login.toLowerCase(), slackId: SLACK_ID.test(slackId) ? slackId : '' };
    if (!members.some((m) => m.login === member.login)) members.push(member);
  }
  return members;
}

const members: Member[] = process.env.TEAM?.trim()
  ? parseTeam(process.env.TEAM)
  : parseTeam(`${process.env.GITHUB_USERNAME ?? ''}:${process.env.SLACK_USER_ID ?? ''}`);

export function team(): Member[] {
  return members;
}

/** The first on the team. Rows from before there was a team are theirs. */
export function owner(): Member | undefined {
  return members[0];
}

export function memberByLogin(login: string): Member | undefined {
  const key = login.toLowerCase();
  return members.find((m) => m.login === key);
}

export function memberBySlack(slackId: string): Member | undefined {
  return slackId ? members.find((m) => m.slackId === slackId) : undefined;
}

/**
 * Whose plate a Slack event is for. With no Slack ids on the team at all, as
 * a team of one without SLACK_USER_ID, everyone's events are the owner's.
 */
export function memberForSlack(slackId: string): Member | undefined {
  return memberBySlack(slackId) ?? (members.every((m) => !m.slackId) ? owner() : undefined);
}

const context = new AsyncLocalStorage<Member>();

/** Run `fn` as `member`: every store call inside reads and writes their rows. */
export function asUser<T>(member: Member, fn: () => T): T {
  return context.run(member, fn);
}

/** The member this work is for. Throws outside asUser(), by design. */
export function currentMember(): Member {
  const member = context.getStore();
  if (!member) throw new Error('no user for this work: wrap it in asUser()');
  return member;
}

/** The member this work is for, or undefined outside asUser(), for logs and traces. */
export function maybeMember(): Member | undefined {
  return context.getStore();
}

/** The `user_id` every row is stored under. */
export function currentUser(): string {
  return currentMember().login;
}

/** Tables keyed by user_id. Rows from before the team are the owner's. */
const USER_TABLES = [
  'items',
  'notifications',
  'days',
  'wraps',
  'wrap_versions',
  'reflections',
  'reflection_turns',
  'feedback',
  'goals',
  'slack_feedback',
];

/**
 * Hand every `default` row to the owner, once there is one. Idempotent: after
 * the first boot there are none left. A row the owner already has under their
 * login (same key) stays where it is rather than failing the boot.
 */
export async function claimDefaultRows(): Promise<void> {
  const first = owner();
  if (!first) return;
  const sql = db();
  for (const table of USER_TABLES) {
    try {
      const moved = await sql.unsafe(`UPDATE ${table} SET user_id = $1 WHERE user_id = 'default'`, [first.login]);
      if (moved.count) console.log(`[team] ${moved.count} ${table} rows are now ${first.login}'s`);
    } catch (err) {
      console.error(`[team] could not hand ${table} rows to ${first.login}:`, err);
    }
  }
}
