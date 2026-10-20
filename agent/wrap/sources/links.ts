/**
 * The day's artifacts, as links.
 *
 * Built entirely from what was collected — never from model output. A wrap is
 * written prose and can be wrong about a number; a source is a URL someone can
 * click, so it comes straight from the GitHub API and the Claude transcripts.
 * New providers (Slack threads, docs, tickets) join by adding a `kind` and a
 * branch that maps their records into this shape.
 */

import type { ClaudeDay, GitHubDay, Source } from '../types.ts';

/** Enough to cover a busy period without turning the list into a wall. */
const MAX_SOURCES = 80;

const KIND_ORDER: Record<Source['kind'], number> = {
  merged: 0,
  opened: 1,
  reviewed: 2,
  commit: 3,
  slack: 4,
};

function shorten(text: string, max = 96): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Collect the sources for one day. `claude.prs` are PRs opened from inside a
 * Claude Code session; they usually also appear in the GitHub results, so the
 * dedupe by URL matters.
 */
export function sourcesForDay(
  claude: ClaudeDay | null,
  github: GitHubDay | null,
): Source[] {
  const byUrl = new Map<string, Source>();

  const add = (source: Source): void => {
    if (!source.url) return;
    const existing = byUrl.get(source.url);
    // A PR that was opened and merged on the same day should read as merged.
    if (existing && KIND_ORDER[existing.kind] <= KIND_ORDER[source.kind]) return;
    byUrl.set(source.url, source);
  };

  for (const pr of github?.merged ?? []) {
    add({
      kind: 'merged',
      ref: `${pr.repo}#${pr.number}`,
      label: shorten(pr.title),
      url: pr.url,
      at: pr.mergedAt ?? pr.createdAt,
    });
  }
  for (const pr of github?.opened ?? []) {
    add({
      kind: 'opened',
      ref: `${pr.repo}#${pr.number}`,
      label: shorten(pr.title),
      url: pr.url,
      at: pr.createdAt,
    });
  }
  for (const pr of github?.reviewed ?? []) {
    add({
      kind: 'reviewed',
      ref: `${pr.repo}#${pr.number}`,
      label: shorten(pr.title),
      url: pr.url,
      at: pr.at,
      author: pr.author,
    });
  }
  for (const commit of github?.commits ?? []) {
    add({
      kind: 'commit',
      ref: `${commit.repo} ${commit.sha}`,
      label: shorten(commit.message),
      url: commit.url,
      at: commit.at,
    });
  }
  // PRs the transcripts know about that the API search missed — commit search
  // is indexed with a lag, so this occasionally catches something real.
  for (const pr of claude?.prs ?? []) {
    add({
      kind: 'opened',
      ref: `${pr.repo}#${pr.number}`,
      label: 'Opened from a Claude Code session',
      url: pr.url,
      at: pr.at,
    });
  }

  return [...byUrl.values()]
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (b.at ?? '').localeCompare(a.at ?? ''),
    )
    .slice(0, MAX_SOURCES);
}

/** Merge several days' sources for a period wrap, keeping the same ordering. */
export function mergeSources(perDay: Source[][]): Source[] {
  const byUrl = new Map<string, Source>();
  for (const sources of perDay) {
    for (const source of sources) {
      const existing = byUrl.get(source.url);
      if (existing && KIND_ORDER[existing.kind] <= KIND_ORDER[source.kind]) continue;
      byUrl.set(source.url, source);
    }
  }
  return [...byUrl.values()]
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (b.at ?? '').localeCompare(a.at ?? ''),
    )
    .slice(0, MAX_SOURCES);
}
