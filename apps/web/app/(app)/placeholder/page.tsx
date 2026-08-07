import type { Metadata } from 'next';
import ComingSoon from './coming-soon';

// BS24 → BS27: the apex home is a deliberate PLACEHOLDER while the marketplace
// home is still being built. middleware rewrites '/' here (was → /discover).
// Discovery stays reachable directly at /discover (and via the header link), so
// restoring it as home is a one-line revert in middleware.ts. BS27 replaces the
// static placeholder with the cinematic "coming soon" landing.

export const metadata: Metadata = {
  title: 'Zora — coming soon',
  description:
    'Zora is the operating system for live experiences in Africa. Going live soon — explore what’s live today.',
};

export default function PlaceholderPage() {
  return <ComingSoon />;
}
