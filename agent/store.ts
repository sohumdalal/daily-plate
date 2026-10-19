/**
 * Every query against the plate. One table, `items`, six sources.
 */

import { db } from './db/client.ts';

const USER = 'default';

export type Source = 'board' | 'pr' | 'issue' | 'mention' | 'reaction' | 'task';

/** The sources read from GitHub, each replaced whole on every sync. */
export type GitHubSource = 'board' | 'pr' | 'issue';

/** Where a card is in its life. Empty for Slack items, which are not tickets. */
export type TicketState =
  | 'open'
  | 'in_progress'
  | 'branch'
  | 'draft'
  | 'in_review'
  | 'changes'
  | 'approved'
  | 'merged'
  | 'closed'
  | 'not_planned';

/** The PR or branch tackling a card, and how it was found. */
export type WorkRef = {
  kind: 'pr' | 'branch';
  repo: string;
  url: string;
  number?: number;
  title?: string;
  branch?: string;
  prState?: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft?: boolean;
  review?: string | null;
  /** Who commented on the PR, by person. Not read for a PR that only mentions the card. */
  comments?: { login: string; count: number }[];
  /** Where an open PR sits in a stack of PRs, and the stack's PRs, from the bottom. Absent when it stands alone. */
  stack?: { position: number; total: number; prs: { number: number; title: string; url: string }[] };
  via: 'self' | 'linked' | 'branch-name' | 'mentioned';
};

export type Note = { id: string; text: string; at: string };

export type Item = {
  id: number;
  source: Source;
  externalId: string;
  title: string;
  url: string;
  /** `astropods/astro#1377` for a card, PR or issue, `#channel` for Slack. */
  context: string;
  author: string;
  /** The board column. Empty for Slack. */
  status: string;
  /** Which boards the card is on, by title. */
  boards: string[];
  state: TicketState | '';
  work: WorkRef | null;
  /** Your own notes on the item, oldest first. */
  notes: Note[];
  doneAt: string | null;
  doneBy: 'you' | 'board' | null;
  addedAt: string;
};

type ItemRow = {
  id: string;
  source: Source;
  external_id: string;
  title: string;
  url: string;
  context: string;
  author: string;
  status: string;
  boards: string[];
  state: TicketState | '';
  work: WorkRef | null;
  notes: Note[];
  done_at: Date | null;
  done_by: 'you' | 'board' | null;
  added_at: Date;
};

const COLUMNS =
  'id, source, external_id, title, url, context, author, status, boards, state, work, notes, ' +
  'done_at, done_by, added_at';

function toItem(row: ItemRow): Item {
  return {
    id: Number(row.id),
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    url: row.url,
    context: row.context,
    author: row.author,
    status: row.status,
    boards: row.boards,
    state: row.state,
    work: row.work,
    notes: row.notes,
    doneAt: row.done_at?.toISOString() ?? null,
    doneBy: row.done_by,
    addedAt: row.added_at.toISOString(),
  };
}

/** Everything still on the plate, plus whatever was cleared today. */
export async function plate(today: string, timezone: string): Promise<Item[]> {
  const sql = db();
  const rows = await sql<ItemRow[]>`
    SELECT ${sql.unsafe(COLUMNS)}
      FROM items
     WHERE user_id = ${USER}
       AND (done_at IS NULL OR (done_at AT TIME ZONE ${timezone})::date = ${today}::date)
     ORDER BY done_at IS NOT NULL, added_at DESC
  `;
  return rows.map(toItem);
}

/** Everything cleared before today, newest first, for All activity. */
export async function history(today: string, timezone: string): Promise<Item[]> {
  const sql = db();
  const rows = await sql<ItemRow[]>`
    SELECT ${sql.unsafe(COLUMNS)}
      FROM items
     WHERE user_id = ${USER}
       AND done_at IS NOT NULL
       AND (done_at AT TIME ZONE ${timezone})::date < ${today}::date
     ORDER BY done_at DESC
  `;
  return rows.map(toItem);
}

export type BoardCard = {
  externalId: string;
  title: string;
  url: string;
  context: string;
  status: string;
  boards: string[];
  done: boolean;
  state: TicketState;
  work: WorkRef | null;
};

/**
 * Make the stored cards of one source match what GitHub says.
 *
 * A card the boards call Done is cleared by the board. A card no longer
 * assigned to you — or a PR or issue no longer open — is cleared too, since
 * it is off your plate either way; `done_by` says 'board' for all of these.
 * A card GitHub reopens comes back, unless you cleared it yourself.
 */
