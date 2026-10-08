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
capabilities:
  - Reads every card assigned to you across one or more GitHub Projects boards
  - Clears a card from the plate when the board moves it to Done
  - Puts any Slack message you react to with a plate emoji on the plate
  - Puts Slack messages that @-mention you in observed channels on the plate
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
| `GITHUB_PROJECTS` | `astropods/1,astropods/4` | Boards, as `owner/number` |
| `SLACK_USER_ID` | — | Your Slack member id; turns on mention capture |
| `TIMEZONE` | `America/New_York` | What "cleared today" means |

Postgres comes from the `knowledge.daily-plate-db` entry. Under the Slack
toggle at deploy, set "Actionable Reactions" to `knife_fork_plate` and
"Observe Channels" to the channels to watch.
