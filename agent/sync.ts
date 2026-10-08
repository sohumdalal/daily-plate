/**
 * Keeps the board half of the plate current: on boot, every SYNC_EVERY_MS,
 * and whenever the screen asks.
 */

import { config } from './config.ts';
import { fetchAssignedCards } from './sources/github.ts';
import * as store from './store.ts';

const SYNC_EVERY_MS = 10 * 60_000;

export type SyncResult = {
  at: string;
  ok: boolean;
  cards: number;
  added: number;
  cleared: number;
  error?: string;
};

let last: SyncResult | null = null;
let running: Promise<SyncResult> | null = null;

export function lastSync(): SyncResult | null {
  return last;
}

/** One sync at a time; a second caller waits on the first. */
export function syncBoards(): Promise<SyncResult> {
  running ??= (async () => {
    const at = new Date().toISOString();
    try {
      if (!config.github.token || !config.github.username) {
        throw new Error('GITHUB_TOKEN and GITHUB_USERNAME are both needed to read the boards');
      }
      const cards = await fetchAssignedCards(
        config.github.token,
        config.github.username,
        config.github.projects,
      );
      // Only after a full read: clearing what is missing from a partial one
      // would empty the plate on every GitHub hiccup.
      const { added, cleared } = await store.syncBoard(cards);
      last = { at, ok: true, cards: cards.length, added, cleared };
      console.log(`[sync] ${cards.length} cards assigned — ${added} new, ${cleared} cleared`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      last = { at, ok: false, cards: 0, added: 0, cleared: 0, error };
      console.error('[sync] board read failed:', error);
    }
    return last;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startBoardSync(): void {
  void syncBoards();
  setInterval(() => void syncBoards(), SYNC_EVERY_MS);
}
