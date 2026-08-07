'use client';

/* PR-BS36 — sections the AdminShell reserves for the other roadmap lanes. They
   are wired into the sidebar NOW so the shell is complete and the information
   architecture is fixed before those lanes land; each renders an honest empty
   state naming what is coming and where it comes from. No API calls — these do
   not exist yet, and a placeholder that silently 404s is worse than one that
   says so. */

import { AdminCard, ComingSoon } from '../admin-kit';

export function OrdersSection() {
  return (
    <>
      <div className="sec-h">
        <h2>Orders &amp; carts</h2>
        <p className="hint">
          Every order in every state — paid, pending, failed, expired and abandoned — with its full line items, buyer
          contact, payment attempt and issued credentials.
        </p>
      </div>
      <AdminCard title="ORDERS">
        <ComingSoon
          line="Order and cart visibility is being built."
          sub="Support will be able to see the whole cart someone attempted, not just the paid summary — filterable by event, organizer and status, searchable by phone, email or order id, split shares included."
        />
      </AdminCard>
    </>
  );
}

/* PAYOUTS graduated out of this file in BS38 — see ./payouts-section.tsx. */

export function BroadcastsSection() {
  return (
    <>
      <div className="sec-h">
        <h2>Broadcasts</h2>
        <p className="hint">
          Compose an SMS or email blast to an audience — everyone, one organizer, or one event — with a live recipient
          count and a cost confirmation before anything sends.
        </p>
      </div>
      <AdminCard title="COMPOSER">
        <ComingSoon
          line="The broadcast composer is being built."
          sub="Sends are queued in bounded batches, respect opt-outs and a per-organizer monthly SMS cap, and every broadcast keeps an aggregate sent/failed record."
        />
      </AdminCard>
    </>
  );
}
