/* PR-7: order creation + credential issuance.

   createGaVipOrder is the checkout write path. CORRECTNESS INVARIANTS:
   - ALL config (feeRate, holdTtl) is read BEFORE the tx and passed in as args.
     A pooled query (db()) issued while holding a tx connection can deadlock the
     transaction pooler under surge, so inside the tx we only ever touch `t`.
   - Every stock move (placeHold) and every write runs on the SAME tx handle `t`,
     so a thrown SoldOut rolls the whole tx back and PR-6's hold decrements are
     undone automatically — we never hand-roll a release.
   - unit_price + price_version_id are snapshotted per line, so a later re-price
     never mutates a placed order. */
import { tx } from '../db';
import { placeHold, convertHolds, convertReservation, releaseHolds, tryReacquire } from '../inventory';
import { generateCode, signCredential, generatePublicRef, ticketSigningKeys, qrPayload, renderQrPng } from '../credentials';
import {
  collectMobile, collectBillPay, collectCard, cardCheckoutUrl, collectionStatus, normalizeMsisdn,
  type CollectionStatusResponse,
} from './xbridge';
import { resolveFsp, type FspRouteMap, type PaymentMethod } from './fsp';
import { sendSms } from '../sms';
import { sendCredentialEmail } from '../email';
import { alertOps } from '../ops';
import {
  onShareSuccessful, onShareShort, onShareFailed, notifyShareReceived, notifySplitCompleteByOrder,
} from '../split';

type Sql = any; // postgres.js Sql | tx handle

/** Thrown when a line can't be held; caught at the top to become a sold_out result. */
export class SoldOut extends Error {
  constructor(public readonly tier: string) {
    super(`sold_out:${tier}`);
    this.name = 'SoldOut';
  }
}

export interface CartLine {
  tier: string;
  quantity: number;
}

export interface CreateGaVipOrderInput {
  phone: string;
  email?: string | null;
  cart: CartLine[];
  feeRate: number; // e.g. 0.05 — read from config BEFORE the tx
  holdTtl: number; // hold lifetime in seconds — read from config BEFORE the tx
}

export type CreateGaVipOrderResult =
  | { ok: true; orderId: string; total: number; subtotal: number; fee: number }
  | { ok: false; reason: 'sold_out'; tier: string };

/**
 * Create a pending GA/VIP order: upsert the customer, insert the order + line
 * items, and place an atomic inventory hold per line. All-or-nothing — any
 * sold-out line rolls the whole transaction back (releasing earlier holds).
 * Pass the pool (or an outer tx handle) as `sql`.
 */
export async function createGaVipOrder(sql: Sql, input: CreateGaVipOrderInput): Promise<CreateGaVipOrderResult> {
  const { phone, email, cart, feeRate, holdTtl } = input;
  try {
    return await tx(async (t: Sql) => {
      // (a) upsert customer by phone (the stable identity); refresh email.
      const custRows = await t`
        insert into customer (phone, email) values (${phone}, ${email ?? null})
        on conflict (phone) do update set email = excluded.email
        returning id`;
      const customerId = custRows[0].id;

      // (b) resolve the event from the (single-event) cart, open the order.
      const evRows = await t`select event_id from product_tier where id = ${cart[0].tier}`;
      if (!evRows.length) throw new SoldOut(cart[0].tier);
      const eventId = evRows[0].event_id;
      const ordRows = await t`
        insert into "order" (customer_id, event_id, type, status)
        values (${customerId}, ${eventId}, 'ga_vip', 'pending')
        returning id`;
      const orderId: string = ordRows[0].id;

      // (c) per line: snapshot the active price, place the hold, record the item.
      let subtotal = 0;
      let passedSubtotal = 0; // only lines whose price passes the fee to the buyer
      for (const line of cart) {
        const pvRows = await t`
          select id, price, fee_treatment from price_version
           where tier_id = ${line.tier} and effective_to is null
           order by effective_from desc limit 1`;
        if (!pvRows.length) throw new SoldOut(line.tier);
        const pv = pvRows[0];

        const hold = await placeHold(t, line.tier, orderId, line.quantity, holdTtl);
        if (hold === null) throw new SoldOut(line.tier); // rollback releases earlier holds

        await t`
          insert into order_item (order_id, product_tier_id, price_version_id, quantity, unit_price)
          values (${orderId}, ${line.tier}, ${pv.id}, ${line.quantity}, ${pv.price})`;

        const lineTotal = Number(pv.price) * line.quantity;
        subtotal += lineTotal;
        if (pv.fee_treatment === 'passed') passedSubtotal += lineTotal;
      }

      // (d) fee applies only to passed-through lines; capture the target.
      const fee = Math.round(passedSubtotal * feeRate);
      const total = subtotal + fee;
      await t`update "order" set target_value = ${total} where id = ${orderId}`;

      return { ok: true, orderId, total, subtotal, fee } as const;
    }, sql);
  } catch (e) {
    if (e instanceof SoldOut) return { ok: false, reason: 'sold_out', tier: e.tier };
    throw e;
  }
}

