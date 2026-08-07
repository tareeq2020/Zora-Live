import { Injectable } from '@nestjs/common';
import {
  countAudience, createBroadcast, db, estimateSmsCost, listBroadcasts, smsCapState, smsUnitCost,
} from '@zora/core';
import type {
  AudienceCount, AudienceScope, BroadcastChannel, BroadcastRecord, BroadcastScopeKind,
  CreateBroadcastResult, SmsCapState, SmsCostEstimate,
} from '@zora/core';
import { OrgScopeService } from '../org/org-scope.service';
import { OrganizerRepo } from '../storage/organizer-repo';

/* BroadcastsService (BS43 / #2) — the SCOPE RESOLVER, and nothing else.
   Audience maths, gates, queueing and the drain all live in @zora/core so both
   consoles share one implementation (eng review CQ2). What is genuinely
   different between them is WHO may be addressed, and that is decided here.

   ── The isolation rule ──────────────────────────────────────────────────────
   `resolveOrgScope` turns a request into a set of event ids the ACTING org
   already owns, or refuses. Core is then handed the resolved id set and never
   sees the raw request, so there is no field on the wire an organizer could set
   to reach another organizer's buyers — cross-org targeting is impossible by
   construction, not by a check someone might forget (the same rule org-sales
   and payouts follow). An unowned event id resolves to an EMPTY set, which core
   refuses as `scope_forbidden`; it never reports whether that event exists.

   Ownership itself lives in the collection_store 'events' blob (C3), which is
   why this reads OrgScopeService rather than joining on organizerHandle. */

export type ScopeRequest = {
  kind?: unknown;
  eventId?: unknown;
  tierId?: unknown;
  organizerHandle?: unknown;
};

export interface ResolvedScope {
  ok: true;
  scope: AudienceScope;
  label: string;
}
export interface RejectedScope {
  ok: false;
  code: 'scope_forbidden' | 'scope_invalid';
  message: string;
}

const ORG_SCOPES: BroadcastScopeKind[] = ['event', 'tier', 'org_all'];
const ADMIN_SCOPES: BroadcastScopeKind[] = ['platform', 'organizer', 'event', 'tier'];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** SMS sender IDs are alphanumeric and ≤11 chars at every gateway we use; a
    longer one is silently truncated by the provider, which is how an organizer
    ends up sending as "THE BRUNCH C". Reject it here instead. */
export function normalizeSenderId(raw: unknown): string {
  return str(raw).replace(/[^A-Za-z0-9 ]/g, '').slice(0, 11).trim();
}

/** A sensible default the composer pre-fills: the org's own name, squeezed into
    the 11-character sender-ID limit. */
export function defaultSenderIdFor(name: string | null, handle: string): string {
  const base = normalizeSenderId(name || handle) || normalizeSenderId(handle);
  return base || 'ZORA';
}

export interface AudienceOptionEvent {
  id: string;
  name: string | null;
  organizerHandle: string | null;
  tiers: { id: string; name: string }[];
}

@Injectable()
export class BroadcastsService {
  constructor(
    private readonly scopeSvc: OrgScopeService,
    private readonly organizers: OrganizerRepo,
  ) {}

  // ── scope resolution ───────────────────────────────────────────────────────

  /** ORGANIZER scopes: their own event, their own tier, or all their buyers. */
  async resolveOrgScope(handle: string, req: ScopeRequest): Promise<ResolvedScope | RejectedScope> {
    const kind = str(req?.kind) as BroadcastScopeKind;
    if (!ORG_SCOPES.includes(kind)) {
      return { ok: false, code: 'scope_invalid', message: 'Pick who this goes to.' };
    }
    const events = await this.scopeSvc.readEvents();
    const owned = events.filter((e) => e && e.organizerHandle === handle);
    const ownedIds = owned.map((e) => e.id as string);

    if (kind === 'org_all') {
      return {
        ok: true,
        scope: { kind, eventIds: ownedIds, organizerHandle: handle },
        label: 'All my customers',
      };
    }

    const eventId = str(req?.eventId);
    // THE isolation check. Not "does this event exist" — "do I own it".
    if (!eventId || !ownedIds.includes(eventId)) {
      return { ok: false, code: 'scope_forbidden', message: 'You can only message your own buyers.' };
    }
    const eventName = (owned.find((e) => e.id === eventId)?.name as string) || eventId;

    if (kind === 'event') {
      return { ok: true, scope: { kind, eventIds: [eventId], eventId, organizerHandle: handle }, label: eventName };
    }

    const tierId = str(req?.tierId);
    // The tier must belong to the owned event, or a tier id from another event
    // would smuggle the scope sideways.
    if (!tierId || !(await this.tierBelongsTo(tierId, eventId))) {
      return { ok: false, code: 'scope_forbidden', message: 'You can only message your own buyers.' };
    }
    return {
      ok: true,
      scope: { kind, eventIds: [eventId], eventId, tierId, organizerHandle: handle },
      label: `${eventName} — one tier`,
    };
  }

