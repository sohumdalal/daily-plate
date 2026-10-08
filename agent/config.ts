import { describeTarget, targetIsLocal } from './db/client.ts';

/**
 * Env → config. Every value here is either injected by Astropods (see the
 * `integrations`/`knowledge` blocks in astropods.yml) or declared as an
 * `agent.inputs` entry there.
 */

export type ProjectRef = { owner: string; number: number };

/** `astropods/1,astropods/4` → two refs. Anything malformed is dropped loudly. */
function parseProjects(raw: string): ProjectRef[] {
  const out: ProjectRef[] = [];
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = part.match(/^([\w.-]+)\/(\d+)$/);
    if (match) out.push({ owner: match[1]!, number: Number(match[2]) });
    else console.warn(`[config] GITHUB_PROJECTS entry "${part}" is not owner/number — skipped`);
  }
  return out;
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
    username: process.env.GITHUB_USERNAME ?? '',
    projects: parseProjects(process.env.GITHUB_PROJECTS ?? 'astropods/1,astropods/4'),
  },
  slack: {
    /** The raw U… id. Mentions of it are captured; only its reactions count. */
    userId: (process.env.SLACK_USER_ID ?? '').trim(),
  },
};

export const isDev = config.port !== 80;

/** What the agent can and cannot do right now, for the UI to report honestly. */
export function readiness() {
  return {
    timezone: config.timezone,
    github: Boolean(config.github.token && config.github.username),
    projects: config.github.projects.map((p) => `${p.owner}/${p.number}`),
    slackMentions: Boolean(config.slack.userId),
    database: describeTarget(),
    databaseIsLocal: targetIsLocal(),
  };
}
