/* PR-BS89 · Control-Room console — super-admin Access page. */

import AdminAccessClient from './access-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleAccessPage() {
  return <AdminAccessClient />;
}
