import type { Metadata } from 'next';
import Link from 'next/link';
import { PassClaim } from './claim';
import styles from './pass.module.css';

/* Shared-ticket / QR landing (FRONTEND-PLAN §4, §6 F8). This is the URL a scanned
   ticket QR / shared pass link resolves to: /t/:code. It lives in the (app) group
   (app-plane chrome, no marketing nav/footer) and is keyed entirely by :code — the
   same code the ticket API renders (GET /api/tickets/:code.svg|.png) and the app
   deep link encodes (zora://t/:code). No dedicated JSON pass-resolve endpoint
   exists, so the landing is an MVP shell around the code: app-claim (deep link +
   store buttons) with a basic web-pass fallback that reveals the server-rendered
   pass image. The claim UX is ported from the legacy tenant checkout step 2. */

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: { code: string } }): Metadata {
  const title = `Your Zora pass · ${params.code}`;
  const description = 'Claim your pass in the Zora app, or use a basic web pass.';
  const canonical = `/t/${params.code}`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: false, follow: false },
    openGraph: { title, description, url: canonical, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default function TicketLandingPage({ params }: { params: { code: string } }) {
  const code = params.code;
  return (
    <main className={styles.wrap}>
      <p className={styles.eyebrow}>ZORA · YOUR PASS</p>
      <PassClaim code={code} />
      <div className={styles.foot}>
        <span>runs on zora</span>
        <Link href="/discover">← back to the marketplace</Link>
      </div>
    </main>
  );
}
