/**
 * Turning a day (or a week, month, year) into five bullets.
 *
 * The output shape is fixed: what you did, what you learned, where you grew.
 * `learned` and `grew` are allowed to come back empty, and that matters — a day
 * of mechanical work should read as one. Inventing growth on a quiet day would
 * make the weekly and yearly rollups worthless, because they are built by
 * reading these fields back.
 */

import { z } from 'zod';
import { generate } from './llm.ts';
import { config } from '../config.ts';
import * as plate from '../store.ts';
import type { Item } from '../store.ts';
import * as store from './store.ts';
import { addDays, labelFor, spanOf, type Period } from '../time.ts';
import type {
  ClaudeDay,
  Feedback,
  GitHubDay,
  Goal,
  Reflection,
  SlackFeedback,
  Wrap,
  WrapReason,
  WrapVersion,
} from './types.ts';

/** How many preceding days of wraps the model sees, for continuity. */
const PRIOR_DAYS = 10;

/**
 * How much of the prompt record reaches the model. Generous on purpose: the
 * read is supposed to be about how this person thinks, and the prompts are the
 * only place that shows. A busy day at these limits is ~10k tokens of input,
 * which is cheap next to writing a paragraph that misses the point.
 */
const MAX_PROMPTS_PER_SESSION = 30;
const MAX_PROMPT_CHARS = 500;

/** How many earlier takes on the same key the model is shown. */
const PRIOR_VERSIONS = 3;

/**
 * A sanity bound, not a style rule. Length is governed by the prompt and
 * absolutely bounded by max_tokens, so this only has to catch output that has
 * gone genuinely wrong. Set anywhere near the prompt's target it instead
 * rejects the wrap for the densest days, which are the ones worth keeping:
 * at 220 and again at 420 it did exactly that.
 */
const PROSE_MAX = 800;

const WrapSchema = z.object({
  // A compact label, not a title: it appears as one row in a rollup's list of
  // days, never as a heading on the page.
  headline: z.string().min(1).max(60),
  did: z.array(z.string().min(1).max(PROSE_MAX)).max(5),
  // A paragraph, and allowed to be empty on a day that shows nothing.
  learned: z.string().max(1200),
  grew: z.array(z.string().min(1).max(PROSE_MAX)).max(2),
});

const VOICE = `You are talking to this person about their own day, in second
person, the way a sharp friend who happens to be a great engineer would over a
drink — someone who was watching, is genuinely interested, and is not trying to
flatter them.

So: have a point of view. Be specific enough that it could only be about this
day. Use a real verb where a bland one would do, and let a sentence carry some
heat when the day had some — if they spent four hours fighting a flaky test,
that was annoying, and you can say so. If a call was sharp, say it was sharp.

The failure mode to avoid is not enthusiasm, it is blandness: the neutered
performance-review register that says "demonstrated strong ownership" and means
nothing. Two bans, and they pull in opposite directions on purpose. No
corporate filler — "leveraged", "demonstrated", "significant", "various",
"several key", "Successfully", "showcases". And no cheerleading — no "great
work", no "crushed it", no exclamation marks. Warm and unimpressed at the same
time.

Write sentences, not log lines. Stay concrete: name the feature, the repo, the
PR number, the person whose work they unblocked, the thing they actually typed.
No em-dashes.`;

