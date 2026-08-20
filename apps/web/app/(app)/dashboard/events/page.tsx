import { EventsListClient } from './events-list-cr';

/* BS78 #3 — /dashboard/events: the organizer's events list (create · edit ·
   archive · delete). Thin server shell over the client island, matching the
   overview/sales split. Org-scoped data is fetched client-side from /api/org/*. */

export const dynamic = 'force-dynamic';

export default function EventsPage() {
  return <EventsListClient />;
}
