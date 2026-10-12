/**
 * Your open PRs and assigned issues across every repo of one or more GitHub
 * owners, through search. Boards only hold what someone put on them; this
 * catches the rest.
 *
 * Issues get the same state and PR/branch lookup as board cards. A PR is its
 * own work, so its state comes straight from it.
 */

import type { Octokit } from '@octokit/rest';
import type { BoardCard } from '../store.ts';
import { deriveState, prRef, resolveWork } from './work.ts';

/** Search stops at 1000 results; nobody has that many open. */
const PAGE = 100;
const MAX_PAGES = 5;

type Hit =
  | {
      __typename: 'PullRequest';
      number: number;
      title: string;
      url: string;
      state: 'OPEN' | 'MERGED' | 'CLOSED';
      isDraft: boolean;
      reviewDecision: string | null;
      headRefName: string;
      repository: { nameWithOwner: string };
    }
  | {
      __typename: 'Issue';
      id: string;
      number: number;
      title: string;
      url: string;
      repository: { nameWithOwner: string };
    };

const SEARCH = `
  query($q: String!, $cursor: String) {
    search(query: $q, type: ISSUE, first: ${PAGE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        ... on PullRequest {
          number title url state isDraft reviewDecision headRefName
          repository { nameWithOwner }
        }
        ... on Issue {
          id number title url
          repository { nameWithOwner }
        }
      }
    }
  }
`;

async function search(gh: Octokit, q: string): Promise<Hit[]> {
  const out: Hit[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: {
      search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Hit[] };
    } = await gh.graphql(SEARCH, { q, cursor });
    out.push(...data.search.nodes.filter((n) => n?.__typename));
    if (!data.search.pageInfo.hasNextPage) break;
    cursor = data.search.pageInfo.endCursor;
  }
  return out;
}

function card(hit: Hit): Omit<BoardCard, 'state' | 'work'> {
  return {
    externalId: hit.url,
    title: hit.title,
    url: hit.url,
    context: `${hit.repository.nameWithOwner}#${hit.number}`,
    status: '',
    boards: [],
    done: false,
  };
}

/**
 * Open PRs `username` wrote and open issues assigned to them, across every
 * repo `owners` hold. `skip` is what the boards already show, by URL, so
 * nothing is on the plate twice.
 */
export async function fetchRepoWork(
  gh: Octokit,
  username: string,
  owners: string[],
  skip: Set<string>,
): Promise<{ pulls: BoardCard[]; issues: BoardCard[] }> {
  if (!owners.length) return { pulls: [], issues: [] };
  const scope = `${owners.map((o) => `user:${o}`).join(' ')} is:open archived:false`;

  const pullHits = await search(gh, `${scope} is:pr author:${username}`);
  const pulls = pullHits.flatMap((hit): BoardCard[] => {
    if (hit.__typename !== 'PullRequest' || skip.has(hit.url)) return [];
    const work = prRef(hit, 'self');
    return [{ ...card(hit), state: deriveState({ column: '', closed: false, notPlanned: false, work }), work }];
  });

  const issueHits = (await search(gh, `${scope} is:issue assignee:${username}`)).filter(
    (hit) => hit.__typename === 'Issue' && !skip.has(hit.url),
  ) as Extract<Hit, { __typename: 'Issue' }>[];
  const work = await resolveWork(gh, issueHits.map((hit) => hit.id));
  const issues = issueHits.map((hit): BoardCard => {
    const found = work.get(hit.id);
    return {
      ...card(hit),
      state: deriveState({
        column: '',
        closed: found?.closed ?? false,
        notPlanned: found?.notPlanned ?? false,
        work: found?.work ?? null,
      }),
      work: found?.work ?? null,
    };
  });

  return { pulls, issues };
}
