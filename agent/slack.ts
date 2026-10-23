/**
 * Slack: one connection to the messaging sidecar, and four ways in.
 *
 *   Talk      @-mention Daily Plate, or message it directly, and the assistant
 *             answers (assistant/agent.ts). It tells a greeting from an ask,
 *             reads the plate, plates a message, adds a task, and changes a
 *             plated message from its thread.
 *   Reaction  React :knife_fork_plate: to any message in a channel the app is
 *             in, and remove it to take the message off. :brain: records
 *             feedback for the Wrap tab instead (wrap/feedback.ts).
 *             `actionable_reactions` decides which emoji are forwarded, and
 *             the adapter fetches the message text before handing it over.
 *   Mention   A message that mentions someone on TEAM, in a channel listed in
 *             `observe_channel_ids` (or in a thread the app can see). The
 *             adapter forwards those messages whole; this file keeps each one
 *             on the plate and the Notifications tab of everyone it names.
 *
 * Everything lands on one person's plate: a reaction on the plate of whoever
 * reacted, :brain: in their wrap, a mention with each member it names, and
 * the assistant works on the plate of whoever is talking to it. Someone not
 * on TEAM has no plate, and their reactions are ignored.
 *
 * `serve()` from @astropods/adapter-mastra owns the connection, and traces
 * each assistant turn. It would hand every message to the model, so the
 * bridge is patched, as Capcom's is: only talk reaches the assistant, and
 * everything else is handled here with no model call.
 *
 * The bot only sees channels it was invited to and never sees DMs between
 * people, so a mention elsewhere has to be reacted onto the plate instead.
 *
 * The sidecar only exists when deployed with messaging on, or locally under
 * `ast project start`, and every failure is logged and dropped so the screen
 * works without Slack.
 */

import { connect } from 'node:net';
import { MessagingBridge } from '@astropods/adapter-core';
import { serve } from '@astropods/adapter-mastra';
import type { Message, MessagingClient } from '@astropods/messaging';
import { assistant } from './assistant/agent.ts';
import { ownerName } from './assistant/tools.ts';
import { setTurn } from './assistant/turns.ts';
import { config } from './config.ts';
import * as notifications from './notifications.ts';
import * as store from './store.ts';
import { asUser, memberForSlack, team } from './users.ts';
import { captureFeedback, FEEDBACK_EMOJI } from './wrap/feedback.ts';
import { slackLink } from './slack-link.ts';

/**
 * Astro injects the sidecar's address as GRPC_SERVER_ADDR, deployed and under
 * `ast project start` alike. Unset means there is no sidecar. Guessing
 * localhost:9090 instead found a dev server on that port and crashed in gRPC.
 */
const SIDECAR = process.env.GRPC_SERVER_ADDR || process.env.MESSAGING_ADDRESS || '';

/** Whether the sidecar stream is up, for the screen's Slack tile. */
let connected = false;

export function slackConnected(): boolean {
  return connected;
}

/** Longest text kept as a plate item's title. The link has the rest. */
const MAX_TITLE = 280;

type Stream = ReturnType<MessagingClient['createConversationStream']>;

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

/** `[reaction :emoji: removed by <@U…> on message]`: the message is not refetched. */
const REMOVAL_HEADER = /^\[reaction :([^:]+): removed by <@([^>]+)> on message\]/;

function parseReaction(content: string): { emoji: string; reactor: string; text: string } | null {
  const match = content.match(REACTION_HEADER);
  if (!match) return null;
  return { emoji: match[1]!, reactor: match[2]!, text: content.slice(match[0].length).trim() };
}

function titleOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1)}…` : flat;
}

/**
 * Who wrote a reacted message, as `<@U…|Name>`: the id finds their picture,
 * and the name holds when Slack cannot be asked.
 */
function authorOf(extra: Record<string, string>): string {
  if (!extra.author_id) return extra.author_name || '';
  return extra.author_name ? `<@${extra.author_id}|${extra.author_name}>` : `<@${extra.author_id}>`;
}

/** `Added to Sohum's plate for Monday, October 19. 5 open.` */
function platedReply(isNew: boolean, open: number): string {
  const who = `${ownerName()}'s`;
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
  return isNew ? `Added to ${who} plate for ${day}. ${open} open.` : `Already on ${who} plate. ${open} open.`;
}