const DAY_SYSTEM = `You are writing one person's daily engineering wrap.

You get two kinds of evidence, and they are not equal.

The prompts they typed into Claude Code are the primary source. That is the
only record of how this person actually thinks: how they frame a problem, what
they reach for first, the moment they change their mind, the thing they refuse
to accept, the idea they float and drop, where they get terse because something
is not landing. Read them the way you would read someone talking through their
work out loud. Their tone is evidence too.

The GitHub activity — commits, pull requests, reviews — is corroboration. It
tells you what came of the thinking. It is not the subject.

A wrap built only from PR titles is a worse wrap. Two people can ship the same
diff and have had completely different days.

ATTRIBUTION. This matters more than anything else in these instructions.

These sessions are this person working with Claude Code. The prompts are theirs.
Most of the reading, tracing, editing and writing in between is the assistant's,
done at their direction. Do not describe the assistant's work as theirs.

Credit them for what the record shows them actually doing: the call they made,
the constraint they set, the answer they refused to accept, the question that
changed direction, the thing they noticed looked wrong, what they chose to
spend the day on, what they decided was good enough.

When the assistant surfaced something, say so, and credit them for what they
did with it. "Claude flagged the stale query and you decided to rewrite the
window rather than patch it" is accurate. "You found the stale query" is not,
and it flatters them in a record whose only value is being true.

For "did", crediting them with shipping their own PR is right; it is their work
and their name on it. The distinction bites hardest in "learned" and "grew",
which are claims about their judgement. Getting attribution wrong there does
not just misreport a fact, it invents a strength they may not have.

Useful verbs for their own acts: asked, directed, rejected, chose, pushed back,
noticed, insisted, stopped, redirected, decided. Reserve found, traced, wrote,
debugged and built for what the record shows them doing themselves.

You are also given the wraps of the days just before this one, under PRIOR DAYS.
Use them for continuity — to recognise work that is ongoing rather than new, and
to see what has been returned to again and again. Do not restate them, and do
not credit their contents to today.

${VOICE}

Return a JSON object with exactly these keys:

  headline  At most six words, 60 characters. A terse label for this day in a
            list of days, not a heading. Name the thing, not the actions:
            "Everyone group lockdown" over "Locked the Everyone group and
            moved access settings". No trailing punctuation.
  did       Three to five bullets, most consequential first. These are NOT a
            changelog. One artifact per bullet is the wrong altitude; so is
            restating a PR title. Step back and say what the day amounted to,
            then let the artifacts be the evidence inside the sentence.

            Three habits make the difference:

            1. Group by thread of work, not by artifact. One feature touched
               through a merge, a follow-up PR and a conflict fix is ONE
               bullet about that feature, naming all three.
            2. Say where the day sits in the work. The PRIOR DAYS section
               below tells you what came before; when today continues it, say
               so ("The Everyone group work you shipped last week came back
               for polish: you locked its name and description and fixed the
               member counts, astro#2669").
            3. Name the mode, not just the output. Reviewing four PRs for
               teammates, leaving comments on someone's design, writing your
               own tooling, and shipping product are different kinds of day.
               Characterise them ("Spent a real slice of the day on other
               people's work, reviewing four PRs across astro and
               cloud9-parcels") rather than counting them.

            Never emit a bullet whose whole content is one PR number and its
            title.
  learned   A short paragraph of two or three sentences — NOT bullets, NOT a
            list with semicolons. This is the most important field, and it is
            the one worth spending your judgement on. It is your read on this
            person's day, written to them, and it sits directly beside the
            reflection they write themselves.

            Take the whole day, not the artifacts. Build this from how they
            were thinking: the questions they asked, the order they asked them
            in, the assumption they started with and abandoned, the thing they
            kept circling, the point where they stopped trusting a tool and
            went and looked. Name the best thinking you saw and say why it was
            good — being specific about someone's judgement is the most useful
            thing you can tell them.

            Hold the attribution rule hardest here. What they learned is what
            their own prompts show them coming to understand, not what the
            assistant worked out and reported to them. If the day's insight
            was the assistant's, the honest version is what they did with it:
            whether they checked it, questioned it, or took it on trust.

            Where they went the long way round, say so, and say what it cost.
            Where they pushed back on something and were right, say that too.
            If two unrelated pieces of the day were really the same problem,
            that connection is the most valuable sentence you can write.

            Do not restate the work; "did" already has it. Do not turn an
            implementation decision into a lesson. Do not praise in general
            terms. If the day genuinely shows nothing, return an empty string.
  grew      Zero to two bullets. Where to go after tomorrow: the sharpest
            thing this person could do differently next, given how today
            actually went and what they are trying to become.

            Be critical. This is the one field where you are allowed to be
            uncomfortable, and a soft version of it is worthless. Point at the
            specific habit today exposed, not a virtue in general. If they
            burned two hours on something a five-minute check would have
            settled, say that. If they are strong at the thing they keep doing
            and avoiding the thing they need, say that.

            Tie it to their goals where the record lets you. Criticism that
            serves the direction they have chosen lands; criticism against a
            standard they never set does not.

            Never praise here. Praise belongs in "learned" where it is earned
            by evidence. Old shape, kept for reference on specificity:
            "Stopped guessing at the fix and read the failing query
            first." If the day shows no such change, return an empty array.

Returning empty arrays for learned and grew is correct and expected on a
mechanical day. Do not manufacture insight. Reply with the JSON object only.`;

