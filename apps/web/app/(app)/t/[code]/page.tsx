import type { Metadata } from 'next';
import Link from 'next/link';
import { PassClaim } from './claim';
import styles from './pass.module.css';

/* Shared-ticket / QR landing (FRONTEND-PLAN §4, §6 F8). This is the URL a scanned
   ticket QR / shared pass link resolves to: /t/:code. It lives in the (app) group
   (app-plane chrome, no marketing nav/footer) and is keyed by :code — the same
   code the ticket API renders (GET /api/tickets/:code.svg|.png) and the app deep
   link encodes (zora://t/:code). A multi-ticket buyer gets ONE SMS link (the first
   pass); GET /api/passes/:ref expands it to every pass in that order so the web
   page shows all of them, not just one (XBR-346). The claim UX is ported from the
   legacy tenant checkout step 2. */

const API_URL = process.env.API_URL || 'http://localhost:4101';

export const dynamic = 'force-dynamic';

// Every pass bought in the same order as :code. Falls back to the single code in
// the URL if the resolver is unreachable or the ref is unknown (studio previews).
async function loadPassRefs(code: string): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/api/passes/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (!res.ok) return [code];
    const data = await res.json();
    const refs = Array.isArray(data?.passes)
      ? data.passes.map((p: { ref?: string }) => p?.ref).filter((r: unknown): r is string => typeof r === 'string' && !!r)
      : [];
    return refs.length ? refs : [code];
  } catch {
    return [code];
  }
}

export function generateMetadata({ params }: { params: { code: string } }): Metadata {
  const title = `Your ZoraPass · ${params.code}`;
  const description = 'Claim your pass in the ZoraPass app, or use a basic web pass.';
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

export default async function TicketLandingPage({ params }: { params: { code: string } }) {
  const code = params.code;
  const codes = await loadPassRefs(code);
  return (
    <div className={styles.page}>
      <main className={styles.wrap}>
        <p className={styles.eyebrow}>{codes.length > 1 ? 'YOUR PASSES' : 'YOUR PASS'}</p>
        <PassClaim codes={codes} />
        <div className={styles.foot}>
          <span>ZORAPASS</span>
          <Link href="/discover">← SEE WHAT&apos;S ON</Link>
        </div>
      </main>
    </div>
  );
}
