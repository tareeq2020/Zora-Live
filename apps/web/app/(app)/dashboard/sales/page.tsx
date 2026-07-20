import type { Metadata } from 'next';
import SalesClient from './sales-client';

/* PR-MT5 — the organizer SALES / tickets-sold view at /dashboard/sales. The
   /dashboard/* prefix is already organizer-gated in middleware.ts (a real
   organizer, or an admin actively impersonating one), so this route inherits
   that gate — no auth work here.

   This server component is a thin shell: it owns the route + metadata and
   renders the client component. SalesClient owns all data (revenue/sold/orders
   header from /api/org/summary, the orders table from /api/org/orders) plus the
   per-event filter and load-more interactivity, so its loading / empty / error
   states live in one place. Data is org-scoped server-side by the acting
   session cookie (forwarded automatically on the same-origin /api/* proxy). */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sales — ZORA Dashboard',
  description: 'Tickets sold, orders and issued passes for your events.',
  robots: { index: false, follow: false },
};

export default function SalesPage() {
  return <SalesClient />;
}