const ROLLUP_SYSTEM = `You are writing one person's engineering wrap for a whole
period, from the daily wraps they already have and the reflections they wrote
alongside them.

${VOICE}

You are looking for the arc, not a longer list. Repetition across days is the
signal: what they returned to, what stopped being hard, what kept biting.

Return a JSON object with exactly these keys:

  headline  At most six words, 60 characters. A terse label for this period in
            a list, not a heading. Name the theme, not the actions. No trailing
            punctuation.
  did       Three to five bullets. The work that mattered at this altitude. At
            most sixteen words each. A single day's task belongs here only if it
            still matters at the end of the period. Group; do not enumerate.
  learned   A short paragraph of two or three sentences — NOT bullets. Your own
            read on what this period taught them, written to them, drawn from
            what recurs across the days rather than from any single one. Make
            an argument. Name the thing they kept running into. Empty string if
            the period genuinely shows nothing.
  grew      Zero to three bullets. How they changed as an engineer over this
            period. This is the most important field — it is the reason the
            record is kept. Ground each one in what the days actually show, and
            name the direction of travel. Return an empty array rather than a
            platitude.

Reply with the JSON object only.`;

/**
 * The person's own corrections to earlier wraps. These are instructions from
 * the reader of this text about how they want to be read, so they outrank the
 * general guidance above — that is the point of the disagree button.
 */
function describeFeedback(feedback: Feedback[]): string {
  if (!feedback.length) return '';
  const notes = feedback.map((f) => `  - (on ${f.key}) ${f.note}`).join('\n');
  return `

CORRECTIONS THIS PERSON HAS GIVEN YOU, newest first. They wrote these after
reading wraps you produced and disagreeing with them. Treat them as binding
instructions about how to read and address this person, and apply them even
where they cut against the general guidance above:
${notes}`;
}

const CATEGORY_LABEL: Record<Goal['category'], string> = {
  career: 'Career',
  craft: 'Craft',
  impact: 'Impact',
  personal: 'Personal',
  intrinsic: 'Why it matters',
};

const HORIZON_LABEL: Record<Goal['horizon'], string> = {
  quarter: 'this quarter',
  year: 'this year',
  long: 'long term',
};

/**
 * What this person is trying to become. Without it, "where to improve" has
 * nothing to measure against and collapses into generic advice.
 */
function describeGoals(goals: Goal[]): string {
  if (!goals.length) return '';
  const lines = goals.map((g) => {
    const parts = [`  - [${CATEGORY_LABEL[g.category]}, ${HORIZON_LABEL[g.horizon]}] ${g.title}`];
    if (g.measure) parts.push(`      measured by: ${g.measure}`);
    if (g.why) parts.push(`      why it matters to them: ${g.why}`);
    return parts.join('\n');
  });
  return `

THE GOALS THIS PERSON HAS SET FOR THEMSELVES:
${lines.join('\n')}

Judge the day against these, not against a generic idea of a good engineer.
Where the day moved one of them, say which. Where a day of real work moved none
of them, that is worth saying plainly and is often the most useful thing in the
whole wrap. Never invent progress against a goal the record does not support.`;
}

/**
 * Earlier takes on this same key. A rewrite should improve on what it said
 * last time rather than restate it, and a take the person disagreed with is
 * the clearest signal of what not to write again.
 */
function describePriorVersions(versions: WrapVersion[]): string {
  if (!versions.length) return '';
  const lines = versions.map((v) => {
    const label = v.reason === 'disagree' ? 'rewritten after they disagreed' : 'earlier';
    return `  v${v.version} (${label}): ${v.learned || '(nothing written)'}`;
  });
  return `

WHAT YOU HAVE ALREADY WRITTEN ABOUT THIS PERIOD, newest first:
${lines.join('\n')}

Do not restate these. Say something truer or sharper than the last attempt,
and drop a line that did not land. Where one of these was rewritten after a
disagreement, the version that followed it is the one they accepted.`;
}

