import { homedir } from 'node:os';
import { join } from 'node:path';
import { describeTarget, targetIsLocal } from './db/client.ts';

/**
 * Env → config. Every value here is either injected by Astropods (see the
 * `models`/`knowledge` blocks in astropods.yml) or declared as an
 * `agent.inputs` entry there.
 */

export type ProjectRef = { owner: string; number: number };

/** `astropods/1,astropods/2` → two refs. Anything malformed is dropped loudly. */
function parseProjects(raw: string): ProjectRef[] {
  const out: ProjectRef[] = [];
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = part.match(/^([\w.-]+)\/(\d+)$/);
    if (match) out.push({ owner: match[1]!, number: Number(match[2]) });
    else console.warn(`[config] GITHUB_PROJECTS entry "${part}" is not owner/number — skipped`);
  }
  return out;
}

const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Display names people actually type or pick from a dropdown, mapped to real
 * model ids. Configuring this agent by hand or through a deploy form makes
 * `Sonnet` or `Opus 5` far likelier than `claude-sonnet-5`, and the API answers
 * a display name with a flat 401/404 that looks like a bad key.
 */
const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-5',
  'opus-5': 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  'sonnet-5': 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  'haiku-4-5': 'claude-haiku-4-5',
  fable: 'claude-fable-5-1',
  'fable-5-1': 'claude-fable-5-1',
};

function resolveModel(raw: string): string {
  const value = raw.trim();
  if (!value) return DEFAULT_MODEL;
  // A real id passes through untouched, so a model released later still works.
  if (value.startsWith('claude-')) return value;

  const key = value.toLowerCase().replace(/[\s_.]+/g, '-');
  const alias = MODEL_ALIASES[key];
  if (alias) return alias;

  console.warn(
    `[config] ANTHROPIC_MODEL="${raw}" is not a known model id or alias — ` +
      `falling back to ${DEFAULT_MODEL}`,
  );
  return DEFAULT_MODEL;
}

const systemTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const config = {
  port: Number(process.env.PORT ?? 80),
  timezone: process.env.TIMEZONE || systemTimezone(),
  github: {
    token: process.env.GITHUB_TOKEN ?? '',
    /** A GitHub App installed on the org. When set, it replaces the token. */
    app: {
      id: process.env.GITHUB_APP_ID ?? '',
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
      installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? '',
    },
    username: process.env.GITHUB_USERNAME ?? '',
    projects: parseProjects(process.env.GITHUB_PROJECTS ?? 'astropods/1'),
    /** Owners whose every repo is searched for your open PRs and issues. */
    orgs: (process.env.GITHUB_ORGS ?? 'astropods').split(',').map((s) => s.trim()).filter(Boolean),
  },
  /** Signing in with GitHub, through the same GitHub App's OAuth client. */
  auth: {
    clientId: process.env.GITHUB_APP_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? '',
    /** Signs the session cookie. Unset, one is made and kept in the database. */
    sessionSecret: process.env.SESSION_SECRET ?? '',
    /** The public URL GitHub sends people back to; the platform sets it. */
    appUrl: (process.env.ASTRO_EXTERNAL_AGENT_URL || process.env.APP_URL || '').replace(/\/$/, ''),
    /** Local only: be this team member without signing in. */
    devUser: process.env.DEV_USER ?? '',
  },
  claude: {
    /** Claude Code home the wrap reads days out of. Read-only, never written to. */
    home: process.env.CLAUDE_HOME || join(homedir(), '.claude'),
  },
  llm: {
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: resolveModel(process.env.ANTHROPIC_MODEL ?? ''),
  },
  slack: {
    /** The raw U… id. Mentions of it are captured; only its reactions count. */
    userId: (process.env.SLACK_USER_ID ?? '').trim(),
    /** Optional. Lets the agent ask Slack for names and pictures; the sidecar keeps its own. */
    botToken: (process.env.SLACK_PROFILE_TOKEN ?? '').trim(),
  },
};

export const isDev = config.port !== 80;

/** Whether a GitHub App is configured, rather than a plain token. */
export function usesApp(): boolean {
  const { id, privateKey, installationId } = config.github.app;
  return Boolean(id && privateKey && installationId);
}

/** What the agent can and cannot do right now, for the UI to report honestly. */
export function readiness() {
  return {
    timezone: config.timezone,
    github: Boolean(config.github.token || usesApp()),
    projects: config.github.projects.map((p) => `${p.owner}/${p.number}`),
    orgs: config.github.orgs,
    signIn: Boolean(config.auth.clientId && config.auth.clientSecret),
    claudeHome: config.claude.home,
    llm: Boolean(config.llm.anthropicKey),
    model: config.llm.model,
    database: describeTarget(),
    databaseIsLocal: targetIsLocal(),
  };
}
