/**
 * What is being done about a card: the PR or branch tackling it, and the
 * lifecycle state that follows.
 *
 * Only cards assigned to you are looked up here, by node id, so the board
 * read itself stays light. Three kinds of evidence, strongest first:
 *
 *   linked       a PR set to close the issue, or a branch created from its
 *                Development sidebar (and that branch's PR)
 *   branch-name  a branch in the issue's repo whose name carries its number,
 *                like `sohum/1377-invite-link`, and that branch's PR
 *   mentioned    an open or merged PR that references the issue
 *
 * A mention is shown but never sets the state: "related to #1377" in some
 * other PR does not mean #1377 is in review, and a merged one does not mean
 * it shipped.
 */

import type { Octokit } from '@octokit/rest';
import type { TicketState, WorkRef } from '../store.ts';

type Pr = {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  reviewDecision: string | null;
  headRefName: string;
  repository: { nameWithOwner: string };
};

const PR_FIELDS = `
  number title url state isDraft reviewDecision headRefName
  repository { nameWithOwner }
`;

type IssueNode = {
  id: string;
  number: number;
  state: 'OPEN' | 'CLOSED';
  stateReason: string | null;
  repository: { nameWithOwner: string };
  closedByPullRequestsReferences: { nodes: Pr[] };
  linkedBranches: {
    nodes: { ref: { name: string; associatedPullRequests: { nodes: Pr[] } } | null }[];
  };
  timelineItems: { nodes: { source?: Partial<Pr> & { __typename?: string } }[] };
};

const ISSUES_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue {
        id number state stateReason
        repository { nameWithOwner }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
          nodes { ${PR_FIELDS} }
        }
        linkedBranches(first: 3) {
          nodes { ref { name associatedPullRequests(first: 3) { nodes { ${PR_FIELDS} } } } }
        }
        timelineItems(last: 15, itemTypes: [CROSS_REFERENCED_EVENT]) {
          nodes { ... on CrossReferencedEvent { source { __typename ... on PullRequest { ${PR_FIELDS} } } } }
        }
      }
    }
  }
`;

type Candidate = { ref: WorkRef; rank: number };

const VIA_RANK: Record<WorkRef['via'], number> = { self: 0, linked: 1, 'branch-name': 2, mentioned: 3 };

/** Approved first: of two open PRs, the one nearest to merging is the news. */
const REVIEW_RANK: Record<string, number> = { APPROVED: 0, CHANGES_REQUESTED: 1, REVIEW_REQUIRED: 2 };

function branchUrl(repo: string, branch: string): string {
  return `https://github.com/${repo}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;
}

export function prRef(pr: Pr, via: WorkRef['via']): WorkRef {
  return {
    kind: 'pr',
    repo: pr.repository.nameWithOwner,
    url: pr.url,
    number: pr.number,
    title: pr.title,
    branch: pr.headRefName,
    prState: pr.state,
    isDraft: pr.isDraft,
    review: pr.reviewDecision,
    via,
  };
}

function branchRef(repo: string, branch: string, via: WorkRef['via']): WorkRef {
  return { kind: 'branch', repo, url: branchUrl(repo, branch), branch, via };
}

/**
 * The one piece of work to show. An open PR beats a merged one beats a bare
 * branch; within those, stronger evidence wins, then the PR nearer to merging.
 * Closed-unmerged PRs are abandoned attempts and are never chosen.
 */
function pick(candidates: Candidate[]): WorkRef | null {
  const live = candidates.filter((c) => c.ref.kind === 'branch' || c.ref.prState !== 'CLOSED');
  const tier = (c: Candidate) =>
    c.ref.kind === 'branch' ? 2 : c.ref.prState === 'OPEN' ? 0 : 1;
  const review = (c: Candidate) =>
    c.ref.isDraft ? 3 : (REVIEW_RANK[c.ref.review ?? ''] ?? 2);
  live.sort((a, b) => tier(a) - tier(b) || a.rank - b.rank || review(a) - review(b));
  return live[0]?.ref ?? null;
}

/** The state a card is in, from the strongest evidence available. */
export function deriveState(input: {
  column: string;
  closed: boolean;
  notPlanned: boolean;
  work: WorkRef | null;
}): TicketState {
  const { column, closed, notPlanned, work } = input;
  // A mention is context, not evidence.
  const evidence = work && work.via !== 'mentioned' ? work : null;

  if (closed) {
    if (evidence?.prState === 'MERGED') return 'merged';
    return notPlanned ? 'not_planned' : 'closed';
  }
  if (evidence?.kind === 'pr') {
    if (evidence.prState === 'MERGED') return 'merged';
    if (evidence.prState === 'OPEN') {
      if (evidence.isDraft) return 'draft';
      if (evidence.review === 'APPROVED') return 'approved';
      if (evidence.review === 'CHANGES_REQUESTED') return 'changes';
      return 'in_review';
    }
  }
  if (evidence?.kind === 'branch') return 'branch';
  if (/^done$/i.test(column)) return 'closed';
  if (/^in progress$/i.test(column)) return 'in_progress';
  if (/^in review$/i.test(column)) return 'in_review';
  return 'open';
}

