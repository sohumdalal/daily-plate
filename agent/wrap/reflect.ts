/**
 * The reflection conversation.
 *
 * Its job is to get someone to three takeaways they actually believe: one
 * thing that went well, one that did not, one to improve. It asks; they
 * answer. It is not here to summarise their day back at them, which they can
 * already read directly above, and not here to write their conclusions for
 * them either.
 */

import { z } from 'zod';
import { generate } from './llm.ts';
import * as store from './store.ts';
import { addDays, labelFor, spanOf, type Period } from '../time.ts';
import type { Goal, Reflection, ReflectionTurn, Takeaways, Wrap } from './types.ts';

/** How much recent history the conversation is given. */
const LOOKBACK_DAYS = 10;

/**
 * Everything but the message is optional, and readiness is inferred from
 * whether a draft came back rather than asked for as a separate flag. A
 * required field the model can forget throws away an otherwise usable reply,
 * and it forgot `ready`.
 */
const ReplySchema = z.object({
  /** One question, or a short acknowledgement plus one question. */
  message: z.string().min(1).max(600),
  takeaways: z
    .object({
      good: z.string().max(400).optional(),
      bad: z.string().max(400).optional(),
      improve: z.string().max(400).optional(),
    })
    .optional(),
});

const SYSTEM = `You are helping one engineer reflect on a period of their own
work, in conversation. You have their record of it in front of you.

You have their recent days too. Use them. The most useful thing you can do is
notice what recurs: a thing they said they would change and did not, a cost
they keep paying, a strength they keep leaning on. A question that lands
because it remembers last week is worth ten generic ones.

Your only goal is that they arrive at three takeaways they believe:

  good     the one thing that went well and is worth repeating
  bad      the one thing that went badly, named honestly
  improve  the one thing to do differently next

Three, not nine. Naming the one that matters is the work.

HOW TO TALK

Ask one question at a time. Short. A sentence of acknowledgement first is fine
when they have just told you something real, but do not open every message with
one, and never restate their day back at them: it is on the screen above this
conversation.

Ask about the things the record cannot answer, and weight it towards where they
could be better rather than what went well. Whether the thing they shipped was
the thing worth shipping. Which hour they would take back. What they were
avoiding. Where they got lucky and should not count on it again. What they
would tell someone starting the same day tomorrow. Which of these is worth
asking depends on what the record shows and what they have already said.

Where the history shows them naming the same improvement more than once, ask
about that directly. Someone repeating an intention without acting on it is the
single most useful thing this conversation can surface, and the only place they
will hear it is from you.

Push once when an answer is vague, then let it go. "It was fine" deserves one
follow-up, not three. You are not running an interrogation, and a person who
feels examined stops answering honestly.

Do not praise. Do not tell them what they learned; that is the wrap's job and
it is written elsewhere. Do not offer advice unless they ask for it.

If their first message is substantial, do not pretend it wasn't. Take what they
gave you and go one level deeper.

THE TAKEAWAYS

Leave the three out entirely until they have said enough for a draft to be
theirs rather than yours. Two or three exchanges of substance is usually
enough; one short answer is not.

When you do draft them, use their words, not a paraphrase into your register.
They will edit these, so a draft that sounds like them is worth more than one
that reads well. Each one is a single sentence, concrete, no hedging.

Once the three are drafted, say so plainly and stop asking questions. They can
edit and save from there.

ATTRIBUTION

These sessions are this person working with Claude Code. The prompts are
theirs; most of the work in between is the assistant's, done at their
direction. Do not ask them about, or credit them with, work the record shows
the assistant doing. Ask about the calls they made.

Reply with a JSON object holding "message", plus "takeaways" with "good",
"bad" and "improve" once you are drafting them. Leave "takeaways" out
entirely until then.`;

