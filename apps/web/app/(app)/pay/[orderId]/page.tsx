import type { Metadata } from 'next';
import PayClient from './pay-client';

/* BS134 (F7 / A5 / DD5): the installment pass + pay page. The reminder SMS/email
   links here (installmentPayLink → /pay/<orderId>), and checkout's CHECK MY PASS
   opens it. Visual spec: PassReserved mockup (pass in progress, no QR until paid
   in full). All data is fetched client-side from GET /api/orders/:id/installments,
   which needs the checkout cookie or an SMS-OTP sign-in — the order id in the
   link alone shows nothing. */

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return {
    title: 'Your booking — ZoraPass',
    description: 'Pay the next installment for your ZoraPass booking.',
    robots: { index: false, follow: false },
  };
}

export default function PayPage({ params }: { params: { orderId: string } }) {
  return <PayClient orderId={params.orderId} />;
}
