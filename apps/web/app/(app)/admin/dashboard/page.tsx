/* PR-BS36 — the INTERNAL STAFF console at /admin/dashboard.

   Was: a legacy port — one big `MARKUP` HTML string plus a `SCRIPT` string run
   through `new Function('setInterval','setTimeout', SCRIPT)`, all scoped under
   `.admin-console`. TypeScript could not see inside the script, every mutation
   was hand-wired DOM, and the ten panels sat behind a top tab bar.

   Now: <AdminShell> — a typed React layout with a left sidebar, shared
   AdminTable / AdminCard / useAdminResource primitives, and one component per
   section. Every ported panel calls the SAME /api/* endpoints as before; no API
   changed. See ./admin-shell.tsx for the section map.

   Routing and session behaviour are untouched: the middleware /admin gate
   rewrites an authenticated admin here and an anonymous visitor to /admin/login,
   and any 401 from inside the console sends the staffer back to /admin so that
   gate re-runs. This thin server wrapper just mounts the client island, matching
   the organizer dashboard's page.tsx -> *-client.tsx split. */

import AdminShell from './admin-shell';

export const dynamic = 'force-dynamic';

export default function AdminDashboardPage() {
  return <AdminShell />;
}
