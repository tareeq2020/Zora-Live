import type { Metadata } from 'next';
import ConfigureClient from './configure-client';

/* BS8 — /split/new : the host configures + starts a table split. Parameterized by
   the table tier via query (?tier=&event=&price=&cap=), linked from the event page
   "Split this table" CTA. App plane, noindex. */

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: 'Split a table · ZoraPass', robots: { index: false, follow: false } };
}

export default function SplitNewPage({ searchParams }: { searchParams: { tier?: string; event?: string; price?: string; cap?: string } }) {
  const tierId = searchParams.tier || '';
  const eventName = searchParams.event || 'this event';
  const unitPrice = Number(searchParams.price) || 0;
  const capMax = Math.max(2, Number(searchParams.cap) || 8);

  return (
    <>
      {tierId && unitPrice > 0 ? (
        <ConfigureClient tierId={tierId} eventName={eventName} unitPrice={unitPrice} capMax={capMax} />
      ) : (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--zp-color-bone)', color: 'var(--zp-color-board-black)', fontFamily: 'var(--zp-font-family-sans)', fontSize: 16, padding: 24, textAlign: 'center' }}>
          <p>Pick a splittable table from an event to start.<br /><a href="/discover" style={{ color: 'var(--zp-color-board-black)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>See what&apos;s on →</a></p>
        </div>
      )}
    </>
  );
}
