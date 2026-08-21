/* PR-BS89 · Control-Room console — super-admin Payments routing page. */

import AdminPaymentsClient from './payments-client';

export const dynamic = 'force-dynamic';

export default function AdminConsolePaymentsPage() {
  return <AdminPaymentsClient />;
}