/**
 * Their own account, which outranks the machine record. The three takeaways
 * outrank even the conversation they came out of: they are what this person
 * decided the period amounted to, in their own words, after being asked.
 */
function describeReflection(reflection: Reflection | null): string {
  if (!reflection) return '';
  const out: string[] = [];
  const t = reflection.takeaways;

  if (t.good || t.bad || t.improve) {
    out.push(`

THE THREE TAKEAWAYS THEY SETTLED ON. These are their own conclusions and they
outrank everything above, including your earlier reads:`);
    if (t.good) out.push(`  went well: ${t.good}`);
    if (t.bad) out.push(`  went badly: ${t.bad}`);
    if (t.improve) out.push(`  to improve: ${t.improve}`);
  }

  if (reflection.body) {
    out.push(`

WHAT THEY SAID WHILE REFLECTING (authoritative for what they learned and how
they grew; the record above is only evidence):
${reflection.body}`);
  }

  if (reflection.energy) {
    out.push(`\nEnergy they rated it: ${reflection.energy}/5.`);
  }

  return out.join('\n');
}

/**
 * Slack messages marked with a reaction. Someone else's words about this
 * person, which nothing else in the record contains: a diff cannot hold
 * manager feedback or an argument they lost.
 */
function describeSlack(feedback: SlackFeedback[]): string {
  if (!feedback.length) return '';
  const lines = feedback.map((f) => {
    const who = f.authorName || f.authorId;
    const where = `#${f.channelName || f.channelId}`;
    return `  - in ${where}${who ? `, from ${who}` : ''}: ${f.text.replace(/\s+/g, ' ').slice(0, 600)}`;
  });
  return `

FEEDBACK THEY MARKED IN SLACK. They reacted to these deliberately, so each one
is something they judged worth keeping. Treat it as being about them, said by
someone else, and weigh it accordingly:
${lines.join('\n')}`;
}

/**
 * What came off the plate that day: cards, PRs and Slack asks the person
 * cleared, or the board moved to Done. The rest of the record says what they
 * typed and pushed; this says what they finished.
 */
function describeCleared(items: Item[]): string {
  if (!items.length) return '';
  const lines = items.map((i) => {
    const how = i.doneBy === 'board' ? 'board moved it to Done' : 'cleared by them';
    const where = i.context ? ` (${i.context})` : '';
    return `  - ${i.title.replace(/\s+/g, ' ').slice(0, 300)}${where}, ${how}`;
  });
  return `

CLEARED FROM THEIR PLATE. Their to-do list for the day, Daily Plate: what came
off it, and how. A thing cleared is a thing finished or let go, not necessarily
worked on today:
${lines.join('\n')}`;
}

function bullets(label: string, items: string[]): string {
  if (!items.length) return '';
  return `${label}\n${items.map((i) => `  - ${i}`).join('\n')}\n`;
}

