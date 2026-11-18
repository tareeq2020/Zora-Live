import type { Metadata } from 'next';
import CardReturnClient from './card-return-client';

/* BS166: where x-bridge's hosted card page sends the buyer back
   (redirectUrl = /pay/card/<orderId>?card=return&tx=…, cancelUrl ?card=cancel).
   The redirect is never proof of payment: the page asks our API, which reads
   x-bridge's status for the card attempt. */

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return {
    title: 'Card payment — ZoraPass',
    description: 'Confirming your card payment.',
    robots: { index: false, follow: false },
  };
}

export default function CardReturnPage({
  params, searchParams,
}: {
  params: { orderId: string };
  searchParams: { card?: string; tx?: string };
}) {
  return <CardReturnClient orderId={params.orderId} cancelled={searchParams.card === 'cancel'} />;
}
