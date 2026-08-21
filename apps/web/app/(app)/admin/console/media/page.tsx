/* PR-BS89 · Control-Room console — super-admin Media page. */

import AdminMediaClient from './media-client';

export const dynamic = 'force-dynamic';

export default function AdminConsoleMediaPage() {
  return <AdminMediaClient />;
}
