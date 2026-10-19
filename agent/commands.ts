/**
 * What `@Daily Plate …` can be asked in Slack, besides "put this on the plate".
 *
 *   Read     "what's on my plate", optionally "from slack / github / prs / tasks"
 *   Create   "add task <title>" adds a task of your own
 *   Update   in a thread: "rename to <title>", "note <text>", "done", "undo"
 *   Delete   in a thread: "remove this"
 *
 * Update and delete act on the message the thread hangs off, which is what a
 * reaction or a mention put on the plate. Plain keyword matching: Daily Plate
 * has no model, and a command that misfires is worse than one that is missed.
 */

import { config } from './config.ts';
import * as store from './store.ts';
import type { Item, Source } from './store.ts';
import { assignee } from './sync.ts';
import { dayOf } from './time.ts';

/** Longest list a "what's on my plate" reply shows before "and N more". */
const MAX_LISTED = 15;

export type Ask = { text: string; channelId: string; threadRootId: string };

/** `Sohum's`, from the GitHub profile, or `your` before it is read. */
export function plateOwner(): string {
  const name = assignee()?.name || config.github.username;
  return name ? `${name.split(' ')[0]}'s` : 'your';
}

const FILTERS: { pattern: RegExp; label: string; sources: Source[] }[] = [
  { pattern: /\bslack\b/i, label: 'from Slack', sources: ['mention', 'reaction'] },
  { pattern: /\b(prs?|pull requests?)\b/i, label: 'PRs', sources: ['pr'] },
  { pattern: /\bissues?\b/i, label: 'issues', sources: ['issue'] },
  { pattern: /\b(board|kanban|cards?)\b/i, label: 'board cards', sources: ['board'] },
  { pattern: /\b(gh|github)\b/i, label: 'from GitHub', sources: ['board', 'pr', 'issue'] },
  { pattern: /\btasks?\b/i, label: 'tasks', sources: ['task'] },
];

const SOURCE_NAME: Record<Source, string> = {
  board: 'board',
  pr: 'PR',
  issue: 'issue',
  mention: 'Slack',
  reaction: 'Slack',
  task: 'task',
};

/** `3 PRs`, `1 board card`, `2 Slack`. */
const COUNT_NAME: Record<string, [string, string]> = {
  board: ['board card', 'board cards'],
  PR: ['PR', 'PRs'],
  issue: ['issue', 'issues'],
  Slack: ['Slack', 'Slack'],
  task: ['task', 'tasks'],
};

const READ = /\b(what'?s|what is|show( me)?|list)\b.*\bplate\b/i;
const ADD_TASK = /^\s*(add (a )?task|new task|task)\s*:?\s+(.+)$/is;
const REMOVE = /\b(remove|take (it|this|that) off|unplate|drop)\b/i;
const RENAME = /\b(rename|change|update)( (it|this|that))?( title)? to\s+(.+)$/is;
const NOTE = /^\s*(add (a )?)?note\s*:?\s+(.+)$/is;
const UNDO = /\b(undo|not done|put (it|this|that) back|reopen)\b/i;
const DONE = /^\s*(done|finished)\s*[.!]*\s*$|\b(mark (it|this|that) (as )?done|(it|this) is done|it'?s done|clear (it|this|that))\b/i;

function line(item: Item): string {
  const title = item.url ? `[${item.title}](${item.url})` : item.title;
  const where = item.source === 'task' ? 'task' : item.context || SOURCE_NAME[item.source];
  return `- ${title} · ${where}`;
}

async function read(text: string): Promise<string> {
  const filter = FILTERS.find((f) => f.pattern.test(text));
  const open = (await store.plate(dayOf(new Date(), config.timezone), config.timezone)).filter(
    (i) => !i.doneAt && (!filter || filter.sources.includes(i.source)),
  );
  const who = plateOwner();
  const scope = filter ? ` (${filter.label})` : '';
  if (open.length === 0) return `Nothing open on ${who} plate${scope}.`;

  const counts = new Map<string, number>();
  for (const item of open) counts.set(SOURCE_NAME[item.source], (counts.get(SOURCE_NAME[item.source]) ?? 0) + 1);
  const breakdown = [...counts].map(([name, n]) => `${n} ${COUNT_NAME[name]![n === 1 ? 0 : 1]}`).join(', ');
  const rest = open.length - MAX_LISTED;
  return [
    `**${open.length} open on ${who} plate${scope}:** ${breakdown}`,
    ...open.slice(0, MAX_LISTED).map(line),
    ...(rest > 0 ? [`…and ${rest} more.`] : []),
  ].join('\n');
}

/** The reply to a command, or null when the message is not one and should go on the plate. */
export async function answer(ask: Ask): Promise<string | null> {
  const text = ask.text.trim();
  const who = plateOwner();

  if (/^\s*help\s*[?.!]*\s*$/i.test(text)) {
    return [
      'Mention me with:',
      '- *what’s on my plate*, or *… from slack / github / prs / issues / tasks*',
      '- *add task* <title>',
      '- in a thread: *remove this*, *rename to* <title>, *note* <text>, *done*, *undo*',
      'Anything else puts the message on the plate.',
    ].join('\n');
  }
  if (READ.test(text)) return read(text);

  const task = text.match(ADD_TASK);
  if (task) {
    await store.addTask(task[3]!.trim());
    return `Added a task to ${who} plate: ${task[3]!.trim()}. ${await store.openCount()} open.`;
  }

  const rename = text.match(RENAME);
  const note = text.match(NOTE);
  const kind = REMOVE.test(text)
    ? 'remove'
    : rename
      ? 'rename'
      : note
        ? 'note'
        : UNDO.test(text)
          ? 'undo'
          : DONE.test(text)
            ? 'done'
            : null;
  if (!kind) return null;
  if (!ask.threadRootId) return 'Reply in the thread of the message on the plate, and I will change that one.';

  const externalId = `${ask.channelId}:${ask.threadRootId}`;
  if (kind === 'remove') {
    const removed = await store.removeSlackItem(externalId, ['mention', 'reaction']);
    return removed ? `Took this off ${who} plate. ${await store.openCount()} open.` : `This was not on ${who} plate.`;
  }
  const item = await store.findSlackItem(externalId);
  if (!item) return `This was not on ${who} plate.`;
  switch (kind) {
    case 'rename':
      await store.renameItem(item.id, rename![5]!.trim());
      return `Renamed it on ${who} plate: ${rename![5]!.trim()}.`;
    case 'note':
      await store.addNote(item.id, note![3]!.trim());
      return `Added a note to it on ${who} plate.`;
    case 'done':
      await store.setDone(item.id, true);
      return `Cleared it from ${who} plate. ${await store.openCount()} open.`;
    case 'undo':
      await store.setDone(item.id, false);
      return `Put it back on ${who} plate. ${await store.openCount()} open.`;
  }
}
