import { Injectable } from '@nestjs/common';
import {
  db, wasEverPaid, buildTimeline, organizerTimeline, organizerExplanation, organizerOutcome,
  CART_OUTCOMES, ORG_FUNNEL_STAGES, type RawEntry, type OrgTimelineEntry,
} from '@zora/core';
import { OrgScopeService } from './org-scope.service';
import { OrgSalesService, type OrgOrderDbRow, type OrgOrderRowWithOutcome } from './org-sales.service';
import { readDecorations, outcomeFields } from './org-outcomes';
import { acceptTrackedSinceMs } from '../admin-orders/outcome-sql';
import { AdminFunnelService, FUNNEL_DAYS } from '../admin-orders/admin-funnel.service';

/* BS160: the organizer's funnel and order detail, for their own events only.

   A lighter copy of the admin views: the same outcome rules and the same stage
   counts (the funnel reuses AdminFunnelService scoped to the org, so the two
   always agree), without anything that is our plumbing: no transaction ids,
   references, gateway errors, callback or status bodies, admin pushes or
   notes. An order of another organizer is a 404, never a 403. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

export interface OrgOrderDetail extends OrgOrderRowWithOutcome {
  /** One plain line on the outcome, in organizer words. */
  outcomeExplanation: string;
  timeline: OrgTimelineEntry[];
}

