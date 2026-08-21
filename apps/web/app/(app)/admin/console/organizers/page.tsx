/* PR-BS89 · Control-Room console — super-admin Organizers page. */

import AdminOrganizersClient from './organizers-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleOrganizersPage() {
  return <AdminOrganizersClient />;
}
