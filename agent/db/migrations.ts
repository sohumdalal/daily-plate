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
  {
    // Your open PRs and assigned issues across whole orgs, beside the boards.
    id: '0004_repo_sources',
    sql: `
      ALTER TABLE items DROP CONSTRAINT IF EXISTS items_source_check;
      ALTER TABLE items ADD CONSTRAINT items_source_check
        CHECK (source IN ('board','pr','issue','mention','reaction'));
    `,
  },
  {
    // Tasks you type in yourself, and your own notes on any item, oldest
    // first, as [{ id, text, at }]. A sync never touches the notes.
    id: '0005_tasks_notes',
    sql: `
      ALTER TABLE items DROP CONSTRAINT IF EXISTS items_source_check;
      ALTER TABLE items ADD CONSTRAINT items_source_check
        CHECK (source IN ('board','pr','issue','mention','reaction','task'));
      ALTER TABLE items ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'::jsonb;
    `,
  },
  // The Wrap tab's tables, with the ids Daily Wrap gave them: a database that
  // already holds Daily Wrap's schema has them applied, so none runs twice.
  {
    // Daily Wrap replaces Mentor's weekly model. The old tables held nothing
    // worth carrying across — goals, ISO-week snapshots and a reading log, all
    // superseded by per-day records and period wraps.
    id: '0002_daily_wrap',
    sql: `
      DROP TABLE IF EXISTS goals;
      DROP TABLE IF EXISTS week_snapshots;
      DROP TABLE IF EXISTS ingestion_runs;

      -- One row per civil day, holding the raw material a wrap is written from.
      CREATE TABLE IF NOT EXISTS days (
        day          DATE NOT NULL,
        user_id      TEXT NOT NULL DEFAULT 'default',
        claude       JSONB,
        github       JSONB,
        collected_at TIMESTAMPTZ,
        PRIMARY KEY (day, user_id)
      );

      -- What the agent wrote, for any period. "did" is what happened;
      -- "learned" and "grew" are the point of keeping the record at all.
      CREATE TABLE IF NOT EXISTS wraps (
        period       TEXT NOT NULL CHECK (period IN ('day','week','month','year')),
        key          TEXT NOT NULL,
        user_id      TEXT NOT NULL DEFAULT 'default',
        headline     TEXT NOT NULL DEFAULT '',
        did          JSONB NOT NULL DEFAULT '[]'::jsonb,
        learned      JSONB NOT NULL DEFAULT '[]'::jsonb,
        grew         JSONB NOT NULL DEFAULT '[]'::jsonb,
        model        TEXT,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (period, key, user_id)
      );
      CREATE INDEX IF NOT EXISTS wraps_period_key ON wraps(user_id, period, key DESC);

      -- What you wrote. Keyed the same way as wraps, so a week or a year can
      -- carry a reflection of its own.
      CREATE TABLE IF NOT EXISTS reflections (
        period     TEXT NOT NULL CHECK (period IN ('day','week','month','year')),
        key        TEXT NOT NULL,
        user_id    TEXT NOT NULL DEFAULT 'default',
        body       TEXT NOT NULL DEFAULT '',
        energy     SMALLINT CHECK (energy IS NULL OR energy BETWEEN 1 AND 5),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (period, key, user_id)
      );
      CREATE INDEX IF NOT EXISTS reflections_period_key
        ON reflections(user_id, period, key DESC);
    `,
  },
  {
    // "learned" became a paragraph rather than a list: it is the agent's read
    // on the period, and it sits beside the person's own reflection. Existing
    // rows hold arrays, so join them instead of discarding them.
    //
    // "feedback" is the correction channel. Disagreeing with a wrap records a
    // note here, and every later generation is shown these notes — so the
    // agent's read gets less wrong over time instead of being wrong the same
    // way forever.
    id: '0003_learned_paragraph_and_feedback',
    sql: `
      UPDATE wraps
         SET learned = to_jsonb(
               (SELECT string_agg(item, ' ')
                  FROM jsonb_array_elements_text(learned) AS item)
             )
       WHERE jsonb_typeof(learned) = 'array';

      UPDATE wraps SET learned = '""'::jsonb WHERE learned IS NULL;

      CREATE TABLE IF NOT EXISTS feedback (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    TEXT NOT NULL DEFAULT 'default',
        period     TEXT NOT NULL CHECK (period IN ('day','week','month','year')),
        key        TEXT NOT NULL,
        note       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS feedback_recent
        ON feedback(user_id, created_at DESC);
    `,
  },
  {
    // Goals are an input to every generated wrap, not a separate tracker. The
    // point of "where to improve" is that it is measured against what this
    // person is actually trying to become, which the day's diffs cannot say.
    //
    // "why" holds the intrinsic anchor — the reason the goal matters to them.
    // Career goals without it drift into someone else's ladder.
    id: '0004_goals',
    sql: `
      CREATE TABLE IF NOT EXISTS goals (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    TEXT NOT NULL DEFAULT 'default',
        title      TEXT NOT NULL,
        category   TEXT NOT NULL DEFAULT 'career'
                   CHECK (category IN ('career','craft','impact','personal','intrinsic')),
        horizon    TEXT NOT NULL DEFAULT 'year'
                   CHECK (horizon IN ('quarter','year','long')),
        why        TEXT NOT NULL DEFAULT '',
        measure    TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','paused','achieved','dropped')),
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS goals_active
        ON goals(user_id, status, category, sort);
    `,
  },
  {
    // Append-only history of every wrap ever written, including the current
    // one — so the table alone is the complete record and nothing has to be
    // reconstructed by joining against `wraps`.
    //
    // `reason` is the interesting column: it separates a plain re-wrap from a
    // rewrite the person forced by disagreeing, which is what makes this a
    // record of how the agent's read of them changed rather than just a log.
    //
    // Existing wraps are backfilled as version 1 so no history starts partial.
    id: '0005_wrap_versions',
    sql: `
      CREATE TABLE IF NOT EXISTS wrap_versions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      TEXT NOT NULL DEFAULT 'default',
        period       TEXT NOT NULL CHECK (period IN ('day','week','month','year')),
        key          TEXT NOT NULL,
        version      INTEGER NOT NULL,
        headline     TEXT NOT NULL DEFAULT '',
        did          JSONB NOT NULL DEFAULT '[]'::jsonb,
        learned      JSONB NOT NULL DEFAULT '""'::jsonb,
        grew         JSONB NOT NULL DEFAULT '[]'::jsonb,
        model        TEXT,
        reason       TEXT NOT NULL DEFAULT 'wrap'
                     CHECK (reason IN ('wrap','disagree')),
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (period, key, user_id, version)
      );
      CREATE INDEX IF NOT EXISTS wrap_versions_for_key
        ON wrap_versions(user_id, period, key, version DESC);

      INSERT INTO wrap_versions
             (user_id, period, key, version, headline, did, learned, grew, model,
              reason, generated_at)
      SELECT user_id, period, key, 1, headline, did, learned, grew, model,
             'wrap', generated_at
        FROM wraps
       WHERE NOT EXISTS (
         SELECT 1 FROM wrap_versions v
          WHERE v.period = wraps.period AND v.key = wraps.key
            AND v.user_id = wraps.user_id
       );
    `,
  },
  {
    // Reflecting is a conversation now, not a textarea. The agent asks, the
    // person answers, and the point of it is the three takeaways they end up
    // with: one thing that went well, one that did not, one to improve.
    //
    // `body` on reflections is kept and derived from the person's own turns, so
    // every prompt that already treats it as their authoritative account keeps
    // working without change.
    id: '0006_reflection_conversation',
    sql: `
      CREATE TABLE IF NOT EXISTS reflection_turns (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    TEXT NOT NULL DEFAULT 'default',
        period     TEXT NOT NULL CHECK (period IN ('day','week','month','year')),
        key        TEXT NOT NULL,
        role       TEXT NOT NULL CHECK (role IN ('agent','person')),
        text       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS reflection_turns_thread
        ON reflection_turns(user_id, period, key, created_at);

      ALTER TABLE reflections ADD COLUMN IF NOT EXISTS good    TEXT NOT NULL DEFAULT '';
      ALTER TABLE reflections ADD COLUMN IF NOT EXISTS bad     TEXT NOT NULL DEFAULT '';
      ALTER TABLE reflections ADD COLUMN IF NOT EXISTS improve TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // Slack feedback, captured by reacting :brain: to a message. A third
    // ingestion source, and the first that is marked by hand: reacting is a
    // judgement that this mattered, which unfiltered channel history is not.
    //
    // `day` is the civil date the reaction happened on, so a capture joins the
    // day it was noticed rather than the day the message was written.
    id: '0007_slack_feedback',
    sql: `
      CREATE TABLE IF NOT EXISTS slack_feedback (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     TEXT NOT NULL DEFAULT 'default',
        day         DATE NOT NULL,
        channel_id  TEXT NOT NULL,
        channel_name TEXT NOT NULL DEFAULT '',
        message_ts  TEXT NOT NULL,
        thread_root TEXT NOT NULL DEFAULT '',
        reactor_id  TEXT NOT NULL DEFAULT '',
        emoji       TEXT NOT NULL DEFAULT 'brain',
        text        TEXT NOT NULL,
        permalink   TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, channel_id, message_ts, emoji)
      );
      CREATE INDEX IF NOT EXISTS slack_feedback_by_day
        ON slack_feedback(user_id, day DESC, created_at DESC);
    `,
  },
  {
    id: '0008_slack_author',
    sql: `
      ALTER TABLE slack_feedback
        ADD COLUMN IF NOT EXISTS author_id   TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // One reaction per person, not one per message. The old key left out the
    // reactor, so a second person reacting upserted onto the first person's
    // row and their capture was lost with nothing logged.
    id: '0009_slack_one_row_per_reactor',
    sql: `
      ALTER TABLE slack_feedback
        DROP CONSTRAINT IF EXISTS slack_feedback_user_id_channel_id_message_ts_emoji_key;
      ALTER TABLE slack_feedback
        ADD CONSTRAINT slack_feedback_one_per_reactor
        UNIQUE (user_id, channel_id, message_ts, emoji, reactor_id);
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