/**
 * Issue one signed credential per seat for every line item of a converted order.
 * Idempotent: the (order_item_id, seat_index) unique index makes re-runs a no-op.
 * Returns the number of NEW credentials inserted. For PR-9's payment-success path.
 */
export async function issueCredentials(sql: Sql, orderId: string): Promise<number> {
  const key = ticketSigningKeys()[0];
  const items = await sql`
    select oi.id, oi.product_tier_id, oi.quantity, o.event_id
      from order_item oi
      join "order" o on o.id = oi.order_id
     where oi.order_id = ${orderId}`;
  let issued = 0;
  for (const it of items) {
    for (let seat = 0; seat < it.quantity; seat++) {
      const code = generateCode();
      const signature = signCredential(
        { code, tier: it.product_tier_id, eventId: it.event_id, tableId: null },
        key,
      );
      const res = await sql`
        insert into credential (order_item_id, seat_index, event_id, tier_id, code, signature, public_ref)
        values (${it.id}, ${seat}, ${it.event_id}, ${it.product_tier_id}, ${code}, ${signature}, ${generatePublicRef()})
        on conflict (order_item_id, seat_index) where order_item_id is not null do nothing`;
      issued += res.count ?? 0;
    }
  }
  return issued;
}

/* ══════════════════════════════════════════════════════════════════════════
   PR-9: payment state machine + reconciliation.
   Webhook = fast path; collection/status = source of truth; every transition is
   idempotent and applied EXACTLY once. Hardened against the surge/payment races:
     - a fresh transaction_id per attempt, so a failed/timed-out payment is retryable
     - never issue a credential without confirmed inventory (convert, else reacquire,
       else flag paid_unseatable and issue NOTHING — the anti-oversell)
     - amount verification: a PARTIAL / short payment never issues a credential
   ══════════════════════════════════════════════════════════════════════════ */

/** Outcome of mapping a gateway collection status onto our state machine. */
export type PaymentOutcome = 'successful' | 'failed' | 'short' | 'pending';

/** A NEW transaction_id per attempt (H2): count existing attempts for the order,
    so a retry after a failed/timed-out payment gets a distinct key. */
export async function nextAttemptKey(sql: Sql, orderId: string): Promise<string> {
  const [{ n }] = await sql`
    select count(*)::int as n from payment_transaction where order_id = ${orderId}`;
  return `ZORA-${orderId}-${n + 1}`;
}

export interface InitiatePaymentInput {
  orderId: string;
  method: PaymentMethod;
  payerPhone: string;
  payerName?: string;
  mno?: string;
  callbackUrl: string;
  routeMap: FspRouteMap;
  /** Per-FSP fee overrides (fee is already baked into target_value at checkout;
      accepted for a stable call signature / future per-attempt re-pricing). */
  feeRateByFsp?: Record<string, number>;
}

