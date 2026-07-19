/* PR-6: inventory domain wrappers over the atomic SQL functions.
   Every wrapper takes a postgres.js handle `sql` (the pool OR a tx handle from
   sql.begin), so the exact same code runs pooled or inside the order-creation
   transaction. The oversell defense lives entirely in the SQL (conditional
   decrement + the capacity_not_exceeded CHECK); these are thin, faithful calls. */

type Sql = any; // postgres.js Sql | tx handle

/** Atomic conditional-decrement hold. Returns the hold id, or null if sold out. */
export async function placeHold(sql: Sql, tierId: string, orderId: string, quantity: number, ttlSecs: number): Promise<string | null> {
  const rows = await sql`select place_inventory_hold(${tierId}, ${orderId}::uuid, ${quantity}, ${ttlSecs}) as id`;
  return rows[0].id ?? null;
}

/** Payment confirmed: held → sold. Returns count converted (0 = holds lapsed → reacquire). */
export async function convertHolds(sql: Sql, orderId: string): Promise<number> {
  const rows = await sql`select convert_order_holds(${orderId}::uuid) as n`;
  return Number(rows[0].n);
}

/** Expiry / abandonment: restore available. Idempotent. */
export async function releaseHolds(sql: Sql, orderId: string): Promise<void> {
  await sql`select release_order_holds(${orderId}::uuid)`;
}

/** Soft reserved-bucket hold (available → reserved). Returns reservation id or null. */
export async function reserveInventory(sql: Sql, tierId: string, refType: string, refId: string, quantity: number, ttlSecs: number): Promise<string | null> {
  const rows = await sql`select reserve_inventory(${tierId}, ${refType}, ${refId}::uuid, ${quantity}, ${ttlSecs}) as id`;
  return rows[0].id ?? null;
}

export async function convertReservation(sql: Sql, refType: string, refId: string): Promise<number> {
  const rows = await sql`select convert_reservation(${refType}, ${refId}::uuid) as n`;
  return Number(rows[0].n);
}

export async function releaseReservation(sql: Sql, refType: string, refId: string): Promise<void> {
  await sql`select release_reservation(${refType}, ${refId}::uuid)`;
}

/** Worker sweep of expired reservations (concurrent-safe). Returns count released. */
export async function sweepExpiredReservations(sql: Sql): Promise<number> {
  const rows = await sql`select sweep_expired_reservations() as n`;
  return Number(rows[0].n);
}

export interface PoolSnapshot {
  tierId: string;
  capacity: number;
  available: number;
  sold: number;
  blocked: number;
  reserved: number;
}

/** Uncached pool read — for correctness / admin. */
export async function poolSnapshots(sql: Sql): Promise<PoolSnapshot[]> {
  return sql`
    select product_tier_id as "tierId", capacity, available_count as available,
           sold_count as sold, blocked_count as blocked, reserved_count as reserved
      from inventory_pool order by product_tier_id`;
}

/* 2s coalescing cache for the storefront read path under drop surge — turns
   per-request DB hits into ~one query / 2s / instance. Keyed only by time. */
let _poolCache: { at: number; data: Promise<PoolSnapshot[]> } | null = null;
export async function poolSnapshotsCached(sql: Sql, ttlMs = 2000, now = Date.now()): Promise<PoolSnapshot[]> {
  if (_poolCache && now - _poolCache.at < ttlMs) return _poolCache.data;
  const data = poolSnapshots(sql);
  _poolCache = { at: now, data };
  return data;
}
