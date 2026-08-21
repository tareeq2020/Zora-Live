/* PR-BS89 · Control-Room console — super-admin Payouts page. */

import AdminPayoutsClient from './payouts-client';

export const dynamic = 'force-dynamic';

export default function AdminConsolePayoutsPage() {
  return <AdminPayoutsClient />;
}
