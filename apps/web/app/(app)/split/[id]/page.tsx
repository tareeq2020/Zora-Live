import type { Metadata } from 'next';
import TrackClient from './track-client';

/* BS8 — /split/:id : the "who's paid" tracker (app plane, noindex — the split id
   is a private capability shared among the table). */

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: 'Your table · Zora', description: 'Track who has paid their share.', robots: { index: false, follow: false } };
}

export default function SplitTrackPage({ params }: { params: { id: string } }) {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <TrackClient id={params.id} />
    </>
  );
}
