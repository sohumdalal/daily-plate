/**
 * Reads a day out of a Claude Code home directory (`~/.claude`).
 *
 * Three files matter:
 *
 *   history.jsonl          every prompt you typed, with a timestamp and project
 *   projects/<slug>/*.jsonl  per-session transcripts — `aiTitle`, cwd, git
 *                          branch, tool calls, models, token usage, turn
 *                          durations, and `pr-link` entries
 *   daily-cost.json        today's spend, keyed by session (today only)
 *
 * Nothing here writes to the Claude home, and nothing is read outside the
 * requested day's window.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bounds } from '../../time.ts';
import type { ClaudeDay, ClaudePrLink, ClaudePrompt, ClaudeSession } from '../types.ts';

/** Prompts longer than this are stored truncated — the opening is the intent. */
const MAX_PROMPT_CHARS = 2000;

type SessionAccum = {
  id: string;
  title: string | null;
  cwds: Map<string, number>;
  branches: Set<string>;
  firstAt: number;
  lastAt: number;
  prompts: Array<{ at: number; text: string }>;
  assistantMessages: number;
  models: Set<string>;
  tools: Map<string, number>;
  activeMs: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
};

function accum(id: string): SessionAccum {
  return {
    id,
    title: null,
    cwds: new Map(),
    branches: new Set(),
    firstAt: Number.POSITIVE_INFINITY,
    lastAt: 0,
    prompts: [],
    assistantMessages: 0,
    models: new Set(),
    tools: new Map(),
    activeMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  };
}

/**
 * A short, recognisable name for a working directory. Sessions run straight
 * out of the home directory get no project name rather than the account name,
 * which reads as a repo but isn't one.
 */
