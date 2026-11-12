/* Ops-alert sink, shared by the payment core and the split domain (extracted so
   split.ts and payments/service.ts can both use it without a circular import).
   One row per (kind, orderId, detail) in webhook_event under provider='ops-alert';
   ON CONFLICT DO NOTHING dedups repeat alerts. This is the manual-refund /
   attention worklist the organizer sees (D8). */

type Sql = any; // postgres.js Sql | tx handle

export async function alertOps(
  sql: Sql, kind: string, orderId: string, detail?: string, opts: { refreshAfterHours?: number } = {},
): Promise<void> {
  const key = `${kind}:${orderId}:${detail ?? ''}`;
  // BS164: refreshAfterHours brings an existing alert back into view (Needs
  // attention lists recent ones only) when a person re-checks it, still unresolved.
  if (opts.refreshAfterHours != null) {
    await sql`
      insert into webhook_event (provider, dedup_key, transaction_id, applied)
      values ('ops-alert', ${key}, null, true)
      on conflict (provider, dedup_key) do update set received_at = now()
       where webhook_event.received_at < now() - make_interval(hours => ${opts.refreshAfterHours})`;
    return;
  }
  await sql`
    insert into webhook_event (provider, dedup_key, transaction_id, applied)
    values ('ops-alert', ${key}, null, true)
    on conflict (provider, dedup_key) do nothing`;
}

