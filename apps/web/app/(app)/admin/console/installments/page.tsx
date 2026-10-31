/* BS136 — super-admin installment refund queue. */

import AdminInstallmentsClient from './installments-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleInstallmentsPage() {
  return <AdminInstallmentsClient />;
}
