import {
  cartOutcome, orderStageReached, organizerOutcome, organizerStage, matchRecoveries, issuesPasses, earnsCollected,
  isCartOutcome, type OrderStage, type OutcomeAttempt,
} from '@zora/core';
import { outcomeRows, recoveryCandidates, acceptedAtSql, acceptTrackedSinceMs } from '../admin-orders/outcome-sql';

/* BS160: outcomes for the organizer's orders. Same rules as the admin list
   (@zora/core cartOutcome + outcome-sql.ts), worded by organizerOutcome so a
   row never carries a gateway error, reference or transaction id. */

/** Credential states that mean the holder came through the door. */
export const CHECKED_IN_STATES = ['scanned', 'wristband_issued', 'used'];

export interface OrgOutcomeFields {
  outcome: string;
  outcomeLabel: string;
  outcomeDetail: string | null;
  stageReached: OrderStage;
}

/** What decorate() needs from each order row. */
export interface OutcomeOrderRow {
  id: string;
  event_id: string;
  type: string | null;
  status: string;
  channel: string | null;
  created_at: Date | string;
  customer_id: string | null;
  phone: string | null;
  notified_at: Date | string | null;
}

export interface Decorations {
  attemptsByOrder: Map<string, (OutcomeAttempt & { transactionId: string; updatedAt: string | null; collectedAmount: number | null })[]>;
  checkedIn: Set<string>;
  holdLive: Set<string>;
  recoveredBy: Map<string, string>;
}

const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Attempts, door state, live holds and recoveries for a page. Four queries for the page, never per row. */
export async function readDecorations(sql: any, rows: OutcomeOrderRow[]): Promise<Decorations> {
  const ids = rows.map((r) => r.id);
  // Sequential on purpose: one connection per request (the pool is small).
  // accepted_at exactly as the admin list reads it (BS159), so outcomes match.
  const attempts = await sql`select pt.order_id, pt.transaction_id, pt.method, pt.status, pt.order_reference, pt.bill_pay_number,
               pt.error, pt.failure_reason, pt.created_at, pt.updated_at, pt.collected_amount, ${acceptedAtSql(sql)} as accepted_at
          from payment_transaction pt where pt.order_id = any(${ids}::uuid[]) order by pt.created_at asc`;
  const creds = await sql`select coalesce(oi.order_id, ss.order_id) as order_id
          from credential c
          left join order_item oi on oi.id = c.order_item_id
          left join split_share ss on ss.id = c.split_share_id
         where coalesce(oi.order_id, ss.order_id) = any(${ids}::uuid[]) and c.state = any(${CHECKED_IN_STATES})`;
  const holds = await sql`select order_id from inventory_hold
         where order_id = any(${ids}::uuid[]) and state = 'held' and expires_at > now()
        union
        select hold_order_id from seat_inventory
         where hold_order_id = any(${ids}::uuid[]) and state = 'held' and hold_expires_at > now()`;
  const attemptsByOrder: Decorations['attemptsByOrder'] = new Map();
  for (const a of attempts as any[]) {
    const arr = attemptsByOrder.get(a.order_id) ?? [];
    arr.push({
      transactionId: a.transaction_id, method: a.method ?? null, acceptedAt: iso(a.accepted_at), status: a.status, orderReference: a.order_reference, billPayNumber: a.bill_pay_number,
      error: a.error ?? null, failureReason: a.failure_reason ?? null, createdAt: iso(a.created_at),
      updatedAt: iso(a.updated_at), collectedAmount: a.collected_amount == null ? null : Number(a.collected_amount),
    });
    attemptsByOrder.set(a.order_id, arr);
  }

  // Only a cart that never paid can be recovered (same rule as the admin list).
  const carts = rows.filter((r) => r.type !== 'comp' && !String(r.channel ?? 'online').startsWith('gate')
    && !issuesPasses(r.status) && !earnsCollected(r.status));
  let recoveredBy = new Map<string, string>();
  if (carts.length) {
    const toCart = (r: any) => ({ id: r.id, eventId: r.event_id, createdAt: r.created_at, customerId: r.customer_id, phone: r.phone });
    const candidates = (await recoveryCandidates(sql, carts.map(toCart))) as any[];
    recoveredBy = matchRecoveries(carts.map(toCart), candidates.map(toCart));
  }
  return {
    attemptsByOrder,
    checkedIn: new Set((creds as any[]).map((r) => r.order_id)),
    holdLive: new Set((holds as any[]).map((r) => r.order_id)),
    recoveredBy,
  };
}

/** The outcome fields of one row, as an organizer sees them. */
export function outcomeFields(o: OutcomeOrderRow, d: Decorations, steps?: Iterable<string>) {
  const attempts = d.attemptsByOrder.get(o.id) ?? [];
  const r = cartOutcome({
    status: o.status, type: o.type, channel: o.channel, createdAt: o.created_at, attempts,
    holdLive: d.holdLive.has(o.id), recoveredBy: d.recoveredBy.get(o.id) ?? null,
    acceptTrackedSinceMs: acceptTrackedSinceMs(),
  });
  const stage = orderStageReached({ status: o.status, attempts, notified: o.notified_at != null, checkedIn: d.checkedIn.has(o.id), steps });
  return { result: r, fields: { ...organizerOutcome(r), stageReached: organizerStage(stage) } as OrgOutcomeFields };
}

/** A where-fragment keeping orders whose SQL outcome is `outcome`, over the
    given org scope. Null when the value is not a known outcome. */
export function outcomeFilter(sql: any, scopeIds: string[], outcome: string | null | undefined, from?: string, to?: string) {
  if (!isCartOutcome(outcome)) return null;
  const scoped = sql`
    select o.id from "order" o
     where o.event_id = any(${scopeIds})
       and (${from ?? null}::timestamptz is null or o.created_at >= ${from ?? null}::timestamptz)
       and (${to ?? null}::timestamptz is null or o.created_at <= ${to ?? null}::timestamptz)`;
  return sql`o.id in (select z.id from (${outcomeRows(sql, scoped)}) z where z.outcome = ${outcome})`;
}
