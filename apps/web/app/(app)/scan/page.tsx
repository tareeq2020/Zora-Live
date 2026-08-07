import type { Metadata, Viewport } from 'next';
import { SCAN_STYLE } from './scan-style';
import { ScanClient } from './scan-client';

/* BS44 (#1) — the DOOR. A phone-held scanner for gate staff, not a consumer page.

   DESIGN.md "Door / scanner" plane: Zora's dark shell + type, but the cinematic
   layer (shimmer, particles, aura text, ambient motion) is DROPPED at the result,
   because a bouncer has to read PASS or FAIL in half a second, in the dark, one
   handed. The result is a full-screen SOLID-COLOUR takeover; the aura gradient is
   reserved for the single case that means "escalate to a supervisor".

   Everything is scoped under `.zscan` (this repo has no Tailwind — every page
   owns a self-contained style block), so the door's look can never leak into the
   consumer or control-room planes. */

export const metadata: Metadata = {
  title: 'Zora — Door scanner',
  description: 'Scan passes at the gate.',
  robots: { index: false, follow: false },
};

// A door tool lives on a phone: full-bleed under the notch, and no zoom-jump when
// the code field focuses. Next 14 wants this as its own export — inside `metadata`
// it is silently ignored, which is exactly the bug this avoids.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A0B10',
};

export default function ScanPage() {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: SCAN_STYLE }} />
      <ScanClient />
    </>
  );
}