export interface InitiatePaymentResult {
  transactionId: string;
  status: 'pending';
  billPayNumber?: string;
  redirectUrl?: string;
}

/** Start a collection. Payable when the order is pending OR failed (retry): a
    timed-out PIN does not lock the buyer out. A failed retry re-holds inventory
    (try_reacquire) before re-opening the order to pending. */
export async function initiatePayment(sql: Sql, input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
  const { orderId, method, payerPhone, payerName, mno, callbackUrl, routeMap } = input;
  const [order] = await sql`
    select target_value, status, customer_id from "order" where id = ${orderId}`;
  if (!order) throw new Error('order not found');
  if (order.status !== 'pending' && order.status !== 'failed') {
    throw new Error(`order not payable (status ${order.status})`);
  }
  // A retry re-holds inventory for a failed order whose holds were released.
  if (order.status === 'failed') {
    const ok = await tryReacquire(sql, orderId);
    if (!ok) throw new Error('inventory no longer available');
    await sql`update "order" set status = 'pending' where id = ${orderId}`;
  }

  const fspId = resolveFsp(routeMap, method, mno);
  const transactionId = await nextAttemptKey(sql, orderId);
  const amount = Number(order.target_value);

  await sql`
    insert into payment_transaction (order_id, transaction_id, method, fsp_id, amount, status)
    values (${orderId}, ${transactionId}, ${method}, ${fspId}, ${amount}, 'created')`;

  let orderReference: string | undefined;
  let billPayNumber: string | undefined;
  let redirectUrl: string | undefined;

  if (method === 'mobile') {
    const r = await collectMobile({ transactionId, amount, payerPhone: normalizeMsisdn(payerPhone), fspId, callbackUrl });
    orderReference = r.orderReference;
  } else if (method === 'billpay') {
    const r = await collectBillPay({
      transactionId, amount, payerName: payerName ?? 'Guest',
      payerPhone: normalizeMsisdn(payerPhone), fspId, callbackUrl,
      paymentMode: fspId === 'CLICKPESA' ? 'EXACT' : undefined,
    });
    orderReference = r.orderReference;
    billPayNumber = r.billPayNumber; // the control number the payer settles later
  } else {
    // card: hosted checkout. Load buyer email + item count for the provider payload.
    const [cust] = await sql`select email, name from customer where id = ${order.customer_id}`;
    const [{ n: items }] = await sql`
      select coalesce(sum(quantity),1)::int as n from order_item where order_id = ${orderId}`;
    const phone = normalizeMsisdn(payerPhone);
    const displayName = payerName ?? cust?.name ?? 'Guest';
    const [first, ...rest] = displayName.trim().split(/\s+/);
    const last = rest.join(' ') || first;
    const r = await collectCard({
      fspId, transactionId, amount, noOfItems: items,
      buyer: { email: cust?.email ?? '', name: displayName, phone },
      billing: {
        firstname: first, lastname: last, address1: 'Dar es Salaam', city: 'Dar es Salaam',
        stateOrRegion: 'Dar es Salaam', postcodeOrPobox: '00000', country: 'TZ', phone,
      },
      redirectUrl: callbackUrl, cancelUrl: callbackUrl,
    });
    orderReference = r.orderReference;
    redirectUrl = cardCheckoutUrl(r);
  }

  await sql`
    update payment_transaction
       set status = 'pending', order_reference = ${orderReference ?? null},
           bill_pay_number = ${billPayNumber ?? null}, updated_at = now()
     where transaction_id = ${transactionId}`;

  return { transactionId, status: 'pending', billPayNumber, redirectUrl };
}

/** Gateway status → our outcome. FAILED→failed; PARTIAL→short; PENDING→pending;
    COMPLETED→ short if collected < amount (amount verification), else successful. */
