import { db } from './client.ts';

/**
 * Bring the schema to current. Idempotent — safe to call on every boot.
 * Migrations are append-only; never edit an existing migration, add a new one.
 */
const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '0001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    // One row per thing on the plate, from any source. external_id is the
    // source's own identity — an issue URL, or channel:ts for Slack — so a
    // re-sync or a second reaction updates the row instead of duplicating it.
    id: '0002_items',
    sql: `
      CREATE TABLE IF NOT EXISTS items (
        id           BIGSERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL DEFAULT 'default',
        source       TEXT NOT NULL CHECK (source IN ('board','mention','reaction')),
        external_id  TEXT NOT NULL,
        title        TEXT NOT NULL,
        url          TEXT NOT NULL DEFAULT '',
        context      TEXT NOT NULL DEFAULT '',
        author       TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT '',
        boards       JSONB NOT NULL DEFAULT '[]'::jsonb,
        done_at      TIMESTAMPTZ,
        -- Who cleared it: 'you' from the screen, 'board' when the board says
        -- Done. A card you cleared stays cleared whatever the board says next.
        done_by      TEXT CHECK (done_by IS NULL OR done_by IN ('you','board')),
        added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, source, external_id)
      );
      CREATE INDEX IF NOT EXISTS items_open ON items(user_id, done_at);
    `,
  },
  {
    // Where a card is in its life (open … merged), and the PR or branch
    // tackling it. Both are recomputed on every board read.
    id: '0003_ticket_state',
    sql: `
      ALTER TABLE items ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '';
      ALTER TABLE items ADD COLUMN IF NOT EXISTS work JSONB;
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const sql = db();
  await sql.unsafe(MIGRATIONS[0]!.sql);
  const applied = new Set(
    (await sql<{ id: string }[]>`SELECT id FROM schema_migrations`).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx`INSERT INTO schema_migrations (id) VALUES (${m.id})`;
    });
    console.log(`[db] applied ${m.id}`);
  }
}
