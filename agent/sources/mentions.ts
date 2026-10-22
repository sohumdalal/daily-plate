/**
 * Where someone @-mentioned you on GitHub lately: in a comment, a review, a
 * comment on a line of a PR, or the body of a new issue or PR, across every
 * repo `GITHUB_ORGS` holds.
 *
 * GitHub's notifications API would be the obvious read, but it answers only
 * a user's own token, and deployed Daily Plate signs in as a GitHub App. So
 * the issues and PRs that mention you and changed since the last read are
 * searched, and what was written on each since then is scanned for your
 * handle. One GraphQL query a page, whatever the number of threads.
 */

import type { Octokit } from '@octokit/rest';

/** Threads a page. Each carries its latest comments and reviews, well under GraphQL's node limit. */
const PAGE = 50;
const MAX_PAGES = 4;
const MAX_BODY = 280;

export type MentionKind = 'comment' | 'review' | 'line' | 'opened';

export type Mention = {
  /** The comment's own URL, which is unique and stable across edits. */
  externalId: string;
  kind: MentionKind;
  /** The issue or PR it was written on. */
  title: string;
  /** What was written, flattened to one line and cut short. */
  body: string;
  url: string;
  /** `astropods/astro#1377` */
  context: string;
  author: string;
  at: string;
};

type Post = { url: string; body: string; createdAt: string; author: { login: string } | null };

type Thread = Post & {
  __typename: 'Issue' | 'PullRequest';
  number: number;
  title: string;
  repository: { nameWithOwner: string };
  comments: { nodes: Post[] };
  reviews?: {
    nodes: (Omit<Post, 'createdAt'> & { submittedAt: string | null; comments: { nodes: Post[] } })[];
  };
};

const POSTS = 'url body createdAt author { login }';
const THREAD = `number title repository { nameWithOwner } ${POSTS} comments(last: 50) { nodes { ${POSTS} } }`;

const SEARCH = `
  query($q: String!, $cursor: String) {
    search(type: ISSUE, query: $q, first: ${PAGE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        ... on Issue { ${THREAD} }
        ... on PullRequest {
          ${THREAD}
          reviews(last: 20) {
            nodes {
              url body submittedAt author { login }
              comments(first: 20) { nodes { ${POSTS} } }
            }
          }
        }
      }
    }
  }
`;

/**
 * Whether a body names `login`. A quoted line (`> @you said…`) is someone
 * replying to an older mention, and code is code, so neither counts.
 */
export function mentions(body: string, login: string): boolean {
  const prose = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');
  const handle = login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w/@-])@${handle}(?![\\w-])`, 'i').test(prose);
}

/** One line of what was said, quotes and code left out. */
function snippet(body: string): string {
  const flat = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY - 1)}…` : flat;
}

/** Every mention of `username` written at or after `since`, newest first. */
export async function fetchMentions(
  gh: Octokit,
  username: string,
  owners: string[],
  since: Date,
): Promise<Mention[]> {
  if (!owners.length) return [];
  const login = username.toLowerCase();
  const after = since.getTime();
  // `updated:` takes a full timestamp, so a read every few minutes asks only
  // for threads touched in those minutes.
  const q =
    `mentions:${username} ${owners.map((o) => `user:${o}`).join(' ')} archived:false ` +
    `updated:>=${since.toISOString().replace(/\.\d+Z$/, 'Z')}`;

  const out: Mention[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: {
      search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Thread[] };
    } = await gh.graphql(SEARCH, { q, cursor });

    for (const thread of data.search.nodes) {
      if (!thread?.__typename) continue;
      const context = `${thread.repository.nameWithOwner}#${thread.number}`;
      const take = (post: Post, kind: MentionKind, at: string) => {
        const author = post.author?.login ?? 'ghost';
        if (author.toLowerCase() === login) return;
        if (new Date(at).getTime() < after || !mentions(post.body, username)) return;
        out.push({
          externalId: post.url,
          kind,
          title: thread.title,
          body: snippet(post.body),
          url: post.url,
          context,
          author,
          at,
        });
      };

      take(thread, 'opened', thread.createdAt);
      for (const comment of thread.comments.nodes) take(comment, 'comment', comment.createdAt);
      for (const review of thread.reviews?.nodes ?? []) {
        // A review still pending is visible to its author alone.
        if (!review.submittedAt) continue;
        take({ ...review, createdAt: review.submittedAt }, 'review', review.submittedAt);
        for (const line of review.comments.nodes) take(line, 'line', line.createdAt);
      }
    }

    if (!data.search.pageInfo.hasNextPage) break;
    cursor = data.search.pageInfo.endCursor;
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
