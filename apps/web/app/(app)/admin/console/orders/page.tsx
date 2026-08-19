/* PR-BS72 · Lane C — super-admin Orders & carts page. */

import AdminOrdersClient from './orders-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleOrdersPage() {
  return <AdminOrdersClient />;
}
