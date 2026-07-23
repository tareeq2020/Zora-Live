/* PR-BS2: bill-split (split-a-table) domain — the SHARE-AS-ORDER coordination
   layer over the untouched exactly-once payment core.

   Model: a parent `table_split` places ONE reservation for the whole table. Each
   seat is a `split_share` backed by its own `order` (type='table_share', NO hold)
   paid through the ordinary initiatePayment/applyOutcome path. The table converts
   its reservation + issues credentials ONCE, when the last share settles.

     createTableSplit ─▶ reserve_inventory('split', id, 1)  + N shares (host absorbs remainder)
     claimShare / createShareOrder ─▶ a payable order per seat
     onShareSuccessful (called from applyOutcome's table_share branch):
        mark share paid ─▶ AGGREGATION GATE (atomic completion flip, single winner)
           winner: convert_reservation ONCE + issueTableCredentials ONCE
        short  ─▶ void+re-mint the seat (OV2)          late/stuck ─▶ refund_pending (OV3/CQ5)
     splitAwareExpirySweep: window lapsed → 0 paid = clean release; ≥1 paid = refund_pending (A5)
*/
import * as crypto from 'crypto';
import { tx } from './db';
import { reserveInventory, convertReservation, releaseReservation } from './inventory';
import { generateCode, generatePublicRef, signCredential, ticketSigningKeys, qrPayload, renderQrPng } from './credentials';
import { alertOps } from './ops';
import { sendSms } from './sms';
import { sendCredentialEmail } from './email';

type Sql = any;

export class SplitSoldOut extends Error {
  constructor() { super('split_sold_out'); this.name = 'SplitSoldOut'; }
}

/* ── share-amount math (CQ3 / OV1): invitees pay floor, host absorbs remainder,
   so the shares sum EXACTLY to target. ────────────────────────────────────── */
export function computeShareAmounts(target: number, n: number): { hostShare: number; inviteeShare: number } {
  const inviteeShare = Math.floor(target / n);
  const hostShare = target - inviteeShare * (n - 1); // ≥ inviteeShare; absorbs the remainder
  return { hostShare, inviteeShare };
}

/* ── invite tokens (CQ4): HMAC-signed `${splitId}.${shareIndex}`, opaque + tamper-evident. */
function splitTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  const key = (env.TICKET_SIGNING_KEY || '').split(',')[0]?.trim();
  return key || env.SESSION_SECRET || 'zora-split-dev-secret';
}
export function signShareToken(splitId: string, shareIndex: number, secret = splitTokenSecret()): string {
  const body = Buffer.from(`${splitId}.${shareIndex}`).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyShareToken(token: string, secret = splitTokenSecret()): { splitId: string; shareIndex: number } | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const [splitId, idx] = Buffer.from(body, 'base64url').toString('utf8').split('.');
    const shareIndex = Number(idx);
    if (!splitId || !Number.isInteger(shareIndex)) return null;
    return { splitId, shareIndex };
  } catch { return null; }
}

/* ── create a split ─────────────────────────────────────────────────────────── */
export interface CreateTableSplitInput {
  hostPhone: string;
  hostEmail?: string | null;
  hostName?: string | null;
  tierId: string;
  capacityN: number;      // number of splitters (2..seatable)
  feeRate: number;        // read from config before the call
  holdWindowSecs?: number; // overrides the tier default
}
export type CreateTableSplitResult =
  | { ok: true; splitId: string; target: number; hostShare: number; inviteeShare: number;
      shares: { index: number; amount: number; isHost: boolean; token: string | null }[] }
  | { ok: false; reason: 'bad_capacity' | 'not_split_enabled' | 'no_price' | 'sold_out' };

