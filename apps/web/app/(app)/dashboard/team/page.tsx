import type { Metadata } from 'next';
// BS94 · auth Phase 3 — the organizer TEAM surface. Thin server shell; the client
// renders its own Control-Room v2 <CrShell> (registered in the dashboard layout's
// OWN_CHROME). Members + pending invites come from /api/org/members; the current
// user's role from /api/org/me decides whether invite/remove controls show.
import TeamCr from './team-cr';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team — ZORA Dashboard',
  description: 'Invite teammates and manage their roles on your organizer.',
  robots: { index: false, follow: false },
};

export default function TeamPage() {
  return <TeamCr />;
}
