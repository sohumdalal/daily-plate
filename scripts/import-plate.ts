/**
 * Copy plate items into the database this checkout points at (POSTGRES_URL in
 * .env.local, the shared store): `bun run import-plate <source> [--dry-run]`.
 *
 *   <source>  a JSON file from GET /api/export, or a postgres:// URL to read from
 *
 * Nothing is deleted or overwritten. A new item is inserted as it was. For an
 * item already here, only what this database lacks is filled in: its notes when
 * it has none, and the cleared state when it is not cleared.
 */

import { loadLocalEnv } from './env.ts';

loadLocalEnv();

const { default: postgres } = await import('postgres');
const { describeTarget, db, shutdown } = await import('../agent/db/client.ts');
const { runMigrations } = await import('../agent/db/migrations.ts');

/** Thrown inside the transaction on --dry-run, so every write rolls back. */
class DryRun extends Error {}

type Row = {
  user_id: string;
  source: string;
  external_id: string;
  title: string;
  url: string;
  context: string;
  author: string;
  status: string;
  boards: unknown;
  state: string;
  work: unknown;
  notes: unknown;
  done_at: string | Date | null;
  done_by: string | null;
  added_at: string | Date;
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const from = args.find((a) => !a.startsWith('--'));
if (!from) {
  console.error('usage: bun run import-plate <export.json | postgres://…> [--dry-run]');
  process.exit(1);
}

async function readRows(source: string): Promise<Row[]> {
  if (/^postgres(ql)?:\/\//.test(source)) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(source);
    const other = postgres(source, { max: 1, ssl: local ? false : 'require', onnotice: () => {} });
    try {
      return (await other`SELECT * FROM items ORDER BY id`) as unknown as Row[];
    } finally {
      await other.end();
    }
  }
  const body = (await Bun.file(source).json()) as { items?: Row[] };
  if (!Array.isArray(body.items)) throw new Error(`${source} has no "items" array`);
  return body.items;
}

const rows = await readRows(from);
const target = describeTarget();
console.log(`${rows.length} item(s) from ${from.replace(/\/\/[^@]*@/, '//…@')} into ${target}${dryRun ? ' (dry run)' : ''}`);
if (target === from || from.includes(target.split('/')[0]!)) {
  console.error('the source and the target are the same database');
  process.exit(1);
}

await runMigrations();
const sql = db();
let inserted = 0;
let filled = 0;

await sql.begin(async (tx) => {
  for (const r of rows) {
    const [result] = await tx<{ inserted: boolean; changed: boolean }[]>`
      INSERT INTO items (user_id, source, external_id, title, url, context, author, status,
                         boards, state, work, notes, done_at, done_by, added_at)
      VALUES (${r.user_id}, ${r.source}, ${r.external_id}, ${r.title}, ${r.url}, ${r.context},
              ${r.author}, ${r.status}, ${tx.json((r.boards ?? []) as never)}, ${r.state ?? ''},
              ${r.work ? tx.json(r.work as never) : null}, ${tx.json((r.notes ?? []) as never)},
              ${r.done_at}, ${r.done_by}, ${r.added_at})
      ON CONFLICT (user_id, source, external_id) DO UPDATE
         SET notes = CASE WHEN items.notes = '[]'::jsonb THEN EXCLUDED.notes ELSE items.notes END,
             done_at = coalesce(items.done_at, EXCLUDED.done_at),
             done_by = coalesce(items.done_by, EXCLUDED.done_by),
             updated_at = now()
       WHERE (items.notes = '[]'::jsonb AND EXCLUDED.notes <> '[]'::jsonb)
          OR (items.done_at IS NULL AND EXCLUDED.done_at IS NOT NULL)
      RETURNING (xmax = 0) AS inserted, true AS changed
    `;
    if (result?.inserted) inserted++;
    else if (result?.changed) filled++;
  }
  if (dryRun) throw new DryRun();
}).catch((err) => {
  if (!(err instanceof DryRun)) throw err;
});

console.log(`${inserted} inserted, ${filled} filled in, ${rows.length - inserted - filled} already complete${dryRun ? ' — rolled back' : ''}`);
await shutdown();