export async function createTableSplit(sql: Sql, input: CreateTableSplitInput): Promise<CreateTableSplitResult> {
  const { hostPhone, hostEmail, hostName, tierId, capacityN, feeRate } = input;
  if (!Number.isInteger(capacityN) || capacityN < 2) return { ok: false, reason: 'bad_capacity' };
  try {
    return await tx(async (t: Sql): Promise<CreateTableSplitResult> => {
      const [tier] = await t`
        select id, event_id, split_enabled, split_window_secs, capacity
          from product_tier where id = ${tierId}`;
      if (!tier || !tier.split_enabled) return { ok: false, reason: 'not_split_enabled' };
      const windowSecs = input.holdWindowSecs ?? Number(tier.split_window_secs) ?? 2700;

      const [pv] = await t`
        select id, price, fee_treatment from price_version
         where tier_id = ${tierId} and effective_to is null
         order by effective_from desc limit 1`;
      if (!pv) return { ok: false, reason: 'no_price' };
      const subtotal = Number(pv.price);
      const fee = pv.fee_treatment === 'passed' ? Math.round(subtotal * feeRate) : 0;
      const target = subtotal + fee;

      const [host] = await t`
        insert into customer (phone, email, name) values (${hostPhone}, ${hostEmail ?? null}, ${hostName ?? null})
        on conflict (phone) do update set email = coalesce(excluded.email, customer.email),
                                          name  = coalesce(excluded.name,  customer.name)
        returning id`;

      const [split] = await t`
        insert into table_split (event_id, product_tier_id, host_customer_id, capacity_n, price_version_id, target_value, window_expires_at)
        values (${tier.event_id}, ${tierId}, ${host.id}, ${capacityN}, ${pv.id}, ${target}, now() + make_interval(secs => ${windowSecs}))
        returning id`;
      const splitId: string = split.id;

      // ONE reservation for the whole table (1 unit of the table tier).
      const resId = await reserveInventory(t, tierId, 'split', splitId, 1, windowSecs);
      if (resId === null) throw new SplitSoldOut(); // rollback undoes the split row
      await t`update table_split set reservation_id = ${resId} where id = ${splitId}`;

      const { hostShare, inviteeShare } = computeShareAmounts(target, capacityN);
      const shares: { index: number; amount: number; isHost: boolean; token: string | null }[] = [];
      for (let i = 0; i < capacityN; i++) {
        const isHost = i === 0;
        const amount = isHost ? hostShare : inviteeShare;
        const token = isHost ? null : signShareToken(splitId, i);
        await t`
          insert into split_share (split_id, share_index, customer_id, amount, is_host, state, claim_token)
          values (${splitId}, ${i}, ${isHost ? host.id : null}, ${amount}, ${isHost}, ${isHost ? 'claimed' : 'unclaimed'}, ${token})`;
        shares.push({ index: i, amount, isHost, token });
      }
      return { ok: true, splitId, target, hostShare, inviteeShare, shares };
    }, sql);
  } catch (e) {
    if (e instanceof SplitSoldOut) return { ok: false, reason: 'sold_out' };
    throw e;
  }
}

/* ── claim a share (invitee opens the link) — idempotent ─────────────────────── */
export type ClaimShareResult =
  | { ok: true; shareId: string; splitId: string; shareIndex: number; amount: number; splitStatus: string; alreadyPaid?: boolean }
  | { ok: false; reason: 'bad_token' | 'not_found' | 'table_full' | 'expired' };

export async function claimShare(sql: Sql, token: string, phone?: string, email?: string | null, name?: string | null): Promise<ClaimShareResult> {
  const decoded = verifyShareToken(token);
  if (!decoded) return { ok: false, reason: 'bad_token' };
  return tx(async (t: Sql): Promise<ClaimShareResult> => {
    const [share] = await t`
      select s.id, s.state, s.amount, ts.status as split_status
        from split_share s join table_split ts on ts.id = s.split_id
       where s.split_id = ${decoded.splitId} and s.share_index = ${decoded.shareIndex} for update`;
    if (!share) return { ok: false, reason: 'not_found' };
    const base = { shareId: share.id, splitId: decoded.splitId, shareIndex: decoded.shareIndex, amount: Number(share.amount) };
    if (share.state === 'paid') return { ok: true, ...base, splitStatus: share.split_status, alreadyPaid: true };
    if (share.split_status !== 'forming') {
      return { ok: false, reason: share.split_status === 'complete' ? 'table_full' : 'expired' };
    }
    if (phone) {
      const [cust] = await t`
        insert into customer (phone, email, name) values (${phone}, ${email ?? null}, ${name ?? null})
        on conflict (phone) do update set email = coalesce(excluded.email, customer.email) returning id`;
      await t`update split_share set customer_id = ${cust.id},
                state = case when state = 'unclaimed' then 'claimed' else state end where id = ${share.id}`;
    }
    return { ok: true, ...base, splitStatus: share.split_status };
  }, sql);
}

/* ── create (or reuse) the payable order for a share — no order_item, no hold ── */
export type CreateShareOrderResult =
  | { ok: true; orderId: string; amount: number }
  | { ok: false; reason: 'not_found' | 'split_closed' | 'already_paid' };