export function mapStatus(resp: CollectionStatusResponse): PaymentOutcome {
  if (resp.status === 'FAILED') return 'failed';
  if (resp.status === 'PARTIAL') return 'short';
  if (resp.status === 'COMPLETED') {
    const target = Number(resp.amount ?? 0);
    const got = Number(resp.collectedAmount ?? resp.amount ?? 0);
    return target > 0 && got < target ? 'short' : 'successful';
  }
  return 'pending'; // PENDING stays in flight
}

/**
 * Apply a terminal outcome EXACTLY once. All in one tx. TWO guards make this safe
 * against every duplicate delivery:
 *   1. TXN-level terminal guard — SELECT ... FOR UPDATE the transaction row; if it
 *      is missing or already terminal (successful|failed|partial) → no-op (null).
 *      This absorbs a duplicate delivery on the SAME txn.
 *   2. ORDER-level already-paid guard — a `successful` for an order already 'paid'
 *      can only be a SECOND settlement by a DIFFERENT txn (the txn-level guard above
 *      already caught same-txn duplicates). Mark this txn successful, alert ops to
 *      refund, and do NOT reconvert inventory or reissue credentials.
 * Returns the resulting order status ('paid' | 'paid_unseatable' | 'payment_short'
 * | 'failed'), or null on a no-op / pending.
 */
export async function applyOutcome(
  sql: Sql,
  transactionId: string,
  outcome: PaymentOutcome,
  collectedAmount?: number | null,
): Promise<string | null> {
  if (outcome === 'pending') return null;
  const collected =
    typeof collectedAmount === 'number' && Number.isFinite(collectedAmount) ? collectedAmount : null;

  return tx(async (t: Sql): Promise<string | null> => {
    // GUARD 1 (txn-level): lock the txn; a terminal/missing txn is a no-op.
    const [txr] = await t`
      select order_id, status from payment_transaction where transaction_id = ${transactionId} for update`;
    if (!txr || txr.status === 'successful' || txr.status === 'failed' || txr.status === 'partial') return null;

    const [ord] = await t`select type, status from "order" where id = ${txr.order_id}`;
    const isTable = ord?.type === 'table';

    // ── BS2 table_share branch: a bill-split seat is its own order. Delegate to
    //    the split aggregation layer (the txn-terminal guard above already deduped).
    //    Returns BEFORE the GA/VIP + table logic below, which stays untouched.
    if (ord?.type === 'table_share') {
      if (outcome === 'successful') return onShareSuccessful(t, txr.order_id, transactionId, collected);
      if (outcome === 'short')      return onShareShort(t, txr.order_id, transactionId, collected);
      return onShareFailed(t, txr.order_id, transactionId);
    }

    if (outcome === 'successful') {
      // GUARD 2 (order-level): a successful on an already-paid order = duplicate
      // COLLECTION by a different txn. Mark this txn paid + record what it took,
      // alert ops to refund, but reconvert NOTHING and reissue NOTHING.
      if (ord?.status === 'paid') {
        await t`update payment_transaction set status='successful',
                  collected_amount = coalesce(${collected}, collected_amount), updated_at=now()
                where transaction_id=${transactionId}`;
        await alertOps(t, 'duplicate_collection', txr.order_id);
        return 'paid';
      }
      // Convert inventory (table→reservation, GA/VIP→holds). A 0 means the grant
      // lapsed (late-settlement race) — fall back to reacquire; if that fails,
      // flag paid_unseatable and issue NOTHING (the anti-oversell).
      let converted = isTable
        ? await convertReservation(t, 'order', txr.order_id)
        : await convertHolds(t, txr.order_id);
      if (converted === 0) {
        const reacquired = await tryReacquire(t, txr.order_id);
        if (!reacquired) {
          await t`update payment_transaction set status='successful',
                    collected_amount = coalesce(${collected}, collected_amount), updated_at=now()
                  where transaction_id=${transactionId}`;
          await t`update "order" set status='paid_unseatable' where id=${txr.order_id}`;
          await alertOps(t, 'paid_unseatable', txr.order_id);
          return 'paid_unseatable'; // paid, but NO credential issued
        }
        converted = 1;
      }
      await t`update payment_transaction set status='successful',
                collected_amount = coalesce(${collected}, collected_amount), updated_at=now()
              where transaction_id=${transactionId}`;
      await t`update "order" set status='paid' where id=${txr.order_id}`;
      if (!isTable) await issueCredentials(t, txr.order_id);
      return 'paid';
    } else if (outcome === 'short') {
      await t`update payment_transaction set status='partial',
                collected_amount = coalesce(${collected}, collected_amount), updated_at=now()
              where transaction_id=${transactionId}`;
      await t`update "order" set status='payment_short' where id=${txr.order_id}`;
      await alertOps(t, 'payment_short', txr.order_id);
      return 'payment_short';
    } else {
      await t`update payment_transaction set status='failed', updated_at=now() where transaction_id=${transactionId}`;
      await t`update "order" set status='failed' where id=${txr.order_id} and status='pending'`;
      await releaseHolds(t, txr.order_id);
      return 'failed';
    }
  }, sql);
}

