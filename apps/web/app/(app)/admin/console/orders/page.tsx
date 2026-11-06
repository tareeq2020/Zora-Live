/* PR-BS72 · Lane C — super-admin Orders & carts page. */

import AdminOrdersClient from './orders-client';

export const dynamic = 'force-dynamic';

/* BS159: ?outcome= preselects the outcome filter (links from Needs attention). */
export default function AdminConsoleOrdersPage({ searchParams }: { searchParams?: { outcome?: string } }) {
  return <AdminOrdersClient initialOutcome={typeof searchParams?.outcome === 'string' ? searchParams.outcome : ''} />;
}