/** The day's raw record, rendered for the model. */
function describeDay(day: string, claude: ClaudeDay | null, github: GitHubDay | null): string {
  const out: string[] = [`DAY: ${day} (${labelFor('day', day)})`];

  if (claude?.sessions.length) {
    const t = claude.totals;
    out.push(
      `\nCLAUDE CODE — ${t.sessions} session(s), ${t.activeMinutes} min active, ` +
        `${t.prompts} prompts, ${t.toolCalls} tool calls` +
        (claude.models.length ? `, models: ${claude.models.join(', ')}` : ''),
    );
    for (const s of claude.sessions) {
      // Resuming a session writes a fresh record that replays the opening
      // prompt. Those stubs carry no title, no tool calls and no active time,
      // and including them makes one piece of work look like three.
      if (!s.title && !s.tools.length && !s.activeMinutes) continue;
      if (!s.prompts.length && !s.title) continue;
      const where = [s.project, ...s.branches].filter(Boolean).join(' @ ');
      out.push(
        `\n  session${s.title ? ` "${s.title}"` : ''}${where ? ` [${where}]` : ''}` +
          ` — ${s.activeMinutes} min` +
          (s.tools.length
            ? `, tools: ${s.tools.slice(0, 5).map((x) => `${x.name}×${x.count}`).join(' ')}`
            : ''),
      );
      // The prompts are the primary evidence, not colour on top of the diffs:
      // they are the only record of how this person frames a problem, when
      // they change direction, and what they refuse to accept. Twelve per
      // session at 300 characters was cutting most of that off mid-sentence.
      for (const p of s.prompts.slice(0, MAX_PROMPTS_PER_SESSION)) {
        out.push(`    asked: ${p.replace(/\s+/g, ' ').slice(0, MAX_PROMPT_CHARS)}`);
      }
      if (s.prompts.length > MAX_PROMPTS_PER_SESSION) {
        out.push(`    (+${s.prompts.length - MAX_PROMPTS_PER_SESSION} more prompts)`);
      }
    }
    if (claude.prs.length) {
      out.push(
        `\n  PRs opened from these sessions: ${claude.prs
          .map((p) => `${p.repo}#${p.number}`)
          .join(', ')}`,
      );
    }
  } else {
    out.push('\nCLAUDE CODE — no sessions recorded.');
  }

  if (github && (github.repos.length || github.totals.commits)) {
    const t = github.totals;
    out.push(
      `\nGITHUB — ${t.commits} commit(s), ${t.opened} PR(s) opened, ` +
        `${t.merged} merged (+${t.additions}/-${t.deletions}), ${t.reviewed} reviewed`,
    );
    out.push(
      bullets(
        '  commits:',
        github.commits.map((c) => `${c.repo} ${c.sha} ${c.message}`),
      ),
    );
    out.push(
      bullets(
        '  opened:',
        github.opened.map(
          (p) =>
            `${p.repo}#${p.number} ${p.title}` +
            (p.additions !== null ? ` (+${p.additions}/-${p.deletions})` : ''),
        ),
      ),
    );
    out.push(
      bullets(
        '  merged:',
        github.merged.map((p) => `${p.repo}#${p.number} ${p.title}`),
      ),
    );
    out.push(
      bullets(
        '  reviewed for others:',
        github.reviewed.map((p) => `${p.repo}#${p.number} ${p.title} (by ${p.author})`),
      ),
    );
  } else {
    out.push('\nGITHUB — nothing recorded.');
  }

  return out.filter(Boolean).join('\n');
}

/** A period with no wrapped days beneath it. Expected, not a failure. */
export class NoDaysToRollUp extends Error {}

/**
 * The days just before this one, as already wrapped. This is what lets a wrap
 * say "the Everyone group work you shipped last week came back for polish"
 * instead of describing every day as though it began from nothing.
 */
function describePriorDays(priors: Wrap[]): string {
  if (!priors.length) return '';
  const lines = priors.map((w) => {
    const did = w.did.map((d) => `      - ${d}`).join('\n');
    return `  ${w.key} — ${w.headline}\n${did}`;
  });
  return `\n\nPRIOR DAYS (context only; do not restate or re-credit):\n${lines.join('\n')}`;
}

/** Whether a day holds enough to be worth asking the model about. */
export function hasActivity(claude: ClaudeDay | null, github: GitHubDay | null): boolean {
  const c = claude?.totals;
  const g = github?.totals;
  return Boolean(
    (c && (c.prompts > 0 || c.sessions > 0)) ||
      (g && (g.commits > 0 || g.opened > 0 || g.merged > 0 || g.reviewed > 0)),
  );
}

export type DayPromptInput = {
  day: string;
  claude: ClaudeDay | null;
  github: GitHubDay | null;
  reflection: Reflection | null;
};

/**
 * Assemble the day's prompt without calling a model or writing anything.
 *
 * Split out from writeDayWrap so that inspecting what the model will see is a
 * pure read. When the two were one function, checking a prompt meant stubbing
 * the model and letting the wrap save anyway, which overwrote a real day with
 * placeholder text.
 */
