import type { Metadata } from 'next';
import JoinInvitee from './join-invitee';

/* BS7 — /join/:token : the cold WhatsApp invitee landing (app plane, no marketing
   chrome). Keyed entirely by the signed share token. noindex — invite links are
   private capabilities, not pages to crawl. */

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const title = 'Join the table · ZoraPass';
  return {
    title,
    description: "You've been invited to split a table. Pay your share in seconds.",
    robots: { index: false, follow: false },
  };
}

export default function JoinPage({ params }: { params: { token: string } }) {
  return (
    <>
      <JoinInvitee token={params.token} />
    </>
  );
}
