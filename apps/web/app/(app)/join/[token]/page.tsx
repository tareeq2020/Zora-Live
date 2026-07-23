import type { Metadata } from 'next';
import JoinInvitee from './join-invitee';

/* BS7 — /join/:token : the cold WhatsApp invitee landing (app plane, no marketing
   chrome). Keyed entirely by the signed share token. noindex — invite links are
   private capabilities, not pages to crawl. */

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const title = 'Join the table · Zora';
  return {
    title,
    description: "You've been invited to split a table. Pay your share in seconds.",
    robots: { index: false, follow: false },
  };
}

export default function JoinPage({ params }: { params: { token: string } }) {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <JoinInvitee token={params.token} />
    </>
  );
}
