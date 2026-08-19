/* PR-BS72 · Lane C — super-admin Overview page (thin server wrapper → client
   island, matching the org overview + legacy admin page.tsx split). */

import AdminOverviewClient from './overview-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleOverviewPage() {
  return <AdminOverviewClient />;
}
