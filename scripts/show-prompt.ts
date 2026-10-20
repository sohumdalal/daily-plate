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

const day = process.argv[2] ?? today(config.timezone);
const record = await store.getDay(day);

const { system, user } = await buildDayPrompt({
  day,
  claude: record?.claude ?? null,
  github: record?.github ?? null,
  reflection: await store.getReflection('day', day),
});

console.log(`=== SYSTEM (${system.length} chars) ===\n${system}`);
console.log(`\n=== USER (${user.length} chars) ===\n${user}`);

await shutdown();
