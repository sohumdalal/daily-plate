/**
 * An LLM reads the board: every open issue gets a size, a few badges from a
 * fixed set, a one-line thought, and a call on whether it may already be
 * closable. Issues go in batches, and an issue is judged again only when it
 * changes (its digest), so a quiet board costs nothing.
 *
 * The deeper thought is asked for one open issue at a time, from the
 * screen. It reads the issue's comments, searches the repo's code and commits
 * for it, and says how far along it is, whether it can be closed, and how to
 * finish it.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config, isDev } from '../config.ts';
import { db } from '../db/client.ts';
import { gh } from '../sources/github.ts';
import { generate } from '../wrap/llm.ts';
import { boardIssues, type BoardIssue } from './issues.ts';

/** The badges a judge may give, and what each means. The screen draws these and no others. */
export const BADGES = {
  'one-shot': 'One focused PR can finish it',
  'quick-win': 'Under an hour or two of work',
  'needs-design': 'Needs a design or UX decision before code',
  'needs-spec': 'Unclear what done means; needs a sharper ask',
  'bigger-infra': 'Touches platform or infrastructure across services',
  'cross-team': 'Needs another team or an outside party',
  bug: 'Something is broken',
  feature: 'New behaviour',
  polish: 'Small fit-and-finish',
  research: 'Needs an investigation before a plan',
  blocked: 'Waiting on something else',
  stale: 'Nobody has touched it in a long time',
  'could-close': 'May already be done, or no longer needed',
} as const;

type Badge = keyof typeof BADGES;
const BADGE_NAMES = Object.keys(BADGES) as [Badge, ...Badge[]];

export type Judgment = {
  size: 'S' | 'M' | 'L' | 'XL' | '';
  badges: Badge[];
  thought: string;
  closable: 'yes' | 'maybe' | 'no';
  closeReason: string;
  judgedAt: string;
  deep: DeepThought | null;
  deepAt: string | null;
};

export type DeepThought = {
  verdict: 'done' | 'partly-done' | 'not-started' | 'unclear';
  closable: 'yes' | 'maybe' | 'no';
  summary: string;
  done: string[];
  left: string[];
  plan: string[];
  risks: string[];
  evidence: { label: string; url: string; why: string }[];
  searched: string[];
};

/** Issues in one judge call: enough to share the instructions, few enough to keep each read sharp. */
const BATCH = 8;
/** Most issues one run judges, so a first run over a large board is spread out. */
const MAX_PER_RUN = 120;
/** How often the deployed agent looks for issues to judge. */
const EVERY_MS = 15 * 60 * 1000;

const DAY_MS = 864e5;
const days = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);

/** What a judge sees; when any of it changes, the issue is judged again. */
function digest(i: BoardIssue): string {
  const facts = [i.title, i.body, i.state, i.column, i.labels.join(','), i.assignees.map((a) => a.login).join(','), i.prs.map((p) => `${p.number}:${p.state}`).join(',')];
  return createHash('sha1').update(facts.join('\u0000')).digest('hex');
}

// ── Store ──────────────────────────────────────────────────────────────────

type Row = {
  issue_id: string;
  digest: string;
  size: string;
  badges: Badge[];
  thought: string;
  closable: Judgment['closable'];
  close_reason: string;
  judged_at: Date;
  deep: DeepThought | null;
  deep_at: Date | null;
};

const toJudgment = (r: Row): Judgment => ({
  size: r.size as Judgment['size'],
  badges: r.badges,
  thought: r.thought,
  closable: r.closable,
  closeReason: r.close_reason,
  judgedAt: r.judged_at.toISOString(),
  deep: r.deep,
  deepAt: r.deep_at?.toISOString() ?? null,
});

export async function judgments(): Promise<Map<string, Judgment & { digest: string }>> {
  const rows = await db()<Row[]>`
    SELECT issue_id, digest, size, badges, thought, closable, close_reason, judged_at, deep, deep_at
      FROM issue_judgments
  `;
  return new Map(rows.map((r) => [r.issue_id, { ...toJudgment(r), digest: r.digest }]));
}

// ── The quick read, in batches ─────────────────────────────────────────────

const quickSchema = z.object({
  judgments: z.array(
    z.object({
      id: z.string(),
      size: z.enum(['S', 'M', 'L', 'XL']),
      badges: z.array(z.string()).max(4),
      thought: z.string(),
      closable: z.enum(['yes', 'maybe', 'no']),
      closeReason: z.string().default(''),
    }),
  ),
});

const QUICK_SYSTEM = `You triage a software team's GitHub Projects board. For each issue, give:

- size: S (hours), M (a day or two), L (a week), XL (more, or many parts).
- badges: one to three from this list, and no others:
${Object.entries(BADGES)
  .map(([name, meaning]) => `  - ${name}: ${meaning}`)
  .join('\n')}
- thought: one sentence, at most 160 characters, on what the issue really needs or what is odd about it. Be concrete and useful to the engineer; never restate the title.
- closable: "yes" when the evidence says the work is done (a merged PR that closes or clearly delivers it) or the issue is obsolete; "maybe" when a merged PR or the issue itself suggests it but does not prove it; otherwise "no". An open or draft PR means the work is in progress, which is "no".
- closeReason: when closable is not "no", one short sentence naming the evidence, such as the merged PR's number.

Judge only from what is given. Reply with JSON only: {"judgments":[{"id","size","badges","thought","closable","closeReason"}]}.`;

