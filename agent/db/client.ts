import postgres from 'postgres';

/**
 * Postgres connection.
 *
 * Astropods injects discrete fields for a Postgres knowledge store —
 * POSTGRES_HOST / PORT / USER / PASSWORD / DB — and deliberately not a URL
 * (Redis, Qdrant and Neo4j get a _URL; Postgres does not). POSTGRES_URL is
 * still honoured first because a hosted provider like Neon or Supabase hands
 * you one, and that is the shape you want when pointing this laptop at the
 * same shared store the deployed agent uses.
 */

let _sql: postgres.Sql | null = null;

function sql(): postgres.Sql {
  if (_sql) return _sql;

  const url = process.env.POSTGRES_URL;
  const local = targetIsLocal();

  const options = {
    max: 8,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
    // A hosted Postgres (Supabase, Neon, RDS) refuses plaintext; a Homebrew
    // install generally has no certificate. Decide from where it is, not from
    // a flag someone has to remember.
    ssl: local ? (false as const) : ('require' as const),
    // Supabase's transaction-mode pooler on 6543 multiplexes connections and
    // cannot hold prepared statements, which postgres.js uses by default —
    // symptom is a confusing "prepared statement already exists". The direct
    // connection and the session-mode pooler are both fine.
    prepare: !usesTransactionPooler(url),
  };

  _sql = url
    ? postgres(url, options)
    : postgres({
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? 'daily_plate',
        username: process.env.POSTGRES_USER ?? 'postgres',
        password: process.env.POSTGRES_PASSWORD ?? 'postgres',
        ...options,
      });
  return _sql;
}

/** Supabase's transaction pooler, which forbids prepared statements. */
function usesTransactionPooler(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).port === '6543';
  } catch {
    return false;
  }
}

export function db(): postgres.Sql {
  return sql();
}

/**
 * Which database this process is talking to, with credentials stripped —
 * `localhost/daily_plate`, or `ep-cool-name.neon.tech/neondb`.
 *
 * Worth surfacing because the two cases look identical from the browser: the
 * same UI on the same port, backed by either this laptop's Postgres or the
 * shared store the deployed agent uses. Writing a day into the wrong one and
 * not noticing is the failure this prevents.
 */
export function describeTarget(): string {
  const url = process.env.POSTGRES_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      const database = parsed.pathname.replace(/^\//, '') || '?';
      return `${parsed.hostname}/${database}`;
    } catch {
      return 'POSTGRES_URL (unparseable)';
    }
  }
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const database = process.env.POSTGRES_DB ?? 'daily_plate';
  return `${host}/${database}`;
}

/** Whether that database is on this machine. */
export function targetIsLocal(): boolean {
  return /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(
    describeTarget().split('/')[0] ?? '',
  );
}

export async function ping(): Promise<boolean> {
  try {
    await sql()`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function shutdown(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}
