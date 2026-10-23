/**
 * The Notifications tab: every time someone @-mentioned you, on GitHub or in
 * Slack, newest first, each read or unread.
 *
 * GitHub is read every READ_EVERY_MS (sources/mentions.ts). Slack mentions
 * arrive as they happen, from the same stream that plates them (slack.ts).
 * Unlike the plate, nothing here is ever cleared by a source: a notification
 * is a record that someone asked for you, and only you mark it read.
 */

import { config, readiness } from './config.ts';
import { db } from './db/client.ts';
import { fetchMentions, type MentionKind } from './sources/mentions.ts';
import { gh } from './sources/github.ts';
import { slackLinkOf } from './slack-link.ts';
import { asUser, currentUser, team } from './users.ts';

const READ_EVERY_MS = 2 * 60_000;
/** How far back the first read after a boot looks. Rows already stored keep their read state. */
const LOOKBACK_MS = 7 * 86_400_000;
/** Each read starts this long before the last one did, for comments that index late. */
const OVERLAP_MS = 5 * 60_000;
/** The most the tab lists. */
const LIMIT = 200;

export type NotificationSource = 'github' | 'slack';

export type Notification = {
  id: number;
  source: NotificationSource;
  /** How you were mentioned: on GitHub a MentionKind, in Slack `mention`. */
  kind: MentionKind | 'mention';
  title: string;
  body: string;
  url: string;
  context: string;
  author: string;
  at: string;
  readAt: string | null;
};

type Row = {
  id: string;
  source: NotificationSource;
  external_id: string;
  kind: Notification['kind'];
  title: string;
  body: string;
  url: string;
  context: string;
  author: string;
  at: Date;
  read_at: Date | null;
};

function toNotification(row: Row): Notification {
  return {
    id: Number(row.id),
    source: row.source,
    kind: row.kind,
    title: row.title,
    body: row.body,
    // Slack rows from before there was a link: rebuilt from `channel:ts`.
    url: row.url || (row.source === 'slack' ? slackLinkOf(row.external_id) : ''),
    context: row.context,
    author: row.author,
    at: row.at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  };
}

const COLUMNS = 'id, source, external_id, kind, title, body, url, context, author, at, read_at';

type Input = Omit<Notification, 'id' | 'readAt'> & { externalId: string };

/** Store each, once. An edited comment updates its text and keeps its read state. */
export async function add(list: Input[]): Promise<number> {
  if (!list.length) return 0;
  const sql = db();
  let added = 0;
  await sql.begin(async (tx) => {
    for (const n of list) {
      const [row] = await tx<{ inserted: boolean }[]>`
        INSERT INTO notifications (user_id, source, kind, external_id, title, body, url, context, author, at)
        VALUES (${currentUser()}, ${n.source}, ${n.kind}, ${n.externalId}, ${n.title}, ${n.body}, ${n.url},
                ${n.context}, ${n.author}, ${n.at})
        ON CONFLICT (user_id, source, external_id) DO UPDATE
           SET title = EXCLUDED.title, body = EXCLUDED.body
        RETURNING (xmax = 0) AS inserted
      `;
      if (row?.inserted) added++;
    }
  });
  return added;
}

export async function list(): Promise<Notification[]> {
  const sql = db();
  const rows = await sql<Row[]>`
    SELECT ${sql.unsafe(COLUMNS)} FROM notifications
     WHERE user_id = ${currentUser()}
     ORDER BY at DESC
     LIMIT ${LIMIT}
  `;
  return rows.map(toNotification);
}

export async function unreadCount(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM notifications WHERE user_id = ${currentUser()} AND read_at IS NULL
  `;
  return row?.n ?? 0;
}

export async function setRead(id: number, read: boolean): Promise<Notification | null> {
  const sql = db();
  const rows = await sql<Row[]>`
    UPDATE notifications
       SET read_at = ${read ? sql`coalesce(read_at, now())` : null}
     WHERE user_id = ${currentUser()} AND id = ${id}
    RETURNING ${sql.unsafe(COLUMNS)}
  `;
  return rows[0] ? toNotification(rows[0]) : null;
}

export async function readAll(): Promise<number> {
  const result = await db()`
    UPDATE notifications SET read_at = now() WHERE user_id = ${currentUser()} AND read_at IS NULL
  `;
  return result.count;
}

// ── Reading GitHub ──────────────────────────────────────────────────────────

export type MentionSync = { at: string; ok: boolean; added: number; error?: string };

/** Each member's last read, by login. */
const last = new Map<string, MentionSync>();
const running = new Map<string, Promise<MentionSync>>();
/** Where each member's next read starts. Unset until a read succeeds, so a failure retries the same window. */
const since = new Map<string, number>();

export function lastMentionSync(): MentionSync | null {
  return last.get(currentUser()) ?? null;
}

/** The current member's read. One at a time each; a second caller waits on the first. */
export function syncMentions(): Promise<MentionSync> {
  const login = currentUser();
  let read = running.get(login);
  if (!read) {
    read = readMentions(login).finally(() => running.delete(login));
    running.set(login, read);
  }
  return read;
}

async function readMentions(login: string): Promise<MentionSync> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  let result: MentionSync;
  try {
    if (!readiness().github) {
      throw new Error('a GitHub App or GITHUB_TOKEN is needed to read mentions');
    }
    const from = new Date((since.get(login) ?? started - LOOKBACK_MS) - OVERLAP_MS);
    const found = await fetchMentions(gh(), login, config.github.orgs, from);
    const added = await add(found.map((m) => ({ ...m, source: 'github' as const })));
    since.set(login, started);
    result = { at, ok: true, added };
    if (added) console.log(`[mentions] ${login}: ${added} new on GitHub`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    result = { at, ok: false, added: 0, error };
    console.error(`[mentions] GitHub read for ${login} failed:`, error);
  }
  last.set(login, result);
  return result;
}

/** Everyone on the team, one after another. */
async function readTeam(): Promise<void> {
  for (const member of team()) await asUser(member, syncMentions);
}

export function startMentionSync(): void {
  void readTeam();
  setInterval(() => void readTeam(), READ_EVERY_MS);
}
