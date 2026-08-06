import type { Metadata } from 'next';
import PayoutsClient from './payouts-client';

/* PR-BS38 (#7) — the organizer WITHDRAWALS screen at /dashboard/payouts. The
   /dashboard/* prefix is already organizer-gated in middleware.ts (a real
   organizer, or an admin actively impersonating one), so this route inherits
   that gate — no auth work here.

   Thin server shell: PayoutsClient owns the balance card, the request form and
   the history, all from /api/org/payouts. Every number it renders is computed
   server-side (balance is never derived in the browser) — the client only ever
   DISPLAYS money and sends an amount. */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Withdrawals — ZORA Dashboard',
  description: 'Your available balance and withdrawal requests.',
  robots: { index: false, follow: false },
};

export default function PayoutsPage() {
  return <PayoutsClient />;
}
