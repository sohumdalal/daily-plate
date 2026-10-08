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

## The boards

`GITHUB_PROJECTS` lists `owner/number` pairs, `astropods/1,astropods/4` by
default. Each board is read whole and filtered to cards assigned to
`GITHUB_USERNAME`. Archived cards are skipped. A card on both boards appears
once, and it is done only when both boards say Done.

The token needs `read:project` on top of `repo`. Locally that means
`gh auth refresh -s read:project` once.

A card first seen in Done was never on the plate, so it is not stored. That
keeps the first sync from reporting a backlog of old work as cleared today.

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

Yellow stays the shared accent and appears twice: the wordmark rule and the
tick on a cleared item. On white it is 1.3:1, so the cleared tick carries an
ink edge; the wordmark rule stays bare, as in Daily Wrap. The
info blue and warning red are the system's hues one step darker, since the
documented values fail AA for an 11px label on white.
