import { Injectable } from '@nestjs/common';
import { FileStore } from './file-store.service';

/* The seam the file->Postgres cutover flips on.
   Every collection read/write goes through EntityStore, which picks a backend
   PER ENTITY from the DATA_BACKEND env. Default is `json` (delegates to FileStore),
   so with no env set the app behaves exactly as before — this PR is a pure
   refactor, gated by the parity suite.

   PR-3 adds the Postgres backend + backfill and flips entities one at a time:
     DATA_BACKEND="pg:tiers|settings|events"   # those read/write Postgres; rest stay json
   The flag is the instant rollback (drop an entity from the list -> back to JSON).

   Async on purpose: the Postgres backend is async, so callers await now while the
   backend is still json (Promise.resolve), avoiding a second refactor at flip time. */

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
    if (this.backendFor(entity) === 'pg') {
      throw new Error(`EntityStore: pg backend for "${entity}" is not wired until PR-3`);
    }
    return this.files.readJson<T>(entity + '.json', fallback);
  }

  async write(entity: string, data: unknown): Promise<void> {
    if (this.backendFor(entity) === 'pg') {
      throw new Error(`EntityStore: pg backend for "${entity}" is not wired until PR-3`);
    }
    this.files.writeJson(entity + '.json', data);
  }
}
