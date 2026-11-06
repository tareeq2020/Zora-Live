import type { Metadata } from 'next';
import OrderDetail from './order-detail';

/* BS160 — one order at /dashboard/sales/[id]: what happened to it, in the
   organizer's words (GET /api/org/orders/:id). The /dashboard/* gate in
   middleware.ts covers it; another organizer's order is a 404 from the API. */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Order — ZORA Dashboard',
  robots: { index: false, follow: false },
};

export default function SalesOrderPage({ params }: { params: { id: string } }) {
  return <OrderDetail orderId={params.id} />;
}