/** START, DELTA, END: the adapter only posts a buffered DELTA on END. */
function say(stream: Stream | null, conversationId: string, text: string): void {
  if (!stream || !conversationId) return;
  stream.sendContentChunk(conversationId, { type: 'START', content: '' });
  stream.sendContentChunk(conversationId, { type: 'DELTA', content: text });
  stream.sendContentChunk(conversationId, { type: 'END', content: '' });
}

/** An @-mention of Daily Plate, a DM to it, or the playground: someone talking to the assistant. */
function isTalk(message: Message): boolean {
  if (message.platform === 'web') return true;
  const kind = message.platformContext?.eventKind;
  return kind === 'EVENT_KIND_APP_MENTION' || kind === 'EVENT_KIND_DM';
}

/**
 * A reaction or an observed message, handled with no model. `reply` posts in
 * the message's thread.
 */
async function handle(message: Message, reply: (text: string) => void): Promise<void> {
  const ctx = message.platformContext ?? ({} as NonNullable<Message['platformContext']>);
  const content = message.content ?? '';
  const channel = ctx.channelName ? `#${ctx.channelName}` : ctx.channelId ?? '';
  const link = slackLink(ctx.channelId ?? '', ctx.messageId ?? '', ctx.threadRootId ?? '');
  const extra = ctx.platformData ?? {};

  if (ctx.eventKind === 'EVENT_KIND_REACTION') {
    const removal = content.match(REMOVAL_HEADER);
    if (removal) {
      // Taking feedback back is not a thing the wrap does; only a plate reaction undoes.
      if (FEEDBACK_EMOJI.has(removal[1]!)) return;
      const member = memberForSlack(ctx.userId || removal[2]!);
      if (!member) return;
      const removed = await asUser(member, () =>
        store.removeSlackItem(`${ctx.channelId}:${ctx.messageId}`, ['reaction']),
      );
      console.log(`[slack] ${removed ? 'unplated' : 'nothing to unplate for'} ${member.login}'s reaction from ${channel || '?'}`);
      return;
    }
    const parsed = parseReaction(content);
    if (!parsed?.text) {
      console.warn('[slack] reaction arrived with no readable message text');
      return;
    }
    // platformContext.userId is always the raw U…; message.user.id may be
    // rewritten to a WorkOS id once a Slack account is linked.
    const member = memberForSlack(ctx.userId || parsed.reactor);
    if (!member) {
      console.log(`[slack] ignored :${parsed.emoji}: from ${ctx.userId || parsed.reactor}, who is not on TEAM`);
      return;
    }
    if (FEEDBACK_EMOJI.has(parsed.emoji)) {
      reply(
        await asUser(member, () => captureFeedback(message, parsed, link)).catch((err) => {
          console.error('[slack] could not store the feedback:', err);
          return 'Could not record that one. It is still in Slack, so react again later.';
        }),
      );
      return;
    }
    // A reaction needs a visible result, or it is indistinguishable from a
    // channel the app was never invited to.
    try {
      await asUser(member, async () => {
        const { item, isNew } = await store.addSlackItem({
          source: 'reaction',
          externalId: `${ctx.channelId}:${ctx.messageId}`,
          title: titleOf(parsed.text),
          url: link,
          context: channel,
          author: authorOf(extra),
        });
        console.log(`[slack] ${isNew ? 'plated' : 'refreshed'} ${member.login}'s reaction from ${item.context || '?'}`);
        if (isNew) reply(platedReply(isNew, await store.openCount()));
      });
    } catch (err) {
      console.error('[slack] could not store the message:', err);
      reply('Could not plate that one. React again later.');
    }
    return;
  }

  // Observed top-level messages and thread replies both carry the raw text,
  // mentions intact as <@U…>. Replying in somebody else's thread to say you
  // were mentioned is noise, so these get none. Mentioning yourself is a
  // note to self: it plates, but it is not a notification.
  if (ctx.eventKind !== 'EVENT_KIND_OBSERVED' && ctx.eventKind !== 'EVENT_KIND_THREAD_REPLY') return;
  const externalId = `${ctx.channelId}:${ctx.messageId}`;
  for (const member of team()) {
    if (!member.slackId || !content.includes(`<@${member.slackId}>`)) continue;
    await asUser(member, async () => {
      try {
        const { item, isNew } = await store.addSlackItem({
          source: 'mention',
          externalId,
          title: titleOf(content),
          url: link,
          context: channel,
          author: ctx.userId ? `<@${ctx.userId}>` : '',
        });
        console.log(`[slack] ${isNew ? 'plated' : 'refreshed'} a mention of ${member.login} from ${item.context || '?'}`);
      } catch (err) {
        console.error(`[slack] could not store ${member.login}'s mention:`, err);
      }
      if (ctx.userId === member.slackId) return;
      // The Notifications tab keeps it too, read or not, after the plate clears it.
      await notifications
        .add([
          {
            source: 'slack',
            kind: 'mention',
            externalId,
            title: channel,
            body: titleOf(content.replaceAll(`<@${member.slackId}>`, '@you')),
            url: link,
            context: channel,
            author: ctx.userId ? `<@${ctx.userId}>` : '',
            at: new Date(Number(ctx.messageId) * 1000 || Date.now()).toISOString(),
          },
        ])
        .catch((err) => console.error(`[slack] could not store ${member.login}'s notification:`, err));
    });
  }
}

