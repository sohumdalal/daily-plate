> Written for Daily Wrap before it merged into Daily Plate as the Wrap tab. Its code is now under `agent/wrap/`, its screen under `agent/ui/wrap/`, and its API under `/api/wrap`.

# Roadmap

Every item is judged the same way: **does it make one day's wrap sharper?** The
day is the smallest successful unit, so a change that only pays off at the
yearly view is not ready.

Status: `done` · `next` · `later` · `open question`

## Shipped

- [x] Claude Code ingestion: prompts, sessions, tools, models, active time, PR links
- [x] GitHub ingestion: commits, PRs opened/merged/reviewed, timezone-correct windows
- [x] Reviews dated by `submitted_at`, not by when the PR was last touched
- [x] Daily wrap: headline, did, learned, grew
- [x] Week / month / year rollups, written from the days beneath them
- [x] Reflection chat that ends in three takeaways
- [x] Goals as an input to every generation
- [x] Corrections (`Disagree`) binding on every later wrap
- [x] Append-only version history per wrap
- [x] Sources tab with search and per-kind filters
- [x] Nightly wrap via cron, with a catch-up window
- [x] Shared Postgres so a deployed agent and the laptop see one record
- [x] Slack capture by `:brain:` reaction, and a Feedback tab (pending install)

## Next

- [ ] **Release readiness.** Turn this into a blueprint anyone can deploy with
      their own credentials. Plan and open questions in
      [plans/release-readiness.md](../plans/release-readiness.md).
- [ ] **Feature impact.** The first outcome input: mark a release in New Relic
      or Grafana, pull its traffic back daily, and report what crossed today.
      Everything else here measures effort. Plan, including why this nearly
      fails the bar above, in
      [plans/feature-impact.md](../plans/feature-impact.md).
- [ ] **Redeploy onto the current build.** Nine builds behind; the live agent
      still inflates review counts.
- [ ] **Did you do it?** Link a day's `to improve` to the days after it and
      record whether it happened. The chat already notices repetition out loud;
      nothing stores the answer. This is the single highest-value missing field,
      because the record can currently tell you what you said and not whether
      you followed through.
- [ ] **Slack install.** The ingestion is built: `actionable_reactions:
      [brain]`, a listener on the messaging stream, a `slack_feedback` table, a
      Feedback tab, and captures feeding the day's prompt. What is left is the
      workspace install, which is the part I cannot test from here. Unknown
      until then: whether the reacted message's author reaches us, since the
      adapter forwards the reactor and the text but not the author.
- [ ] **Surface `headline`.** Generated on every wrap and shown nowhere except a
      rollup's day list.
- [ ] **A week view worth opening.** The rollup works; nothing shows a day
      against the week around it.

## Later

- [ ] **Workday**, as a paste first. API access is unlikely to be granted.
- [ ] **Prompt quality score.** See the open question below.
- [ ] Growth trendlines across periods
- [ ] A year view worth printing
- [ ] Export: the whole record as files you own

## Open questions

### Should this be Go?

**No, not yet.** Astro's server is Go and consistency is a real argument, but it
does not apply here yet.

What this app actually is: a JSONL reader, a set of prompts, seven tables, and
one screen. The backend is about 1,500 lines. Go buys nothing for any of that,
and Bun gives three things that matter today: streaming 60MB of transcripts in
~100ms with no dependency, the Anthropic SDK, and serving a UI with no build
step at all. Astropods runs any container, so the platform is not asking.

The condition that changes the answer: **if this becomes an Astro product**
rather than a personal agent, it has to be Go, because it would live in
`astro-server` under the Store pattern and the existing testing conventions. At
that point the port is a couple of days and worth it. Porting before then pays
the cost for none of the benefit.

Worth saying plainly: the risk is not the language. It is that the prompts are
the product, and they are still changing weekly.

### How do you score a prompt?

The interesting part is that most of it needs no model at all. Every signal is
already in the transcripts:

- **Rework ratio** — prompts that correct the assistant ("no", "stop", "actually",
  "that's wrong") against prompts that advance the task
- **Prompts to outcome** — how many turns from opening a session to a merged PR
- **Model fit** — Opus on a rename, Haiku on a design question
- **Abandonment** — sessions opened and dropped with no artifact
- **Cost per landed change** — tokens and dollars against merged PRs
- **Redirection depth** — how far in you changed direction, which says something
  about how well the first prompt was framed

Those are cheap, deterministic, and trend over time, which is what makes them
useful. Build them first and you have a score without an opinion in it.

A judge over the prompt text can come second, on top: a rubric for whether the
ask carried enough context, named a constraint, and said what done looked like.

On GEPA: it optimises *prompts for a system*, not a human's prompting habits.
Different problem. The rubric idea is the transferable half.

### What else belongs in the record?

You listed the summary, what to improve, what went well, and the chat. All four
are stored. Two things are missing:

1. **Whether an improvement was acted on** — the `next` item above.
2. **What you decided not to do.** The chat surfaces avoidance well; nothing
   captures a deliberate no. A week of good decisions to decline things looks
   identical to a week of drift in this record.

Energy is stored and barely used. Either something reads it or it should go.