/** Reconcile one transaction against x-bridge (the source of truth): read the
    collection status, map it, apply it once. If the order lands on 'paid', fire
    the buyer confirmation OUTSIDE the tx (idempotent, best-effort). */
export async function reconcile(sql: Sql, transactionId: string): Promise<PaymentOutcome> {
  const [txr] = await sql`
    select order_id, fsp_id from payment_transaction where transaction_id = ${transactionId}`;
  if (!txr) throw new Error(`unknown transaction: ${transactionId}`);
  const status = await collectionStatus(transactionId, txr.fsp_id);
  const outcome = mapStatus(status);
  const collected =
    outcome === 'successful' || outcome === 'short'
      ? Number(status.collectedAmount ?? status.amount ?? 0)
      : null;
  const orderStatus = await applyOutcome(sql, transactionId, outcome, collected);
  if (orderStatus === 'paid') await notifyOrderPaid(sql, txr.order_id);
  else if (orderStatus === 'share_paid') await notifyShareReceived(sql, txr.order_id);        // BS2: "you're in, k/N"
  else if (orderStatus === 'split_complete') await notifySplitCompleteByOrder(sql, txr.order_id); // BS2: table locked → per-payer passes
  return outcome;
}

/** SMS body — includes the readable code(s) so the text alone is a usable ticket
    handle; caps at 3 codes to keep the message short. */
function ticketSmsText(refs: string[], eventName: string): string {
  const plural = refs.length !== 1;
  const shown = refs.filter(Boolean);
  const codePart = shown.length && shown.length <= 3 ? ` Code${plural ? 's' : ''}: ${shown.join(', ')}.` : '';
  const origin = process.env.PUBLIC_ORIGIN || '';
  const link = origin ? ` View: ${origin}/tickets` : '';
  return `Your ${eventName} ${plural ? 'tickets are' : 'ticket is'} confirmed.${codePart}${link}`;
}

/** Send the purchase confirmation SMS + email EXACTLY once. The atomic claim on
    order.notified_at is the once-latch; each delivery is best-effort (a gateway
    failure never throws — the ticket is already valid). */