export async function createShareOrder(sql: Sql, shareId: string, payerPhone: string, payerEmail?: string | null, payerName?: string | null): Promise<CreateShareOrderResult> {
  return tx(async (t: Sql): Promise<CreateShareOrderResult> => {
    const [share] = await t`
      select s.id, s.order_id, s.amount, s.state, ts.event_id, ts.status as split_status
        from split_share s join table_split ts on ts.id = s.split_id
       where s.id = ${shareId} for update`;
    if (!share) return { ok: false, reason: 'not_found' };
    if (share.split_status !== 'forming') return { ok: false, reason: 'split_closed' };
    if (share.state === 'paid') return { ok: false, reason: 'already_paid' };
    if (share.order_id) return { ok: true, orderId: share.order_id, amount: Number(share.amount) }; // idempotent re-pay

    const [cust] = await t`
      insert into customer (phone, email, name) values (${payerPhone}, ${payerEmail ?? null}, ${payerName ?? null})
      on conflict (phone) do update set email = coalesce(excluded.email, customer.email) returning id`;
    const [ord] = await t`
      insert into "order" (customer_id, event_id, type, status, target_value)
      values (${cust.id}, ${share.event_id}, 'table_share', 'pending', ${share.amount}) returning id`;
    await t`update split_share set order_id = ${ord.id}, customer_id = ${cust.id},
              state = case when state = 'unclaimed' then 'claimed' else state end where id = ${shareId}`;
    return { ok: true, orderId: ord.id, amount: Number(share.amount) };
  }, sql);
}

/* ── payment outcomes for a share (called from applyOutcome's table_share branch,
   inside its tx `t`). Return a status string reconcile() dispatches on. ──────── */
export type ShareStatus = 'share_paid' | 'split_complete' | 'split_stuck' | 'share_refund_pending' | 'share_short' | 'share_failed';

export async function onShareSuccessful(t: Sql, orderId: string, transactionId: string, collected: number | null): Promise<ShareStatus> {
  await t`update payment_transaction set status = 'successful',
            collected_amount = coalesce(${collected}, collected_amount), updated_at = now()
          where transaction_id = ${transactionId}`;
  await t`update "order" set status = 'paid' where id = ${orderId}`;

  const [share] = await t`select id, split_id from split_share where order_id = ${orderId} for update`;
  if (!share) return 'share_paid'; // defensive: not a share order after all
  const [split] = await t`select id, status, capacity_n from table_split where id = ${share.split_id} for update`;

  // CQ5/OV3 — the parent already closed (late settlement / stuck): money in, no table.
  if (split.status !== 'forming') {
    await t`update split_share set state = 'paid', paid_at = now() where id = ${share.id} and state <> 'paid'`;
    await t`update table_split set status = 'refund_pending' where id = ${split.id} and status <> 'complete'`;
    await alertOps(t, 'split_late_share', orderId, split.id);
    return 'share_refund_pending';
  }

  await t`update split_share set state = 'paid', paid_at = now() where id = ${share.id}`;

  // CQ1 — aggregation gate: atomic completion flip; only one caller wins (we hold
  // the table_split row lock, so concurrent shares serialize here).
  const flipped = await t`
    update table_split set status = 'complete', completed_at = now()
     where id = ${split.id} and status = 'forming'
       and (select count(*) from split_share where split_id = ${split.id} and state = 'paid') = capacity_n
    returning id`;
  if (flipped.length === 0) return 'share_paid'; // still forming — waiting on others

  // Winner: convert the ONE reservation, ONCE. A 0 means it lapsed (OV3 stuck).
  const converted = await convertReservation(t, 'split', split.id);
  if (converted === 0) {
    await t`update table_split set status = 'refund_pending' where id = ${split.id}`;
    await alertOps(t, 'split_unconvertible', orderId, split.id);
    return 'split_stuck';
  }
  await issueTableCredentials(t, split.id);
  return 'split_complete';
}

export async function onShareShort(t: Sql, orderId: string, transactionId: string, collected: number | null): Promise<ShareStatus> {
  await t`update payment_transaction set status = 'partial',
            collected_amount = coalesce(${collected}, collected_amount), updated_at = now()
          where transaction_id = ${transactionId}`;
  await t`update "order" set status = 'payment_short' where id = ${orderId}`;
  // OV2 — void + re-mint the seat: reset the share to re-payable (same token/index),
  // detach the short order so createShareOrder mints a fresh one on retry.
  const [share] = await t`select id, split_id from split_share where order_id = ${orderId} for update`;
  if (share) {
    await t`update split_share set state = 'claimed', order_id = null where id = ${share.id} and state <> 'paid'`;
    await alertOps(t, 'split_share_short', orderId, share.split_id);
  }
  return 'share_short';
}

export async function onShareFailed(t: Sql, orderId: string, transactionId: string): Promise<ShareStatus> {
  await t`update payment_transaction set status = 'failed', updated_at = now() where transaction_id = ${transactionId}`;
  await t`update "order" set status = 'failed' where id = ${orderId} and status = 'pending'`;
  // A failed share keeps its seat claimed and re-payable (a new attempt reuses the order).
  return 'share_failed';
}

