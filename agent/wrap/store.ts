/**
 * Every read and write against Postgres. Nothing else in the agent issues SQL.
 */

import { db } from '../db/client.ts';
import type { Period } from '../time.ts';
import type {
  ClaudeDay,
  DayRecord,
  Feedback,
  GitHubDay,
  Goal,
  Reflection,
  ReflectionTurn,
  SlackFeedback,
  Wrap,
  WrapReason,
  WrapVersion,
} from './types.ts';

/** Single-user today, but every row is tagged so that needn't stay true. */
const USER = 'default';

type DayRow = {
  day: Date;
  claude: ClaudeDay | null;
  github: GitHubDay | null;
  collected_at: Date | null;
};

function toDay(row: DayRow): DayRecord {
  return {
    day: row.day.toISOString().slice(0, 10),
    claude: row.claude,
    github: row.github,
    collectedAt: row.collected_at?.toISOString() ?? null,
  };
}

export async function getDay(day: string): Promise<DayRecord | null> {
  const rows = await db()<DayRow[]>`
    SELECT day, claude, github, collected_at
      FROM days
     WHERE user_id = ${USER} AND day = ${day}
  `;
  return rows[0] ? toDay(rows[0]) : null;
}

export async function getDays(from: string, to: string): Promise<DayRecord[]> {
  const rows = await db()<DayRow[]>`
    SELECT day, claude, github, collected_at
      FROM days
     WHERE user_id = ${USER} AND day BETWEEN ${from} AND ${to}
     ORDER BY day
  `;
  return rows.map(toDay);
}

/**
 * How much signal a capture holds. Used to decide whether a fresh collect is
 * an improvement on what is already stored, or a regression.
 */
function claudeSignal(day: ClaudeDay | null): number {
  if (!day) return 0;
  const t = day.totals;
  return t.prompts + t.sessions + t.toolCalls;
}

function githubSignal(day: GitHubDay | null): number {
  if (!day) return 0;
  const t = day.totals;
  return t.commits + t.opened + t.merged + t.reviewed;
}

/**
 * Store a day's raw material, keeping the richer capture per source.
 *
 * Re-collecting is normal — you wrap at noon and again at midnight — but it is
 * not always an improvement. Claude Code prunes and rotates its transcripts,
 * so re-reading a day weeks later can return less than was captured at the
 * time; a GitHub token can lose access to a repo it could once see. Blindly
 * taking the newer result means a permanent record quietly degrades as it
 * ages, which defeats the point of keeping it.
 *
 * So a source is replaced only when the new capture holds at least as much
 * signal as the stored one. The two sources are judged independently: a
 * GitHub outage should not cost you the day's Claude record.
 *
 * `force` is for repairing a day whose stored capture is wrong rather than
 * merely thinner, which the signal comparison cannot tell apart.
 *
 * Done in a transaction because it is a read-then-write; concurrent collects of
 * the same day would otherwise be able to interleave.
 */
export async function saveDay(
  day: string,
  claude: ClaudeDay | null,
  github: GitHubDay | null,
  opts: { force?: boolean } = {},
): Promise<DayRecord> {
  const sql = db();
  return sql.begin(async (tx) => {
    const existing = await tx<DayRow[]>`
      SELECT day, claude, github, collected_at
        FROM days
       WHERE user_id = ${USER} AND day = ${day}
         FOR UPDATE
    `;
    const stored = existing[0];

    const keepClaude =
      stored && !opts.force && claudeSignal(claude) < claudeSignal(stored.claude)
        ? stored.claude
        : claude;
    const keepGithub =
      stored && !opts.force && githubSignal(github) < githubSignal(stored.github)
        ? stored.github
        : github;

    const rows = await tx<DayRow[]>`
      INSERT INTO days (day, user_id, claude, github, collected_at)
      VALUES (${day}, ${USER}, ${tx.json(keepClaude)}, ${tx.json(keepGithub)}, now())
      ON CONFLICT (day, user_id) DO UPDATE
         SET claude = EXCLUDED.claude,
             github = EXCLUDED.github,
             collected_at = EXCLUDED.collected_at
      RETURNING day, claude, github, collected_at
    `;
    return toDay(rows[0]!);
  });
}

type WrapRow = {
  period: Period;
  key: string;
  headline: string;
  did: string[];
  /** A string since 0003; older rows held an array of bullets. */
  learned: string | string[] | null;
  grew: string[];
  model: string | null;
  generated_at: Date;
};

