/**
 * Which Slack message each conversation's turn is answering.
 *
 * The Mastra adapter hands a tool the conversation id and nothing else about
 * the message, so slack.ts records the message here before the turn starts,
 * and the tools look it up by the id in their request context.
 */

import type { RequestContext } from '@mastra/core/request-context';

export type Turn = {
  channelId: string;
  /** `#quill-test`, or the bare id when Slack gave no name. */
  channel: string;
  messageId: string;
  /** The message the thread hangs off, when the mention is a reply in one. */
  threadRootId: string;
  workspaceId: string;
  /** The sender's raw Slack id. */
  userId: string;
};

/** Plenty for the conversations open at once; the oldest goes first. */
const KEEP = 500;
const turns = new Map<string, Turn>();

export function setTurn(conversationId: string, turn: Turn): void {
  turns.delete(conversationId);
  turns.set(conversationId, turn);
  if (turns.size > KEEP) turns.delete(turns.keys().next().value!);
}

export function turnOf(requestContext: RequestContext | undefined): Turn | null {
  const id = requestContext?.get('threadId');
  return typeof id === 'string' ? (turns.get(id) ?? null) : null;
}

export function permalink(turn: Turn, messageId: string): string {
  if (!turn.workspaceId || !turn.channelId || !messageId) return '';
  return `https://${turn.workspaceId}.slack.com/archives/${turn.channelId}/p${messageId.replace('.', '')}`;
}
