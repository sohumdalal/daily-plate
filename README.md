---
description: "Your assigned Astro Kanban cards and every Slack ask aimed at you, on one plate."
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

An Astropods agent that keeps one list of what is on your plate today.

Two sources feed it:

- **The boards.** Every card assigned to you on Astro Kanban and Astro Kanban
  (AI), read through GitHub Projects every ten minutes. A card moved to Done,
  closed, or unassigned from you leaves the plate on its own.
- **Slack.** React `:knife_fork_plate:` 🍽️ to any message and it lands on the
  plate. A message that @-mentions you in an observed channel lands there
  without the reaction.

Tick an item to clear it. What you cleared today stays visible beneath the
plate until the day ends. A card you clear yourself stays cleared, even if the
board still has it open.

## Two views

The toggle in the nav (or `V`) switches between them, and the choice is
remembered in this browser.

- **Split**: a section per source. Each board gets its own section, headed
  by its name (a link to the board), `owner · #number`, and how many of your
  cards are open on it. Slack follows, and its header is where the connection
  shows: live or not, and whether mentions are on. A card on both boards
  appears under each.
- **All**: one list of every task, whatever the source. Active board work
  (In progress, In review) comes first, then Slack asks newest first, then
  the rest of the boards' queue. Each row leads with its source.

## The boards

`GITHUB_PROJECTS` lists `owner/number` pairs, `astropods/1,astropods/4` by
default. Each board is read whole and filtered to cards assigned to
`GITHUB_USERNAME`. Archived cards are skipped. A card on both boards appears
once, and it is done only when both boards say Done.

The token needs `read:project` on top of `repo`. Locally that means
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

The PR or branch shows beside the card, linked. `sources/work.ts` finds it
from three kinds of evidence, strongest first:

1. **Linked**: a PR set to close the issue, or a branch made from its
   Development sidebar
2. **Branch name**: a branch in the issue's repo whose name carries its
   number, like `sohum/1377-invite-link`
3. **Mentioned**: an open or merged PR that references the issue

A mention is shown, quieter, but never sets the state: "related to #1377" in
another PR does not put #1377 in review. Closed, unmerged PRs are abandoned
attempts and never chosen. The board read stays light; this lookup runs once
per sync for your cards only.

The card's header line also says whose plate it is: your GitHub name and
avatar, read once from `GITHUB_USERNAME`'s profile.

## Slack

Both paths ride the Astro messaging sidecar. The agent needs no Slack token of
its own.

| Path | What reaches the plate | Needs |
|---|---|---|
| Reaction | Any message you react `:knife_fork_plate:` to | "Actionable Reactions" = `knife_fork_plate` at deploy |
| Mention | A message containing `<@SLACK_USER_ID>` | `SLACK_USER_ID`, and the channel under "Observe Channels" at deploy |

With `SLACK_USER_ID` set, only your own reactions count. Without it, mention
capture is off and anyone's reaction counts.

The bot only sees channels it has been invited to, and Slack never shows a
bot the DMs between people. A mention in a DM, or in a channel the app is not
in, has to be reacted onto the plate. Catching every mention everywhere would
take a user token and Slack's `search.messages`, which is a separate Slack app
with user scopes and has not been built.

A reaction gets a reply in Slack ("On your plate"), so you can tell a capture
from a channel the app was never invited to. A mention gets no reply.

The agent reads the sidecar address from `GRPC_SERVER_ADDR`, which Astro
injects. Plain `bun run dev` has no sidecar, so Slack capture is off and the
boards still work.

Setup is `slack-app-manifest.yml`: create the app from it, then
`/invite @Daily Plate` in the channels where asks happen.

## Local development

Needs Bun, and Postgres on `localhost:5432` unless you point it elsewhere.

```bash
createdb daily_plate
bun install
bun run dev            # http://localhost:3003, migrations run on boot
bun run check          # typecheck
```

Secrets, in precedence order: your shell, then `.env.local` (gitignored), then
`~/.ast/project-configs.json`. `GITHUB_TOKEN` comes from `gh auth token` unless
your shell sets one.

## Deploy

```bash
ast login
ast push                 # build and register
```

Then deploy **from the dashboard**, the same way as Daily Wrap:

1. **Blueprints → daily-plate → Deploy**
2. `daily-plate-db` → your Postgres store
3. `GITHUB_TOKEN` as a PAT with `repo` + `read:project`
4. Under the Slack toggle: "Actionable Reactions" = `knife_fork_plate`, and
   "Observe Channels" = the channel ids to watch for mentions
5. `SLACK_USER_ID` = your Slack member id

## Design

The screen uses the shared Ferrari design system in `../DESIGN.md` (linked
here as `DESIGN.md`), on its light bands, so it pairs with Daily Wrap: Daily
Wrap is the dark half, this is the light one. Same Inter, sharp corners,
hairlines and spacing. The counts across the top use the system's `spec-cell`
treatment.

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
highlight, and Refresh runs a red line along the nav. Switching views moves
every row from its place in one layout to its place in the other. All of it
is off under `prefers-reduced-motion`.