function quickInput(i: BoardIssue, n: number) {
  return {
    // A short id: node ids are long, and every judgment repeats it.
    id: String(n + 1),
    ref: `${i.repo}#${i.number}`,
    title: i.title,
    column: i.column,
    labels: i.labels,
    assignees: i.assignees.map((a) => a.login),
    openedDaysAgo: days(i.createdAt),
    updatedDaysAgo: days(i.updatedAt),
    comments: i.comments,
    prs: i.prs.map((p) => ({ number: p.number, state: p.state, title: p.title })),
    body: i.body.slice(0, 900),
  };
}

async function judgeBatch(batch: BoardIssue[]): Promise<number> {
  const { value, model } = await generate({
    system: QUICK_SYSTEM,
    user: JSON.stringify({ issues: batch.map(quickInput) }),
    schema: quickSchema,
    maxTokens: 8192,
    trace: { name: `board judge ${batch.length}`, session: 'board:judge' },
  });
  const byId = new Map(batch.map((i, n) => [String(n + 1), i]));
  let saved = 0;
  for (const j of value.judgments) {
    const issue = byId.get(j.id);
    if (!issue) continue;
    const badges = j.badges.filter((b): b is Badge => b in BADGES);
    await db()`
      INSERT INTO issue_judgments (issue_id, url, digest, size, badges, thought, closable, close_reason, model, judged_at)
      VALUES (${issue.id}, ${issue.url}, ${digest(issue)}, ${j.size}, ${db().json(badges)}, ${j.thought.slice(0, 240)},
              ${j.closable}, ${(j.closeReason ?? '').slice(0, 240)}, ${model}, now())
      ON CONFLICT (issue_id) DO UPDATE SET
        url = EXCLUDED.url, digest = EXCLUDED.digest, size = EXCLUDED.size, badges = EXCLUDED.badges,
        thought = EXCLUDED.thought, closable = EXCLUDED.closable, close_reason = EXCLUDED.close_reason,
        model = EXCLUDED.model, judged_at = now()
    `;
    saved++;
  }
  return saved;
}

let running: Promise<{ judged: number; waiting: number }> | null = null;

/** Judge the open issues that are new or changed since their last read. One run at a time. */
export function judgeBoard(): Promise<{ judged: number; waiting: number }> {
  running ??= (async () => {
    const [{ issues }, known] = await Promise.all([boardIssues(), judgments()]);
    // Newest first: they are the ones nobody has read yet.
    const due = issues
      .filter((i) => i.state === 'open' && known.get(i.id)?.digest !== digest(i))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const now = due.slice(0, MAX_PER_RUN);
    let judged = 0;
    for (let n = 0; n < now.length; n += BATCH) {
      try {
        judged += await judgeBatch(now.slice(n, n + BATCH));
      } catch (err) {
        console.warn('[board] a judge batch failed:', err instanceof Error ? err.message : err);
      }
    }
    if (judged) console.log(`[board] judged ${judged} issues, ${due.length - judged} still to read`);
    return { judged, waiting: Math.max(0, due.length - judged) };
  })().finally(() => (running = null));
  return running;
}

export const judging = () => running !== null;

/**
 * Deployed, the board is read for judging every EVERY_MS. On a laptop it
 * waits for the screen's Judge button, unless BOARD_JUDGE=1, so a dev server
 * on the shared database never writes on its own.
 */
export function startBoardJudge(): void {
  if (!config.llm.gateway.url && !config.llm.anthropicKey) return;
  if (isDev && process.env.BOARD_JUDGE !== '1') return;
  const run = () => judgeBoard().catch((err) => console.warn('[board] judge run failed:', err));
  setTimeout(run, 30_000);
  setInterval(run, EVERY_MS);
}

// ── The deeper thought, one issue at a time ────────────────────────────────

const planSchema = z.object({ queries: z.array(z.string()).max(4) });

const deepSchema = z.object({
  verdict: z.enum(['done', 'partly-done', 'not-started', 'unclear']),
  closable: z.enum(['yes', 'maybe', 'no']),
  summary: z.string(),
  done: z.array(z.string()).default([]),
  left: z.array(z.string()).default([]),
  plan: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  evidence: z.array(z.object({ label: z.string(), url: z.string().default(''), why: z.string() })).default([]),
});

type CodeHit = { path: string; url: string; fragments: string[] };