export async function buildDayPrompt(
  opts: DayPromptInput,
): Promise<{ system: string; user: string }> {
  // Oldest first, and excluding today — a day is context for the days after it.
  const [priors, feedback, goals, versions, slack, cleared] = await Promise.all([
    store.getWrapsBetween('day', addDays(opts.day, -PRIOR_DAYS), addDays(opts.day, -1)),
    store.recentFeedback(),
    store.activeGoals(),
    store.listWrapVersions('day', opts.day),
    store.slackFeedbackBetween(opts.day, opts.day),
    plate.clearedOn(opts.day, config.timezone),
  ]);

  const user =
    describeDay(opts.day, opts.claude, opts.github) +
    describePriorDays(priors) +
    describeSlack(slack) +
    describeCleared(cleared) +
    describeReflection(opts.reflection) +
    describePriorVersions(versions.slice(0, PRIOR_VERSIONS));

  return {
    system: DAY_SYSTEM + describeGoals(goals) + describeFeedback(feedback),
    user,
  };
}

export async function writeDayWrap(
  opts: DayPromptInput & {
    /** Recorded against the version this produces. */
    reason?: WrapReason;
  },
): Promise<Wrap> {
  const { system, user } = await buildDayPrompt(opts);

  const { value, model } = await generate({
    system,
    user,
    schema: WrapSchema,
    trace: { name: `wrap day ${opts.day}`, session: `day:${opts.day}` },
  });

  return store.saveWrap(
    { period: 'day', key: opts.day, model, ...value },
    opts.reason ?? 'wrap',
  );
}

export async function writeRollup(
  period: Period,
  key: string,
  reason: WrapReason = 'wrap',
): Promise<Wrap> {
  if (period === 'day') throw new Error('use writeDayWrap for a single day');
  const { from, to } = spanOf(period, key);

  const [dayWraps, dayReflections, ownReflection, feedback, goals, versions, slack] =
    await Promise.all([
      store.getWrapsBetween('day', from, to),
      store.getReflectionsBetween('day', from, to),
      store.getReflection(period, key),
      store.recentFeedback(),
      store.activeGoals(),
      store.listWrapVersions(period, key),
      store.slackFeedbackBetween(from, to),
    ]);

  if (!dayWraps.length) {
    throw new NoDaysToRollUp(`no daily wraps between ${from} and ${to} to roll up`);
  }

  const reflectionByDay = new Map(dayReflections.map((r) => [r.key, r]));
  const sections = dayWraps.map((w) => {
    const parts = [`--- ${w.key} — ${w.headline}`];
    parts.push(bullets('  did:', w.did));
    if (w.learned) parts.push(`  learned: ${w.learned}`);
    parts.push(bullets('  grew:', w.grew));
    const r = reflectionByDay.get(w.key);
    if (r) {
      const t = r.takeaways;
      if (t.good) parts.push(`  they said went well: ${t.good}`);
      if (t.bad) parts.push(`  they said went badly: ${t.bad}`);
      if (t.improve) parts.push(`  they said to improve: ${t.improve}`);
      if (r.body) {
        parts.push(
          `  they wrote: ${r.body.replace(/\s+/g, ' ').slice(0, 600)}` +
            (r.energy ? ` (energy ${r.energy}/5)` : ''),
        );
      }
    }
    return parts.filter(Boolean).join('\n');
  });

  const covered = dayWraps.length;
  let user =
    `PERIOD: ${period} ${key} (${labelFor(period, key)})\n` +
    `${covered} day(s) wrapped in this period.\n\n` +
    sections.join('\n');

  user += describeReflection(ownReflection);

  user += describeSlack(slack) + describePriorVersions(versions.slice(0, PRIOR_VERSIONS));

  const { value, model } = await generate({
    system: ROLLUP_SYSTEM + describeGoals(goals) + describeFeedback(feedback),
    user,
    schema: WrapSchema.extend({
      grew: z.array(z.string().min(1).max(PROSE_MAX)).max(3),
    }),
    maxTokens: 8192,
    trace: { name: `wrap ${period} ${key}`, session: `${period}:${key}` },
  });

  return store.saveWrap({ period, key, model, ...value }, reason);
}
