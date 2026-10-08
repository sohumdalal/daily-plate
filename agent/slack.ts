/**
 * Slack ingestion, two ways onto the plate.
 *
 *   Reaction  React :knife_fork_plate: to any message in a channel the app is
 *             in. `actionable_reactions` decides which emoji are forwarded,
 *             and the adapter fetches the message text before handing it over.
 *   Mention   A message that mentions SLACK_USER_ID, in a channel listed in
 *             `observe_channel_ids` (or in a thread the app can see). The
 *             adapter forwards those messages whole; this file keeps the ones
 *             naming you.
 *
 * The bot only sees channels it was invited to and never sees DMs between
 * people, so a mention elsewhere has to be reacted onto the plate instead.
 *
 * Same sidecar handshake as Daily Wrap: the sidecar only exists when deployed
 * with messaging on, or locally under `ast project start`, and every failure
 * is logged and dropped so the screen works without Slack.
 */

import { connect } from 'node:net';
import { MessagingClient, type AgentResponse, type Message } from '@astropods/messaging';
import { config } from './config.ts';
import * as store from './store.ts';

/**
 * Astro injects the sidecar's address as GRPC_SERVER_ADDR, deployed and under
 * `ast project start` alike. Unset means there is no sidecar. Guessing
 * localhost:9090 instead found a dev server on that port and crashed in gRPC.
 */
const SIDECAR = process.env.GRPC_SERVER_ADDR || process.env.MESSAGING_ADDRESS || '';

/** Longest text kept as a plate item's title. The link has the rest. */
const MAX_TITLE = 280;

/** A gRPC channel connects lazily, so probe the port once before streaming. */
async function sidecarPresent(address: string): Promise<boolean> {
  const [host, port] = address.split(':');
  return new Promise((resolve) => {
    const socket = connect({ host: host || 'localhost', port: Number(port ?? 9090) });
    const settle = (present: boolean) => {
      socket.destroy();
      resolve(present);
    };
    socket.setTimeout(700);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/** `[reaction :emoji: added by <@U…> on message]\n` precedes a reaction's text. */
const REACTION_HEADER = /^\[reaction :([^:]+): added by <@([^>]+)> on message\]\n?/;

function parseReaction(content: string): { reactor: string; text: string } | null {
  const match = content.match(REACTION_HEADER);
  if (!match) return null;
  return { reactor: match[2]!, text: content.slice(match[0].length).trim() };
}

function permalink(workspace: string, channelId: string, messageTs: string): string {
  if (!workspace || !channelId || !messageTs) return '';
  return `https://${workspace}.slack.com/archives/${channelId}/p${messageTs.replace('.', '')}`;
}

function titleOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1)}…` : flat;
}

/** START, DELTA, END: the adapter only posts a buffered DELTA on END. */
function say(
  conversation: ReturnType<MessagingClient['createConversationStream']>,
  conversationId: string,
  text: string,
): void {
  conversation.sendContentChunk(conversationId, { type: 'START', content: '' });
  conversation.sendContentChunk(conversationId, { type: 'DELTA', content: text });
  conversation.sendContentChunk(conversationId, { type: 'END', content: '' });
}

export async function startSlackIngestion(): Promise<void> {
  if (!SIDECAR) {
    console.log('[slack] GRPC_SERVER_ADDR is unset — no messaging sidecar, Slack capture off');
    return;
  }
  if (!(await sidecarPresent(SIDECAR))) {
    console.log(`[slack] no messaging sidecar at ${SIDECAR} — Slack capture off`);
    return;
  }

  let client: MessagingClient;
  try {
    client = new MessagingClient(SIDECAR);
    await client.connectWithRetry({ maxRetries: 5 });
  } catch (err) {
    console.log(
      `[slack] could not reach the sidecar at ${SIDECAR} — Slack capture off ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
    return;
  }

  const conversation = client.createConversationStream();

  // The sidecar only registers a stream once the agent speaks first.
  conversation.sendAgentConfig({
    systemPrompt: 'Daily Plate puts Slack messages aimed at you on your plate.',
    tools: [],
  });

  const me = config.slack.userId;
  console.log(
    `[slack] registered with the sidecar via ${SIDECAR} — ` +
      (me ? `capturing reactions and mentions of <@${me}>` : 'capturing reactions; set SLACK_USER_ID for mentions'),
  );

  conversation.on('error', (err: Error) => console.error('[slack] stream gave up:', err.message));

  conversation.on('response', (resp: AgentResponse) => {
    const message = resp.incomingMessage;
    if (message) void handle(message);
  });

  async function handle(message: Message): Promise<void> {
    const ctx = message.platformContext ?? ({} as NonNullable<Message['platformContext']>);
    console.log(
      `[slack] inbound ${ctx.eventKind ?? 'unknown'} channel=${ctx.channelName || ctx.channelId || '?'}`,
    );

    const content = message.content ?? '';
    const channel = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId ?? '';
    const link = permalink(ctx.workspaceId ?? '', ctx.channelId ?? '', ctx.messageId ?? '');
    const extra = ctx.platformData ?? {};

    if (ctx.eventKind === 'EVENT_KIND_REACTION') {
      const parsed = parseReaction(content);
      if (!parsed?.text) {
        console.warn('[slack] reaction arrived with no readable message text');
        return;
      }
      // platformContext.userId is always the raw U…; message.user.id may be
      // rewritten to a WorkOS id once a Slack account is linked.
      const reactor = ctx.userId || parsed.reactor;
      if (me && reactor !== me) return;

      await save(message, {
        source: 'reaction',
        externalId: `${ctx.channelId}:${ctx.messageId}`,
        title: titleOf(parsed.text),
        url: link,
        context: channel,
        author: extra.author_name || extra.author_id || '',
      }, true);
      return;
    }

    // Observed top-level messages and thread replies both carry the raw text,
    // mentions intact as <@U…>.
    if (
      me &&
      (ctx.eventKind === 'EVENT_KIND_OBSERVED' || ctx.eventKind === 'EVENT_KIND_THREAD_REPLY') &&
      content.includes(`<@${me}>`) &&
      ctx.userId !== me
    ) {
      await save(message, {
        source: 'mention',
        externalId: `${ctx.channelId}:${ctx.messageId}`,
        title: titleOf(content),
        url: link,
        context: channel,
        author: ctx.userId ?? '',
      }, false);
    }
  }

  async function save(
    message: Message,
    input: Parameters<typeof store.addSlackItem>[0],
    reply: boolean,
  ): Promise<void> {
    try {
      const { item, isNew } = await store.addSlackItem(input);
      console.log(`[slack] ${isNew ? 'plated' : 'refreshed'} ${item.source} from ${item.context || '?'}`);
      // A reaction needs a visible result, or it is indistinguishable from a
      // channel the app was never invited to. A mention gets none: replying in
      // somebody else's thread to say you were mentioned is noise.
      if (reply && isNew && message.conversationId) {
        const open = await store.openCount();
        say(conversation, message.conversationId, `On your plate (${open} open).`);
      }
    } catch (err) {
      console.error('[slack] could not store the message:', err);
      if (reply && message.conversationId) {
        say(conversation, message.conversationId, 'Could not plate that one. React again later.');
      }
    }
  }
}
