/**
 * Loads the local environment for anything run outside the container:
 * `.env.local` first, then the ast project bag, then a live `gh` token.
 *
 * Everything run outside the container goes through here, so local runs can
 * never disagree about which database or which credentials they are using.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_NAMES = ['daily-plate', '@sohumdalal/daily-plate'];

export function loadLocalEnv(): void {
  // Anything the shell set already wins over every source below.
  const fromShell = new Set(Object.keys(process.env));

  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!match) continue;
      const key = match[1]!;
      const value = match[2]!.trim().replace(/^['"]|['"]$/g, '');
      if (value && !process.env[key]) process.env[key] = value;
    }
  }

  try {
    const raw = JSON.parse(
      readFileSync(join(homedir(), '.ast', 'project-configs.json'), 'utf-8'),
    );
    const projects = raw.projects ?? raw;
    const entry =
      projects[process.cwd()] ??
      Object.values(projects).find(
        (p): p is { name?: string; vars?: Record<string, unknown> } =>
          !!p &&
          typeof p === 'object' &&
          PROJECT_NAMES.includes((p as { name?: string }).name ?? ''),
      ) ??
      PROJECT_NAMES.map((n) => projects[n]).find(Boolean);

    const vars = entry?.vars ?? entry?.variables;
    if (vars) {
      for (const [key, value] of Object.entries(vars)) {
        if (typeof value === 'string' && !process.env[key]) process.env[key] = value;
      }
    }
  } catch {
    // No ast config. The shell environment and .env.local still apply.
  }

  // `gh` holds a live token; the ast bag holds one that was pasted once and
  // goes stale, then fails as `Bad credentials`. So `gh` overrides the bag,
  // but never a GITHUB_TOKEN the shell set deliberately.
  if (!fromShell.has('GITHUB_TOKEN')) {
    const gh = Bun.spawnSync(['gh', 'auth', 'token']);
    const token = gh.exitCode === 0 ? gh.stdout.toString().trim() : '';
    if (token) process.env.GITHUB_TOKEN = token;
  }

  process.env.GITHUB_USERNAME ??= 'sohumdalal';

  if (!process.env.POSTGRES_URL) {
    process.env.POSTGRES_HOST ??= 'localhost';
    process.env.POSTGRES_PORT ??= '5432';
    process.env.POSTGRES_DB ??= 'daily_plate';
    process.env.POSTGRES_USER ??= process.env.USER ?? 'postgres';
    process.env.POSTGRES_PASSWORD ??= '';
  }
}