const PATCHED = Symbol.for('daily-plate/bridge-patched');

/**
 * Route each message before the bridge gives it to the model. Patches the
 * prototype, since `serve()` builds the bridge inside and never hands it out.
 * Idempotent, and only works while adapter-mastra and this file share one
 * copy of adapter-core: package.json pins both to the same version.
 */
export function patchBridge(): void {
  const proto = MessagingBridge.prototype as unknown as {
    handleMessage(message: Message): void;
    start(): Promise<void>;
    stream: Stream | null;
    [PATCHED]?: boolean;
  };
  if (proto[PATCHED]) return;

  const toModel = proto.handleMessage;
  proto.handleMessage = function (this: typeof proto, message: Message) {
    const ctx = message.platformContext;
    console.log(`[slack] inbound ${ctx?.eventKind ?? message.platform ?? 'unknown'} channel=${ctx?.channelName || ctx?.channelId || '?'}`);
    if (!isTalk(message)) {
      const stream = this.stream;
      void handle(message, (text) => say(stream, message.conversationId, text)).catch((err) =>
        console.error('[slack] could not handle the message:', err),
      );
      return;
    }
    if (ctx) {
      setTurn(message.conversationId, {
        channelId: ctx.channelId ?? '',
        channel: ctx.channelName ? `#${ctx.channelName}` : ctx.channelId ?? '',
        messageId: ctx.messageId ?? '',
        threadRootId: ctx.threadRootId ?? '',
        workspaceId: ctx.workspaceId ?? '',
        userId: ctx.userId ?? '',
      });
    }
    toModel.call(this, message);
  };

  const start = proto.start;
  proto.start = async function (this: typeof proto) {
    await start.call(this);
    connected = true;
    const ids = team().filter((m) => m.slackId);
    console.log(
      `[slack] registered with the sidecar via ${SIDECAR} — ` +
        (ids.length
          ? `capturing reactions and mentions of ${ids.map((m) => `${m.login} <@${m.slackId}>`).join(', ')}`
          : 'capturing reactions for the owner; put Slack ids on TEAM for mentions'),
    );
    this.stream?.on('error', (err: Error) => {
      connected = false;
      console.error('[slack] stream gave up:', err.message);
    });
  };
  proto[PATCHED] = true;
}

export async function startSlack(): Promise<void> {
  if (!SIDECAR) {
    console.log('[slack] GRPC_SERVER_ADDR is unset — no messaging sidecar, Slack off');
    return;
  }
  if (!(await sidecarPresent(SIDECAR))) {
    console.log(`[slack] no messaging sidecar at ${SIDECAR} — Slack off`);
    return;
  }
  if (process.env.ASTRO_GATEWAY_URL) {
    console.log(`[slack] the assistant talks through the AI gateway with ${process.env.MODEL_DEFAULT ?? 'its default model'}`);
  } else if (config.llm.anthropicKey) {
    console.log(`[slack] the assistant talks to Anthropic with ${config.llm.model}`);
  } else {
    console.warn('[slack] no AI gateway and no ANTHROPIC_API_KEY — the assistant cannot answer mentions');
  }
  patchBridge();
  serve(assistant, { serverAddress: SIDECAR });
}
