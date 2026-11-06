/* BS153: the per-order funnel log (order_event, 0035).

   logOrderEvent() is best-effort by contract: it never throws and never breaks
   the money path. Inside a transaction it writes under a SAVEPOINT, so a failed
   insert (say, the table is missing on an old database) rolls back only itself
   and the payment transaction carries on. Outside a transaction it is a plain
   insert whose error is swallowed. */

type Sql = any; // postgres.js Sql | tx handle

export type OrderStep =
  | 'cart_created' | 'pay_requested' | 'gateway_accepted' | 'gateway_rejected'
  | 'callback_received' | 'status_changed'
  | 'paid' | 'short' | 'failed' | 'expired' | 'hold_released' | 'refunded'
  | 'passes_issued' | 'buyer_notified' | 'checked_in';

type Detail = Record<string, unknown>;

/** Append one step to an order's log. Never throws. */
export async function logOrderEvent(
  sql: Sql, orderId: string | null | undefined, step: OrderStep, detail: Detail = {}, transactionId?: string | null,
): Promise<void> {
  if (!orderId || !sql) return;
  try {
    const json = JSON.parse(JSON.stringify(detail ?? {}));
    const write = (q: Sql) => q`
      insert into order_event (order_id, step, transaction_id, detail)
      values (${orderId}::uuid, ${step}, ${transactionId ?? null}, ${q.json(json)})`;
    if (typeof sql.savepoint === 'function') await sql.savepoint((sp: Sql) => write(sp));
    else await write(sql);
  } catch (e) {
    // The log is a window, not the money path.
    console.error('order_event write skipped', step, (e as Error)?.message);
  }
}

/** Make a gateway error safe to store and show: no tokens, secrets, JWTs or full
    phone numbers, and short. */
export function sanitizeGatewayError(e: unknown): string {
  let s = String((e as any)?.message ?? e ?? 'unknown error');
  s = s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+)?/g, '[jwt]')
    .replace(/("?(?:token|secret|password|apiKey|api_key|keyId|authorization|signature)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, '$1"[redacted]"')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]')
    .replace(/\+?\d{9,15}/g, (m) => '*'.repeat(Math.max(0, m.length - 3)) + m.slice(-3));
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 500 ? s.slice(0, 497) + '...' : s;
}

/** Record why the gateway refused an attempt: on the attempt row and in the log.
    Never throws (the caller rethrows the original error). */
export async function recordGatewayRejection(
  sql: Sql, orderId: string, transactionId: string, e: unknown, extra: Detail = {},
): Promise<void> {
  const message = sanitizeGatewayError(e);
  try {
    await sql`update payment_transaction set error = ${message}, error_at = now()
               where transaction_id = ${transactionId}`;
  } catch (err) {
    console.error('payment_transaction.error write skipped', (err as Error)?.message);
  }
  const status = /failed: (\d{3})/.exec(message);
  await logOrderEvent(sql, orderId, 'gateway_rejected', { ...extra, error: message, http: status ? Number(status[1]) : null }, transactionId);
}

/** Order ids an attempt or a credential belongs to, for logging from paths that
    only know the attempt/credential. Null when unknown. Never throws. */
export async function orderIdForCredential(sql: Sql, credentialId: string): Promise<string | null> {
  try {
    const read = (q: Sql) => q`
      select coalesce(
               (select oi.order_id from order_item oi where oi.id = c.order_item_id),
               (select ss.order_id from split_share ss where ss.id = c.split_share_id)) as order_id
        from credential c where c.id = ${credentialId}`;
    const [r] = typeof sql.savepoint === 'function' ? await sql.savepoint((sp: Sql) => read(sp)) : await read(sql);
    return r?.order_id ?? null;
  } catch {
    return null;
  }
}

/** A gateway callback arrived for an attempt. Never throws. */
export async function logCallbackReceived(sql: Sql, transactionId: string | null | undefined, detail: Detail = {}): Promise<void> {
  const orderId = await orderIdForTransaction(sql, transactionId);
  if (orderId) await logOrderEvent(sql, orderId, 'callback_received', detail, transactionId);
}

export async function orderIdForTransaction(sql: Sql, transactionId: string | null | undefined): Promise<string | null> {
  if (!transactionId) return null;
  try {
    const [r] = await sql`select order_id from payment_transaction where transaction_id = ${transactionId}`;
    return r?.order_id ?? null;
  } catch {
    return null;
  }
}
