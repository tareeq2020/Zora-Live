import { Injectable } from '@nestjs/common';
import { db } from '@zora/core';
import { FileStore } from './file-store.service';

/* The seam the file->Postgres cutover flips on.
   Every collection read/write goes through EntityStore, which picks a backend
   PER ENTITY from the DATA_BACKEND env:
     DATA_BACKEND="pg:settings|tiers"   # those use Postgres; everything else json

   json backend  -> FileStore (data/<entity>.json)   [default, unchanged behavior]
   pg backend    -> collection_store table (exact JSON TEXT blob per collection)

   Storing the blob as TEXT (not jsonb) and returning JSON.parse(text) preserves
   key order, so res.json reproduces byte-identical output to the file backend —
   that's what the golden-dataset diff asserts before each flip. Dropping an
   entity from DATA_BACKEND is the instant rollback (reads go back to JSON). */

export type Backend = 'json' | 'pg';

function parseBackends(raw = process.env.DATA_BACKEND || ''): Set<string> {
  const pg = new Set<string>();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [backend, list] = part.split(':');
    if (backend === 'pg' && list) for (const e of list.split('|')) { const t = e.trim(); if (t) pg.add(t); }
  }
  return pg;
}

@Injectable()
export class EntityStore {
  private readonly pgEntities = parseBackends();

  constructor(private readonly files: FileStore) {}

  backendFor(entity: string): Backend {
    return this.pgEntities.has(entity) ? 'pg' : 'json';
  }

  async read<T>(entity: string, fallback: T): Promise<T> {
    if (this.backendFor(entity) === 'json') {
      return this.files.readJson<T>(entity + '.json', fallback);
    }
    const rows = await db()<{ data: string }[]>`select data from collection_store where name = ${entity}`;
    if (!rows.length) return fallback;
    return JSON.parse(rows[0].data) as T;
  }

  async write(entity: string, data: unknown): Promise<void> {
    if (this.backendFor(entity) === 'json') {
      this.files.writeJson(entity + '.json', data);
      return;
    }
    const text = JSON.stringify(data);
    await db()`
      insert into collection_store (name, data, updated_at)
      values (${entity}, ${text}, now())
      on conflict (name) do update set data = excluded.data, updated_at = now()`;
  }
}
