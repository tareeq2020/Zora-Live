import OverviewClient from './overview-client';

/* BS69 · Lane A — organizer Home/Overview, rebuilt on the Control-Room v2
   shared component library as the proof-of-concept for the token system +
   primitives. Additive (strangler-fig): the legacy home at /dashboard is left
   in place; this new surface proves the CR lib end-to-end. The real metrics
   come from Lane D's /api/org/analytics (see the SEAM in overview-client). */

export const dynamic = 'force-dynamic';

export default function DashboardOverviewPage() {
  return <OverviewClient />;
}
