/**
 * Local dev launcher: `bun run dev`.
 */

import { loadLocalEnv } from './env.ts';

loadLocalEnv();
process.env.PORT ??= '3003';

await import('../agent/index.ts');
