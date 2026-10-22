---
description: "Your assigned Astro Kanban cards and every Slack ask aimed at you, on one plate, and a written record of what you did."
tags:
  - personal
  - todo
  - github
  - slack
authors:
  - name: Sohum Dalal
    account: sohumdalal
repository: "github:sohumdalal/daily-plate"
---

# Daily Plate

An Astropods agent with three tabs. **Plate** keeps one list of what is on your
plate today. **Wrap** keeps the record of what you did: each day written back
as a few bullets, rolled up into weeks, months and years. Daily Wrap was its own
agent until it merged in here; see [The Wrap tab](#the-wrap-tab).
**Notifications** lists every time someone @-mentioned you; see
[The Notifications tab](#the-notifications-tab).

Three sources feed the plate:

- **The boards.** Every card assigned to you on Astro Kanban, read through
  GitHub Projects every ten minutes. A card moved to Done,
  closed, or unassigned from you leaves the plate on its own.
- **Your PRs and issues.** Every open PR you opened, and every open issue
  assigned to you, across every repo in `GITHUB_ORGS` (`astropods` by
  default), read with the boards. An issue or PR already on a board shows
  there only, so nothing is on the plate twice.
- **Slack.** React `:knife_fork_plate:` 🍽️ to any message and it lands on the
  plate. A message that @-mentions you in an observed channel lands there
  without the reaction.

You can also type a task of your own into the box under the counts (or press
`N`). It goes under Tasks and stays until you clear it.

Every item has a dropdown at its right edge for your notes. A bubble on the
dropdown counts them. Type a note and press Enter to add it, or Shift+Enter for
a new line. Hover a note and click × to delete it. A sync never changes your
notes.

Tick an item to clear it. What you cleared today stays visible beneath the
plate until the day ends. A card you clear yourself stays cleared, even if the
board still has it open.

## Sections

Each board gets its own section, headed by its name (a link to the board),
`owner · #number`, and how many of your cards are open on it. Pull requests
and Issues come next, each headed by a link to the same search on GitHub.
Tasks and then Slack follow, and Slack's header is where the connection
shows: live or not, and whether mentions are on. A card on both boards
appears under each.

## Filters

Under the counts, a Section row (a board, Pull requests, Issues, Tasks, Slack) shows
one section at a time. One section is always on; click another to switch.
Under Pull requests, a Repo row (`astropods/messaging`) and a State row (In PR,
Approved…) narrow the list. Click a chip to show only its rows, and click it
again to turn it off. Each chip counts what it would leave with the other
filters as they are, and a chip that would leave nothing is greyed out. `Esc`
or "Clear filters" turns off Repo and State. The counts across the top stay
whole, and the filters are remembered in this browser.

## The boards

`GITHUB_PROJECTS` lists `owner/number` pairs, `astropods/1` (Astro Kanban)
by default. Each board is read whole and filtered to cards assigned to
`GITHUB_USERNAME`. Archived cards are skipped. A card on both boards appears
once, and it is done only when both boards say Done.

Deployed, Daily Plate reads GitHub as a GitHub App installed on the org,
because `astropods` forbids personal access tokens. The App needs read access
to Contents, Issues, Pull requests and (org) Projects. Locally it uses your
`gh` token instead, which needs `read:project` on top of `repo`: run
`gh auth refresh -s read:project` once.

A card first seen in Done was never on the plate, so it is not stored. That
keeps the first sync from reporting a backlog of old work as cleared today.

## Ticket state

Every board card carries one state, worked out from its column, the issue,
and the PR or branch tackling it:

| State | When |
|---|---|
| Open | Not started (the column, Backlog or Ready, shows beside it) |
| In progress | In progress column, no branch or PR yet |
| Branch | A branch exists, no PR yet |
| Draft PR | A draft PR is open |
| In PR | A PR is open, waiting on review |
| Changes requested | The PR's review asked for changes |
| Approved | The PR is approved and can merge |
| Merged | The PR merged |
| Closed / Not planned | The issue closed without a merged PR |

A PR the state comes from is named in the pill, linked: In PR #3216. A
branch, or a PR that only mentions the card, shows beside it instead.
`sources/work.ts` finds the PR or branch from three kinds of evidence,
strongest first:

1. **Linked**: a PR set to close the issue, or a branch made from its
   Development sidebar
2. **Branch name**: a branch in the issue's repo whose name carries its
   number, like `sohum/1377-invite-link`
3. **Mentioned**: an open or merged PR that references the issue

A mention is shown, quieter, but never sets the state: "related to #1377" in
another PR does not put #1377 in review. Closed, unmerged PRs are abandoned
attempts and never chosen. The board read stays light; this lookup runs once
per sync for your cards only.

The date line also says whose plate it is ("Assigned to me · Sohum Dalal"),
with the name read once from `GITHUB_USERNAME`'s GitHub profile.

## Slack

Both paths ride the Astro messaging sidecar. The agent needs no Slack token of
its own.

| Path | What it does | Needs |
|---|---|---|
| Reaction 🍽️ | Any message you react `:knife_fork_plate:` to goes on the plate; removing the reaction takes it off | "Actionable Reactions" includes `knife_fork_plate` at deploy |
| Reaction 🧠 | Any message reacted `:brain:` to is recorded as feedback for that day's wrap | "Actionable Reactions" includes `brain` at deploy |
| Mention of you | A message containing `<@SLACK_USER_ID>` goes on the plate | `SLACK_USER_ID`, and the channel under "Observe Channels" at deploy |
| `@Daily Plate` | The message goes on the plate, unless it is a command: `what's on my plate` (optionally `from slack`, `github`, `prs`, `issues`, `tasks`), `add task …`, and in a plated message's thread `rename to …`, `note …`, `done`, `undo`, `remove this`. `help` lists them | Nothing more (`agent/commands.ts`) |

With `SLACK_USER_ID` set, only your own reactions count. Without it, mention
capture is off and anyone's reaction counts.

The bot only sees channels it has been invited to, and Slack never shows a
bot the DMs between people. A mention in a DM, or in a channel the app is not
in, has to be reacted onto the plate. Catching every mention everywhere would
take a user token and Slack's `search.messages`, which is a separate Slack app
with user scopes and has not been built.

A reaction gets a reply in Slack ("Added to Sohum's plate for Monday, October
19"), so you can tell a capture from a channel the app was never invited to. A
mention of you gets no reply.

The agent reads the sidecar address from `GRPC_SERVER_ADDR`, which Astro
injects. Plain `bun run dev` has no sidecar, so Slack capture is off and the
boards still work.

Setup is `slack-app-manifest.yml`: create the app from it, then
`/invite @Daily Plate` in the channels where asks happen.

## The Wrap tab

At `/wrap/`. It reads your day out of **Claude Code** (`~/.claude`, read only:
your prompts, sessions, repos and active minutes), **GitHub** (commits, PRs
opened, merged and reviewed), the Slack messages you marked with `:brain:` 🧠,
and **what you cleared from the plate** that day. A model writes it back as a
headline, three to five bullets, what you learned, and where to grow. A
reflection chat then asks about it until you have three takeaways.

Summary, Reflection and Sources are tabs on a period. Keys: `←` `→` move ·
`D` `W` `M` `Y` period · `⏎` wrap · `T` today. The design notes are in
[`docs/wrap/`](docs/wrap/architecture.md).

A deployed agent has no `~/.claude`, so the laptop collects the Claude half of
each day into the shared database, and the deployed agent serves it:

```bash
bun run nightly                # today, plus any unwrapped day in the last 7
bun run nightly 2026-09-19     # one day, rewrapped
bun run nightly --dry-run
```

From cron, with an explicit `PATH`:

```
30 23 * * * cd /path/to/daily-plate && PATH=$HOME/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin bun scripts/nightly.ts >> $HOME/Library/Logs/daily-plate-nightly.log 2>&1
```

Under `~/Desktop`, macOS may block cron from the folder until `/usr/sbin/cron`
has Full Disk Access.

## The Notifications tab

Every time someone @-mentions you, newest first and grouped by day, each one
unread until you open it or mark it read. The tab carries the unread count on
every page.

- **GitHub.** A comment, a review, a comment on a line of a PR, or the body
  of a new issue or PR that names `@GITHUB_USERNAME`, in any repo of
  `GITHUB_ORGS`. Read every two minutes, or on Refresh. A quoted line or code
  that names you does not count, nor does anything you wrote yourself.
  GitHub's own notifications API answers only a person's token, and the
  deployed agent is a GitHub App, so the issues and PRs that mention you are
  searched instead. After a restart the first read looks back seven days.
- **Slack.** A message that mentions `SLACK_USER_ID` in an observed channel,
  as it arrives. It still goes on the plate as well; clearing it there leaves
  it here.

`R` refreshes, `U` switches between Unread and All, and `Shift+A` marks
everything read.

## Local development

Needs Bun. With `POSTGRES_URL` in `.env.local`, this checkout reads and writes
the shared database the deployed agent serves; without it, Postgres on
`localhost:5432`. The boot line names whichever is in use.

```bash
bun install
bun run dev            # http://localhost:3003, migrations run on boot
bun run check          # typecheck, then every page's UI checks
bun run prompt [day]   # print the prompt a day would be wrapped with; reads only
```

Secrets, in precedence order: your shell, then `.env.local` (gitignored), then
`~/.ast/project-configs.json`. `GITHUB_TOKEN` comes from `gh auth token` unless
your shell sets one. The Wrap tab also needs `ANTHROPIC_API_KEY`.

`bun run import-plate <export.json | postgres://…>` copies plate items into
the database this checkout points at. It only adds: an item already there keeps
its own state, and gains notes or a cleared state only where it has none.
`GET /api/export` downloads every item as JSON for it.

## Deploy

```bash
ast login
ast push                 # build and register
```

Then deploy **from the dashboard**: binding the database to a shared store is
a deploy-form control with no flag.

1. **Blueprints → daily-plate → Deploy**
2. `daily-plate-db` → **Shared** → the store the laptop's `POSTGRES_URL` names
3. `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_INSTALLATION_ID`
   from a GitHub App installed on the org (see [The boards](#the-boards))
4. `ANTHROPIC_API_KEY` from the vault, and `ANTHROPIC_MODEL`
5. Under the Slack toggle: "Actionable Reactions" = `knife_fork_plate, brain`,
   and "Observe Channels" = the channel ids to watch for mentions
6. `SLACK_USER_ID` = your Slack member id

## Design

Both tabs use the shared Ferrari design system in `../DESIGN.md` (linked here
as `DESIGN.md`), from one set of tokens in `agent/ui/theme.css`. Light is the
default. The account menu at the top right (`agent/ui/shell.js`) switches to the
design file's dark palette, or to System, remembered per browser, and links to
Settings at `/settings/`. Same Inter, sharp corners, hairlines and spacing. The
counts across the top use the system's `spec-cell` treatment.

The GitHub and Slack marks are Lucide's, vendored into `agent/ui/icons/` from
`lucide-static@1.0.0`. Later releases dropped brand icons, so that version is
pinned. They are drawn as CSS masks, so they take the ink colour.

The accent is Rosso Corsa, the system's own red, where Daily Wrap's is
yellow: yellow on near-black there, red on white here. It appears twice: the
wordmark rule and the tick on a cleared item. Warnings share that red; here a
warning is one line of text, which no mark can be mistaken for. The info blue
is the system's hue one step darker, since the documented one fails AA for an
11px label on white.

Motion is FLIP, in plain CSS and the Web Animations API. Counts roll, upward
when they grow and downward when they shrink. Ticking an item plays the mark
in place first (the box fills, the tick draws, a line runs through the
title), then the row glides into Cleared today while the rows around it close
the gap. Unticking runs it back. A new Slack arrival fades in with a brief
highlight, and Refresh runs a red line along the nav. All of it is off under `prefers-reduced-motion`.
