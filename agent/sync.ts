/**
 * Keeps the GitHub half of each plate current — the boards, and each
 * member's PRs and issues across the orgs — on boot, every SYNC_EVERY_MS,
 * and whenever the screen asks. Each member is read in turn, as themselves.
 */

import { config, readiness } from './config.ts';
import {
  fetchAssignedCards,
  fetchProfile,
  gh,
  type BoardSummary,
  type Profile,
} from './sources/github.ts';
import { fetchRepoWork } from './sources/repos.ts';
import { markStacks } from './sources/work.ts';
import * as store from './store.ts';
import { asUser, currentUser, team } from './users.ts';

const SYNC_EVERY_MS = 10 * 60_000;

export type SyncResult = {
  at: string;
  ok: boolean;
  cards: number;
  pulls: number;
  issues: number;
  added: number;
  cleared: number;
  /** The boards as last read successfully. */
  boards: BoardSummary[];
  error?: string;
};

/** Each member's last sync, by login. */
const last = new Map<string, SyncResult>();
const running = new Map<string, Promise<SyncResult>>();
/** Read once each: a name and an avatar do not change between syncs. */
const profiles = new Map<string, Profile>();

export function lastSync(): SyncResult | null {
  return last.get(currentUser()) ?? null;
}

export function assignee(): Profile | null {
  return profiles.get(currentUser()) ?? null;
}

/** Any member's profile, once read. */
export function profileOf(login: string): Profile | null {
  return profiles.get(login) ?? null;
}

/** The current member's sync. One at a time each; a second caller waits on the first. */
export function syncBoards(): Promise<SyncResult> {
  const login = currentUser();
  let sync = running.get(login);
  if (!sync) {
    sync = readOne(login).finally(() => running.delete(login));
    running.set(login, sync);
  }
  return sync;
}

/** Everyone on the team, one after another so GitHub sees one reader. */
export async function syncTeam(): Promise<void> {
  for (const member of team()) await asUser(member, syncBoards);
}

async function readOne(login: string): Promise<SyncResult> {
  const previous = last.get(login);
  let result: SyncResult;
  const at = new Date().toISOString();
  try {
    if (!readiness().github) {
      throw new Error('a GitHub App or GITHUB_TOKEN is needed to read the boards');
    }
    const { cards, boards } = await fetchAssignedCards(login, config.github.projects);
    // A missing profile only costs the screen a name, never the sync.
    if (!profiles.has(login)) {
      const profile = await fetchProfile(login).catch((err) => {
        console.warn(`[sync] could not read ${login}'s GitHub profile:`, err.message);
        return null;
      });
      if (profile) profiles.set(login, profile);
    }
    // An issue or PR already on a board stays there, and only there.
    const { pulls, issues } = await fetchRepoWork(
      gh(),
      login,
      config.github.orgs,
      new Set(cards.map((c) => c.externalId)),
    );
    // A missing stack only costs the screen a pill, never the sync.
    await markStacks(
      gh(),
      [...cards, ...pulls, ...issues].flatMap((c) => (c.work ? [c.work] : [])),
    ).catch((err) => console.warn('[sync] could not read PR stacks:', err.message));
    // Only after a full read: clearing what is missing from a partial one
    // would empty the plate on every GitHub hiccup.
    let added = 0;
    let cleared = 0;
    for (const [source, list] of [['board', cards], ['pr', pulls], ['issue', issues]] as const) {
      const result = await store.syncSource(source, list);
      added += result.added;
      cleared += result.cleared;
    }
    result = {
      at,
      ok: true,
      cards: cards.length,
      pulls: pulls.filter((p) => !p.done).length,
      issues: issues.length,
      added,
      cleared,
      boards,
    };
    console.log(
      `[sync] ${login}: ${cards.length} cards, ${pulls.length} PRs, ${issues.length} issues — ` +
        `${added} new, ${cleared} cleared`,
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Keep the last good board names, so a failed read can still say which
    // boards it failed on.
    result = {
      at,
      ok: false,
      cards: 0,
      pulls: 0,
      issues: 0,
      added: 0,
      cleared: 0,
      boards: previous?.boards ?? [],
      error,
    };
    console.error(`[sync] GitHub read for ${login} failed:`, error);
  }
  last.set(login, result);
  return result;
}

export function startBoardSync(): void {
  void syncTeam();
  setInterval(() => void syncTeam(), SYNC_EVERY_MS);
}
