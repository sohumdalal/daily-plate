/**
 * Print the prompt a day would be wrapped with: `bun scripts/show-prompt.ts [day]`.
 *
 * Reads only. It exists because the obvious way to check a prompt, stubbing the
 * model and calling writeDayWrap, saves the stub over a real wrap.
 */

import { loadLocalEnv } from './env.ts';

loadLocalEnv();

const { config } = await import('../agent/config.ts');
const { shutdown } = await import('../agent/db/client.ts');
const store = await import('../agent/wrap/store.ts');
const { buildDayPrompt } = await import('../agent/wrap/wrap.ts');
const { today } = await import('../agent/time.ts');
const { asUser, memberByLogin } = await import('../agent/users.ts');

const day = process.argv[2] ?? today(config.timezone);
// Whose day: DAILY_PLATE_USER, or the GitHub login the local env sets.
const login = process.env.DAILY_PLATE_USER || config.github.username;
const member = memberByLogin(login) ?? { login: login.toLowerCase(), slackId: '' };

const { system, user } = await asUser(member, async () => {
  const record = await store.getDay(day);
  return buildDayPrompt({
    day,
    claude: record?.claude ?? null,
    github: record?.github ?? null,
    reflection: await store.getReflection('day', day),
  });
});

console.log(`=== SYSTEM (${system.length} chars) ===\n${system}`);
console.log(`\n=== USER (${user.length} chars) ===\n${user}`);

await shutdown();
