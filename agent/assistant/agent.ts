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
import { ownerName, tools } from './tools.ts';
import { turnOf } from './turns.ts';

function instructions(sender: { name: string; isOwner: boolean; inThread: boolean }): string {
  const owner = ownerName();
  const plate = sender.isOwner ? 'your plate' : `${owner}'s plate`;
  return `
You are Daily Plate, ${owner}'s assistant in Slack. The plate is ${owner}'s list of what to do
today: cards assigned to them on GitHub boards, their open PRs and issues, Slack messages put on
it, and tasks they typed in. Ticking an item clears it.

${sender.name || 'Someone'} is talking to you${sender.isOwner ? `, and they are ${owner}` : ''}.
${sender.inThread ? 'The message is a reply in a thread.' : 'The message is not in a thread.'}
A message can start with [slack_thread_summary]: that is the thread so far, and the last
paragraph is the new message.

Work out what they want before you act:
- A greeting, thanks, or small talk ("hi", "how are you", "thanks!"): reply in a sentence, in a
  friendly way, and do nothing else. Never put a greeting or thanks on the plate.
- A question about the plate ("what's on my plate", "anything from Slack?", "how many PRs are
  open?"): call readPlate and answer from what it returns.
- An ask for ${owner} to do something ("can you review this", "please send the deck"), or "plate
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
  const url = process.env.ASTRO_GATEWAY_URL;
  if (url) {
    const gateway = createOpenAI({ apiKey: process.env.ASTRO_GATEWAY_API_KEY, baseURL: `${url}/v1` });
    // Chat Completions, not the SDK's default Responses API, which the gateway
    // mistranslates for multi-step tool calls (Capcom found this).
    return gateway.chat(process.env.MODEL_DEFAULT ?? 'claude-sonnet-4-6');
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
    const name = requestContext.get('userName');
    return instructions({
      name: typeof name === 'string' ? name : '',
      isOwner: Boolean(turn && config.slack.userId && turn.userId === config.slack.userId),
      inThread: Boolean(turn?.threadRootId),
    });
  },
  model: chatModel(),
  memory,
  tools,
  // A reply needs a step after its last tool call to say what happened.
  defaultOptions: { maxSteps: 6 },
});
