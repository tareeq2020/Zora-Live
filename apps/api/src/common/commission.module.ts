import { Global, Injectable, Module } from '@nestjs/common';
import { db, resolveCommissionRate } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { OrganizerRepo } from '../storage/organizer-repo';

/* CommissionService (BS35 / plan #6) — the API-side lookup that feeds
   @zora/core's resolveCommissionRate. Core stays DB- and framework-agnostic, so
   the RESOLUTION ORDER lives there and the LOOKUPS live here.

   Every method resolves BEFORE the checkout transaction opens and the result is
   passed by value into core, matching the existing rule in payments/service.ts:
   a pooled query issued while holding a tx connection can deadlock the
   transaction pooler under surge.

   Ownership + the per-event override live in the collection_store 'events' blob
   (event.organizer_id is NULL post-seed — see org-scope.service.ts C3), so the
   event side is a blob read and the org side is an `organizer` row. */
@Injectable()
export class CommissionService {
  constructor(private readonly entities: EntityStore, private readonly organizers: OrganizerRepo) {}

  /** The rate in force for a purchase on `eventId`: event override → org → default. */
  async forEvent(eventId: string | null | undefined): Promise<number> {
    if (!eventId) return resolveCommissionRate(null, null);
    const events = await this.entities.read<any[]>('events', []);
    const event = Array.isArray(events) ? events.find((e) => e && e.id === eventId) : null;
    const org = event?.organizerHandle ? await this.organizers.byHandle(event.organizerHandle) : null;
    return resolveCommissionRate(event, org);
  }

  /** GA/VIP checkout: the cart is single-event, so the first tier names it. One
      cheap indexed read, outside the tx. */
  async forTier(tierId: string): Promise<number> {
    const rows = await db()<{ event_id: string }[]>`select event_id from product_tier where id = ${tierId}`;
    return this.forEvent(rows[0]?.event_id);
  }

  /** Split seats: the share's table names the event (D1 — split money lives only
      on `table_share` orders, so they must be stamped too). */
  async forSplitShare(shareId: string): Promise<number> {
    const rows = await db()<{ event_id: string }[]>`
      select ts.event_id from split_share s join table_split ts on ts.id = s.split_id where s.id = ${shareId}`;
    return this.forEvent(rows[0]?.event_id);
  }
}

@Global()
@Module({ providers: [CommissionService], exports: [CommissionService] })
export class CommissionModule {}
