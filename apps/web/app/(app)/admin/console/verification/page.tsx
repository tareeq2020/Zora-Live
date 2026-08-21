/* PR-BS89 · Control-Room console — super-admin Verification (KYC) page.
   Thin server wrapper → client island, matching the other console routes. */

import AdminVerificationClient from './verification-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleVerificationPage() {
  return <AdminVerificationClient />;
}
