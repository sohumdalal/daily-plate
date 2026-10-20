/**
 * React :brain: to a Slack message and it becomes feedback on the day you
 * reacted, read by that day's wrap. agent/slack.ts routes the reaction here;
 * the Slack adapter has already fetched the reacted message's text.
 */

import type { Message } from '@astropods/messaging';
import { config } from '../config.ts';
import { dayOf } from '../time.ts';
import * as store from './store.ts';

/** Emoji that record Wrap feedback rather than put a message on the plate. */
export const FEEDBACK_EMOJI = new Set(['brain']);

/** Stores the reaction, and returns the reply that says it was recorded. */
export async function captureFeedback(
  message: Message,
  reaction: { emoji: string; reactor: string; text: string },
  permalink: string,
): Promise<string> {
  const ctx = message.platformContext ?? ({} as NonNullable<Message['platformContext']>);
  const extra = ctx.platformData ?? {};
  const saved = await store.addSlackFeedback({
    // The day it was noticed, not the day the message was written: this is an
    // input to today's wrap.
    day: dayOf(new Date(), config.timezone),
    channelId: ctx.channelId ?? '',
    channelName: ctx.channelName ?? '',
    messageTs: ctx.messageId ?? '',
    threadRoot: ctx.threadRootId ?? '',
    // Not message.user.id: the platform rewrites that to the WorkOS user id
    // once a Slack account is linked. platformContext.userId is always the raw U….
    reactorId: ctx.userId || message.user?.id || reaction.reactor,
    authorId: extra.author_id ?? '',
    authorName: extra.author_name ?? '',
    emoji: reaction.emoji,
    text: reaction.text,
    permalink,
  });
  console.log(
    `[slack] captured :${saved.emoji}: from ${saved.channelName || saved.channelId}` +
      (saved.authorName || saved.authorId ? ` by ${saved.authorName || saved.authorId}` : ''),
  );
  const todays = await store.slackFeedbackBetween(saved.day, saved.day);
  const nth = todays.length === 1 ? 'first one today' : `${todays.length} today`;
  return `Feedback recorded for ${saved.day} (${nth}). It will be part of that day's wrap.`;
}
