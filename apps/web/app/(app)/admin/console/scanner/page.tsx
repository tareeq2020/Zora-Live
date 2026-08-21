/* PR-BS89 · Control-Room console — super-admin Scanner users page. */

import AdminScannerClient from './scanner-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleScannerPage() {
  return <AdminScannerClient />;
}
