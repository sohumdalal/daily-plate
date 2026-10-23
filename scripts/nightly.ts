/**
 * Collects and wraps days without the web server: `bun run nightly`.
 *
 * Nothing watches `~/.claude`, so a day you never open the app on is a day
 * that never gets wrapped even though the transcripts are sitting there. This
 * is what launchd runs to close that gap.
 *
 * It looks back over a window rather than at today alone, because a laptop
 * asleep at the scheduled hour, or a day spent away from the machine, would
 * otherwise leave a permanent hole. Any day in the window that holds activity
 * and has no wrap gets one; a day already wrapped is left alone unless it is
 * the day still in progress.
 *
 *   bun run nightly                  today, plus any unwrapped day in the window
 *   bun run nightly 2026-09-19       one specific day, rewrapped
 *   bun run nightly --window 30      widen the catch-up window
 *   bun run nightly --dry-run        report what it would do
 *   bun run nightly --force          replace a stored capture that is wrong,
 *                                    not merely thinner, which the signal
 *                                    comparison in saveDay cannot tell apart
 */

import { loadLocalEnv } from './env.ts';

loadLocalEnv();

const { config, readiness } = await import('../agent/config.ts');
const { describeTarget, ping, shutdown } = await import('../agent/db/client.ts');
const { runMigrations } = await import('../agent/db/migrations.ts');
const store = await import('../agent/wrap/store.ts');
const { fetchClaudeDay } = await import('../agent/wrap/sources/claude.ts');
const { fetchGitHubDay } = await import('../agent/wrap/sources/github.ts');
const { hasActivity, writeDayWrap } = await import('../agent/wrap/wrap.ts');
const { addDays, daysBetween, today } = await import('../agent/time.ts');
const { asUser, memberByLogin } = await import('../agent/users.ts');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const windowArg = args.indexOf('--window');
const windowDays = windowArg === -1 ? 7 : Number(args[windowArg + 1] ?? 7);
const explicitDay = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

const log = (message: string): void => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

function fail(message: string): never {
  log(`ERROR ${message}`);
  process.exit(1);
}

const todayKey = today(config.timezone);
log(`nightly starting — db ${describeTarget()}, tz ${config.timezone}, today ${todayKey}`);

if (!config.llm.anthropicKey) fail('ANTHROPIC_API_KEY is not set');
if (!(await ping())) fail(`database unreachable at ${describeTarget()}`);
await runMigrations();

/** Days worth looking at: the day in progress, plus any gap behind it. */
async function chooseDays(): Promise<string[]> {
  if (explicitDay) return [explicitDay];
  // A repair pass has to revisit days that already have a wrap.
  if (force) {
    const from = addDays(todayKey, -Math.max(0, windowDays - 1));
    return daysBetween(from, todayKey);
  }

  const from = addDays(todayKey, -Math.max(0, windowDays - 1));
  const candidates = daysBetween(from, todayKey);
  const wrapped = new Set(
    (await store.getWrapsBetween('day', from, todayKey)).map((w) => w.key),
  );
  // Today is always redone: it is still in progress, so the wrap it already
  // has is out of date by definition.
  return candidates.filter((day) => day === todayKey || !wrapped.has(day));
}

// Every row this run writes is this person's: whoever runs it, on their own laptop.
const login = process.env.DAILY_PLATE_USER || config.github.username;
if (!login) fail('set DAILY_PLATE_USER (or GITHUB_USERNAME) to your GitHub login');
const member = memberByLogin(login) ?? { login: login.toLowerCase(), slackId: '' };
log(`wrapping as ${member.login}`);

let wrapped = 0;
let quiet = 0;
let failed = 0;

await asUser(member, async () => {
  const days = await chooseDays();
  log(`${days.length} day(s) to consider: ${days.join(', ') || 'none'}`);

  for (const day of days) {
    try {
      const [claude, github] = await Promise.all([
        fetchClaudeDay(day, { home: config.claude.home, timezone: config.timezone }).catch(
          (err: unknown) => {
            log(`  ${day} claude read failed: ${String(err)}`);
            return null;
          },
        ),
        readiness().github
          ? fetchGitHubDay(day, {
              username: member.login,
              timezone: config.timezone,
            }).catch((err: unknown) => {
              log(`  ${day} github read failed: ${String(err)}`);
              return null;
            })
          : Promise.resolve(null),
      ]);

      if (!hasActivity(claude, github)) {
        log(`  ${day} nothing recorded, skipping`);
        quiet += 1;
        continue;
      }

      if (dryRun) {
        log(
          `  ${day} would wrap — ${claude?.totals.prompts ?? 0} prompts, ` +
            `${github?.totals.commits ?? 0} commits`,
        );
        wrapped += 1;
        continue;
      }

      const stored = await store.saveDay(day, claude, github, { force });
      const wrap = await writeDayWrap({
        day,
        claude: stored.claude,
        github: stored.github,
        reflection: await store.getReflection('day', day),
      });
      log(`  ${day} wrapped: ${wrap.headline}`);
      wrapped += 1;
    } catch (err) {
      // One bad day must not stop the rest of the window.
      log(`  ${day} failed: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }
});

log(`done — ${wrapped} wrapped, ${quiet} quiet, ${failed} failed`);
await shutdown();
process.exit(failed > 0 ? 1 : 0);
