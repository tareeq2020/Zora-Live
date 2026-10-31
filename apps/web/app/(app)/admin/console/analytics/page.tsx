'use client';

/* BS129: platform storefront analytics (super-admin). */
import { AdminConsoleShell } from '../console-shell';
import StorefrontAnalyticsView from '@/app/components/storefront-analytics-view';

export default function AdminAnalyticsPage() {
  return (
    <AdminConsoleShell title="Analytics">
      <StorefrontAnalyticsView endpoint="/api/admin/storefront-analytics" admin />
    </AdminConsoleShell>
  );
}
