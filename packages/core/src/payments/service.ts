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
import { placeHold } from '../inventory';
import { generateCode, signCredential, generatePublicRef, ticketSigningKeys } from '../credentials';

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
