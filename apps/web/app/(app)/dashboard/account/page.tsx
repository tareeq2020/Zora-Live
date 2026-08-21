import type { Metadata } from 'next';
// BS96 · auth Phase 4 — the user ACCOUNT surface. Thin server shell; the client
// renders its own Control-Room v2 <CrShell> (registered in the dashboard layout's
// OWN_CHROME). Reachable from the topbar account menu, not the main nav. Shows the
// signed-in identity, the organizations the user belongs to + their role in each
// (from /api/me), and a change-password form (POST /api/me/password).
import AccountCr from './account-cr';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account — ZORA Dashboard',
  description: 'Your identity, the organizers you belong to, and your password.',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountCr />;
}
