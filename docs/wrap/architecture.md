> Written for Daily Wrap before it merged into Daily Plate as the Wrap tab. Its code is now under `agent/wrap/`, its screen under `agent/ui/wrap/`, and its API under `/api/wrap`.

# Architecture

## The shape of the whole thing

Every input is an **ingestion source**. Each one lands in a per-day row, keyed
by civil date. One assembler turns a day's rows into a prompt. One product comes
out: the day's wrap. Every longer period is that same product, written from the
days beneath it.

```
INGESTION                ASSEMBLY              PRODUCTS
Claude Code    ┐
GitHub         ├──►  days (per date)  ──►  day wrap  ──►  week ──► month ──► year
Slack (next)   │          +                    ▲
Workday (next) ┘   goals · corrections         │
                                          your three
                                        (the reflection chat)
```

**The day is the smallest successful unit.** If a day's wrap is not worth
reading, no rollup built from it can be. So the rule for every new source is the
same: it has to make the *day* better, measured by whether the day's three
bullets and the read on them get sharper. A source that only pays off at the
yearly view is not ready.

A rollup never re-reads raw material. It reads the days' wraps and takeaways, so
the cost of a yearly wrap is 365 short records, not a year of transcripts. That
is the whole reason the ladder can keep growing.

Adding a source means four things, in order: a reader in `sources/`, a column or
key on `days`, a section in the day's prompt, and a decision about whether it
deserves a tab. Nothing else in the pipeline changes.

## Today's container

One container. Bun serves an API and three static files; Postgres holds the
record. No build step, no bundler, no framework.

```
~/.claude/**          GitHub API            you
     │                     │                 │
     ▼                     ▼                 ▼
sources/claude.ts    sources/github.ts    reflect.ts  ← the chat
     └──────────┬──────────┘                 │
                ▼                            │
             days table  ──────► wrap.ts ────┴──► wraps · reflections
                                (prompts)          reflection_turns
```

## The day, assembled

A day is a **civil date in one timezone**, not a UTC window. Both sources speak
UTC instants, so `time.ts` converts: `dayStart('2026-09-21', tz)` resolves local
midnight to a UTC instant, correcting once for DST. Everything downstream is
bucketed against that. `TIMEZONE` decides where one day ends.

Collecting is on demand (`POST /api/view/day/:day/collect`) or nightly
(`scripts/nightly.ts`). Both write one row per day, and **the richer capture
wins**: Claude Code prunes transcripts and a GitHub token can lose a repo, so
re-reading a day weeks later can return less than was captured. Replacing
blindly would let a permanent record decay as it ages. The two sources are
judged independently, so a GitHub outage cannot cost you the Claude half.
`--force` overrides this, for repairing a capture that is wrong rather than
thin.

## Claude Code ingestion

Read-only, from `CLAUDE_HOME` (default `~/.claude`), one day at a time.

| File | What it gives |
|---|---|
| `history.jsonl` | Every prompt typed, with timestamp and project |
| `projects/<slug>/*.jsonl` | Session transcripts: `aiTitle`, `cwd`, `gitBranch`, tool calls, models, token usage, turn durations, `pr-link` entries |
| `daily-cost.json` | That day's spend, if the file is still on the day |

Files whose mtime predates the day's start are skipped without opening, which
is what keeps a 60MB+ tree at roughly 100ms.

Three cleanups the raw data needs. Resuming a session writes a fresh record
that replays the opening prompt, so stubs with no title, no tools and no active
time are dropped, or one piece of work looks like three. A session's project is
the **least-nested** `cwd` it saw: the first is often `~`, and the busiest is
often a deep `src/`. `<synthetic>` models and detached `HEAD` are discarded.

## GitHub ingestion

Commits authored, PRs opened, PRs merged, PRs reviewed for others. Every query
is bounded with the day's real UTC offset
(`2026-09-21T00:00:00-04:00..2026-09-21T23:59:59-04:00`), so a local day is a
local day.

