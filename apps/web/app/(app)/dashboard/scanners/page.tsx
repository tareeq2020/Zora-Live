import type { Metadata } from 'next';
import ScannersClient from './scanners-client';

/* PR-BS106 (#183) — the organizer DOOR STAFF screen at /dashboard/scanners.
   The /dashboard/* prefix is organizer-gated in middleware.ts, so this route
   inherits that gate. Owner/admin only (the API enforces it too). */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Door staff — ZORA Dashboard',
  description: 'Create and manage the door-scanning staff for your events.',
  robots: { index: false, follow: false },
};

export default function ScannersPage() {
  return <ScannersClient />;
}
