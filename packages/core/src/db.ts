import postgres, { type Sql } from 'postgres';

/* The single Postgres entry point for the whole domain.
   - Runtime connects via the transaction pooler (set PG_PREPARE=false there).
   - int8 (oid 20) is parsed to a JS number: ZORA money is whole-TZS bigint and
     stays well under 2^53, so this avoids BigInt/JSON serialization breakage.
   - tx(fn) wraps sql.begin so domain helpers can run standalone or in a tx. */

let _sql: Sql | null = null;

export function makeSql(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, {
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 10,
    // Transaction-pooler mode forbids prepared statements; toggle via env.
    prepare: process.env.PG_PREPARE !== 'false',
    types: {
      // int8 -> number (safe for TZS money magnitudes)
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
}

/** Process-wide lazy singleton pool. */
export function db(): Sql {
  if (!_sql) _sql = makeSql();
  return _sql;
}

/** Run fn inside a transaction; accepts the pool or an existing tx handle. */
export async function tx<T>(fn: (sql: Sql) => Promise<T>, sql: Sql = db()): Promise<T> {
  return sql.begin(fn as any) as Promise<T>;
}

export async function closeDb(): Promise<void> {
  if (_sql) { await _sql.end({ timeout: 5 }); _sql = null; }
}

export type { Sql };
