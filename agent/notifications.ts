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

const USER = 'default';
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
    url: row.url,
    context: row.context,
    author: row.author,
    at: row.at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  };
}

const COLUMNS = 'id, source, kind, title, body, url, context, author, at, read_at';

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
        VALUES (${USER}, ${n.source}, ${n.kind}, ${n.externalId}, ${n.title}, ${n.body}, ${n.url},
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
     WHERE user_id = ${USER}
     ORDER BY at DESC
     LIMIT ${LIMIT}
  `;
  return rows.map(toNotification);
}

export async function unreadCount(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM notifications WHERE user_id = ${USER} AND read_at IS NULL
  `;
  return row?.n ?? 0;
}

export async function setRead(id: number, read: boolean): Promise<Notification | null> {
  const sql = db();
  const rows = await sql<Row[]>`
    UPDATE notifications
       SET read_at = ${read ? sql`coalesce(read_at, now())` : null}
     WHERE user_id = ${USER} AND id = ${id}
    RETURNING ${sql.unsafe(COLUMNS)}
  `;
  return rows[0] ? toNotification(rows[0]) : null;
}

export async function readAll(): Promise<number> {
  const result = await db()`
    UPDATE notifications SET read_at = now() WHERE user_id = ${USER} AND read_at IS NULL
  `;
  return result.count;
}

// ── Reading GitHub ──────────────────────────────────────────────────────────

export type MentionSync = { at: string; ok: boolean; added: number; error?: string };

let last: MentionSync | null = null;
let running: Promise<MentionSync> | null = null;
/** Where the next read starts. Unset until a read succeeds, so a failure retries the same window. */
let since: number | null = null;

export function lastMentionSync(): MentionSync | null {
  return last;
}

/** One read at a time; a second caller waits on the first. */
export function syncMentions(): Promise<MentionSync> {
  running ??= (async () => {
    const started = Date.now();
    const at = new Date(started).toISOString();
    try {
      if (!readiness().github) {
        throw new Error('GITHUB_USERNAME and a GitHub App or GITHUB_TOKEN are needed to read mentions');
      }
      const from = new Date((since ?? started - LOOKBACK_MS) - OVERLAP_MS);
      const found = await fetchMentions(gh(), config.github.username, config.github.orgs, from);
      const added = await add(found.map((m) => ({ ...m, source: 'github' as const })));
      since = started;
      last = { at, ok: true, added };
      if (added) console.log(`[mentions] ${added} new on GitHub`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      last = { at, ok: false, added: 0, error };
      console.error('[mentions] GitHub read failed:', error);
    }
    return last;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startMentionSync(): void {
  void syncMentions();
  setInterval(() => void syncMentions(), READ_EVERY_MS);
}
