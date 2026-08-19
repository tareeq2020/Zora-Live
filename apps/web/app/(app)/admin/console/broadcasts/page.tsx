/* PR-BS72 · Lane C — super-admin Broadcasts page. */

import AdminBroadcastsClient from './broadcasts-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleBroadcastsPage() {
  return <AdminBroadcastsClient />;
}