**Reviews need a second request.** The search API has no reviewed-at qualifier,
so `reviewed-by:me` must be bounded by `updated:`, which matches any PR *touched*
in the window however long ago it was reviewed. A PR reviewed in November and
relabelled today came back as today's work. Search is therefore a candidate
finder only, and each candidate is confirmed against `pulls.listReviews`: kept
only if a review of yours carries a `submitted_at` inside the day, and dated by
that timestamp. Capped at 60 candidates.

`search/commits` is indexed with a lag, so a day read minutes after a push can
be short. Re-collecting later fills it in, and the UI states when sources were
read so a low count reads as early rather than wrong.

## What reaches the model

`wrap.ts` assembles one prompt. Roughly 5KB on a normal day.

**Your prompts are the primary evidence; GitHub is corroboration.** Two people
can ship the same diff and have had different days, and only the prompts show
how a problem got framed or when someone changed their mind. Up to 30 prompts
per session at 500 characters each.

Also included: the previous 10 days' wraps, for continuity; active goals with
the reason each matters; your corrections; the last 3 versions of this wrap.

Attribution is stated explicitly in the prompt. The prompts are yours; most of
the work between them is the assistant's, done at your direction. Crediting you
with the assistant's discoveries invents a strength, which is worse than useless
in a growth record.

`learned` and `grew` may come back empty, and that is correct. Manufactured
insight would make the rollups noise, since they are written by reading those
fields back.

## Reflection

A chat, not a textarea. `reflect.ts` asks one question at a time and its only
goal is three takeaways you believe: one thing that went well, one that went
badly, one to improve. It reads the last 10 days' wraps and takeaways, so a
question can remember last week.

Your turns are written back to `reflections.body`, so every prompt that already
treats that field as your authoritative account picks the conversation up
unchanged. The three outrank the body: a conversation is evidence, the three are
what you decided.

## Schema

```
days              (day, user_id)              raw capture: claude jsonb, github jsonb
wraps             (period, key, user_id)      current: headline, did[], learned, grew[]
wrap_versions     append-only                 every version, with why it exists
reflections       (period, key, user_id)      body, energy, good, bad, improve
reflection_turns  append-only                 the conversation
goals             id                          career/craft/impact/personal/intrinsic
feedback          append-only                 your corrections, binding on every later wrap
slack_feedback    (channel, ts, emoji)        messages you marked with a reaction
```

`period` is `day` / `week` / `month` / `year` and `key` is `2026-09-21` /
`2026-W39` / `2026-09` / `2026`. One shape for all four, so a rollup is just a
wrap written from the wraps beneath it, and a week can carry its own reflection.

Writes are upserts, so re-wrapping overwrites in place while
`wrap_versions` keeps the history. Migrations are append-only and run on boot,
behind a retry loop: the HTTP server binds before the database is touched, so a
slow Postgres cannot turn into a crash-loop where the URL never resolves.

## Keeping it performant as history grows

Nothing reads raw history into a prompt. A prior day contributes its headline,
`did`, and your three: a few hundred bytes. Prior chats are never replayed into
a later day's prompt, only their distillation. That keeps a day's prompt flat as
the record grows, which matters most for the yearly rollup.

The limits that bound it: `PRIOR_DAYS` 10, `PRIOR_VERSIONS` 3,
`MAX_PROMPTS_PER_SESSION` 30, `MAX_PROMPT_CHARS` 500, `MAX_REVIEW_CHECKS` 60,
`MAX_SOURCES` 80.

## Deployment shape

`agent.interfaces.frontend: true` means Astropods routes a hostname straight to
the container on port 80 and skips the built-in chat UI; OIDC sign-in stays at
the front door.

The Claude half cannot work in the cloud: `~/.claude` is on your laptop. Bind
`daily-wrap-db` to a **Shared** knowledge store and point the laptop at the same
database, and the laptop collects while the deployed agent serves.

