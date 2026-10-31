import type { Metadata } from 'next';
import TrackClient from './track-client';

/* BS8 — /split/:id : the "who's paid" tracker (app plane, noindex — the split id
   is a private capability shared among the table). */

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: 'Your table · ZoraPass', description: 'Track who has paid their share.', robots: { index: false, follow: false } };
}

export default function SplitTrackPage({ params }: { params: { id: string } }) {
  return (
    <>
      <TrackClient id={params.id} />
    </>
  );
}