/* ── per-payer credential issuance (A2), idempotent via credential_split_share_key ── */
export async function issueTableCredentials(t: Sql, splitId: string): Promise<number> {
  const key = ticketSigningKeys()[0];
  const [split] = await t`select event_id, product_tier_id from table_split where id = ${splitId}`;
  const shares = await t`
    select s.id, s.share_index, s.customer_id, c.name as holder
      from split_share s left join customer c on c.id = s.customer_id
     where s.split_id = ${splitId} and s.state = 'paid' order by s.share_index`;
  let issued = 0;
  for (const s of shares) {
    const code = generateCode();
    const signature = signCredential({ code, tier: split.product_tier_id, eventId: split.event_id, tableId: splitId }, key);
    const res = await t`
      insert into credential (event_id, tier_id, code, signature, public_ref, seat_index, split_id, split_share_id, holder_name, table_no)
      values (${split.event_id}, ${split.product_tier_id}, ${code}, ${signature}, ${generatePublicRef()},
              ${s.share_index}, ${splitId}, ${s.id}, ${s.holder ?? null}, ${'T-' + String(splitId).slice(0, 8)})
      on conflict (split_share_id) where split_share_id is not null do nothing`;
    issued += res.count ?? 0;
  }
  return issued;
}

/* ── split-aware expiry sweep (A5/OV3) — worker loop ─────────────────────────── */
export async function splitAwareExpirySweep(sql: Sql): Promise<{ released: number; flagged: number }> {
  const rows = await sql`
    select id, (select count(*) from split_share where split_id = table_split.id and state = 'paid') as paid
      from table_split where status = 'forming' and window_expires_at < now()`;
  let released = 0, flagged = 0;
  for (const s of rows) {
    if (Number(s.paid) > 0) {
      // OV3 — money is in: keep inventory LOCKED (do NOT release), flag for manual refund.
      const [f] = await sql`update table_split set status = 'refund_pending' where id = ${s.id} and status = 'forming' returning id`;
      if (f) { await alertOps(sql, 'split_expired_unfilled', s.id, `paid=${s.paid}`); flagged++; }
    } else {
      // Nobody paid — release the held table cleanly and expire.
      await releaseReservation(sql, 'split', s.id);
      await sql`update table_split set status = 'expired' where id = ${s.id} and status = 'forming'`;
      released++;
    }
  }
  return { released, flagged };
}

/* ── notifications (called from reconcile, OUTSIDE the tx; best-effort) ───────── */
export async function notifyShareReceived(sql: Sql, orderId: string): Promise<void> {
  const [row] = await sql`
    select c.phone, ts.id as split_id, ts.capacity_n, e.name as event_name,
           (select count(*) from split_share where split_id = ts.id and state = 'paid') as paid
      from split_share s
      join table_split ts on ts.id = s.split_id
      join "order" o on o.id = s.order_id
      join customer c on c.id = o.customer_id
      join event e on e.id = ts.event_id
     where s.order_id = ${orderId}`;
  if (!row?.phone) return;
  const msg = `You're in for ${row.event_name}. ${row.paid}/${row.capacity_n} paid — we'll text your pass when the table fills.`;
  try { await sendSms(row.phone, msg); } catch (e) { console.error('share receipt SMS failed', e); }
}

export async function notifySplitCompleteByOrder(sql: Sql, orderId: string): Promise<void> {
  const [link] = await sql`select split_id from split_share where order_id = ${orderId}`;
  if (link?.split_id) await notifySplitComplete(sql, link.split_id);
}

export async function notifySplitComplete(sql: Sql, splitId: string): Promise<void> {
  const [ev] = await sql`select e.name as event_name from table_split ts join event e on e.id = ts.event_id where ts.id = ${splitId}`;
  const eventName = ev?.event_name ?? 'your event';
  const rows = await sql`
    select cr.code, cr.signature, cr.public_ref, cr.tier_id, c.phone, c.email, c.name
      from credential cr
      join split_share s on s.id = cr.split_share_id
      left join customer c on c.id = s.customer_id
     where cr.split_id = ${splitId} order by cr.seat_index`;
  for (const r of rows) {
    let qrPng: Buffer | null = null;
    try { qrPng = await renderQrPng(qrPayload(r.code, r.signature)); } catch (e) { console.error('split QR render failed', e); }
    const codePart = r.public_ref ? ` Code: ${r.public_ref}.` : '';
    try { if (r.phone) await sendSms(r.phone, `Your table is locked for ${eventName}. You're seated.${codePart}`); }
    catch (e) { console.error('split complete SMS failed', e); }
    try {
      if (r.email) await sendCredentialEmail(r.email, {
        buyerName: r.name ?? 'there', eventName,
        tickets: [{ publicRef: r.public_ref ?? '', tier: r.tier_id, qrPng }],
      });
    } catch (e) { console.error('split complete email failed', e); }
  }
}
