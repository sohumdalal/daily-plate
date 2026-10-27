/**
 * Every issue on the boards, whoever it is assigned to, for the Board tab.
 *
 * The plate reads only your cards (sources/github.ts); this reads the whole
 * board once and shares it across the team, since the board is the same for
 * everyone. A board holds a few hundred cards, so a read is a handful of
 * GraphQL pages, kept for READ_TTL_MS.
 *
 * Each issue carries the PRs that reference it, so a still-open issue whose
 * PR has merged can be named as one that may be closed.
 */

import { config, type ProjectRef } from '../config.ts';
import { gh } from '../sources/github.ts';

const PAGE = 100;
const MAX_PAGES = 20;
/** How long a read of the boards is served before the next one. */
const READ_TTL_MS = 10 * 60 * 1000;
/** Enough of an issue's body for a judge to know what it asks. */
const BODY_CHARS = 1500;

export type Person = { login: string; avatar: string };

export type IssuePr = { number: number; title: string; url: string; state: 'OPEN' | 'MERGED' | 'CLOSED'; mergedAt: string | null };

export type BoardIssue = {
  /** The node id, which stays the same if the issue moves repo. */
  id: string;
  url: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  notPlanned: boolean;
  column: string;
  boards: string[];
  labels: string[];
  author: Person | null;
  assignees: Person[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** PRs that close or mention it, newest first. */
  prs: IssuePr[];
};

type PrNode = { __typename?: string; number: number; title: string; url: string; state: IssuePr['state']; mergedAt: string | null };

type IssueNode = {
  __typename: 'Issue';
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  stateReason: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  assignees: { nodes: { login: string; avatarUrl: string }[] };
  labels: { nodes: { name: string }[] };
  comments: { totalCount: number };
  closedByPullRequestsReferences: { nodes: PrNode[] };
  timelineItems: { nodes: { source?: PrNode | null }[] };
};

type ItemNode = {
  isArchived: boolean;
  status: { name: string } | null;
  content: IssueNode | { __typename: 'PullRequest' | 'DraftIssue' } | null;
};

type ProjectPage = {
  title: string;
  items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ItemNode[] };
};

const PR = 'number title url state mergedAt';

const ITEMS = `
  title
  items(first: ${PAGE}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      isArchived
      status: fieldValueByName(name: "Status") {
        ... on ProjectV2ItemFieldSingleSelectValue { name }
      }
      content {
        __typename
        ... on Issue {
          id number title url body state stateReason createdAt updatedAt closedAt
          repository { nameWithOwner }
          author { login avatarUrl }
          assignees(first: 10) { nodes { login avatarUrl } }
          labels(first: 10) { nodes { name } }
          comments { totalCount }
          closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { ${PR} } }
          timelineItems(last: 5, itemTypes: [CROSS_REFERENCED_EVENT]) {
            nodes { ... on CrossReferencedEvent { source { __typename ... on PullRequest { ${PR} } } } }
          }
        }
      }
    }
  }
`;

// As in sources/github.ts: the owner may be an org or a user, so both are
// asked for and the NOT_FOUND for the wrong one is ignored.
const QUERY = `
  query($owner: String!, $number: Int!, $cursor: String) {
    organization(login: $owner) { projectV2(number: $number) { ${ITEMS} } }
    user(login: $owner) { projectV2(number: $number) { ${ITEMS} } }
  }
`;

type QueryResult = {
  organization: { projectV2: ProjectPage | null } | null;
  user: { projectV2: ProjectPage | null } | null;
};

async function readPage(ref: ProjectRef, cursor: string | null): Promise<ProjectPage> {
  let data: QueryResult;
  try {
    data = await gh().graphql<QueryResult>(QUERY, { ...ref, cursor });
  } catch (err) {
    const partial = err as { data?: QueryResult; errors?: { type?: string; message: string }[] };
    if (!partial.data) throw err;
    const fatal = partial.errors?.find((e) => e.type !== 'NOT_FOUND');
    if (fatal) throw new Error(fatal.message);
    data = partial.data;
  }
  const project = data.organization?.projectV2 ?? data.user?.projectV2;
  if (!project) throw new Error(`project ${ref.owner}/${ref.number} not found`);
  return project;
}

const person = (p: { login: string; avatarUrl: string }): Person => ({ login: p.login, avatar: p.avatarUrl });

function toIssue(node: IssueNode, column: string, board: string): BoardIssue {
  const prs = new Map<string, IssuePr>();
  for (const pr of [...node.closedByPullRequestsReferences.nodes, ...node.timelineItems.nodes.map((t) => t.source)]) {
    if (!pr?.url || (pr.__typename && pr.__typename !== 'PullRequest')) continue;
    prs.set(pr.url, { number: pr.number, title: pr.title, url: pr.url, state: pr.state, mergedAt: pr.mergedAt });
  }
  return {
    id: node.id,
    url: node.url,
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    body: (node.body ?? '').slice(0, BODY_CHARS),
    state: node.state === 'OPEN' ? 'open' : 'closed',
    notPlanned: node.stateReason === 'NOT_PLANNED',
    column,
    boards: [board],
    labels: node.labels.nodes.map((l) => l.name),
    author: node.author ? person(node.author) : null,
    assignees: node.assignees.nodes.map(person),
    comments: node.comments.totalCount,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    closedAt: node.closedAt,
    prs: [...prs.values()].sort((a, b) => b.number - a.number),
  };
}

async function readBoards(projects: ProjectRef[]): Promise<BoardIssue[]> {
  const byId = new Map<string, BoardIssue>();
  for (const ref of projects) {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const project = await readPage(ref, cursor);
      for (const node of project.items.nodes) {
        if (node.isArchived || node.content?.__typename !== 'Issue') continue;
        const issue = node.content as IssueNode;
        const existing = byId.get(issue.id);
        if (existing) existing.boards.push(project.title);
        else byId.set(issue.id, toIssue(issue, node.status?.name ?? '', project.title));
      }
      if (!project.items.pageInfo.hasNextPage) break;
      cursor = project.items.pageInfo.endCursor;
    }
  }
  return [...byId.values()];
}

let cache: { at: number; issues: BoardIssue[] } | null = null;
let reading: Promise<BoardIssue[]> | null = null;

/** The boards' issues, read again when the last read is older than READ_TTL_MS or `fresh` asks. */
export async function boardIssues({ fresh = false } = {}): Promise<{ at: number; issues: BoardIssue[] }> {
  if (cache && !fresh && Date.now() - cache.at < READ_TTL_MS) return cache;
  // Two tabs asking at once share one read.
  reading ??= readBoards(config.github.projects).finally(() => (reading = null));
  const issues = await reading;
  cache = { at: Date.now(), issues };
  return cache;
}