export async function syncSource(
  source: GitHubSource,
  cards: BoardCard[],
): Promise<{ added: number; cleared: number }> {
  const sql = db();
  return sql.begin(async (tx) => {
    let added = 0;
    for (const card of cards) {
      if (card.done) {
        // Only clears what is already on the plate. A card first seen in Done
        // was never on it, and storing one would read as cleared today.
        await tx`
          UPDATE items
             SET title = ${card.title}, url = ${card.url}, context = ${card.context},
                 status = ${card.status}, boards = ${tx.json(card.boards)},
                 state = ${card.state}, work = ${card.work ? tx.json(card.work) : null},
                 updated_at = now(),
                 done_at = coalesce(done_at, now()),
                 done_by = coalesce(done_by, 'board')
           WHERE user_id = ${USER} AND source = ${source} AND external_id = ${card.externalId}
        `;
        continue;
      }
      // Open on the boards: back on the plate, unless you cleared it yourself.
      const [row] = await tx<{ inserted: boolean }[]>`
        INSERT INTO items (user_id, source, external_id, title, url, context, status, boards,
                           state, work)
        VALUES (${USER}, ${source}, ${card.externalId}, ${card.title}, ${card.url},
                ${card.context}, ${card.status}, ${tx.json(card.boards)},
                ${card.state}, ${card.work ? tx.json(card.work) : null})
        ON CONFLICT (user_id, source, external_id) DO UPDATE
           SET title = EXCLUDED.title,
               url = EXCLUDED.url,
               context = EXCLUDED.context,
               status = EXCLUDED.status,
               boards = EXCLUDED.boards,
               state = EXCLUDED.state,
               work = EXCLUDED.work,
               updated_at = now(),
               done_at = CASE WHEN items.done_by = 'you' THEN items.done_at END,
               done_by = CASE WHEN items.done_by = 'you' THEN 'you' END
        RETURNING (xmax = 0) AS inserted
      `;
      if (row?.inserted) added++;
    }

    const ids = cards.map((c) => c.externalId);
    const gone = await tx`
      UPDATE items
         SET done_at = now(), done_by = 'board', updated_at = now()
       WHERE user_id = ${USER} AND source = ${source} AND done_at IS NULL
         AND NOT (external_id = ANY(${ids}::text[]))
    `;
    return { added, cleared: gone.count };
  });
}

/** A Slack message, from a reaction or a mention. Re-delivery updates in place. */
export async function addSlackItem(input: {
  source: 'mention' | 'reaction';
  externalId: string;
  title: string;
  url: string;
  context: string;
  author: string;
}): Promise<{ item: Item; isNew: boolean }> {
  const sql = db();
  const rows = await sql<(ItemRow & { inserted: boolean })[]>`
    INSERT INTO items (user_id, source, external_id, title, url, context, author)
    VALUES (${USER}, ${input.source}, ${input.externalId}, ${input.title}, ${input.url},
            ${input.context}, ${input.author})
    ON CONFLICT (user_id, source, external_id) DO UPDATE
       SET title = EXCLUDED.title,
           url = coalesce(nullif(EXCLUDED.url, ''), items.url),
           context = coalesce(nullif(EXCLUDED.context, ''), items.context),
           author = coalesce(nullif(EXCLUDED.author, ''), items.author),
           updated_at = now()
    RETURNING ${sql.unsafe(COLUMNS)}, (xmax = 0) AS inserted
  `;
  const row = rows[0]!;
  return { item: toItem(row), isNew: row.inserted };
}

/** A task you typed in. It has no source to sync, so only you clear it. */
export async function addTask(title: string): Promise<Item> {
  const sql = db();
  const rows = await sql<ItemRow[]>`
    INSERT INTO items (user_id, source, external_id, title)
    VALUES (${USER}, 'task', ${crypto.randomUUID()}, ${title})
    RETURNING ${sql.unsafe(COLUMNS)}
  `;
  return toItem(rows[0]!);
}

export async function addNote(id: number, text: string): Promise<Item | null> {
  const sql = db();
  const note: Note = { id: crypto.randomUUID(), text, at: new Date().toISOString() };
  const rows = await sql<ItemRow[]>`
    UPDATE items SET notes = notes || ${sql.json([note])}, updated_at = now()
     WHERE id = ${id} AND user_id = ${USER}
    RETURNING ${sql.unsafe(COLUMNS)}
  `;
  return rows[0] ? toItem(rows[0]) : null;
}

export async function deleteNote(id: number, noteId: string): Promise<Item | null> {
  const sql = db();
  const rows = await sql<ItemRow[]>`
    UPDATE items
       SET notes = coalesce(
             (SELECT jsonb_agg(n) FROM jsonb_array_elements(notes) n WHERE n->>'id' <> ${noteId}),
             '[]'::jsonb),
           updated_at = now()
     WHERE id = ${id} AND user_id = ${USER}
    RETURNING ${sql.unsafe(COLUMNS)}
  `;
  return rows[0] ? toItem(rows[0]) : null;
}

/** Clear an item from the screen, or put it back. */
export async function setDone(id: number, done: boolean): Promise<Item | null> {
  const sql = db();
  const rows = await sql<ItemRow[]>`
    UPDATE items
       SET done_at = ${done ? sql`now()` : null},
           done_by = ${done ? 'you' : null},
           updated_at = now()
     WHERE id = ${id} AND user_id = ${USER}
    RETURNING ${sql.unsafe(COLUMNS)}
  `;
  return rows[0] ? toItem(rows[0]) : null;
}

/** Delete a task for good. Only tasks: a synced item would come back. */
export async function deleteTask(id: number): Promise<boolean> {
  const rows = await db()`
    DELETE FROM items WHERE id = ${id} AND user_id = ${USER} AND source = 'task' RETURNING id
  `;
  return rows.length > 0;
}

/** Takes a Slack message off the plate, as the given sources put it there. */
export async function removeSlackItem(
  externalId: string,
  sources: ('mention' | 'reaction')[],
): Promise<boolean> {
  const rows = await db()`
    DELETE FROM items
     WHERE user_id = ${USER} AND source IN ${db()(sources)} AND external_id = ${externalId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function openCount(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM items WHERE user_id = ${USER} AND done_at IS NULL
  `;
  return row?.n ?? 0;
}