function projectName(path: string): string | null {
  if (!path || path === homedir()) return null;
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/** `<synthetic>` is Claude Code's placeholder for locally-generated messages. */
function realModel(model: string): boolean {
  return Boolean(model) && !model.startsWith('<');
}

/** Detached HEAD tells us nothing about what was being worked on. */
function realBranch(branch: string): boolean {
  return Boolean(branch) && branch !== 'HEAD';
}

/**
 * The project a session was really about. A session wanders into
 * subdirectories as it works and may have been started from the home
 * directory, so neither the first nor the busiest `cwd` is reliable: the
 * least-nested named path is the one closest to the repo root.
 */
function dominantProject(cwds: Map<string, number>): string | null {
  let best: string | null = null;
  let bestDepth = Number.POSITIVE_INFINITY;
  for (const cwd of cwds.keys()) {
    const name = projectName(cwd);
    if (!name) continue;
    const depth = cwd.split('/').filter(Boolean).length;
    if (depth < bestDepth) {
      best = name;
      bestDepth = depth;
    }
  }
  return best;
}

function truncate(text: string): string {
  return text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS)}…` : text;
}

/** A user message's content is either a plain string or content blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: string }).type === 'text',
    )
    .map((b) => b.text)
    .join('\n');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Every prompt typed on the day, from history.jsonl. This is the clearest
 * signal of intent available — it is what the person actually asked for.
 */
async function readHistory(
  home: string,
  from: number,
  to: number,
): Promise<ClaudePrompt[]> {
  const raw = await readFile(join(home, 'history.jsonl'), 'utf-8').catch(() => '');
  const out: ClaudePrompt[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: { display?: string; timestamp?: number; project?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const at = entry.timestamp;
    if (typeof at !== 'number' || at < from || at >= to) continue;
    if (!entry.display) continue;
    out.push({
      at: new Date(at).toISOString(),
      project: entry.project ? projectName(entry.project) : null,
      text: truncate(entry.display),
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Walks the transcripts, skipping any file last modified before the window
 * opened — such a file cannot hold entries from it. With a 60MB+ transcript
 * tree that check is what keeps this fast.
 */
async function readTranscripts(
  home: string,
  from: number,
  to: number,
): Promise<{ sessions: SessionAccum[]; prs: ClaudePrLink[] }> {
  const root = join(home, 'projects');
  const slugs = await readdir(root).catch(() => [] as string[]);

  const sessions = new Map<string, SessionAccum>();
  const prs = new Map<string, ClaudePrLink>();
  const titles = new Map<string, string>();

  for (const slug of slugs) {
    const dir = join(root, slug);
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const path = join(dir, file);
      const info = await stat(path).catch(() => null);
      if (!info || info.mtimeMs < from) continue;

      const raw = await readFile(path, 'utf-8').catch(() => '');
      for (const line of raw.split('\n')) {
        if (!line) continue;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }

        const sessionId = (e.sessionId ?? e.session_id) as string | undefined;
        if (!sessionId) continue;
        const type = e.type as string | undefined;

        // Session titles carry no timestamp, so hold them aside and attach
        // them only to sessions that turn out to fall inside the window.
        if (type === 'ai-title' && typeof e.aiTitle === 'string') {
          titles.set(sessionId, e.aiTitle);
          continue;
        }

        const ts = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
        if (Number.isNaN(ts) || ts < from || ts >= to) continue;

        if (type === 'pr-link' && typeof e.prNumber === 'number') {
          const url = String(e.prUrl ?? '');
          prs.set(url || `${e.prRepository}#${e.prNumber}`, {
            repo: String(e.prRepository ?? 'unknown'),
            number: e.prNumber,
            url,
            at: new Date(ts).toISOString(),
          });
          continue;
        }

        let s = sessions.get(sessionId);
        if (!s) {
          s = accum(sessionId);
          sessions.set(sessionId, s);
        }
        s.firstAt = Math.min(s.firstAt, ts);
        s.lastAt = Math.max(s.lastAt, ts);
        if (typeof e.cwd === 'string') {
          s.cwds.set(e.cwd, (s.cwds.get(e.cwd) ?? 0) + 1);
        }
        if (typeof e.gitBranch === 'string' && realBranch(e.gitBranch)) {
          s.branches.add(e.gitBranch);
        }

        if (type === 'user' && !e.isSidechain) {
          // Only what a person typed — tool results and injected context also
          // arrive as `user` entries but carry no promptId.
          const origin = e.origin as { kind?: string } | undefined;
          if (e.promptId && origin?.kind === 'human') {
            const msg = e.message as { content?: unknown } | undefined;
            const text = textOf(msg?.content).trim();
            if (text) s.prompts.push({ at: ts, text: truncate(text) });
          }
        } else if (type === 'assistant') {
          s.assistantMessages += 1;
          const msg = e.message as
            | {
                model?: string;
                content?: unknown;
                usage?: Record<string, number>;
              }
            | undefined;
          if (msg?.model && realModel(msg.model)) s.models.add(msg.model);
          if (Array.isArray(msg?.content)) {
            for (const block of msg.content) {
              const b = block as { type?: string; name?: string };
              if (b?.type === 'tool_use' && b.name) {
                s.tools.set(b.name, (s.tools.get(b.name) ?? 0) + 1);
              }
            }
          }
          const u = msg?.usage;
          if (u) {
            s.tokens.input += u.input_tokens ?? 0;
            s.tokens.output += u.output_tokens ?? 0;
            s.tokens.cacheRead += u.cache_read_input_tokens ?? 0;
            s.tokens.cacheCreate += u.cache_creation_input_tokens ?? 0;
          }
        } else if (type === 'system' && e.subtype === 'turn_duration') {
          s.activeMs += typeof e.durationMs === 'number' ? e.durationMs : 0;
        }
      }
    }
  }

  for (const [id, title] of titles) {
    const s = sessions.get(id);
    if (s) s.title = title;
  }

  return {
    sessions: [...sessions.values()].sort((a, b) => a.firstAt - b.firstAt),
    prs: [...prs.values()].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

/** Today's Claude spend, if the cost file is still on the requested day. */
async function readCost(home: string, day: string): Promise<number | null> {
  const file = await readJson<{
    date?: string;
    sessions?: Record<string, { baseline?: number; current?: number }>;
  }>(join(home, 'daily-cost.json'));
  if (!file || file.date !== day || !file.sessions) return null;
  let total = 0;
  for (const s of Object.values(file.sessions)) {
    // `current` is cumulative for the session; `baseline` is what it had
    // already accrued before today, so the day's share is the difference.
    total += Math.max(0, (s.current ?? 0) - (s.baseline ?? 0));
  }
  return Math.round(total * 100) / 100;
}

/** Read everything Claude recorded for one civil day. */
export async function fetchClaudeDay(
  day: string,
  opts: { home: string; timezone: string },
): Promise<ClaudeDay> {
  const { start, end } = bounds(day, day, opts.timezone);
  const from = start.getTime();
  const to = end.getTime();

  const [prompts, transcripts, costUsd] = await Promise.all([
    readHistory(opts.home, from, to),
    readTranscripts(opts.home, from, to),
    readCost(opts.home, day),
  ]);

  const sessions: ClaudeSession[] = transcripts.sessions.map((s) => ({
    id: s.id,
    title: s.title,
    project: dominantProject(s.cwds),
    branches: [...s.branches],
    startedAt: new Date(s.firstAt).toISOString(),
    endedAt: new Date(s.lastAt).toISOString(),
    activeMinutes: Math.round(s.activeMs / 60_000),
    prompts: s.prompts.sort((a, b) => a.at - b.at).map((p) => p.text),
    models: [...s.models],
    tools: [...s.tools.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  }));

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  let assistantMessages = 0;
  let toolCalls = 0;
  let activeMinutes = 0;
  for (const s of transcripts.sessions) {
    tokens.input += s.tokens.input;
    tokens.output += s.tokens.output;
    tokens.cacheRead += s.tokens.cacheRead;
    tokens.cacheCreate += s.tokens.cacheCreate;
    assistantMessages += s.assistantMessages;
    for (const n of s.tools.values()) toolCalls += n;
    activeMinutes += Math.round(s.activeMs / 60_000);
  }

  const models = [...new Set(sessions.flatMap((s) => s.models))];
  const projects = [
    ...new Set([
      ...sessions.map((s) => s.project),
      ...prompts.map((p) => p.project),
    ].filter((p): p is string => Boolean(p))),
  ];

  return {
    sessions,
    // history.jsonl is the authority on what was typed; transcripts agree but
    // can miss prompts from sessions whose files have been pruned.
    prompts: prompts.length
      ? prompts
      : sessions.flatMap((s) =>
          s.prompts.map((text) => ({ at: s.startedAt, project: s.project, text })),
        ),
    prs: transcripts.prs,
    totals: {
      sessions: sessions.length,
      prompts: prompts.length,
      assistantMessages,
      toolCalls,
      activeMinutes,
      costUsd,
      tokens,
    },
    models,
    projects,
  };
}
