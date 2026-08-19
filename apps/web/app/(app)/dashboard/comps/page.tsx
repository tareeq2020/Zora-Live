import type { Metadata } from 'next';
import CompsClient from './comps-client';

/* BS71 · Lane B — Comps ★NEW at /dashboard/comps. The /dashboard/* prefix is
   already organizer-gated in middleware.ts, so this route inherits that gate.
   Thin server shell: CompsClient owns the issue form, the issued list and the
   delivery-status tracking. The comps persistence is a typed seam today (there
   is no comps endpoint yet — see the SEAM note in comps-client). */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Comps — ZORA Dashboard',
  description: 'Issue and track complimentary passes for your events.',
  robots: { index: false, follow: false },
};

export default function CompsPage() {
  return <CompsClient />;
}
