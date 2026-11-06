/* BS153 — super-admin per-cart detail: /admin/console/orders/<orderId>.
   The overview's attention rows (BS152) link here by order id. */

import OrderDetailClient from './order-detail-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleOrderDetailPage({ params }: { params: { id: string } }) {
  return <OrderDetailClient id={params.id} />;
}