  /** ADMIN scopes: everyone, one organizer, one event, one tier. No ownership
      restriction — but still resolved through the same shape so core is handed
      an id set either way and there is one send path, not two. */
  async resolveAdminScope(req: ScopeRequest): Promise<ResolvedScope | RejectedScope> {
    const kind = str(req?.kind) as BroadcastScopeKind;
    if (!ADMIN_SCOPES.includes(kind)) {
      return { ok: false, code: 'scope_invalid', message: 'Pick who this goes to.' };
    }
    if (kind === 'platform') {
      // null (not []) = every customer. Only reachable from here.
      return { ok: true, scope: { kind, eventIds: null }, label: 'Everyone on Zora' };
    }

    const events = await this.scopeSvc.readEvents();

    if (kind === 'organizer') {
      const orgHandle = str(req?.organizerHandle).toLowerCase();
      if (!orgHandle) return { ok: false, code: 'scope_invalid', message: 'Pick an organizer.' };
      const ids = events.filter((e) => e && e.organizerHandle === orgHandle).map((e) => e.id as string);
      const org = await this.organizers.byHandle(orgHandle);
      return {
        ok: true,
        scope: { kind, eventIds: ids, organizerHandle: orgHandle },
        label: org?.name || orgHandle,
      };
    }

    const eventId = str(req?.eventId);
    const ev = events.find((e) => e && e.id === eventId);
    if (!eventId || !ev) return { ok: false, code: 'scope_invalid', message: 'Pick an event.' };
    const eventName = (ev.name as string) || eventId;

    if (kind === 'event') {
      return {
        ok: true,
        scope: { kind, eventIds: [eventId], eventId, organizerHandle: ev.organizerHandle ?? null },
        label: eventName,
      };
    }

    const tierId = str(req?.tierId);
    if (!tierId || !(await this.tierBelongsTo(tierId, eventId))) {
      return { ok: false, code: 'scope_invalid', message: 'Pick a tier of that event.' };
    }
    return {
      ok: true,
      scope: { kind, eventIds: [eventId], eventId, tierId, organizerHandle: ev.organizerHandle ?? null },
      label: `${eventName} — one tier`,
    };
  }

  private async tierBelongsTo(tierId: string, eventId: string): Promise<boolean> {
    const rows = await db()<{ id: string }[]>`
      select id from product_tier where id = ${tierId} and event_id = ${eventId}`;
    return rows.length > 0;
  }

  // ── audience picker options ────────────────────────────────────────────────

  /** Events (+ their tiers) the composer offers. Scoped to `handle` for the
      organizer console; every event for admin. */
  async audienceOptions(handle: string | null): Promise<AudienceOptionEvent[]> {
    const events = await this.scopeSvc.readEvents();
    const visible = handle == null ? events.filter(Boolean) : events.filter((e) => e && e.organizerHandle === handle);
    const ids = visible.map((e) => e.id as string);
    if (!ids.length) return [];
    const tiers = await db()<{ id: string; event_id: string; name: string | null }[]>`
      select id, event_id, name from product_tier where event_id = any(${ids}) order by name asc, id asc`;
    const byEvent = new Map<string, { id: string; name: string }[]>();
    for (const t of tiers) {
      const arr = byEvent.get(t.event_id) ?? [];
      arr.push({ id: t.id, name: t.name || t.id });
      byEvent.set(t.event_id, arr);
    }
    return visible.map((e) => ({
      id: e.id as string,
      name: (e.name as string) ?? null,
      organizerHandle: (e.organizerHandle as string) ?? null,
      tiers: byEvent.get(e.id as string) ?? [],
    }));
  }

  // ── the three operations both consoles share ───────────────────────────────

  /** Live recipient count + the cost-confirm figure. Cheap by construction — one
      aggregate, no recipient rows (PERF-2). */
  async preview(
    scope: AudienceScope,
    senderHandle: string,
    senderKind: 'org' | 'admin',
    bodySms: string,
  ): Promise<{ audience: AudienceCount; cost: SmsCostEstimate; cap: SmsCapState; unitCost: number }> {
    const sql = db();
    const scopeHandle = senderKind === 'org' ? senderHandle.toLowerCase() : null;
    const audience = await countAudience(sql, scope, scopeHandle);
    const cap = await smsCapState(sql, senderHandle);
    return {
      audience,
      cost: estimateSmsCost(audience.sms, bodySms || ''),
      cap,
      unitCost: smsUnitCost(),
    };
  }

  async send(input: {
    senderHandle: string;
    senderKind: 'org' | 'admin';
    scope: AudienceScope;
    channel: BroadcastChannel;
    subject: string | null;
    bodySms: string | null;
    bodyEmail: string | null;
    senderId: string | null;
    verified: boolean;
  }): Promise<CreateBroadcastResult> {
    return createBroadcast(db(), input);
  }

  async history(senderHandle: string | null, limit?: number): Promise<BroadcastRecord[]> {
    return listBroadcasts(db(), { senderHandle, limit });
  }

  async capFor(senderHandle: string): Promise<SmsCapState> {
    return smsCapState(db(), senderHandle);
  }
}