/** `(^|non-digit)1377(non-digit|$)`, so 1377 does not match 13770. */
function namesIssue(branch: string, number: number): boolean {
  return new RegExp(`(^|\\D)${number}(\\D|$)`).test(branch);
}

/**
 * Branches whose names carry an issue's number, for the issues no link
 * explained. One query per repo, one aliased `refs` search per issue.
 */
async function branchesByName(
  gh: Octokit,
  issues: IssueNode[],
): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  const byRepo = new Map<string, IssueNode[]>();
  for (const issue of issues) {
    const list = byRepo.get(issue.repository.nameWithOwner) ?? [];
    list.push(issue);
    byRepo.set(issue.repository.nameWithOwner, list);
  }

  for (const [repo, list] of byRepo) {
    const [owner, name] = repo.split('/');
    const fields = list
      .map(
        (issue) => `
        i${issue.number}: refs(refPrefix: "refs/heads/", query: "${issue.number}", first: 5) {
          nodes { name associatedPullRequests(first: 2, states: [OPEN, MERGED]) { nodes { ${PR_FIELDS} } } }
        }`,
      )
      .join('');
    const data = await gh.graphql<{
      repository: Record<string, { nodes: { name: string; associatedPullRequests: { nodes: Pr[] } }[] }>;
    }>(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, {
      owner,
      name,
    });

    for (const issue of list) {
      const refs = data.repository[`i${issue.number}`]?.nodes ?? [];
      const found: Candidate[] = [];
      for (const ref of refs) {
        if (!namesIssue(ref.name, issue.number)) continue;
        const prs = ref.associatedPullRequests.nodes;
        if (prs.length) for (const pr of prs) found.push({ ref: prRef(pr, 'branch-name'), rank: VIA_RANK['branch-name'] });
        else found.push({ ref: branchRef(repo, ref.name, 'branch-name'), rank: VIA_RANK['branch-name'] });
      }
      if (found.length) out.set(issue.id, found);
    }
  }
  return out;
}

export type IssueWork = { work: WorkRef | null; closed: boolean; notPlanned: boolean };

/** The work behind each issue, keyed by issue node id. */
export async function resolveWork(gh: Octokit, ids: string[]): Promise<Map<string, IssueWork>> {
  const result = new Map<string, IssueWork>();
  if (!ids.length) return result;

  const issues: IssueNode[] = [];
  // `nodes(ids:)` takes at most 100 ids.
  for (let i = 0; i < ids.length; i += 100) {
    const data = await gh.graphql<{ nodes: (IssueNode | null)[] }>(ISSUES_QUERY, {
      ids: ids.slice(i, i + 100),
    });
    for (const node of data.nodes) if (node?.id) issues.push(node);
  }

  const candidates = new Map<string, Candidate[]>();
  for (const issue of issues) {
    const found: Candidate[] = [];
    for (const pr of issue.closedByPullRequestsReferences.nodes) {
      found.push({ ref: prRef(pr, 'linked'), rank: VIA_RANK.linked });
    }
    for (const branch of issue.linkedBranches.nodes) {
      if (!branch.ref) continue;
      const prs = branch.ref.associatedPullRequests.nodes;
      if (prs.length) for (const pr of prs) found.push({ ref: prRef(pr, 'linked'), rank: VIA_RANK.linked });
      else found.push({ ref: branchRef(issue.repository.nameWithOwner, branch.ref.name, 'linked'), rank: VIA_RANK.linked });
    }
    for (const item of issue.timelineItems.nodes) {
      const pr = item.source;
      if (pr?.__typename === 'PullRequest' && pr.url) {
        found.push({ ref: prRef(pr as Pr, 'mentioned'), rank: VIA_RANK.mentioned });
      }
    }
    candidates.set(issue.id, found);
  }

  // Only an open issue with nothing linked is worth a branch-name search; a
  // closed one is settled, and a linked one is already explained.
  const unexplained = issues.filter(
    (i) => i.state === 'OPEN' && !candidates.get(i.id)?.some((c) => c.rank <= VIA_RANK.linked),
  );
  for (const [id, found] of await branchesByName(gh, unexplained)) {
    candidates.get(id)?.push(...found);
  }

  for (const issue of issues) {
    result.set(issue.id, {
      work: pick(candidates.get(issue.id) ?? []),
      closed: issue.state === 'CLOSED',
      notPlanned: issue.stateReason === 'NOT_PLANNED',
    });
  }
  return result;
}
