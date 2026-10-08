/**
 * Every query against the plate. One table, `items`, three sources.
 */

import { db } from './db/client.ts';

const USER = 'default';

export type Source = 'board' | 'mention' | 'reaction';

export type Item = {
  id: number;
  source: Source;
  externalId: string;
  title: string;
  url: string;
  /** `astropods/astro#1377` for a card, `#channel` for Slack. */
  context: string;
  author: string;
  /** The board column. Empty for Slack. */
  status: string;
  /** Which boards the card is on, by title. */
  boards: string[];
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
  done_at: Date | null;
  done_by: 'you' | 'board' | null;
  added_at: Date;
};

const COLUMNS =
  'id, source, external_id, title, url, context, author, status, boards, done_at, done_by, added_at';

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

export type BoardCard = {
  externalId: string;
  title: string;
  url: string;
  context: string;
  status: string;
  boards: string[];
  done: boolean;
};

/**
 * Make the stored cards match the boards.
 *
 * A card the boards call Done is cleared by the board. A card no longer
 * assigned to you is cleared too, since it is off your plate either way. A
 * card the board reopens comes back, unless you cleared it yourself.
 */
export async function syncBoard(cards: BoardCard[]): Promise<{ added: number; cleared: number }> {
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
                 status = ${card.status}, boards = ${tx.json(card.boards)}, updated_at = now(),
                 done_at = coalesce(done_at, now()),
                 done_by = coalesce(done_by, 'board')
           WHERE user_id = ${USER} AND source = 'board' AND external_id = ${card.externalId}
        `;
        continue;
      }
      // Open on the boards: back on the plate, unless you cleared it yourself.
      const [row] = await tx<{ inserted: boolean }[]>`
        INSERT INTO items (user_id, source, external_id, title, url, context, status, boards)
        VALUES (${USER}, 'board', ${card.externalId}, ${card.title}, ${card.url},
                ${card.context}, ${card.status}, ${tx.json(card.boards)})
        ON CONFLICT (user_id, source, external_id) DO UPDATE
           SET title = EXCLUDED.title,
               url = EXCLUDED.url,
               context = EXCLUDED.context,
               status = EXCLUDED.status,
               boards = EXCLUDED.boards,
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
       WHERE user_id = ${USER} AND source = 'board' AND done_at IS NULL
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

export async function openCount(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM items WHERE user_id = ${USER} AND done_at IS NULL
  `;
  return row?.n ?? 0;
}
