/**
 * The Slack assistant: whoever @-mentions Daily Plate, or messages it
 * directly, talks to this agent. It tells a greeting from an ask, answers
 * questions about the plate, and changes the plate only through its tools.
 *
 * It talks through the Astro AI gateway, as Capcom does. Conversation memory
 * keeps the last turns of each Slack thread, so "yes, plate it" can follow a
 * question; it lives in a local file and starts empty after a restart.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { config } from '../config.ts';
import { asUser, memberForSlack } from '../users.ts';
import { ownerName, tools } from './tools.ts';
import { turnOf } from './turns.ts';

/** For someone with no plate: the team is set in the deploy form, not here. */
function strangerInstructions(name: string): string {
  return `
You are Daily Plate, a team's assistant in Slack. Each person on the team has a plate: their list
of what to do today. ${name || 'The person talking to you'} is not on the team, so they have no
plate, and your tools will refuse. Say so in one or two friendly sentences, and say that whoever
deployed Daily Plate can add them to TEAM. Answer greetings in kind.
`.trim();
}

function instructions(sender: { name: string; inThread: boolean }): string {
  const owner = ownerName();
  const plate = 'your plate';
  return `
You are Daily Plate, a team's assistant in Slack. Each person on the team has their own plate:
their list of what to do today, from cards assigned to them on GitHub boards, their open PRs and
issues, Slack messages put on it, and tasks they typed in. Ticking an item clears it.

${sender.name || owner} is talking to you, and the plate your tools read and change is theirs.
${sender.inThread ? 'The message is a reply in a thread.' : 'The message is not in a thread.'}
A message can start with [slack_thread_summary]: that is the thread so far, and the last
paragraph is the new message.

Work out what they want before you act:
- A greeting, thanks, or small talk ("hi", "how are you", "thanks!"): reply in a sentence, in a
  friendly way, and do nothing else. Never put a greeting or thanks on the plate.
- A question about the plate ("what's on my plate", "anything from Slack?", "how many PRs are
  open?"): call readPlate and answer from what it returns.
- An ask for them to do something ("can you review this", "please send the deck"), or "plate
  this", "add this", "save this": call plateMessage. In a thread, when the ask is the message the
  thread started from, use target thread_root.
- "Add a task …": call addTask with the task.
- In the thread of a plated message: "done" or "clear it" is done, "undo" or "put it back" is
  reopen, "rename to …" is rename, "note …" is note, "remove this" or "take it off" is remove.
  Call changePlated.
- What you can do: say so in two or three lines.
- When you cannot tell whether they want something plated, ask one short question. They answer by
  mentioning you again in the thread.

Rules:
- Act only through the tools, and say only what a tool confirmed. When a tool answers ok: false,
  say why in plain words.
- Call it ${plate}.
- Keep replies short: one to three sentences, or a short list. Write Markdown: **bold**, and
  links as [title](url). Use no headings.
- After a change, give the new count, such as "Added to ${plate}. 5 open."
`.trim();
}

/**
 * Deployed, the Astro AI gateway, as Capcom talks: the `default` model entry
 * in astropods.yml injects its URL, key and model id. Without it, as on a
 * laptop, the Wrap tab's own Anthropic key and model.
 */
function chatModel() {
  const { url, key, model } = config.llm.gateway;
  if (url) {
    const gateway = createOpenAI({ apiKey: key, baseURL: `${url}/v1` });
    // Chat Completions, not the SDK's default Responses API, which the gateway
    // mistranslates for multi-step tool calls (Capcom found this).
    return gateway.chat(model);
  }
  return createAnthropic({ apiKey: config.llm.anthropicKey })(config.llm.model);
}

const memory = new Memory({
  storage: new LibSQLStore({
    id: 'daily-plate-assistant',
    url: process.env.ASSISTANT_MEMORY_DB_URL ?? 'file:/tmp/daily-plate-assistant.db',
  }),
  // A turn with a tool call is three or four messages; 20 keeps several turns.
  options: { lastMessages: 20 },
});

export const assistant = new Agent({
  id: 'daily-plate',
  name: 'Daily Plate',
  description: 'Talks about your plate in Slack, and puts on it what you ask.',
  instructions: ({ requestContext }) => {
    const turn = turnOf(requestContext);
    const raw = requestContext.get('userName');
    const name = typeof raw === 'string' ? raw : '';
    const member = turn ? memberForSlack(turn.userId) : undefined;
    if (!member) return strangerInstructions(name);
    return asUser(member, () => instructions({ name, inThread: Boolean(turn?.threadRootId) }));
  },
  model: chatModel(),
  memory,
  tools,
  // A reply needs a step after its last tool call to say what happened.
  defaultOptions: { maxSteps: 6 },
});
