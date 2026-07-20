import DashboardClient from './dashboard-client';

/* PR-MT4 — the organizer dashboard HOME. The middleware /dashboard gate has
   already established an organizer (or admin-impersonating) session by the time
   this renders; the real, org-scoped data (identity, KPIs, drops) is fetched
   client-side from the proxied /api/org/* surface so each section owns its own
   loading / empty / error state. This thin server wrapper just mounts the client
   island — mirroring the storefront route's page.tsx → *-client.tsx split. */

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return <DashboardClient />;
}