async function searchCode(repo: string, query: string): Promise<CodeHit[]> {
  try {
    const { data } = await gh().request('GET /search/code', {
      q: `${query} repo:${repo}`,
      per_page: 5,
      headers: { accept: 'application/vnd.github.text-match+json' },
    });
    return (data.items as { path: string; html_url: string; text_matches?: { fragment: string }[] }[]).map((hit) => ({
      path: hit.path,
      url: hit.html_url,
      fragments: (hit.text_matches ?? []).map((m) => m.fragment.slice(0, 300)).slice(0, 2),
    }));
  } catch (err) {
    console.warn(`[board] code search "${query}" failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function commitsFor(issue: BoardIssue) {
  try {
    const { data } = await gh().request('GET /search/commits', {
      q: `repo:${issue.repo} "#${issue.number}"`,
      per_page: 8,
      sort: 'committer-date',
    });
    return (data.items as { sha: string; html_url: string; commit: { message: string; committer: { date: string } | null } }[]).map((c) => ({
      sha: c.sha.slice(0, 7),
      url: c.html_url,
      message: c.commit.message.split('\n')[0]!.slice(0, 160),
      date: c.commit.committer?.date?.slice(0, 10) ?? '',
    }));
  } catch {
    return [];
  }
}

async function commentsOf(issue: BoardIssue) {
  const [owner, repo] = issue.repo.split('/') as [string, string];
  try {
    const { data } = await gh().issues.listComments({ owner, repo, issue_number: issue.number, per_page: 30 });
    return data.slice(-10).map((c) => ({ by: c.user?.login ?? '', at: c.created_at.slice(0, 10), text: (c.body ?? '').slice(0, 600) }));
  } catch {
    return [];
  }
}

const PLAN_SYSTEM = `You are about to check a GitHub issue against its repository's code. Name up to four short GitHub code-search queries (one to three words each: identifiers, file names, UI strings or error text the fix would touch) that would find the relevant code. Reply with JSON only: {"queries":[...]}.`;

const DEEP_SYSTEM = `You are a senior engineer reviewing one open issue on your team's board, with its comments, the PRs and commits that reference it, and what a search of the code found. Decide how far along it is, and whether the code already has what it asks, so that it can be closed.

Reply with JSON only:
{
  "verdict": "done" | "partly-done" | "not-started" | "unclear",
  "closable": "yes" when the code already does what it asks, "maybe" when that is likely but unproven, "no" when work is left,
  "summary": "two or three sentences: what the issue really is, and where it stands",
  "done": ["what the evidence shows is already in place"],
  "left": ["what is still missing"],
  "plan": ["the steps to finish it, in order, naming files where the search found them"],
  "risks": ["what could go wrong, or what to confirm first"],
  "evidence": [{"label": "a PR, commit or file", "url": "its link from the input", "why": "what it shows"}]
}

Use only links that appear in the input. Say "unclear" rather than guess. Keep every item to one sentence.`;

/** The deeper thought on one issue, saved with its quick read. */
export async function thinkDeeper(issueId: string): Promise<Judgment> {
  const { issues } = await boardIssues();
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new Error('That issue is not on the board.');
  if (issue.state !== 'open') throw new Error('The deeper thought is for open issues.');

  const facts = { ...quickInput(issue, 0), body: issue.body, url: issue.url, prs: issue.prs };
  const session = `board:issue:${issue.repo}#${issue.number}`;
  const { value: plan } = await generate({
    system: PLAN_SYSTEM,
    user: JSON.stringify({ title: issue.title, body: issue.body, repo: issue.repo }),
    schema: planSchema,
    maxTokens: 512,
    trace: { name: `board plan ${issue.repo}#${issue.number}`, session },
  });
  const queries = plan.queries.map((q) => q.trim()).filter(Boolean).slice(0, 4);
  const [code, commits, comments] = await Promise.all([
    Promise.all(queries.map((q) => searchCode(issue.repo, q))),
    commitsFor(issue),
    commentsOf(issue),
  ]);

  const { value, model } = await generate({
    system: DEEP_SYSTEM,
    user: JSON.stringify({
      issue: facts,
      comments,
      commits,
      code: queries.map((q, n) => ({ query: q, hits: code[n] })),
    }),
    schema: deepSchema,
    maxTokens: 4096,
    trace: { name: `board think ${issue.repo}#${issue.number}`, session },
  });
  const deep: DeepThought = {
    verdict: value.verdict,
    closable: value.closable,
    summary: value.summary,
    done: value.done ?? [],
    left: value.left ?? [],
    plan: value.plan ?? [],
    risks: value.risks ?? [],
    evidence: (value.evidence ?? []).map((e) => ({ label: e.label, url: e.url ?? '', why: e.why })),
    searched: queries,
  };

  const known = (await judgments()).get(issue.id);
  await db()`
    INSERT INTO issue_judgments (issue_id, url, digest, closable, close_reason, model, deep, deep_at)
    VALUES (${issue.id}, ${issue.url}, ${known?.digest ?? ''}, ${deep.closable}, ${deep.summary.slice(0, 240)}, ${model},
            ${db().json(deep)}, now())
    ON CONFLICT (issue_id) DO UPDATE SET deep = EXCLUDED.deep, deep_at = now(),
      closable = EXCLUDED.closable, close_reason = EXCLUDED.close_reason
  `;
  const saved = (await judgments()).get(issue.id)!;
  return saved;
}
