'use client';

import { CrShell } from '@/app/components/cr';
import StorefrontAnalyticsView from '@/app/components/storefront-analytics-view';
import { ORG_NAV } from '../components/org-nav';

const ORG_BRAND = { name: 'ZoraPass', sublabel: 'Organizer' };

export default function AnalyticsClient() {
  return (
    <CrShell nav={ORG_NAV} brand={ORG_BRAND} topbarTitle="Analytics">
      <StorefrontAnalyticsView endpoint="/api/org/storefront-analytics" />
    </CrShell>
  );
}