/**
 * `learned` is a paragraph now. Migration 0003 joined the old arrays, but a row
 * written by an older build could still be an array — so normalise on read
 * rather than trusting the column's shape.
 */
function asParagraph(value: string | string[] | null): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(' ');
  return '';
}

function toWrap(row: WrapRow): Wrap {
  return {
    period: row.period,
    key: row.key,
    headline: row.headline,
    did: row.did ?? [],
    learned: asParagraph(row.learned),
    grew: row.grew ?? [],
    model: row.model,
    generatedAt: row.generated_at.toISOString(),
  };
}

export async function getWrap(period: Period, key: string): Promise<Wrap | null> {
  const rows = await db()<WrapRow[]>`
    SELECT period, key, headline, did, learned, grew, model, generated_at
      FROM wraps
     WHERE user_id = ${USER} AND period = ${period} AND key = ${key}
  `;
  return rows[0] ? toWrap(rows[0]) : null;
}

/** Wraps of one period whose keys fall in `[from, to]`, oldest first. */
export async function getWrapsBetween(
  period: Period,
  from: string,
  to: string,
): Promise<Wrap[]> {
  const rows = await db()<WrapRow[]>`
    SELECT period, key, headline, did, learned, grew, model, generated_at
      FROM wraps
     WHERE user_id = ${USER} AND period = ${period} AND key BETWEEN ${from} AND ${to}
     ORDER BY key
  `;
  return rows.map(toWrap);
}

/**
 * Write a wrap, overwriting the current one and appending to its history.
 *
 * `wraps` holds what is current; `wrap_versions` holds every version ever
 * written, this one included. The duplication is deliberate: the history table
 * is then complete on its own, and reading the current wrap stays a single-row
 * lookup. One transaction, because a version number is derived from the
 * existing rows.
 */
export async function saveWrap(
  wrap: Omit<Wrap, 'generatedAt'>,
  reason: WrapReason = 'wrap',
): Promise<Wrap> {
  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<WrapRow[]>`
      INSERT INTO wraps (period, key, user_id, headline, did, learned, grew, model, generated_at)
      VALUES (
        ${wrap.period}, ${wrap.key}, ${USER}, ${wrap.headline},
        ${tx.json(wrap.did)}, ${tx.json(wrap.learned)}, ${tx.json(wrap.grew)},
        ${wrap.model}, now()
      )
      ON CONFLICT (period, key, user_id) DO UPDATE
         SET headline = EXCLUDED.headline,
             did = EXCLUDED.did,
             learned = EXCLUDED.learned,
             grew = EXCLUDED.grew,
             model = EXCLUDED.model,
             generated_at = EXCLUDED.generated_at
      RETURNING period, key, headline, did, learned, grew, model, generated_at
    `;
    const saved = toWrap(rows[0]!);

    await tx`
      INSERT INTO wrap_versions
             (user_id, period, key, version, headline, did, learned, grew, model,
              reason, generated_at)
      SELECT ${USER}, ${wrap.period}, ${wrap.key},
             coalesce(max(version), 0) + 1,
             ${wrap.headline}, ${tx.json(wrap.did)}, ${tx.json(wrap.learned)},
             ${tx.json(wrap.grew)}, ${wrap.model}, ${reason}, ${saved.generatedAt}
        FROM wrap_versions
       WHERE user_id = ${USER} AND period = ${wrap.period} AND key = ${wrap.key}
    `;

    return saved;
  });
}

type WrapVersionRow = WrapRow & { version: number; reason: WrapReason };

/** Every version of one wrap, newest first. */
export async function listWrapVersions(
  period: Period,
  key: string,
): Promise<WrapVersion[]> {
  const rows = await db()<WrapVersionRow[]>`
    SELECT period, key, headline, did, learned, grew, model, generated_at,
           version, reason
      FROM wrap_versions
     WHERE user_id = ${USER} AND period = ${period} AND key = ${key}
     ORDER BY version DESC
  `;
  return rows.map((row) => ({
    ...toWrap(row),
    version: row.version,
    reason: row.reason,
  }));
}

