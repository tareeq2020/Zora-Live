import { Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { EntityStore } from '../storage/entity-store';
import { resolveActingContext } from './acting-context';

/* OrgScopeService — the shared org-scoping spine MT2 (events CRUD) and MT3
   (sales/reporting) import. It is the single place that answers "who is acting"
   and "which events does an org own".

   C3: event.organizerHandle lives ONLY in the collection_store 'events' blob, not
   in Postgres (event.organizer_id is NULL post-seed). Ownership is therefore an
   id-set computed from the blob — never a SQL join on organizerHandle. Callers
   scope relational reads with `... where event_id = ANY(ownedIds)`. */
@Injectable()
export class OrgScopeService {
  constructor(private readonly entities: EntityStore) {}

  /** C1: acting handle for a request — same resolution as OrganizerGuard. */
  actingHandle(req: Request): string | null {
    return resolveActingContext(req.session).actingHandle;
  }

  /** Parsed 'events' blob (the collection_store row every collection uses). */
  async readEvents(): Promise<any[]> {
    const events = await this.entities.read<any[]>('events', []);
    return Array.isArray(events) ? events : [];
  }

  /** Ids of every event owned by `handle` (C3 — the scoping id set). */
  async ownedEventIds(handle: string): Promise<string[]> {
    const events = await this.readEvents();
    return events.filter((e) => e && e.organizerHandle === handle).map((e) => e.id);
  }

  /** The owned event, or a 404-mapped error (no 403 — avoids existence leaks). */
  async assertOwnsEvent(handle: string, eventId: string): Promise<any> {
    const events = await this.readEvents();
    const ev = events.find((e) => e && e.id === eventId);
    if (!ev || ev.organizerHandle !== handle) {
      throw new NotFoundException({ error: 'Not found' });
    }
    return ev;
  }
}
