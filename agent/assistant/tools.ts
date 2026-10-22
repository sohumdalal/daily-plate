/**
 * What the Slack assistant can do to the plate. Every change goes through
 * store.ts, the same as the screen, and each tool answers with what actually
 * happened, so the reply never claims more than was done.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { config } from '../config.ts';
import * as store from '../store.ts';
import type { Item, Source } from '../store.ts';
import { assignee } from '../sync.ts';
import { dayOf } from '../time.ts';
import { permalink, turnOf } from './turns.ts';

/** Longest list readPlate returns before "and N more". */
const MAX_LISTED = 25;
/** Longest title kept, as on a reacted message. The link has the rest. */
const MAX_TITLE = 280;

/** `Sohum`, from the GitHub profile, or the handle before it is read. */
export function ownerName(): string {
  const name = assignee()?.name || config.github.username;
  return name.split(' ')[0] || 'the owner';
}

const SECTIONS: Record<string, { label: string; sources: Source[] }> = {
  slack: { label: 'from Slack', sources: ['mention', 'reaction'] },
  github: { label: 'from GitHub', sources: ['board', 'pr', 'issue'] },
  board: { label: 'board cards', sources: ['board'] },
  prs: { label: 'PRs', sources: ['pr'] },
  issues: { label: 'issues', sources: ['issue'] },
  tasks: { label: 'tasks', sources: ['task'] },
};

const SOURCE_NAME: Record<Source, string> = {
  board: 'board card',
  pr: 'PR',
  issue: 'issue',
  mention: 'Slack',
  reaction: 'Slack',
  task: 'task',
};

function shortTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1)}…` : flat;
}

function brief(item: Item) {
  return {
    title: item.title,
    url: item.url || undefined,
    kind: SOURCE_NAME[item.source],
    where: item.source === 'task' ? undefined : item.context || undefined,
    column: item.status || undefined,
    state: item.state || undefined,
    notes: item.notes.length || undefined,
  };
}

export const readPlate = createTool({
  id: 'readPlate',
  description:
    "Read what is open on the plate right now, newest first, and what was cleared today. Use it for any question about the plate.",
  inputSchema: z.object({
    only: z
      .enum(['slack', 'github', 'board', 'prs', 'issues', 'tasks'])
      .optional()
      .describe('Keep one part of the plate. Leave it out for everything.'),
  }),
  execute: async ({ only }) => {
    const today = dayOf(new Date(), config.timezone);
    const section = only ? SECTIONS[only] : undefined;
    const items = (await store.plate(today, config.timezone)).filter(
      (i) => !section || section.sources.includes(i.source),
    );
    const open = items.filter((i) => !i.doneAt);
    return {
      owner: ownerName(),
      scope: section?.label ?? 'everything',
      openCount: open.length,
      open: open.slice(0, MAX_LISTED).map(brief),
      notListed: Math.max(0, open.length - MAX_LISTED),
      clearedToday: items.filter((i) => i.doneAt).map((i) => i.title),
    };
  },
});

export const plateMessage = createTool({
  id: 'plateMessage',
  description:
    'Put a Slack message on the plate: this message, or in a thread the message the thread hangs off. ' +
    'Use it when someone asks the owner to do something, or asks you to plate, add or save a message.',
  inputSchema: z.object({
    target: z
      .enum(['this_message', 'thread_root'])
      .describe('thread_root plates the message the thread started from, and needs a thread.'),
    title: z
      .string()
      .min(1)
      .describe("The ask in the sender's own words, without the @-mention. The whole ask, not a summary."),
  }),
  execute: async ({ target, title }, { requestContext }) => {
    const turn = turnOf(requestContext);
    if (!turn) return { ok: false, reason: 'not in a Slack message' };
    if (target === 'thread_root' && !turn.threadRootId) return { ok: false, reason: 'this message is not in a thread' };
    const messageId = target === 'thread_root' ? turn.threadRootId : turn.messageId;
    const { item, isNew } = await store.addSlackItem({
      source: 'mention',
      externalId: `${turn.channelId}:${messageId}`,
      title: shortTitle(title),
      url: permalink(turn, messageId),
      context: turn.channel,
      author: turn.userId,
    });
    console.log(`[assistant] ${isNew ? 'plated' : 'refreshed'} a message from ${turn.channel || '?'}`);
    return { ok: true, alreadyOnPlate: !isNew, title: item.title, openCount: await store.openCount() };
  },
});

export const addTask = createTool({
  id: 'addTask',
  description: 'Add a task of the owner’s own to the plate, with no Slack message or GitHub item behind it.',
  inputSchema: z.object({ title: z.string().min(1).max(2000) }),
  execute: async ({ title }) => {
    const item = await store.addTask(title.trim());
    return { ok: true, title: item.title, openCount: await store.openCount() };
  },
});

export const changePlated = createTool({
  id: 'changePlated',
  description:
    'Change the plated message this thread hangs off: clear it (done), put it back (reopen), rename it, ' +
    'add a note to it, or take it off the plate (remove). Only works in the thread of a plated message.',
  inputSchema: z.object({
    action: z.enum(['done', 'reopen', 'rename', 'note', 'remove']),
    text: z.string().optional().describe('The new title for rename, or the note for note.'),
  }),
  execute: async ({ action, text }, { requestContext }) => {
    const turn = turnOf(requestContext);
    if (!turn) return { ok: false, reason: 'not in a Slack message' };
    if (!turn.threadRootId) return { ok: false, reason: 'not in a thread: reply in the thread of the plated message' };
    const externalId = `${turn.channelId}:${turn.threadRootId}`;
    if ((action === 'rename' || action === 'note') && !text?.trim()) {
      return { ok: false, reason: `${action} needs text` };
    }

    if (action === 'remove') {
      const removed = await store.removeSlackItem(externalId, ['mention', 'reaction']);
      return removed
        ? { ok: true, openCount: await store.openCount() }
        : { ok: false, reason: 'the message this thread hangs off is not on the plate' };
    }
    const item = await store.findSlackItem(externalId);
    if (!item) return { ok: false, reason: 'the message this thread hangs off is not on the plate' };
    if (action === 'rename') await store.renameItem(item.id, shortTitle(text!));
    if (action === 'note') await store.addNote(item.id, text!.trim());
    if (action === 'done') await store.setDone(item.id, true);
    if (action === 'reopen') await store.setDone(item.id, false);
    return { ok: true, title: action === 'rename' ? shortTitle(text!) : item.title, openCount: await store.openCount() };
  },
});

export const tools = { readPlate, plateMessage, addTask, changePlated };