/** How many times this key has been written. Cheap enough for every view. */
export async function countWrapVersions(
  period: Period,
  key: string,
): Promise<number> {
  const rows = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM wrap_versions
     WHERE user_id = ${USER} AND period = ${period} AND key = ${key}
  `;
  return rows[0]?.n ?? 0;
}

type ReflectionRow = {
  period: Period;
  key: string;
  body: string;
  energy: number | null;
  good: string;
  bad: string;
  improve: string;
  updated_at: Date;
};

function toReflection(row: ReflectionRow): Reflection {
  return {
    period: row.period,
    key: row.key,
    body: row.body,
    energy: row.energy,
    takeaways: {
      good: row.good ?? '',
      bad: row.bad ?? '',
      improve: row.improve ?? '',
    },
    updatedAt: row.updated_at.toISOString(),
  };
}

const REFLECTION_COLUMNS = `period, key, body, energy, good, bad, improve, updated_at`;

export async function getReflection(
  period: Period,
  key: string,
): Promise<Reflection | null> {
  const rows = await db()<ReflectionRow[]>`
    SELECT ${db().unsafe(REFLECTION_COLUMNS)}
      FROM reflections
     WHERE user_id = ${USER} AND period = ${period} AND key = ${key}
  `;
  return rows[0] ? toReflection(rows[0]) : null;
}

export async function getReflectionsBetween(
  period: Period,
  from: string,
  to: string,
): Promise<Reflection[]> {
  const rows = await db()<ReflectionRow[]>`
    SELECT ${db().unsafe(REFLECTION_COLUMNS)}
      FROM reflections
     WHERE user_id = ${USER} AND period = ${period} AND key BETWEEN ${from} AND ${to}
       AND (body <> '' OR good <> '' OR bad <> '' OR improve <> '')
     ORDER BY key
  `;
  return rows.map(toReflection);
}

/** Patch a reflection, leaving out fields alone. */
export async function saveReflection(
  period: Period,
  key: string,
  patch: {
    body?: string;
    energy?: number | null;
    good?: string;
    bad?: string;
    improve?: string;
  },
): Promise<Reflection> {
  const sql = db();
  const rows = await sql<ReflectionRow[]>`
    INSERT INTO reflections (period, key, user_id, body, energy, good, bad, improve, updated_at)
    VALUES (
      ${period}, ${key}, ${USER},
      ${patch.body ?? ''}, ${patch.energy ?? null},
      ${patch.good ?? ''}, ${patch.bad ?? ''}, ${patch.improve ?? ''}, now()
    )
    ON CONFLICT (period, key, user_id) DO UPDATE
       SET body = coalesce(${patch.body ?? null}::text, reflections.body),
           energy = CASE WHEN ${patch.energy !== undefined} THEN ${patch.energy ?? null}::smallint
                         ELSE reflections.energy END,
           good = coalesce(${patch.good ?? null}::text, reflections.good),
           bad = coalesce(${patch.bad ?? null}::text, reflections.bad),
           improve = coalesce(${patch.improve ?? null}::text, reflections.improve),
           updated_at = now()
    RETURNING ${sql.unsafe(REFLECTION_COLUMNS)}
  `;
  return toReflection(rows[0]!);
}

type TurnRow = {
  id: string;
  role: ReflectionTurn['role'];
  text: string;
  created_at: Date;
};

export async function getTurns(period: Period, key: string): Promise<ReflectionTurn[]> {
  const rows = await db()<TurnRow[]>`
    SELECT id, role, text, created_at
      FROM reflection_turns
     WHERE user_id = ${USER} AND period = ${period} AND key = ${key}
     ORDER BY created_at
  `;
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    text: r.text,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Append a turn. A person's turn also refreshes `reflections.body` to the
 * joined text of everything they have said, which is what every wrap prompt
 * already reads as their own account of the period.
 */
export async function addTurn(
  period: Period,
  key: string,
  role: ReflectionTurn['role'],
  text: string,
): Promise<ReflectionTurn[]> {
  const sql = db();
  return sql.begin(async (tx) => {
    await tx`
      INSERT INTO reflection_turns (user_id, period, key, role, text)
      VALUES (${USER}, ${period}, ${key}, ${role}, ${text})
    `;
    const rows = await tx<TurnRow[]>`
      SELECT id, role, text, created_at
        FROM reflection_turns
       WHERE user_id = ${USER} AND period = ${period} AND key = ${key}
       ORDER BY created_at
    `;
    if (role === 'person') {
      const body = rows
        .filter((r) => r.role === 'person')
        .map((r) => r.text)
        .join('\n\n');
      await tx`
        INSERT INTO reflections (period, key, user_id, body, updated_at)
        VALUES (${period}, ${key}, ${USER}, ${body}, now())
        ON CONFLICT (period, key, user_id) DO UPDATE
           SET body = EXCLUDED.body, updated_at = now()
      `;
    }
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      text: r.text,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

type SlackFeedbackRow = {
  id: string;
  day: Date;
  channel_id: string;
  channel_name: string;
  message_ts: string;
  thread_root: string;
  reactor_id: string;
  author_id: string;
  author_name: string;
  emoji: string;
  text: string;
  permalink: string;
  created_at: Date;
};

function toSlackFeedback(row: SlackFeedbackRow): SlackFeedback {
  return {
    id: row.id,
    day: row.day.toISOString().slice(0, 10),
    channelId: row.channel_id,
    channelName: row.channel_name,
    messageTs: row.message_ts,
    threadRoot: row.thread_root,
    reactorId: row.reactor_id,
    authorId: row.author_id,
    authorName: row.author_name,
    emoji: row.emoji,
    text: row.text,
    permalink: row.permalink,
    createdAt: row.created_at.toISOString(),
  };
}

const SLACK_COLUMNS = `id, day, channel_id, channel_name, message_ts,
                       thread_root, reactor_id, author_id, author_name,
                       emoji, text, permalink, created_at`;

/**
 * Store one capture. Reacting twice to the same message is the same capture,
 * so the text is refreshed rather than duplicated. Two *people* reacting are
 * two captures: the reactor is part of the key, or the second one overwrites
 * the first.
 */
export async function addSlackFeedback(input: {
  day: string;
  channelId: string;
  channelName: string;
  messageTs: string;
  threadRoot: string;
  reactorId: string;
  authorId: string;
  authorName: string;
  emoji: string;
  text: string;
  permalink: string;
}): Promise<SlackFeedback> {
  const sql = db();
  const rows = await sql<SlackFeedbackRow[]>`
    INSERT INTO slack_feedback
           (user_id, day, channel_id, channel_name, message_ts, thread_root,
            reactor_id, author_id, author_name, emoji, text, permalink)
    VALUES (${USER}, ${input.day}, ${input.channelId}, ${input.channelName},
            ${input.messageTs}, ${input.threadRoot}, ${input.reactorId},
            ${input.authorId}, ${input.authorName},
            ${input.emoji}, ${input.text}, ${input.permalink})
    ON CONFLICT (user_id, channel_id, message_ts, emoji, reactor_id) DO UPDATE
       SET text = EXCLUDED.text,
           channel_name = coalesce(nullif(EXCLUDED.channel_name, ''),
                                   slack_feedback.channel_name),
           author_id   = coalesce(nullif(EXCLUDED.author_id, ''),
                                  slack_feedback.author_id),
           author_name = coalesce(nullif(EXCLUDED.author_name, ''),
                                  slack_feedback.author_name),
           permalink   = coalesce(nullif(EXCLUDED.permalink, ''),
                                  slack_feedback.permalink)
    RETURNING ${sql.unsafe(SLACK_COLUMNS)}
  `;
  return toSlackFeedback(rows[0]!);
}

export async function listSlackFeedback(limit = 200): Promise<SlackFeedback[]> {
  const rows = await db()<SlackFeedbackRow[]>`
    SELECT ${db().unsafe(SLACK_COLUMNS)}
      FROM slack_feedback
     WHERE user_id = ${USER}
     ORDER BY day DESC, created_at DESC
     LIMIT ${limit}
  `;
  return rows.map(toSlackFeedback);
}

/** Captures inside a span, for the day's prompt and for rollups. */
export async function slackFeedbackBetween(
  from: string,
  to: string,
): Promise<SlackFeedback[]> {
  const rows = await db()<SlackFeedbackRow[]>`
    SELECT ${db().unsafe(SLACK_COLUMNS)}
      FROM slack_feedback
     WHERE user_id = ${USER} AND day BETWEEN ${from} AND ${to}
     ORDER BY day, created_at
  `;
  return rows.map(toSlackFeedback);
}

type GoalRow = {
  id: string;
  title: string;
  category: Goal['category'];
  horizon: Goal['horizon'];
  why: string;
  measure: string;
  status: Goal['status'];
  sort: number;
  created_at: Date;
  updated_at: Date;
};

function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    horizon: row.horizon,
    why: row.why,
    measure: row.measure,
    status: row.status,
    sort: row.sort,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const GOAL_COLUMNS = `id, title, category, horizon, why, measure, status, sort,
                      created_at, updated_at`;

export async function listGoals(): Promise<Goal[]> {
  const rows = await db()<GoalRow[]>`
    SELECT ${db().unsafe(GOAL_COLUMNS)}
      FROM goals
     WHERE user_id = ${USER}
     ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1
                   WHEN 'achieved' THEN 2 ELSE 3 END,
       sort, created_at
  `;
  return rows.map(toGoal);
}

/** Only what the agent should be judging a day against. */
export async function activeGoals(): Promise<Goal[]> {
  const rows = await db()<GoalRow[]>`
    SELECT ${db().unsafe(GOAL_COLUMNS)}
      FROM goals
     WHERE user_id = ${USER} AND status = 'active'
     ORDER BY category, sort, created_at
  `;
  return rows.map(toGoal);
}

export async function createGoal(
  input: Pick<Goal, 'title' | 'category' | 'horizon' | 'why' | 'measure'>,
): Promise<Goal> {
  const rows = await db()<GoalRow[]>`
    INSERT INTO goals (user_id, title, category, horizon, why, measure)
    VALUES (${USER}, ${input.title}, ${input.category}, ${input.horizon},
            ${input.why}, ${input.measure})
    RETURNING ${db().unsafe(GOAL_COLUMNS)}
  `;
  return toGoal(rows[0]!);
}

/**
 * Patch only the fields present, so the UI can send partial edits (a status
 * flip on its own, say). COALESCE keeps an absent field at its current value;
 * an empty string is a real value and does clear `why` or `measure`.
 */
export async function updateGoal(
  id: string,
  patch: Partial<
    Pick<Goal, 'title' | 'category' | 'horizon' | 'why' | 'measure' | 'status' | 'sort'>
  >,
): Promise<Goal | null> {
  const sql = db();
  const rows = await sql<GoalRow[]>`
    UPDATE goals SET
      title      = coalesce(${patch.title ?? null}::text, title),
      category   = coalesce(${patch.category ?? null}::text, category),
      horizon    = coalesce(${patch.horizon ?? null}::text, horizon),
      why        = coalesce(${patch.why ?? null}::text, why),
      measure    = coalesce(${patch.measure ?? null}::text, measure),
      status     = coalesce(${patch.status ?? null}::text, status),
      sort       = coalesce(${patch.sort ?? null}::int, sort),
      updated_at = now()
     WHERE id = ${id} AND user_id = ${USER}
    RETURNING ${sql.unsafe(GOAL_COLUMNS)}
  `;
  return rows[0] ? toGoal(rows[0]) : null;
}

export async function deleteGoal(id: string): Promise<boolean> {
  const rows = await db()`
    DELETE FROM goals WHERE id = ${id} AND user_id = ${USER} RETURNING id
  `;
  return rows.length > 0;
}

type FeedbackRow = {
  id: string;
  period: Period;
  key: string;
  note: string;
  created_at: Date;
};

function toFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    period: row.period,
    key: row.key,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

export async function addFeedback(
  period: Period,
  key: string,
  note: string,
): Promise<Feedback> {
  const rows = await db()<FeedbackRow[]>`
    INSERT INTO feedback (user_id, period, key, note)
    VALUES (${USER}, ${period}, ${key}, ${note})
    RETURNING id, period, key, note, created_at
  `;
  return toFeedback(rows[0]!);
}

/** Corrections for one period key, newest first — shown beside its wrap. */
export async function getFeedback(period: Period, key: string): Promise<Feedback[]> {
  const rows = await db()<FeedbackRow[]>`
    SELECT id, period, key, note, created_at
      FROM feedback
     WHERE user_id = ${USER} AND period = ${period} AND key = ${key}
     ORDER BY created_at DESC
  `;
  return rows.map(toFeedback);
}

/**
 * The most recent corrections across every period. Injected into every later
 * generation — this is the whole mechanism by which the agent's read of this
 * person improves rather than repeating the same misjudgement.
 */
export async function recentFeedback(limit = 25): Promise<Feedback[]> {
  const rows = await db()<FeedbackRow[]>`
    SELECT id, period, key, note, created_at
      FROM feedback
     WHERE user_id = ${USER}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `;
  return rows.map(toFeedback);
}

/**
 * Period keys that already hold a wrap or a reflection — what the UI's index
 * lists, so you can navigate to days that have something on them.
 */
export async function listKeys(period: Period, limit = 400): Promise<string[]> {
  const rows = await db()<{ key: string }[]>`
    SELECT key FROM wraps       WHERE user_id = ${USER} AND period = ${period}
    UNION
    SELECT key FROM reflections WHERE user_id = ${USER} AND period = ${period} AND body <> ''
    ORDER BY key DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.key);
}
