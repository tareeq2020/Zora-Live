/* PR-BS72 · Lane C — super-admin Events-manager (#6) page. */

import AdminEventsClient from './events-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleEventsPage() {
  return <AdminEventsClient />;
}