@Injectable()
export class OrgFunnelService {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly sales: OrgSalesService,
    private readonly adminFunnel: AdminFunnelService,
  ) {}

  /** GET /api/org/orders/:id. Null when the id is malformed, absent or not this org's. */
  async detail(handle: string, id: string): Promise<OrgOrderDetail | null> {
    if (!UUID_RE.test(String(id || ''))) return null;
    const sql = db();
    const [o] = (await sql`
      select o.id, o.event_id, o.type, o.status, o.channel, o.created_at, o.notified_at, o.customer_id,
             o.refunded_at, c.phone, c.email
        from "order" o left join customer c on c.id = o.customer_id
       where o.id = ${id}::uuid`) as any[];
    if (!o) return null;
    const ev = (await this.scope.readEvents()).find((e) => e && e.id === o.event_id);
    if (!ev || ev.organizerHandle !== handle) return null;

    const logged = (await sql`
      select at, step, transaction_id, detail from order_event where order_id = ${id}::uuid order by at asc, id asc`
      .catch(() => [])) as any[];
    const passes = (await sql`
      select c.public_ref, c.issued_at, c.scanned_at from credential c join order_item oi on oi.id = c.order_item_id where oi.order_id = ${id}::uuid
      union all
      select c.public_ref, c.issued_at, c.scanned_at from credential c join split_share ss on ss.id = c.split_share_id where ss.order_id = ${id}::uuid`) as any[];
    const holds = (await sql`select state, expires_at from inventory_hold where order_id = ${id}::uuid`) as any[];

    const decorations = await readDecorations(sql, [o]);
    const steps = new Map([[id, logged.map((e) => String(e.step))]]);
    const [row] = await this.sales.rowsFor(sql, [o as OrgOrderDbRow], new Map([[ev.id, ev.name ?? null]]), { decorations, steps });
    const attempts = decorations.attemptsByOrder.get(id) ?? [];

    // Logged steps merged with ones derived from the tables (orders before 0035).
    const loggedEntries: RawEntry[] = logged.map((e) => ({
      at: iso(e.at) as string, step: e.step, transactionId: e.transaction_id ?? null,
      detail: e.detail && typeof e.detail === 'object' ? e.detail : {},
    }));
    const derived: RawEntry[] = [{ at: iso(o.created_at) as string, step: 'cart_created', transactionId: null, detail: {} }];
    for (const a of attempts) {
      derived.push({ at: a.createdAt as string, step: 'pay_requested', transactionId: a.transactionId, detail: {} });
      const at = a.updatedAt ?? (a.createdAt as string);
      if (a.error) derived.push({ at, step: 'gateway_rejected', transactionId: a.transactionId, detail: {} });
      else if (a.status === 'successful' && wasEverPaid(o.status)) derived.push({ at, step: 'paid', transactionId: a.transactionId, detail: {} });
      else if (a.status === 'failed') derived.push({ at, step: 'failed', transactionId: a.transactionId, detail: {} });
      else if (a.status === 'expired') derived.push({ at, step: 'status_changed', transactionId: a.transactionId, detail: { to: 'expired' } });
    }
    // Comps and door sales are paid without an attempt.
    if (!attempts.length && wasEverPaid(o.status)) derived.push({ at: iso(o.created_at) as string, step: 'paid', transactionId: null, detail: {} });
    const issued = passes.map((p) => p.issued_at).filter(Boolean).map((d: any) => new Date(d).getTime());
    if (issued.length) derived.push({ at: new Date(Math.min(...issued)).toISOString(), step: 'passes_issued', transactionId: null, detail: {} });
    if (o.notified_at) derived.push({ at: iso(o.notified_at) as string, step: 'buyer_notified', transactionId: null, detail: {} });
    // publicRef only lines a scan up with its logged step; it never leaves this method.
    for (const p of passes) {
      if (p.scanned_at) derived.push({ at: iso(p.scanned_at) as string, step: 'checked_in', transactionId: null, detail: { publicRef: p.public_ref } });
    }
    if (o.refunded_at) derived.push({ at: iso(o.refunded_at) as string, step: 'refunded', transactionId: null, detail: {} });
    const lastExpiry = holds.map((h) => h.expires_at).filter(Boolean).map((d: any) => new Date(d).getTime()).sort((a, b) => b - a)[0];
    if (lastExpiry && o.status === 'expired' && holds.some((h) => h.state === 'released')) {
      derived.push({ at: new Date(lastExpiry).toISOString(), step: 'expired', transactionId: null, detail: {} });
    }

    const result = outcomeFields(o, decorations, steps.get(id)).result;
    return {
      ...row,
      outcomeExplanation: organizerExplanation(result, attempts),
      timeline: organizerTimeline(buildTimeline(loggedEntries, derived), attempts, Date.now(), acceptTrackedSinceMs()),
    };
  }

  /** GET /api/org/funnel?days=7|30|90&event=. The admin funnel scoped to this
      org, without gateway_accepted and the gateway drop-off block. */
  async funnel(handle: string, daysRaw?: number | null, event?: string | null) {
    if (event) await this.scope.assertOwnsEvent(handle, event); // 404 when not theirs
    const days = (FUNNEL_DAYS as readonly number[]).includes(Number(daysRaw)) ? Number(daysRaw) : 7;
    const f = await this.adminFunnel.funnel({ days, org: handle, event: event || null });
    const count = new Map(f.stages.map((s) => [s.stage as string, s.count]));
    const stages = ORG_FUNNEL_STAGES.map((stage, i) => {
      const n = count.get(stage) ?? 0;
      if (i === 0) return { stage, count: n, fromPrev: null as number | null, dropPct: null as number | null };
      const prev = count.get(ORG_FUNNEL_STAGES[i - 1]) ?? 0;
      return { stage, count: n, fromPrev: prev, dropPct: prev > 0 ? Math.round(((prev - n) / prev) * 1000) / 10 : null };
    });
    const outcomes = CART_OUTCOMES.map((k) => {
      const v = organizerOutcome({ outcome: k, outcomeDetail: null });
      // Sub-reasons only where they are the buyer's (organizerOutcome keeps them).
      const subs = Object.entries((f.outcomeDetails as Record<string, Record<string, number>>)[k] ?? {})
        .map(([d, n]) => ({ o: organizerOutcome({ outcome: k, outcomeDetail: d }), n }))
        .filter((x) => x.o.outcomeDetail != null)
        .map((x) => ({ detail: x.o.outcomeDetail as string, label: x.o.outcomeLabel, count: x.n }))
        .sort((a, b) => b.count - a.count);
      return { outcome: k, label: v.outcomeLabel, count: f.outcomes[k] ?? 0, details: subs };
    });
    return { window: f.window, event: event || null, stages, unique: f.unique, outcomes };
  }
}