Use a Supabase **pooler** connection string. The direct host resolves AAAA only,
with no A record, so any moment without IPv6 drops the connection. The pooler's
user must carry the project ref: `postgres.<ref>`.

## Planned sources

### Slack, by emoji (built)

Astropods already ships the mechanism. `actionable_reactions` in
`astropods.yml` tells the platform which emoji to forward to the agent, and the
deployment emits `SLACK_ACTIONABLE_REACTIONS`; `allowed_channel_ids` and
`allowed_user_ids` bound where it listens.

```yaml
agent:
  interfaces:
    frontend: true
    messaging: true       # the Slack adapter rides on this
dev:
  interfaces:
    messaging:
      adapters: [slack]
      slack:
        actionable_reactions: [brain]
```

React `:brain:` on a message and it is stored as feedback against the day you
reacted. The adapter fetches the message text itself before forwarding, so the
agent needs no Slack token and no Slack app of its own: it reads
`AgentResponse.incomingMessage` off the `ProcessConversation` stream, keeps the
events whose `eventKind` is `EVENT_KIND_REACTION`, and strips the
`[reaction :brain: added by <@U…> on message]` header the adapter prepends. The
messaging sidecar is not billed.

Just the message, not the thread. A thread is a conversation, and capturing all
of it would bury the line that was worth marking.

The agent must speak first. The sidecar blocks on `stream.Recv()` waiting for
the agent's opening message and only then registers the stream, so an agent
that opens a stream and merely listens is never registered and every reaction
fails with `no active agent stream available`. Sending `AgentConfig` on connect
is the handshake; the server has an explicit branch for it.

The sidecar only exists when deployed with messaging on, or locally under
`ast project start`. A gRPC channel connects lazily, so the agent probes the
port once with TCP before opening a stream: without that, plain `bun run dev`
reconnects forever against nothing and buries the log.

Captures reach the day's prompt as somebody else's words about this person,
which nothing else in the record holds.

The value is specific: manager feedback, a design debate you lost, a decision
someone talked you out of. None of it appears in a diff, and all of it belongs
in the same pot as your prompts. Marking it by hand is a feature rather than a
limitation, since unfiltered channel history is noise and reacting is a
judgement that this mattered.

It earns a tab of its own, because feedback accumulates across days and is
worth reading as a list rather than only inside the day it landed on.

`actionable_reactions` in `astropods.yml` is local-only, and a pre-fill for the
deploy form: the spec has no production home for it, because `SlackConfig()` is
a method on `Dev` alone. **At deploy, set "Actionable Reactions" to `brain`
under the Slack toggle**, or the adapter drops every reaction. Its sibling
"Allowed Channels" restricts which channels it listens in, and a value there
silently ignores reactions everywhere else. Both are visible in the sidecar's
boot line:

```
[Slack] Adapter initialized (Socket Mode: true, observe channels: [],
        actionable reactions: [brain], allowed channels: [], ...)
```

Setup is a manifest, not a click-through: `slack-app-manifest.yml` at the repo
root carries the scopes and the `reaction_added` subscription. Socket Mode means
no public request URL. Astropods asks for `SLACK_BOT_TOKEN` (`xoxb-`) and
`SLACK_APP_TOKEN` (`xapp-`, scope `connections:write`) when the slack adapter is
enabled at deploy.

Slack only delivers `reaction_added` for channels the app belongs to, so the app
has to be invited to the channels where feedback happens.

Two things are unverified, because both need a real workspace: whether
Postman's Slack permits the app install, and whether the author of the reacted
message reaches us. The adapter forwards the reactor and the text but not the
author, so a capture currently records what was said and not who said it.

### Workday

Quarterly manager feedback is the highest-signal input available, and Workday
API access is almost never granted to an individual. The honest first version
is a paste: a text field that stores a review against a quarter, which then
feeds goals and the monthly and yearly rollups. Build the paste, and treat an
API as a later question.