export async function notifyOrderPaid(sql: Sql, orderId: string): Promise<void> {
  const [claimed] = await sql`
    update "order" set notified_at = now()
     where id = ${orderId} and status = 'paid' and notified_at is null
    returning id`;
  if (!claimed) return; // already notified, or not paid

  const [row] = await sql`
    select c.phone, c.email, c.name, e.name as event_name
      from "order" o
      join customer c on c.id = o.customer_id
      join event e on e.id = o.event_id
     where o.id = ${orderId}`;
  if (!row) return;

  const creds = await sql`
    select c.code, c.signature, c.tier_id, c.public_ref, c.seat_index
      from credential c join order_item oi on oi.id = c.order_item_id
     where oi.order_id = ${orderId}
     order by c.tier_id, c.seat_index`;

  const tickets: { publicRef: string; tier: string; qrPng: Buffer | null }[] = [];
  const refs: string[] = [];
  for (const c of creds) {
    if (c.public_ref) refs.push(c.public_ref);
    let qrPng: Buffer | null = null;
    try { qrPng = await renderQrPng(qrPayload(c.code, c.signature)); }
    catch (e) { console.error('QR render failed', e); }
    tickets.push({ publicRef: c.public_ref ?? '', tier: c.tier_id, qrPng });
  }

  try {
    if (row.phone) await sendSms(row.phone, ticketSmsText(refs, row.event_name));
  } catch (e) { console.error('confirm SMS failed', e); }
  try {
    if (row.email) await sendCredentialEmail(row.email, {
      buyerName: row.name ?? 'there', eventName: row.event_name, tickets,
    });
  } catch (e) { console.error('confirm email failed', e); }
}

// alertOps moved to ../ops (shared with the split domain to avoid a circular
// import); re-exported here so the existing index.ts export path is unchanged.
export { alertOps } from '../ops';

/** Resolve a raw webhook body to our transaction_id. Selcom forwards `transid`
    (= our id); ClickPesa forwards only `orderReference`/`reference` (H3) — resolve
    it back via the tx row. Returns null when unresolvable (still dedup-logged). */
export async function resolveTransactionId(sql: Sql, rawBody: string): Promise<string | null> {
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(rawBody); } catch { return null; }
  if (typeof j.transid === 'string') return j.transid;
  const orderRef = (j.orderReference ?? j.reference) as string | undefined;
  if (orderRef) {
    const [row] = await sql`
      select transaction_id from payment_transaction where order_reference = ${orderRef} limit 1`;
    return row?.transaction_id ?? null;
  }
  return null;
}

/* ── Worker helpers ───────────────────────────────────────────────────────── */

/** Bounded-concurrency map; per-item errors are swallowed (next sweep retries). */
async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx]); } catch { /* next sweep retries */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/** Per-method stale-tx expiry window (seconds): a USSD push is a live session
    (~1h), but a BillPay control number is legitimately payable for DAYS. */
const PENDING_WINDOW = { mobile: 3600, card: 7200, billpay: 259200, default: 3600 };

/** Expire stale transactions past their per-method window, then reconcile the
    remaining non-terminal transactions (bounded concurrency). Returns the count
    reconciled. A late settlement past the window still settles (applyOutcome does
    not treat 'expired' as terminal). */
export async function reconcilePending(sql: Sql): Promise<number> {
  await sql`
    update payment_transaction set status = 'expired', updated_at = now()
     where status in ('created', 'pending', 'processing')
       and created_at < now() - make_interval(secs => (case method
             when 'mobile'  then ${PENDING_WINDOW.mobile}
             when 'card'    then ${PENDING_WINDOW.card}
             when 'billpay' then ${PENDING_WINDOW.billpay}
             else ${PENDING_WINDOW.default}
           end)::int)`;
  const pending = await sql`
    select transaction_id from payment_transaction
     where status in ('created', 'pending', 'processing')
     order by created_at asc limit 200`;
  await mapLimit(pending, 8, (p: any) => reconcile(sql, p.transaction_id).then(() => undefined));
  return pending.length;
}

/** Sweep expired GA/VIP holds: per abandoned order, release its holds back to
    available and expire the still-pending order. Returns the count of orders swept. */
export async function sweepExpiredHolds(sql: Sql): Promise<number> {
  const rows = await sql`
    select distinct order_id from inventory_hold where state = 'held' and expires_at < now()`;
  for (const r of rows) {
    await releaseHolds(sql, r.order_id);
    await sql`update "order" set status = 'expired' where id = ${r.order_id} and status = 'pending'`;
  }
  return rows.length;
}
