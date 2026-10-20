/**
 * Reads a day out of GitHub: commits authored, PRs opened, PRs merged, PRs
 * reviewed for someone else.
 *
 * Every query is bounded with an explicit UTC offset for the day in question
 * (`2026-09-21T00:00:00-04:00..2026-09-21T23:59:59-04:00`) so the window
 * matches the local day rather than a UTC one.
 */

import { gh } from '../../sources/github.ts';
import { offsetSuffix } from '../../time.ts';
import type { Commit, GitHubDay, PullRequest, ReviewedPullRequest } from '../types.ts';

/** Per-query page cap. A single day never approaches this. */
const PER_PAGE = 50;
const MAX_PAGES = 3;
/** Fetching additions/deletions costs one request per PR. */
const MAX_ENRICHED = 20;
/** Confirming a review date costs one request per candidate PR. */
const MAX_REVIEW_CHECKS = 60;


/** The `..`-delimited range qualifier covering one local day. */
function dayRange(day: string, timezone: string): string {
  const off = offsetSuffix(day, timezone);
  return `${day}T00:00:00${off}..${day}T23:59:59${off}`;
}

function repoFromPullUrl(htmlUrl: string): string {
  return htmlUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1] ?? 'unknown';
}

type SearchedPr = {
  number: number;
  title: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  mergedAt: string | null;
  author: string;
  repo: string;
};

async function searchPrs(q: string): Promise<SearchedPr[]> {
  const out: SearchedPr[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await gh().search.issuesAndPullRequests({
      q,
      per_page: PER_PAGE,
      page,
      advanced_search: 'true',
    });
    for (const item of res.data.items) {
      out.push({
        number: item.number,
        title: item.title,
        htmlUrl: item.html_url,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        state: item.state,
        mergedAt:
          (item.pull_request as { merged_at?: string | null } | undefined)?.merged_at ?? null,
        author: item.user?.login ?? 'unknown',
        repo: repoFromPullUrl(item.html_url),
      });
    }
    if (res.data.items.length < PER_PAGE) break;
  }
  return out;
}

/**
 * When the user actually submitted a review on this PR inside the window.
 *
 * The search API has no reviewed-at qualifier, so `reviewed-by` has to be
 * bounded by `updated`, which matches any PR touched in the window however
 * long ago it was reviewed. A PR reviewed last November and relabelled today
 * comes back as today's work. Only the review timestamps can settle it.
 */
async function reviewedInWindow(
  repo: string,
  number: number,
  username: string,
  startIso: string,
  endIso: string,
): Promise<string | null> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return null;
  try {
    const res = await gh().pulls.listReviews({
      owner,
      repo: name,
      pull_number: number,
      per_page: 100,
    });
    const mine = res.data
      .filter((r) => r.user?.login === username && r.submitted_at)
      .map((r) => r.submitted_at!)
      .filter((at) => at >= startIso && at <= endIso)
      .sort();
    return mine[mine.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** Diff size for a PR. Null when the repo or PR isn't reachable. */
async function prDiff(
  repo: string,
  number: number,
): Promise<{ additions: number; deletions: number } | null> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return null;
  try {
    const res = await gh().pulls.get({ owner, repo: name, pull_number: number });
    return { additions: res.data.additions, deletions: res.data.deletions };
  } catch {
    return null;
  }
}

async function toPullRequests(rows: SearchedPr[]): Promise<PullRequest[]> {
  return Promise.all(
    rows.map(async (r, i): Promise<PullRequest> => {
      const diff = i < MAX_ENRICHED ? await prDiff(r.repo, r.number) : null;
      return {
        repo: r.repo,
        number: r.number,
        title: r.title,
        url: r.htmlUrl,
        state: r.mergedAt ? 'merged' : r.state === 'closed' ? 'closed' : 'open',
        createdAt: r.createdAt,
        mergedAt: r.mergedAt,
        additions: diff?.additions ?? null,
        deletions: diff?.deletions ?? null,
      };
    }),
  );
}

/**
 * Commits authored on the day, across every repo the token can see.
 *
 * `search/commits` is the only cross-repo commit query GitHub offers. It is
 * subject to indexing lag, so a commit pushed minutes ago may not appear yet —
 * re-collecting the day later picks it up.
 */
async function fetchCommits(
  username: string,
  day: string,
  timezone: string,
): Promise<Commit[]> {
  const q = `author:${username} author-date:${dayRange(day, timezone)}`;
  const out: Commit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await gh().search.commits({ q, per_page: PER_PAGE, page, sort: 'author-date' });
    for (const item of res.data.items) {
      out.push({
        repo: item.repository.full_name,
        sha: item.sha.slice(0, 8),
        // Only the subject line — commit bodies are mostly trailers.
        message: item.commit.message.split('\n')[0] ?? '',
        url: item.html_url,
        at: item.commit.author?.date ?? '',
      });
    }
    if (res.data.items.length < PER_PAGE) break;
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function fetchGitHubDay(
  day: string,
  opts: { username: string; timezone: string },
): Promise<GitHubDay> {
  const { username, timezone } = opts;
  if (!username) throw new Error('GITHUB_USERNAME is not configured');
  const range = dayRange(day, timezone);
  const offset = offsetSuffix(day, timezone);
  const startIso = new Date(`${day}T00:00:00${offset}`).toISOString();
  const endIso = new Date(`${day}T23:59:59${offset}`).toISOString();

  const [commits, openedRaw, mergedRaw, reviewedRaw] = await Promise.all([
    fetchCommits(username, day, timezone),
    searchPrs(`is:pr author:${username} created:${range}`),
    searchPrs(`is:pr author:${username} merged:${range}`),
    searchPrs(`is:pr reviewed-by:${username} -author:${username} updated:${range}`),
  ]);

  const [opened, merged] = await Promise.all([
    toPullRequests(openedRaw),
    toPullRequests(mergedRaw),
  ]);

  // Each candidate costs one request, so cap the fan-out. A day's real review
  // count is far below this; the surplus is stale PRs the search matched on
  // `updated` alone.
  const candidates = reviewedRaw.slice(0, MAX_REVIEW_CHECKS);
  const checked = await Promise.all(
    candidates.map(async (r) => ({
      row: r,
      at: await reviewedInWindow(r.repo, r.number, username, startIso, endIso),
    })),
  );
  const reviewed: ReviewedPullRequest[] = checked
    .filter((c): c is { row: SearchedPr; at: string } => c.at !== null)
    .map(({ row, at }) => ({
      repo: row.repo,
      number: row.number,
      title: row.title,
      url: row.htmlUrl,
      author: row.author,
      at,
    }));

  const repos = [
    ...new Set([
      ...commits.map((c) => c.repo),
      ...opened.map((p) => p.repo),
      ...merged.map((p) => p.repo),
      ...reviewed.map((p) => p.repo),
    ]),
  ];

  return {
    commits,
    opened,
    merged,
    reviewed,
    repos,
    totals: {
      commits: commits.length,
      opened: opened.length,
      merged: merged.length,
      reviewed: reviewed.length,
      additions: merged.reduce((n, p) => n + (p.additions ?? 0), 0),
      deletions: merged.reduce((n, p) => n + (p.deletions ?? 0), 0),
    },
  };
}
