---
description: "Your assigned Astro Kanban cards and every Slack ask aimed at you, on one plate, and a written record of what you did."
tags:
  - personal
  - todo
  - github
  - slack
  - daily-review
  - claude-code
authors:
  - name: Sohum Dalal
    account: sohumdalal
repository: "github:sohumdalal/daily-plate"
capabilities:
  - Reads every card assigned to you across one or more GitHub Projects boards
  - Clears a card from the plate when the board moves it to Done
  - Puts any Slack message you react to with a plate emoji on the plate, and takes it off when you remove the emoji
  - Puts Slack messages that @-mention you in observed channels on the plate
  - Puts any Slack message that @-mentions Daily Plate on the plate
  - Takes tasks you type in yourself, and your notes on any item
  - Writes each day back as a short wrap from Claude Code, GitHub, Slack feedback and what you cleared, rolled up into weeks, months and years
  - "Records any Slack message you react to with :brain: as feedback for that day's wrap"
  - Lists every GitHub or Slack @-mention of you on a Notifications tab, with an unread count
integrations:
  - GitHub
  - Slack
---

<h1 align="center">Daily Plate</h1>

<p align="center"><em>Everything on your plate today, in one list.</em></p>

Daily Plate gathers what you have to do from two places. One is the cards
assigned to you on your team's GitHub Projects boards. The other is the Slack
messages where someone asked you for something. Tick an item to clear it.

## Where the plate comes from

**Your PRs and issues**: every open PR you opened, and every open issue
assigned to you, across all repos of the orgs you name. An issue or PR
already on a board shows there only.

**GitHub Projects**: every non-archived card assigned to you, with its
column. A card moved to Done, closed, or unassigned leaves the plate on its
own. Read every ten minutes, or on demand.

**Slack**: react `:knife_fork_plate:` to a message to plate it. In channels
the agent observes, a message that @-mentions you is plated without the
reaction.

## Setup

| Input | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | — | `repo` + `read:project` (from `integrations.github`) |
| `GITHUB_USERNAME` | `sohumdalal` | Whose assigned cards to read |
| `GITHUB_PROJECTS` | `astropods/1` | Boards, as `owner/number` |
| `GITHUB_ORGS` | `astropods` | Owners whose repos are searched for your PRs and issues |
| `SLACK_USER_ID` | — | Your Slack member id; turns on mention capture |
| `TIMEZONE` | `America/New_York` | What "cleared today" means |

Postgres comes from the `knowledge.daily-plate-db` entry. Under the Slack
toggle at deploy, set "Actionable Reactions" to `knife_fork_plate` and
"Observe Channels" to the channels to watch.