function describeContext(opts: {
  period: Period;
  key: string;
  wrap: Wrap | null;
  goals: Goal[];
  energy: number | null;
}): string {
  const out = [`PERIOD: ${opts.period} ${opts.key} (${labelFor(opts.period, opts.key)})`];

  if (opts.wrap) {
    out.push(`\nWHAT THE RECORD SAYS THEY DID:`);
    for (const d of opts.wrap.did) out.push(`  - ${d}`);
    if (opts.wrap.learned) out.push(`\nTHE READ ALREADY WRITTEN ON IT:\n  ${opts.wrap.learned}`);
    if (opts.wrap.grew.length) {
      out.push(`\nWHERE IT SAYS TO IMPROVE:`);
      for (const g of opts.wrap.grew) out.push(`  - ${g}`);
    }
  } else {
    out.push('\nNo wrap has been written for this period yet.');
  }

  if (opts.energy) out.push(`\nThey rated their energy ${opts.energy}/5.`);

  if (opts.goals.length) {
    out.push(`\nWHAT THEY ARE TRYING TO BECOME. Ask about the distance between
these and the day:`);
    for (const g of opts.goals) {
      out.push(`  - [${g.category}, ${g.horizon}] ${g.title}`);
      if (g.measure) out.push(`      measured by: ${g.measure}`);
      if (g.why) out.push(`      why it matters to them: ${g.why}`);
    }
  }

  return out.join('\n');
}

/**
 * The days before this one, with what they said about each. This is what lets
 * a question remember last week instead of treating every day as the first.
 */
function describeHistory(
  wraps: Wrap[],
  reflections: Reflection[],
): string {
  if (!wraps.length && !reflections.length) return '';

  const byKey = new Map(reflections.map((r) => [r.key, r]));
  const keys = [...new Set([...wraps.map((w) => w.key), ...reflections.map((r) => r.key)])]
    .sort()
    .reverse();

  const lines: string[] = [];
  for (const key of keys) {
    const wrap = wraps.find((w) => w.key === key);
    const reflection = byKey.get(key);
    const parts = [`  ${key}${wrap ? ` — ${wrap.headline}` : ''}`];
    if (wrap?.grew.length) {
      for (const g of wrap.grew) parts.push(`      it told them to improve: ${g}`);
    }
    const t = reflection?.takeaways;
    if (t?.good) parts.push(`      they said went well: ${t.good}`);
    if (t?.bad) parts.push(`      they said went badly: ${t.bad}`);
    if (t?.improve) parts.push(`      they said to improve: ${t.improve}`);
    lines.push(parts.join('\n'));
  }

  return `

THEIR RECENT DAYS, newest first. Look for what repeats:
${lines.join('\n')}`;
}

function describeThread(turns: ReflectionTurn[]): string {
  if (!turns.length) {
    return `\n\nThis is the start of the conversation. Open it: one short line
that shows you have read the record, then your first question.`;
  }
  const lines = turns.map((t) => `  ${t.role === 'agent' ? 'you' : 'them'}: ${t.text}`);
  return `\n\nTHE CONVERSATION SO FAR:\n${lines.join('\n')}`;
}

export type ReflectReply = {
  message: string;
  takeaways: Takeaways;
  ready: boolean;
  model: string;
};

/** The agent's next turn, given everything said so far. */
export async function nextReflectionTurn(
  period: Period,
  key: string,
): Promise<ReflectReply> {
  // For a day, look back from it. For a rollup, look across the days it covers.
  const span = spanOf(period, key);
  const from = period === 'day' ? addDays(key, -LOOKBACK_DAYS) : span.from;
  const to = period === 'day' ? addDays(key, -1) : span.to;

  const [wrap, reflection, turns, goals, feedback, pastWraps, pastReflections] =
    await Promise.all([
      store.getWrap(period, key),
      store.getReflection(period, key),
      store.getTurns(period, key),
      store.activeGoals(),
      store.recentFeedback(),
      store.getWrapsBetween('day', from, to),
      store.getReflectionsBetween('day', from, to),
    ]);

  const corrections = feedback.length
    ? `\n\nCORRECTIONS THIS PERSON HAS GIVEN ABOUT HOW YOU WRITE TO THEM. They
are binding here too:\n${feedback.map((f) => `  - ${f.note}`).join('\n')}`
    : '';

  const user =
    describeContext({
      period,
      key,
      wrap,
      goals,
      energy: reflection?.energy ?? null,
    }) +
    describeHistory(pastWraps, pastReflections) +
    describeThread(turns);

  const { value, model } = await generate({
    system: SYSTEM + corrections,
    user,
    schema: ReplySchema,
    maxTokens: 2048,
  });

  const takeaways: Takeaways = {
    good: value.takeaways?.good?.trim() ?? '',
    bad: value.takeaways?.bad?.trim() ?? '',
    improve: value.takeaways?.improve?.trim() ?? '',
  };

  return {
    message: value.message,
    takeaways,
    ready: Boolean(takeaways.good || takeaways.bad || takeaways.improve),
    model,
  };
}
