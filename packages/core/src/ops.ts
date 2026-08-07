/* Ops-alert sink, shared by the payment core and the split domain (extracted so
   split.ts and payments/service.ts can both use it without a circular import).
   One row per (kind, orderId, detail) in webhook_event under provider='ops-alert';
   ON CONFLICT DO NOTHING dedups repeat alerts. This is the manual-refund /
   attention worklist the organizer sees (D8). */

type Sql = any; // postgres.js Sql | tx handle

export async function alertOps(sql: Sql, kind: string, orderId: string, detail?: string): Promise<void> {
  await sql`
    insert into webhook_event (provider, dedup_key, transaction_id, applied)
    values ('ops-alert', ${`${kind}:${orderId}:${detail ?? ''}`}, null, true)
    on conflict (provider, dedup_key) do nothing`;
}
