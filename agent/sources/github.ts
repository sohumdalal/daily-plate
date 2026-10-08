/**
 * Reads the cards assigned to you off one or more GitHub Projects (v2).
 *
 * A board is small — the two Astro Kanbans hold a few hundred cards between
 * them — so each is read whole and filtered here. The GraphQL `items` filter
 * would save a few pages but is not on every Projects API version.
 *
 * Needs a token with `read:project`. A token without it gets a GraphQL error
 * naming the scope, which is passed through to the screen as-is.
 */

import { Octokit } from '@octokit/rest';
import type { ProjectRef } from '../config.ts';
import type { BoardCard } from '../store.ts';
import { deriveState, prRef, resolveWork } from './work.ts';

const PAGE = 100;
const MAX_PAGES = 20;

/** Column names that mean the card is off your plate. */
const DONE_COLUMN = /^done$/i;

let client: Octokit | null = null;

function gh(token: string): Octokit {
  client ??= new Octokit({ auth: token });
  return client;
}

type Assignees = { nodes: { login: string }[] };

type ItemNode = {
  isArchived: boolean;
  status: { name: string } | null;
  content:
    | {
        __typename: 'Issue';
        id: string;
        number: number;
        title: string;
        url: string;
        state: string;
        repository: { nameWithOwner: string };
        assignees: Assignees;
      }
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
        assignees: Assignees;
      }
    | { __typename: 'DraftIssue'; id: string; title: string; assignees: Assignees }
    | null;
};

type ProjectPage = {
  title: string;
  url: string;
  items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ItemNode[] };
};

const ITEMS = `
  title
  url
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
          id number title url state
          repository { nameWithOwner }
          assignees(first: 10) { nodes { login } }
        }
        ... on PullRequest {
          number title url state isDraft reviewDecision headRefName
          repository { nameWithOwner }
          assignees(first: 10) { nodes { login } }
        }
        ... on DraftIssue {
          id title
          assignees(first: 10) { nodes { login } }
        }
      }
    }
  }
`;

// A project's owner is an organization or a user, and GraphQL needs to be told
// which. Asking for both in one query returns null for the wrong one alongside
// a NOT_FOUND error, so errors are inspected rather than thrown on.
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

async function readPage(
  token: string,
  ref: ProjectRef,
  cursor: string | null,
): Promise<ProjectPage> {
  let data: QueryResult;
  try {
    data = await gh(token).graphql<QueryResult>(QUERY, { ...ref, cursor });
  } catch (err) {
    // Partial success: one of organization/user is always NOT_FOUND.
    const partial = (err as { data?: QueryResult; errors?: { type?: string; message: string }[] });
    if (!partial.data) throw err;
    const fatal = partial.errors?.find((e) => e.type !== 'NOT_FOUND');
    if (fatal) throw new Error(fatal.message);
    data = partial.data;
  }
  const project = data.organization?.projectV2 ?? data.user?.projectV2;
  if (!project) throw new Error(`project ${ref.owner}/${ref.number} not found`);
  return project;
}

/** Whose plate this is, as GitHub names them. */
export type Profile = { login: string; name: string; avatarUrl: string; url: string };

export async function fetchProfile(token: string, username: string): Promise<Profile> {
  const { data } = await gh(token).users.getByUsername({ username });
  return {
    login: data.login,
    // Not everyone sets a display name; the handle stands in.
    name: data.name || data.login,
    avatarUrl: data.avatar_url,
    url: data.html_url,
  };
}

/** One board as the screen names and links it. */
export type BoardSummary = {
  owner: string;
  number: number;
  title: string;
  url: string;
};

/** Every non-archived card on the boards that is assigned to `username`. */
export async function fetchAssignedCards(
  token: string,
  username: string,
  projects: ProjectRef[],
): Promise<{ cards: BoardCard[]; boards: BoardSummary[] }> {
  const login = username.toLowerCase();
  type Pending = Omit<BoardCard, 'state' | 'work'> & {
    doneOn: boolean[];
    content: NonNullable<ItemNode['content']>;
  };
  const byId = new Map<string, Pending>();
  const boards: BoardSummary[] = [];

  for (const ref of projects) {
    let cursor: string | null = null;
    let summary: BoardSummary | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const project = await readPage(token, ref, cursor);
      if (!summary) {
        summary = { ...ref, title: project.title, url: project.url };
        boards.push(summary);
      }

      for (const node of project.items.nodes) {
        const content = node.content;
        if (node.isArchived || !content) continue;
        if (!content.assignees.nodes.some((a) => a.login.toLowerCase() === login)) continue;

        const status = node.status?.name ?? '';
        const isDraft = content.__typename === 'DraftIssue';
        const externalId = isDraft ? `draft:${content.id}` : content.url;
        const done = DONE_COLUMN.test(status) || (!isDraft && content.state !== 'OPEN');

        const existing = byId.get(externalId);
        if (existing) {
          existing.boards.push(project.title);
          existing.doneOn.push(done);
          // The column that still has work in it is the one worth showing.
          if (!done) existing.status = status;
          continue;
        }
        byId.set(externalId, {
          externalId,
          title: content.title,
          url: isDraft ? project.url : content.url,
          context: isDraft ? 'Draft' : `${content.repository.nameWithOwner}#${content.number}`,
          status,
          boards: [project.title],
          done,
          doneOn: [done],
          content,
        });
      }

      if (!project.items.pageInfo.hasNextPage) break;
      cursor = project.items.pageInfo.endCursor;
    }
  }

  // What is being done about each issue, in one lookup for all of them.
  const pending = [...byId.values()];
  const work = await resolveWork(
    gh(token),
    pending.flatMap((p) => (p.content.__typename === 'Issue' ? [p.content.id] : [])),
  );

  const cards = pending.map(({ doneOn, content, ...card }): BoardCard => {
    let found = null;
    let closed = false;
    let notPlanned = false;
    if (content.__typename === 'Issue') {
      const issue = work.get(content.id);
      found = issue?.work ?? null;
      closed = issue?.closed ?? content.state !== 'OPEN';
      notPlanned = issue?.notPlanned ?? false;
    } else if (content.__typename === 'PullRequest') {
      // The card is the PR itself.
      found = prRef(content, 'self');
      closed = content.state === 'CLOSED';
    }
    return {
      ...card,
      // On two boards, a card is done only when both say so.
      done: doneOn.every(Boolean),
      state: deriveState({ column: card.status, closed, notPlanned, work: found }),
      work: found,
    };
  });
  return { cards, boards };
}
