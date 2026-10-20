import type { Period } from '../time.ts';

// ── Claude Code activity ───────────────────────────────────────────────────

export type ClaudeSession = {
  id: string;
  /** Claude's own generated title for the session — the best one-line summary. */
  title: string | null;
  /** Repo or directory the session ran in, shortened to a basename. */
  project: string | null;
  branches: string[];
  startedAt: string;
  endedAt: string;
  /** Summed turn durations, not wall-clock between first and last message. */
  activeMinutes: number;
  prompts: string[];
  models: string[];
  tools: Array<{ name: string; count: number }>;
};

export type ClaudePrompt = {
  at: string;
  project: string | null;
  text: string;
};

export type ClaudePrLink = {
  repo: string;
  number: number;
  url: string;
  at: string;
};

export type ClaudeDay = {
  sessions: ClaudeSession[];
  prompts: ClaudePrompt[];
  prs: ClaudePrLink[];
  totals: {
    sessions: number;
    prompts: number;
    assistantMessages: number;
    toolCalls: number;
    activeMinutes: number;
    costUsd: number | null;
    tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  };
  models: string[];
  projects: string[];
};

// ── GitHub activity ────────────────────────────────────────────────────────

export type Commit = {
  repo: string;
  sha: string;
  message: string;
  url: string;
  at: string;
};

export type PullRequest = {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  createdAt: string;
  mergedAt: string | null;
  additions: number | null;
  deletions: number | null;
};

export type ReviewedPullRequest = {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  at: string;
};

export type GitHubDay = {
  commits: Commit[];
  opened: PullRequest[];
  merged: PullRequest[];
  reviewed: ReviewedPullRequest[];
  repos: string[];
  totals: {
    commits: number;
    opened: number;
    merged: number;
    reviewed: number;
    additions: number;
    deletions: number;
  };
};

/**
 * One clickable artifact behind a wrap. Derived from collected data only, so a
 * source is always something that really exists. `slack` is declared ahead of
 * the integration so the UI and ordering don't need changing when it lands.
 */
export type Source = {
  kind: 'merged' | 'opened' | 'reviewed' | 'commit' | 'slack';
  /** Short identity, e.g. `astropods/astro#2669`. */
  ref: string;
  label: string;
  url: string;
  at: string | null;
  /** Whose work it was, for something reviewed rather than authored. */
  author?: string;
};

// ── Stored records ─────────────────────────────────────────────────────────

export type DayRecord = {
  day: string;
  claude: ClaudeDay | null;
  github: GitHubDay | null;
  collectedAt: string | null;
};

/**
 * What the agent writes back.
 *
 * `did` is what happened. `learned` is the agent's own read on what this person
 * took from the period — a short paragraph, not bullets, because it is an
 * argument rather than a list, and it is the half of the record that sits
 * beside the reflection. `grew` stays terse: the distilled trajectory.
 *
 * `learned` and `grew` may be empty. A quiet day should read as a quiet day
 * rather than have growth invented for it.
 */
export type Wrap = {
  period: Period;
  key: string;
  headline: string;
  did: string[];
  /** 2–3 sentences. The agent's take, paired with the person's reflection. */
  learned: string;
  grew: string[];
  model: string | null;
  generatedAt: string;
};

export const GOAL_CATEGORIES = [
  'career',
  'craft',
  'impact',
  'personal',
  'intrinsic',
] as const;
export const GOAL_HORIZONS = ['quarter', 'year', 'long'] as const;
export const GOAL_STATUSES = ['active', 'paused', 'achieved', 'dropped'] as const;

export type GoalCategory = (typeof GOAL_CATEGORIES)[number];
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/**
 * Something this person is trying to become. Active goals are an input to
 * every wrap, which is what lets "where to improve" be measured against their
 * own direction instead of against nothing.
 */
export type Goal = {
  id: string;
  title: string;
  category: GoalCategory;
  horizon: GoalHorizon;
  /** Why it matters to them. The anchor that keeps a goal from being someone else's. */
  why: string;
  measure: string;
  status: GoalStatus;
  sort: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A Slack message you marked as feedback with a reaction. Kept whole: it is
 * someone else's words, and paraphrasing them would lose the thing that made
 * it worth keeping.
 */
export type SlackFeedback = {
  id: string;
  day: string;
  channelId: string;
  channelName: string;
  messageTs: string;
  threadRoot: string;
  reactorId: string;
  /** Who wrote it. Empty until the platform forwards it. */
  authorId: string;
  authorName: string;
  emoji: string;
  text: string;
  permalink: string;
  createdAt: string;
};

/** Why a version of a wrap exists. */
export type WrapReason = 'wrap' | 'disagree';

/** One historical wrap. Version 1 is the first ever written for that key. */
export type WrapVersion = Wrap & {
  version: number;
  reason: WrapReason;
};

/**
 * A correction the person made to something the agent wrote. Every wrap
 * written afterwards sees these, which is how the agent's read of them gets
 * less wrong over time.
 */
export type Feedback = {
  id: string;
  period: Period;
  key: string;
  note: string;
  createdAt: string;
};

/** One message in a reflection conversation. */
export type ReflectionTurn = {
  id: string;
  role: 'agent' | 'person';
  text: string;
  createdAt: string;
};

/**
 * What a person took from a period. Three, deliberately: naming the one thing
 * that mattered is the work, and nine bullets is a chore that gets skipped.
 */
export type Takeaways = {
  good: string;
  bad: string;
  improve: string;
};

export type Reflection = {
  period: Period;
  key: string;
  /** Derived from the person's own turns; their authoritative account. */
  body: string;
  energy: number | null;
  takeaways: Takeaways;
  updatedAt: string;
};
