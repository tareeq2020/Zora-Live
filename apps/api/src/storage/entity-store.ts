import { Injectable } from '@nestjs/common';
import { db } from '@zora/core';

/* Collection storage — always Postgres (the collection_store blob table).
   `data` is exact JSON text, so JSON.parse -> res.json reproduces byte-identical
   output to the old file backend (proven by the golden-fixture test). No dual
   backend / flag: the database is the source of truth. Requires DATABASE_URL and
   a backfilled store (see db/backfill.mjs). */
@Injectable()
export class EntityStore {
  async read<T>(entity: string, fallback: T): Promise<T> {
    const rows = await db()<{ data: string }[]>`select data from collection_store where name = ${entity}`;
    if (!rows.length) return fallback;
    return JSON.parse(rows[0].data) as T;
  }

  async write(entity: string, data: unknown): Promise<void> {
    const text = JSON.stringify(data);
    await db()`
      insert into collection_store (name, data, updated_at)
      values (${entity}, ${text}, now())
      on conflict (name) do update set data = excluded.data, updated_at = now()`;
  }
}
