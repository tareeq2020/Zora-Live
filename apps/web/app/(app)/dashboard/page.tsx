import { redirect } from 'next/navigation';

/* BS78 #1 — the legacy /dashboard home (imperative KPIs + drop list) is retired
   in favour of the Control-Room v2 surfaces. The middleware /dashboard gate has
   already established the organizer session by the time this renders; send them
   straight to the new Home at /dashboard/overview. The events list + management
   that the old home carried now lives at its own route, /dashboard/events. */

export default function DashboardPage() {
  redirect('/dashboard/overview');
}
